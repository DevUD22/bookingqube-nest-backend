import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus, PaymentStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  formatPaymentProviderLabel,
  normalizePaymentMethodLabel,
  resolvePaymentMethodKeyLabel,
} from '../admin-payment-settings/payment-method-labels';
import { InventoryService } from '../inventory/inventory.service';
import { BookingJobsService } from '../queues/booking-jobs.service';
import {
  AdminOrderListQueryDto,
  UpdateAdminOrderDto,
} from './dto/admin-order.dto';

const orderDetailInclude = {
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      status: true,
      customerProfile: { select: { address: true, defaultLocale: true } },
    },
  },
  event: {
    include: {
      translations: true,
      organization: { select: { id: true, slug: true, name: true } },
    },
  },
  eventSession: {
    include: {
      eventDate: true,
    },
  },
  items: {
    orderBy: { createdAt: 'asc' as const },
  },
  payments: {
    orderBy: { createdAt: 'desc' as const },
  },
  refunds: {
    orderBy: { createdAt: 'desc' as const },
  },
  taxLines: true,
  hold: {
    include: { items: true },
  },
  promo: {
    select: { id: true, code: true, discountType: true, discountValue: true },
  },
} satisfies Prisma.OrderInclude;

@Injectable()
export class AdminOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly jobs: BookingJobsService,
  ) {}

  async list(
    query: AdminOrderListQueryDto,
    scopedEventIds?: string[] | null,
    scopedVendorIds?: string[] | null,
  ) {
    if (
      (scopedEventIds && !scopedEventIds.length) ||
      (scopedVendorIds && !scopedVendorIds.length)
    ) {
      return {
        success: true,
        data: {
          orders: [],
          pagination: { page: query.page ?? 1, per_page: query.per_page ?? 20, total: 0, total_pages: 1 },
          status_counts: {},
          filters: {
            search: query.search ?? null,
            status: query.status ?? null,
            payment_status: query.payment_status ?? null,
            event_id: query.event_id ?? null,
            organization_id: query.organization_id ?? null,
            from: query.from ?? null,
            to: query.to ?? null,
          },
          event_options: [],
        },
      };
    }

    if (
      scopedEventIds &&
      query.event_id &&
      !scopedEventIds.includes(query.event_id)
    ) {
      throw new BadRequestException('You do not have access to this event.');
    }

    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where = this.buildWhere(query, scopedEventIds, scopedVendorIds);

    const [total, statusGroups, orders, events] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: this.buildWhere(
          { ...query, status: undefined },
          scopedEventIds,
          scopedVendorIds,
        ),
      }),
      this.prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          event: {
            include: {
              translations: true,
              organization: { select: { id: true, name: true, slug: true } },
            },
          },
          eventSession: { include: { eventDate: true } },
          items: true,
          payments: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.event.findMany({
        where: {
          status: { not: 'archived' },
          ...(query.organization_id ? { organizationId: query.organization_id } : {}),
          ...(scopedEventIds ? { id: { in: scopedEventIds } } : {}),
        },
        select: { id: true, slug: true, translations: true },
        orderBy: { updatedAt: 'desc' },
        take: 200,
      }),
    ]);

    const statusCounts = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    ) as Partial<Record<OrderStatus, number>>;

    return {
      success: true,
      data: {
        orders: orders.map((order) =>
          this.toListRow(order, query.lang ?? 'en', scopedVendorIds),
        ),
        pagination: {
          page,
          per_page: perPage,
          total,
          total_pages: Math.max(1, Math.ceil(total / perPage)),
        },
        status_counts: statusCounts,
        filters: {
          search: query.search ?? null,
          status: query.status ?? null,
          payment_status: query.payment_status ?? null,
          event_id: query.event_id ?? null,
          organization_id: query.organization_id ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
        event_options: events.map((event) => ({
          id: event.id,
          slug: event.slug,
          title: this.eventTitle(event.translations, query.lang ?? 'en'),
        })),
      },
    };
  }

  async getEventId(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { eventId: true },
    });
    return order?.eventId ?? null;
  }

  /** Event + line-item vendor ids for staff access checks. */
  async getAccessMeta(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        eventId: true,
        items: { select: { thirdPartyVendorId: true } },
      },
    });
    if (!order) return null;
    return {
      eventId: order.eventId,
      vendorIds: [
        ...new Set(
          order.items
            .map((item) => item.thirdPartyVendorId)
            .filter((id): id is string => Boolean(id)),
        ),
      ],
    };
  }

  async get(
    id: string,
    lang = 'en',
    scopedVendorIds?: string[] | null,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: orderDetailInclude,
    });
    if (!order) throw new NotFoundException('Order not found.');
    const scoped =
      scopedVendorIds && scopedVendorIds.length
        ? {
            ...order,
            items: order.items.filter(
              (item) =>
                item.thirdPartyVendorId &&
                scopedVendorIds.includes(item.thirdPartyVendorId),
            ),
          }
        : order;
    return { success: true, data: await this.toDetail(scoped, lang) };
  }

  async update(
    id: string,
    body: UpdateAdminOrderDto,
    lang = 'en',
    scopedVendorIds?: string[] | null,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      include: { customer: true },
    });
    if (!existing) throw new NotFoundException('Order not found.');

    if (body.status && body.status !== existing.status) {
      this.assertStatusTransition(existing.status, body.status);
    }

    await this.prisma.$transaction(async (tx) => {
      if (body.customer_name !== undefined || body.customer_phone !== undefined) {
        await tx.user.update({
          where: { id: existing.customerId },
          data: {
            ...(body.customer_name !== undefined
              ? { name: body.customer_name.trim() || existing.customer.name }
              : {}),
            ...(body.customer_phone !== undefined
              ? { phone: body.customer_phone?.trim() || null }
              : {}),
          },
        });
      }

      await tx.order.update({
        where: { id },
        data: {
          ...(body.status ? { status: body.status } : {}),
          ...(body.status === 'cancelled' && existing.status !== 'cancelled'
            ? { cancelledAt: new Date() }
            : {}),
          ...(body.locale !== undefined ? { locale: body.locale } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.waiver_accepted !== undefined
            ? { waiverAccepted: body.waiver_accepted }
            : {}),
          ...(body.waiver_signed_by !== undefined
            ? { waiverSignedBy: body.waiver_signed_by }
            : {}),
          ...(body.customer_name !== undefined
            ? {
                customerName: body.customer_name.trim() || existing.customer.name,
                reportVersion: { increment: 1 },
              }
            : {}),
          ...(body.customer_phone !== undefined
            ? {
                customerPhone: body.customer_phone?.trim() || null,
                reportVersion: { increment: 1 },
              }
            : {}),
        },
      });
    });

    if (body.status === 'cancelled' && existing.status !== 'cancelled') {
      await this.releaseInventoryForOrder(id);
      await this.jobs.enqueueReportSync({ orderId: id, action: 'expire' });
    }

    return this.get(id, lang, scopedVendorIds);
  }

  async remove(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        hold: { include: { items: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found.');
    if (order.status === 'cancelled') {
      return {
        success: true,
        message: 'Order already cancelled.',
        data: { id: order.id, status: order.status },
      };
    }

    await this.releaseInventoryForOrder(id);

    await this.prisma.order.update({
      where: { id },
      data: {
        status: 'cancelled',
        cancelledAt: new Date(),
        paymentStatus:
          order.paymentStatus === PaymentStatus.paid
            ? PaymentStatus.refunded
            : order.paymentStatus,
      },
    });

    if (order.holdId && order.hold?.status === 'active') {
      await this.prisma.ticketHold.update({
        where: { id: order.holdId },
        data: { status: 'released' },
      });
      await this.jobs.cancelHoldExpiry(order.holdId);
    }

    await this.jobs.enqueueReportSync({
      orderId: id,
      action: order.status === 'paid' ? 'refund' : 'expire',
    });

    return {
      success: true,
      message: 'Order cancelled and inventory released.',
      data: { id: order.id, common_order: order.commonOrder, status: 'cancelled' },
    };
  }

  private async releaseInventoryForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        hold: { include: { items: true } },
      },
    });
    if (!order || order.status === 'cancelled' || order.status === 'expired') return;

    const deltas = order.items
      .filter((item) => item.inventoryItemId)
      .map((item) => ({
        inventoryItemId: item.inventoryItemId!,
        quantity: item.quantity,
      }));

    if (order.status === 'pending_payment') {
      if (order.hold?.status === 'active' && order.hold.items.length > 0) {
        await this.inventory.release(
          order.hold.items.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            quantity: item.quantity,
          })),
        );
      } else if (deltas.length > 0) {
        await this.inventory.release(deltas);
      }
      return;
    }

    if (
      order.status === 'paid' ||
      order.status === 'refunded' ||
      order.status === 'partially_refunded'
    ) {
      if (deltas.length > 0) await this.inventory.releaseSold(deltas);
    }
  }

  private assertStatusTransition(from: OrderStatus, to: OrderStatus) {
    if (from === to) return;
    const allowed: Partial<Record<OrderStatus, OrderStatus[]>> = {
      pending_payment: ['cancelled', 'paid', 'expired'],
      paid: ['cancelled', 'refunded', 'partially_refunded'],
      partially_refunded: ['refunded', 'cancelled'],
      expired: ['cancelled'],
    };
    if (!allowed[from]?.includes(to)) {
      throw new BadRequestException(`Cannot change order status from ${from} to ${to}.`);
    }
  }

  private buildWhere(
    query: AdminOrderListQueryDto,
    scopedEventIds?: string[] | null,
    scopedVendorIds?: string[] | null,
  ): Prisma.OrderWhereInput {
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) {
      const from = new Date(query.from);
      if (Number.isNaN(from.getTime())) throw new BadRequestException('Invalid from date.');
      createdAt.gte = from;
    }
    if (query.to) {
      const to = new Date(query.to);
      if (Number.isNaN(to.getTime())) throw new BadRequestException('Invalid to date.');
      to.setHours(23, 59, 59, 999);
      createdAt.lte = to;
    }

    const search = query.search?.trim();
    const vendorFilter =
      scopedVendorIds && scopedVendorIds.length
        ? {
            items: {
              some: {
                thirdPartyVendorId:
                  scopedVendorIds.length === 1
                    ? scopedVendorIds[0]
                    : { in: scopedVendorIds },
              },
            },
          }
        : {};

    return {
      ...(query.status ? { status: query.status } : {}),
      ...(query.payment_status ? { paymentStatus: query.payment_status } : {}),
      ...(query.event_id
        ? { eventId: query.event_id }
        : scopedEventIds
          ? { eventId: { in: scopedEventIds } }
          : {}),
      ...(query.organization_id ? { event: { organizationId: query.organization_id } } : {}),
      ...vendorFilter,
      ...(Object.keys(createdAt).length > 0 ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { commonOrder: { contains: search, mode: 'insensitive' } },
              { idempotencyKey: { contains: search, mode: 'insensitive' } },
              { customer: { name: { contains: search, mode: 'insensitive' } } },
              { customer: { email: { contains: search, mode: 'insensitive' } } },
              { customer: { phone: { contains: search, mode: 'insensitive' } } },
              { items: { some: { ticketCode: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
  }

  private visibleItems<
    T extends { itemType: string; quantity: number; thirdPartyVendorId?: string | null },
  >(items: T[], scopedVendorIds?: string[] | null): T[] {
    if (!scopedVendorIds || !scopedVendorIds.length) return items;
    return items.filter(
      (item) =>
        item.thirdPartyVendorId && scopedVendorIds.includes(item.thirdPartyVendorId),
    );
  }

  private toListRow(
    order: {
      id: string;
      commonOrder: string;
      status: OrderStatus;
      paymentStatus: PaymentStatus;
      currency: string;
      subtotalAmount: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      source: string;
      createdAt: Date;
      paidAt: Date | null;
      cancelledAt: Date | null;
      customer: { id: string; name: string; email: string; phone: string | null };
      event: {
        id: string;
        slug: string;
        translations: Array<{ locale: string; title: string }>;
        organization: { id: string; name: string; slug: string };
      };
      eventSession: {
        displayTime: string;
        eventDate: { date: Date };
      };
      items: Array<{
        quantity: number;
        itemType: string;
        displayName: string;
        thirdPartyVendorId?: string | null;
        totalAmount?: Prisma.Decimal;
      }>;
      payments: Array<{ status: string; methodKey: string; provider: string }>;
    },
    lang: string,
    scopedVendorIds?: string[] | null,
  ) {
    const items = this.visibleItems(order.items, scopedVendorIds);
    const ticketQty = items
      .filter((item) => item.itemType === 'ticket_type' || item.itemType === 'ticket_variant')
      .reduce((sum, item) => sum + item.quantity, 0);
    const addonQty = items
      .filter((item) => item.itemType === 'addon' || item.itemType === 'addon_variant')
      .reduce((sum, item) => sum + item.quantity, 0);
    const cafeQty = items
      .filter((item) => item.itemType === 'cafe_item')
      .reduce((sum, item) => sum + item.quantity, 0);
    const vendorScoped = Boolean(scopedVendorIds?.length);
    const scopedTotal = vendorScoped
      ? items.reduce(
          (sum, item) => sum + (item.totalAmount ? item.totalAmount.toNumber() : 0),
          0,
        )
      : null;
    return {
      id: order.id,
      common_order: order.commonOrder,
      status: order.status,
      payment_status: order.paymentStatus,
      currency: order.currency,
      subtotal_amount: this.money(order.subtotalAmount),
      discount_amount: this.money(order.discountAmount),
      tax_amount: this.money(order.taxAmount),
      total_amount:
        scopedTotal !== null ? this.money(scopedTotal) : this.money(order.totalAmount),
      tickets_net: this.money((order as { ticketsNet?: Prisma.Decimal }).ticketsNet ?? 0),
      addons_net: this.money((order as { addonsNet?: Prisma.Decimal }).addonsNet ?? 0),
      total_admits: vendorScoped
        ? ticketQty
        : ((order as { totalAdmits?: number }).totalAdmits ?? ticketQty),
      payment_mode: (order as { paymentMode?: string }).paymentMode ?? null,
      payment_method_label: normalizePaymentMethodLabel(
        (order as { paymentMethodLabel?: string }).paymentMethodLabel ?? null,
      ),
      source: order.source,
      ticket_quantity: ticketQty,
      addon_quantity: addonQty,
      cafe_quantity: cafeQty,
      line_count: items.length,
      created_at: order.createdAt.toISOString(),
      paid_at: order.paidAt?.toISOString() ?? null,
      cancelled_at: order.cancelledAt?.toISOString() ?? null,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
      },
      event: {
        id: order.event.id,
        slug: order.event.slug,
        title: this.eventTitle(order.event.translations, lang),
        organization: order.event.organization,
      },
      session: {
        date: order.eventSession.eventDate.date.toISOString().slice(0, 10),
        time: order.eventSession.displayTime,
      },
      latest_payment: order.payments[0]
        ? {
            status: order.payments[0].status,
            method_key: order.payments[0].methodKey,
            method_label: resolvePaymentMethodKeyLabel(
              order.payments[0].methodKey,
            ),
            provider: order.payments[0].provider,
            provider_label: formatPaymentProviderLabel(
              order.payments[0].provider,
            ),
          }
        : null,
    };
  }

  private async toDetail(
    order: Prisma.OrderGetPayload<{ include: typeof orderDetailInclude }>,
    lang: string,
  ) {
    const ticketTypeIds = [
      ...new Set(
        order.items
          .filter((item) => item.itemType === 'ticket_type')
          .map((item) => item.itemId),
      ),
    ];
    const variantIds = [
      ...new Set(
        order.items
          .filter((item) => item.itemType === 'ticket_variant')
          .map((item) => item.itemId),
      ),
    ];

    const [ticketTypes, variants] = await Promise.all([
      ticketTypeIds.length
        ? this.prisma.ticketType.findMany({
            where: { id: { in: ticketTypeIds } },
            select: { id: true, title: true },
          })
        : Promise.resolve([]),
      variantIds.length
        ? this.prisma.ticketVariant.findMany({
            where: { id: { in: variantIds } },
            select: {
              id: true,
              name: true,
              externalKey: true,
              ticketTypeId: true,
              ticketType: { select: { id: true, title: true } },
            },
          })
        : Promise.resolve([]),
    ]);

    const ticketTypeById = new Map(ticketTypes.map((row) => [row.id, row]));
    const variantById = new Map(variants.map((row) => [row.id, row]));

    const legacyPackByTicketCode = this.legacyPackLookup(order.metadata);

    return {
      id: order.id,
      common_order: order.commonOrder,
      idempotency_key: order.idempotencyKey,
      status: order.status,
      payment_status: order.paymentStatus,
      currency: order.currency,
      subtotal_amount: this.money(order.subtotalAmount),
      discount_amount: this.money(order.discountAmount),
      tax_amount: this.money(order.taxAmount),
      total_amount: this.money(order.totalAmount),
      promo_code: order.promoCode,
      promo: order.promo
        ? {
            id: order.promo.id,
            code: order.promo.code,
            discount_type: order.promo.discountType,
            discount_value: this.money(order.promo.discountValue),
          }
        : null,
      source: order.source,
      locale: order.locale,
      waiver_accepted: order.waiverAccepted,
      waiver_signed_by: order.waiverSignedBy,
      waiver_accepted_at: order.waiverAcceptedAt?.toISOString() ?? null,
      metadata: order.metadata,
      created_at: order.createdAt.toISOString(),
      updated_at: order.updatedAt.toISOString(),
      paid_at: order.paidAt?.toISOString() ?? null,
      cancelled_at: order.cancelledAt?.toISOString() ?? null,
      hold_id: order.holdId,
      hold: order.hold
        ? {
            id: order.hold.id,
            status: order.hold.status,
            expires_at: order.hold.expiresAt.toISOString(),
          }
        : null,
      customer: {
        id: order.customer.id,
        name: order.customer.name,
        email: order.customer.email,
        phone: order.customer.phone,
        status: order.customer.status,
        address: order.customer.customerProfile?.address ?? null,
        default_locale: order.customer.customerProfile?.defaultLocale ?? null,
      },
      event: {
        id: order.event.id,
        slug: order.event.slug,
        title: this.eventTitle(order.event.translations, lang),
        organization: order.event.organization,
      },
      session: {
        id: order.eventSession.id,
        date: order.eventSession.eventDate.date.toISOString().slice(0, 10),
        time: order.eventSession.displayTime,
        starts_at: order.eventSession.startsAt.toISOString(),
      },
      items: order.items.map((item) => {
        const variant =
          item.itemType === 'ticket_variant' ? variantById.get(item.itemId) : undefined;
        const ticketType =
          item.itemType === 'ticket_type'
            ? ticketTypeById.get(item.itemId)
            : variant?.ticketType;
        const legacyPackId =
          (item.ticketCode ? legacyPackByTicketCode.get(item.ticketCode) : undefined) ??
          this.legacyPackIdFromExternalKey(variant?.externalKey);

        return {
          id: item.id,
          item_type: item.itemType,
          item_id: item.itemId,
          parent_order_item_id: item.parentOrderItemId ?? null,
          inventory_item_id: item.inventoryItemId,
          display_name: item.displayName,
          ticket_title: ticketType?.title ?? null,
          variant_name: variant?.name ?? null,
          ticket_type_id: ticketType?.id ?? null,
          ticket_variant_id:
            item.itemType === 'ticket_variant' ? item.itemId : null,
          legacy_playtime_pack_id: legacyPackId,
          quantity: item.quantity,
          unit_price: this.money(item.unitPrice),
          subtotal_amount: this.money(item.subtotalAmount),
          discount_amount: this.money(item.discountAmount),
          tax_amount: this.money(item.taxAmount),
          total_amount: this.money(item.totalAmount),
          currency: item.currency,
          ticket_code: item.ticketCode,
          attendance_status: item.attendanceStatus,
          checked_in_at: item.checkedInAt?.toISOString() ?? null,
        };
      }),
      payments: order.payments.map((payment) => ({
        id: payment.id,
        provider: payment.provider,
        provider_label: formatPaymentProviderLabel(payment.provider),
        method_key: payment.methodKey,
        method_label: resolvePaymentMethodKeyLabel(
          payment.methodKey,
          (payment as { providerPaymentMethodId?: number | null })
            .providerPaymentMethodId,
        ),
        status: payment.status,
        amount: this.money(payment.amount),
        currency: payment.currency,
        provider_invoice_id: payment.providerInvoiceId,
        provider_payment_id: payment.providerPaymentId,
        provider_session_id: payment.providerSessionId,
        paid_at: payment.paidAt?.toISOString() ?? null,
        failed_at: payment.failedAt?.toISOString() ?? null,
        created_at: payment.createdAt.toISOString(),
      })),
      refunds: order.refunds.map((refund) => ({
        id: refund.id,
        status: refund.status,
        amount: this.money(refund.amount),
        currency: refund.currency,
        created_at: refund.createdAt.toISOString(),
      })),
      tax_lines: order.taxLines.map((line) => ({
        id: line.id,
        title: line.title,
        rate_type: line.rateType,
        rate: this.money(line.rate),
        tax_type: line.taxType,
        taxable_amount: this.money(line.taxableAmount),
        tax_amount: this.money(line.taxAmount),
      })),
    };
  }

  /** Map ticket_code (legacy order_number) → playtime_pack_id from order metadata. */
  private legacyPackLookup(metadata: Prisma.JsonValue | null): Map<string, number> {
    const map = new Map<string, number>();
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return map;
    const legacy = (metadata as Record<string, unknown>).legacy;
    if (!legacy || typeof legacy !== 'object' || Array.isArray(legacy)) return map;
    const lines = (legacy as Record<string, unknown>).booking_lines;
    if (!Array.isArray(lines)) return map;
    for (const raw of lines) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      const line = raw as Record<string, unknown>;
      const orderNumber =
        line.order_number != null ? String(line.order_number).trim() : '';
      const packId = Number(line.playtime_pack_id);
      if (orderNumber && Number.isFinite(packId) && packId > 0) {
        map.set(orderNumber, packId);
      }
    }
    return map;
  }

  private legacyPackIdFromExternalKey(externalKey: string | null | undefined): number | null {
    if (!externalKey) return null;
    const match = /^legacy-pack-(\d+)$/.exec(externalKey);
    if (!match) return null;
    const id = Number(match[1]);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  private eventTitle(
    translations: Array<{ locale: string; title: string }>,
    lang: string,
  ) {
    return (
      translations.find((item) => item.locale === lang)?.title ??
      translations.find((item) => item.locale === 'en')?.title ??
      translations[0]?.title ??
      'Untitled event'
    );
  }

  private money(value: Prisma.Decimal | number) {
    return typeof value === 'number' ? value : value.toNumber();
  }
}
