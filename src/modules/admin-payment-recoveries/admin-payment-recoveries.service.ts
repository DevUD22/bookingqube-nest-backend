import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CustomerPaymentRecoveryStatus,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  coerceOnlinePaymentMethodId,
  resolveMyFatoorahMethodIdFromHints,
} from '../admin-payment-settings/payment-method-labels';
import { CheckoutService } from '../checkout/checkout.service';
import { BookTicketRequestDto } from '../checkout/dto/book-ticket.dto';
import { MpgsCheckoutService } from '../checkout/mpgs-checkout.service';
import { PaymentRecoveryService } from '../checkout/payment-recovery.service';
import { MyFatoorahService } from '../myfatoorah/myfatoorah.service';
import { AdminPaymentRecoveryListQueryDto } from './dto/admin-payment-recovery.dto';

@Injectable()
export class AdminPaymentRecoveriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly checkout: CheckoutService,
    private readonly myFatoorah: MyFatoorahService,
    private readonly mpgs: MpgsCheckoutService,
    private readonly paymentRecovery: PaymentRecoveryService,
  ) {}

  async list(query: AdminPaymentRecoveryListQueryDto, scopedEventIds: string[] | null) {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const where: Prisma.CustomerPaymentRecoveryWhereInput = {};

    if (query.status) where.status = query.status;
    if (query.reason) where.reason = query.reason;
    if (query.gateway) where.gateway = query.gateway;
    if (query.event_id) where.eventId = query.event_id;
    if (scopedEventIds !== null) {
      where.OR = [
        { eventId: { in: scopedEventIds } },
        { eventId: null },
      ];
    }

    const search = query.search?.trim();
    if (search) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        {
          OR: [
            { commonOrder: { contains: search, mode: 'insensitive' } },
            { customerEmail: { contains: search, mode: 'insensitive' } },
            { idempotencyKey: { contains: search, mode: 'insensitive' } },
            { providerSessionId: { contains: search, mode: 'insensitive' } },
            { providerInvoiceId: { contains: search, mode: 'insensitive' } },
            { providerPaymentId: { contains: search, mode: 'insensitive' } },
            { eventSlug: { contains: search, mode: 'insensitive' } },
          ],
        },
      ];
    }

    const [total, rows, statusGroups] = await Promise.all([
      this.prisma.customerPaymentRecovery.count({ where }),
      this.prisma.customerPaymentRecovery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          customer: { select: { id: true, name: true, email: true, phone: true } },
          event: {
            select: {
              id: true,
              slug: true,
              translations: {
                where: { locale: 'en' },
                take: 1,
                select: { title: true },
              },
            },
          },
          order: { select: { id: true, commonOrder: true, status: true } },
        },
      }),
      this.prisma.customerPaymentRecovery.groupBy({
        by: ['status'],
        _count: { _all: true },
        where: scopedEventIds !== null
          ? { OR: [{ eventId: { in: scopedEventIds } }, { eventId: null }] }
          : undefined,
      }),
    ]);

    const statusCounts = Object.fromEntries(
      statusGroups.map((row) => [row.status, row._count._all]),
    );

    return {
      success: true,
      data: {
        recoveries: rows.map((row) => this.toListItem(row)),
        pagination: {
          page,
          per_page: perPage,
          total,
          total_pages: Math.max(1, Math.ceil(total / perPage)),
        },
        status_counts: statusCounts,
      },
    };
  }

  async getById(id: string, scopedEventIds: string[] | null) {
    const row = await this.loadScoped(id, scopedEventIds);
    return {
      success: true,
      data: this.toDetail(row),
    };
  }

  /**
   * Ask the payment gateway (or local hosted callback for QPay) whether money
   * was actually captured. Does not change order status.
   */
  async verify(id: string, scopedEventIds: string[] | null) {
    const row = await this.loadScoped(id, scopedEventIds);
    const verification = await this.verifyWithGateway(row);

    const snapshot = {
      ...((row.checkoutSnapshotJson as Record<string, unknown>) ?? {}),
      last_gateway_verify: {
        at: new Date().toISOString(),
        paid: verification.paid,
        message: verification.message,
        source: verification.source,
        refs: verification.refs,
      },
    };

    await this.prisma.customerPaymentRecovery.update({
      where: { id: row.id },
      data: {
        providerSessionId:
          verification.refs.sessionId ?? row.providerSessionId,
        providerInvoiceId:
          verification.refs.invoiceId != null
            ? String(verification.refs.invoiceId)
            : row.providerInvoiceId,
        providerPaymentId:
          verification.refs.paymentId ?? row.providerPaymentId,
        checkoutSnapshotJson: snapshot as Prisma.InputJsonValue,
        ...(verification.paid
          ? { failureMessage: null }
          : {
              failureMessage:
                verification.message ||
                row.failureMessage ||
                'Gateway reports payment not completed.',
            }),
      },
    });

    const refreshed = await this.loadScoped(id, scopedEventIds);
    return {
      success: true,
      message: verification.message,
      data: {
        ...this.toDetail(refreshed),
        gateway_verify: {
          paid: verification.paid,
          message: verification.message,
          source: verification.source,
          can_confirm: verification.paid && refreshed.status === 'open',
          detail: verification.detail ?? null,
        },
      },
    };
  }

  /**
   * If the customer paid but booking never confirmed, mark the order paid
   * (same path as /payments/confirm) and resolve this recovery.
   * When no order exists yet (e.g. payment_ok_booking_failed), rebuild from
   * the checkout snapshot as a paid bookTicket.
   */
  async confirm(
    id: string,
    scopedEventIds: string[] | null,
    force = false,
    rebuildCart?: {
      event_slug?: string;
      schedule?: { date?: string; time?: string };
      tickets?: unknown[];
      addons?: unknown[];
      payment_method?: number;
      customer?: {
        user_id?: string | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      };
    },
  ) {
    let row = await this.loadScoped(id, scopedEventIds);
    if (row.status !== 'open' && !force) {
      throw new BadRequestException(
        `Recovery is already ${row.status}. Pass force=true to retry.`,
      );
    }

    if (rebuildCart?.event_slug || rebuildCart?.tickets?.length) {
      const previous =
        (row.checkoutSnapshotJson as Record<string, unknown>) ?? {};
      const mergedSnapshot = {
        ...previous,
        event_slug: rebuildCart.event_slug ?? previous.event_slug,
        schedule: rebuildCart.schedule ?? previous.schedule,
        tickets: rebuildCart.tickets ?? previous.tickets,
        addons: rebuildCart.addons ?? previous.addons,
        payment_method:
          rebuildCart.payment_method ?? previous.payment_method ?? null,
        customer: rebuildCart.customer ?? previous.customer,
        idempotency_key:
          previous.idempotency_key ?? row.idempotencyKey ?? null,
      };
      row = await this.prisma.customerPaymentRecovery.update({
        where: { id: row.id },
        data: {
          eventSlug:
            (typeof mergedSnapshot.event_slug === 'string'
              ? mergedSnapshot.event_slug
              : row.eventSlug) ?? null,
          checkoutSnapshotJson: mergedSnapshot as Prisma.InputJsonValue,
        },
        include: {
          customer: {
            select: { id: true, name: true, email: true, phone: true },
          },
          event: {
            select: {
              id: true,
              slug: true,
              translations: {
                where: { locale: 'en' },
                take: 1,
                select: { title: true },
              },
            },
          },
          order: {
            select: {
              id: true,
              commonOrder: true,
              status: true,
              paymentStatus: true,
              totalAmount: true,
              currency: true,
            },
          },
        },
      });
    }

    const snapshot = (row.checkoutSnapshotJson as Record<string, unknown>) ?? {};
    const canRebuild = this.snapshotCanRebuildBooking(snapshot, row);
    if (
      !row.commonOrder &&
      !row.idempotencyKey &&
      !row.orderId &&
      !canRebuild
    ) {
      throw new BadRequestException(
        'Recovery has no order reference or checkout snapshot to confirm.',
      );
    }

    if (!force) {
      const verification = await this.verifyWithGateway(row);
      if (!verification.paid) {
        throw new BadRequestException(
          verification.message ||
            'Gateway does not show a successful payment. Verify first, or use force only if you confirmed in the gateway portal.',
        );
      }
      // Persist freshest ids before confirm; also backfill payment_method when missing.
      const enrichedSnapshot: Record<string, unknown> = {
        ...snapshot,
        ...(verification.detail ? { payment: verification.detail } : {}),
      };
      const inferredMethod = this.resolveRecoveryPaymentMethodId(
        enrichedSnapshot,
        row.gateway,
      );
      if (inferredMethod != null) {
        enrichedSnapshot.payment_method = inferredMethod;
      }
      await this.prisma.customerPaymentRecovery.update({
        where: { id: row.id },
        data: {
          providerSessionId:
            verification.refs.sessionId ?? row.providerSessionId,
          providerInvoiceId:
            verification.refs.invoiceId != null
              ? String(verification.refs.invoiceId)
              : row.providerInvoiceId,
          providerPaymentId:
            verification.refs.paymentId ?? row.providerPaymentId,
          checkoutSnapshotJson: enrichedSnapshot as Prisma.InputJsonValue,
        },
      });
    }

    let order = await this.findOrderForRecovery(row);

    if (!order) {
      // Reload so rebuild sees payment_method / payment detail we just persisted.
      row = await this.loadScoped(id, scopedEventIds);
      const rebuild = await this.rebuildPaidBookingFromSnapshot(row);
      order = rebuild.order;
      await this.paymentRecovery.resolve({
        commonOrder: order.commonOrder,
        orderId: order.id,
        idempotencyKey: row.idempotencyKey,
        providerSessionId: row.providerSessionId,
      });
      const refreshed = await this.loadScoped(id, scopedEventIds);
      return {
        success: true,
        message:
          rebuild.message ||
          'Booking created and confirmed from recovery snapshot.',
        data: this.toDetail(refreshed),
      };
    }

    if (order.status === 'paid') {
      await this.paymentRecovery.resolve({
        commonOrder: order.commonOrder,
        orderId: order.id,
        idempotencyKey: row.idempotencyKey,
        providerSessionId: row.providerSessionId,
      });
      const refreshed = await this.loadScoped(id, scopedEventIds);
      return {
        success: true,
        message: 'Order was already paid. Recovery marked resolved.',
        data: this.toDetail(refreshed),
      };
    }

    const latest = await this.prisma.customerPaymentRecovery.findUniqueOrThrow({
      where: { id: row.id },
    });

    const snapshotMethod = this.resolveRecoveryPaymentMethodId(
      (latest.checkoutSnapshotJson as Record<string, unknown>) ?? {},
      latest.gateway,
    );

    const confirmResult = await this.checkout.confirmPayment(
      {
        common_order: order.commonOrder,
        idempotency_key: latest.idempotencyKey ?? undefined,
        // Prefer concrete method id (10/11/12) so labels stay Google Pay / Apple Pay / Card.
        provider:
          snapshotMethod != null ? String(snapshotMethod) : latest.gateway,
        providerResponse: {
          sessionId: latest.providerSessionId ?? undefined,
          paymentId: latest.providerPaymentId ?? undefined,
          invoiceId: latest.providerInvoiceId ?? undefined,
          gateway: latest.gateway,
        },
      },
      { skipGatewayVerification: force },
    );

    const refreshed = await this.loadScoped(id, scopedEventIds);
    return {
      success: true,
      message: confirmResult.message || 'Booking confirmed from recovery.',
      data: this.toDetail(refreshed),
    };
  }

  private async findOrderForRecovery(row: {
    order: { id: string; commonOrder: string; status: string } | null;
    orderId: string | null;
    commonOrder: string | null;
    idempotencyKey: string | null;
    providerSessionId: string | null;
    providerPaymentId: string | null;
    providerInvoiceId: string | null;
  }) {
    if (row.order) return row.order;

    if (row.commonOrder?.trim()) {
      const byCommon = await this.prisma.order.findUnique({
        where: { commonOrder: row.commonOrder.trim() },
        select: {
          id: true,
          commonOrder: true,
          status: true,
        },
      });
      if (byCommon) return byCommon;
    }

    if (row.idempotencyKey?.trim()) {
      const byKey = await this.prisma.order.findUnique({
        where: { idempotencyKey: row.idempotencyKey.trim() },
        select: {
          id: true,
          commonOrder: true,
          status: true,
        },
      });
      if (byKey) return byKey;
    }

    if (row.orderId?.trim()) {
      const byId = await this.prisma.order.findUnique({
        where: { id: row.orderId.trim() },
        select: {
          id: true,
          commonOrder: true,
          status: true,
        },
      });
      if (byId) return byId;
    }

    if (row.providerSessionId?.trim()) {
      const hosted = await this.prisma.hostedCheckoutSession.findUnique({
        where: { sid: row.providerSessionId.trim() },
        select: { orderId: true, commonOrder: true },
      });
      if (hosted?.orderId) {
        const byHosted = await this.prisma.order.findUnique({
          where: { id: hosted.orderId },
          select: { id: true, commonOrder: true, status: true },
        });
        if (byHosted) return byHosted;
      }
      if (hosted?.commonOrder) {
        const byHostedCommon = await this.prisma.order.findUnique({
          where: { commonOrder: hosted.commonOrder },
          select: { id: true, commonOrder: true, status: true },
        });
        if (byHostedCommon) return byHostedCommon;
      }
    }

    if (row.providerPaymentId?.trim() || row.providerInvoiceId?.trim()) {
      const payment = await this.prisma.payment.findFirst({
        where: {
          OR: [
            ...(row.providerPaymentId?.trim()
              ? [{ providerPaymentId: row.providerPaymentId.trim() }]
              : []),
            ...(row.providerInvoiceId?.trim()
              ? [{ providerInvoiceId: row.providerInvoiceId.trim() }]
              : []),
            ...(row.providerSessionId?.trim()
              ? [{ providerSessionId: row.providerSessionId.trim() }]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          order: { select: { id: true, commonOrder: true, status: true } },
        },
      });
      if (payment?.order) return payment.order;
    }

    return null;
  }

  private snapshotCanRebuildBooking(
    snapshot: Record<string, unknown>,
    row: { idempotencyKey: string | null; eventSlug: string | null },
  ) {
    const eventSlug =
      (typeof snapshot.event_slug === 'string' && snapshot.event_slug) ||
      row.eventSlug ||
      '';
    const schedule = (snapshot.schedule as { date?: string; time?: string } | null) ?? null;
    const tickets = snapshot.tickets;
    const idempotency =
      (typeof snapshot.idempotency_key === 'string' && snapshot.idempotency_key) ||
      row.idempotencyKey ||
      '';
    return Boolean(
      eventSlug &&
        schedule?.date &&
        schedule?.time &&
        Array.isArray(tickets) &&
        tickets.length > 0 &&
        idempotency,
    );
  }

  /**
   * Prefer snapshot.payment_method; for MyFatoorah also infer from checkout_ref /
   * supportedPaymentMethods so Google Pay is not mislabeled as Apple Pay.
   */
  private resolveRecoveryPaymentMethodId(
    snapshot: Record<string, unknown>,
    gateway: string,
  ): number | null {
    if (gateway === 'qpay') {
      return coerceOnlinePaymentMethodId(snapshot.payment_method) ?? 7;
    }
    if (gateway === 'mastercard') {
      return coerceOnlinePaymentMethodId(snapshot.payment_method) ?? 8;
    }
    if (gateway === 'myfatoorah') {
      return (
        resolveMyFatoorahMethodIdFromHints({
          paymentMethod: snapshot.payment_method,
          checkoutRef:
            typeof snapshot.checkout_ref === 'string'
              ? snapshot.checkout_ref
              : null,
          supportedPaymentMethods: snapshot.supportedPaymentMethods,
          paymentDetail:
            snapshot.payment ?? snapshot.provider_response ?? null,
        }) ?? 12
      );
    }
    return coerceOnlinePaymentMethodId(snapshot.payment_method);
  }

  private async rebuildPaidBookingFromSnapshot(row: {
    id: string;
    gateway: string;
    amount: Prisma.Decimal | number;
    currency: string;
    idempotencyKey: string | null;
    eventSlug: string | null;
    customerEmail: string | null;
    customerId: string | null;
    providerSessionId: string | null;
    providerInvoiceId: string | null;
    providerPaymentId: string | null;
    checkoutSnapshotJson: Prisma.JsonValue;
  }) {
    let snapshot = (row.checkoutSnapshotJson as Record<string, unknown>) ?? {};
    let hostedParams: Record<string, unknown> | null = null;
    let hostedCheckoutRef: string | null = null;

    if (row.providerSessionId) {
      const hosted = await this.prisma.hostedCheckoutSession.findUnique({
        where: { sid: row.providerSessionId },
      });
      hostedParams = (hosted?.paramsJson as Record<string, unknown> | null) ?? null;
      hostedCheckoutRef = hosted?.checkoutRef ?? null;
      const draft =
        (hostedParams?.checkout_draft as Record<string, unknown> | undefined) ??
        null;
      if (draft && !this.snapshotCanRebuildBooking(snapshot, row)) {
        snapshot = { ...draft, ...snapshot };
      } else if (draft) {
        snapshot = {
          ...draft,
          ...snapshot,
          checkout_ref:
            snapshot.checkout_ref ?? draft.checkout_ref ?? hostedCheckoutRef,
          supportedPaymentMethods:
            snapshot.supportedPaymentMethods ??
            hostedParams?.supportedPaymentMethods ??
            null,
        };
      } else if (hostedParams || hostedCheckoutRef) {
        snapshot = {
          ...snapshot,
          checkout_ref: snapshot.checkout_ref ?? hostedCheckoutRef,
          supportedPaymentMethods:
            snapshot.supportedPaymentMethods ??
            hostedParams?.supportedPaymentMethods ??
            null,
        };
      }
    }

    if (!this.snapshotCanRebuildBooking(snapshot, row)) {
      throw new BadRequestException(
        'No order found for this recovery, and the checkout snapshot is incomplete (need event, schedule, tickets, idempotency key). Enter the cart details below and confirm again, or refund in the gateway.',
      );
    }

    const schedule =
      (snapshot.schedule as { date?: string; time?: string }) ?? {};
    const customer =
      (snapshot.customer as {
        user_id?: string | number | null;
        id?: string | number | null;
        name?: string | null;
        email?: string | null;
        phone?: string | null;
      } | null) ?? {};
    const paymentMethod = this.resolveRecoveryPaymentMethodId(
      snapshot,
      row.gateway,
    );
    const idempotencyKey = String(
      snapshot.idempotency_key || row.idempotencyKey,
    ).trim();
    const eventSlug = String(snapshot.event_slug || row.eventSlug).trim();
    const amount = Number(row.amount);

    const bookResult = await this.checkout.bookTicket(
      {
        event_slug: eventSlug,
        schedule: {
          date: schedule.date,
          time: schedule.time,
        },
        tickets: (snapshot.tickets as BookTicketRequestDto['tickets']) ?? [],
        addons: (snapshot.addons as BookTicketRequestDto['addons']) ?? [],
        payment_method: paymentMethod ?? undefined,
        idempotency_key: idempotencyKey,
        customer: {
          user_id: customer.user_id ?? customer.id ?? row.customerId ?? null,
          name: customer.name ?? null,
          email: customer.email ?? row.customerEmail ?? null,
          phone: customer.phone ?? null,
        },
        totals: {
          total: amount,
          currency: row.currency || 'QAR',
        },
        metadata: { source: 'web' },
        paymentDetailPayload: {
          provider: row.gateway,
          status: 'paid',
          amount,
          currency: row.currency || 'QAR',
          providerResponse: {
            sessionId: row.providerSessionId ?? undefined,
            paymentId: row.providerPaymentId ?? undefined,
            invoiceId: row.providerInvoiceId ?? undefined,
          },
        },
      },
      'en',
      row.customerId ?? undefined,
      { allowVerifiedPaid: true },
    );

    const commonOrder =
      (bookResult as { data?: { common_order?: string } })?.data?.common_order ??
      (bookResult as { common_order?: string }).common_order ??
      null;

    const order = commonOrder
      ? await this.prisma.order.findUnique({
          where: { commonOrder },
          select: { id: true, commonOrder: true, status: true },
        })
      : await this.prisma.order.findUnique({
          where: { idempotencyKey },
          select: { id: true, commonOrder: true, status: true },
        });

    if (!order) {
      throw new BadRequestException(
        'Rebuild from snapshot ran but no order was returned. Check inventory/session and try again.',
      );
    }

    return {
      order,
      message:
        order.status === 'paid'
          ? 'Booking created and paid from recovery snapshot.'
          : ((bookResult as { message?: string }).message ??
            'Booking created from recovery snapshot.'),
    };
  }

  async abandon(id: string, scopedEventIds: string[] | null, note?: string) {
    const row = await this.loadScoped(id, scopedEventIds);
    if (row.status !== 'open') {
      throw new BadRequestException(`Recovery is already ${row.status}.`);
    }

    await this.prisma.customerPaymentRecovery.update({
      where: { id: row.id },
      data: {
        status: CustomerPaymentRecoveryStatus.abandoned,
        resolvedAt: new Date(),
        failureMessage:
          note?.trim() ||
          row.failureMessage ||
          'Marked abandoned by admin.',
      },
    });

    const refreshed = await this.loadScoped(id, scopedEventIds);
    return {
      success: true,
      message: 'Recovery marked abandoned.',
      data: this.toDetail(refreshed),
    };
  }

  private async verifyWithGateway(row: {
    gateway: string;
    orderId?: string | null;
    commonOrder: string | null;
    providerSessionId: string | null;
    providerInvoiceId: string | null;
    providerPaymentId: string | null;
    checkoutSnapshotJson?: unknown;
    order: { id?: string; commonOrder: string } | null;
  }) {
    if (row.gateway === 'myfatoorah') {
      if (row.providerPaymentId || row.providerInvoiceId) {
        const result = await this.myFatoorah.resolvePaymentStatus({
          payment_id: row.providerPaymentId ?? undefined,
          invoice_id: row.providerInvoiceId ?? undefined,
          session_id: row.providerSessionId ?? undefined,
        });
        return {
          paid: Boolean(result.paid),
          message: result.message,
          source: 'myfatoorah',
          refs: {
            sessionId: result.data.sessionId ?? row.providerSessionId,
            paymentId: result.data.paymentId ?? row.providerPaymentId,
            invoiceId:
              result.data.invoiceId != null
                ? String(result.data.invoiceId)
                : row.providerInvoiceId,
          },
          detail: result.data.payment ?? null,
        };
      }

      const orderId = row.orderId ?? row.order?.id ?? null;
      const hostedWhere: Prisma.HostedCheckoutSessionWhereInput[] = [];
      if (row.providerSessionId) hostedWhere.push({ sid: row.providerSessionId });
      if (orderId) hostedWhere.push({ orderId });
      if (row.commonOrder) hostedWhere.push({ commonOrder: row.commonOrder });

      const hosted = hostedWhere.length
        ? await this.prisma.hostedCheckoutSession.findFirst({
            where: { gateway: 'myfatoorah', OR: hostedWhere },
            orderBy: { updatedAt: 'desc' },
          })
        : null;

      if (hosted?.status === 'paid') {
        const params = (hosted.paramsJson as Record<string, unknown> | null) ?? {};
        const providerResponse =
          (params.providerResponse as Record<string, unknown> | undefined) ?? {};
        return {
          paid: true,
          message:
            'MyFatoorah hosted session is marked paid. Confirm to settle the order.',
          source: 'myfatoorah_session',
          refs: {
            sessionId: hosted.sid,
            paymentId:
              (typeof providerResponse.paymentId === 'string'
                ? providerResponse.paymentId
                : row.providerPaymentId) ?? null,
            invoiceId:
              providerResponse.invoiceId != null
                ? String(providerResponse.invoiceId)
                : row.providerInvoiceId,
          },
          detail: {
            hosted_status: hosted.status,
            checkout_ref: hosted.checkoutRef,
          },
        };
      }

      const snapshot =
        (row.checkoutSnapshotJson as Record<string, unknown> | null) ?? {};
      return {
        paid: false,
        message: hosted
          ? 'MyFatoorah session started. Payment has not been captured on this recovery yet.'
          : 'No MyFatoorah payment/invoice id on this recovery. Check MyFatoorah portal manually.',
        source: 'myfatoorah_session',
        refs: {
          sessionId: hosted?.sid ?? row.providerSessionId,
          paymentId: row.providerPaymentId,
          invoiceId: row.providerInvoiceId,
        },
        detail: {
          hosted_status: hosted?.status ?? null,
          myfatoorah_sessions: snapshot.myfatoorah_sessions ?? null,
        },
      };
    }

    if (row.gateway === 'mastercard') {
      const orderRef =
        row.commonOrder ||
        row.order?.commonOrder ||
        row.providerInvoiceId ||
        '';
      if (!orderRef) {
        return {
          paid: false,
          message: 'No Mastercard order reference available to look up.',
          source: 'mastercard',
          refs: {
            sessionId: row.providerSessionId,
            paymentId: row.providerPaymentId,
            invoiceId: row.providerInvoiceId,
          },
          detail: null,
        };
      }
      const result = await this.mpgs.retrieveOrderStatus(orderRef);
      return {
        paid: Boolean(result.paid),
        message: result.message,
        source: 'mastercard',
        refs: {
          sessionId: row.providerSessionId,
          paymentId: result.data.paymentId ?? row.providerPaymentId,
          invoiceId: result.data.invoiceId ?? row.providerInvoiceId ?? orderRef,
        },
        detail: result.data.gateway ?? null,
      };
    }

    // QPay — no merchant query API; use bank callback stored on hosted session / payment.
    const hosted = row.providerSessionId
      ? await this.prisma.hostedCheckoutSession.findUnique({
          where: { sid: row.providerSessionId },
        })
      : row.commonOrder
        ? await this.prisma.hostedCheckoutSession.findFirst({
            where: { gateway: 'qpay', commonOrder: row.commonOrder },
            orderBy: { createdAt: 'desc' },
          })
        : null;
    const params = (hosted?.paramsJson as Record<string, unknown>) ?? {};
    const callback =
      (params.qpay_callback as Record<string, unknown> | undefined) ??
      (params.providerResponse as Record<string, unknown> | undefined) ??
      {};
    const statusCode = String(
      callback.Response_Status ?? callback.status ?? '',
    ).trim();
    const paid =
      hosted?.status === 'paid' ||
      statusCode === '0000' ||
      Boolean(callback.isSuccess);
    const confirmationId = String(
      callback.Response_ConfirmationID ??
        callback.paymentId ??
        row.providerPaymentId ??
        '',
    ).trim();

    return {
      paid,
      message: paid
        ? 'QPay callback on file shows successful payment (Status 0000).'
        : hosted
          ? `QPay hosted session status is "${hosted.status}". No successful bank callback stored — check NAPS/QPay portal.`
          : 'No QPay callback stored. Confirm in the bank/NAPS portal, then use Confirm (force) if paid.',
      source: 'qpay_local',
      refs: {
        sessionId: hosted?.sid ?? row.providerSessionId,
        paymentId: confirmationId || row.providerPaymentId,
        invoiceId: row.providerInvoiceId ?? row.commonOrder,
      },
      detail: {
        hosted_status: hosted?.status ?? null,
        callback,
      },
    };
  }

  private async loadScoped(id: string, scopedEventIds: string[] | null) {
    const row = await this.prisma.customerPaymentRecovery.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true, email: true, phone: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        order: {
          select: {
            id: true,
            commonOrder: true,
            status: true,
            paymentStatus: true,
            totalAmount: true,
            currency: true,
          },
        },
      },
    });
    if (!row) throw new NotFoundException('Payment recovery not found.');
    if (
      scopedEventIds !== null &&
      row.eventId &&
      !scopedEventIds.includes(row.eventId)
    ) {
      throw new NotFoundException('Payment recovery not found.');
    }
    return row;
  }

  private toDetail(
    row: Prisma.CustomerPaymentRecoveryGetPayload<{
      include: {
        customer: { select: { id: true; name: true; email: true; phone: true } };
        event: {
          select: {
            id: true;
            slug: true;
            translations: { select: { title: true } };
          };
        };
        order: {
          select: {
            id: true;
            commonOrder: true;
            status: true;
            paymentStatus: true;
            totalAmount: true;
            currency: true;
          };
        };
      };
    }>,
  ) {
    return {
      ...this.toListItem(row),
      checkout_snapshot: row.checkoutSnapshotJson,
      order: row.order
        ? {
            id: row.order.id,
            common_order: row.order.commonOrder,
            status: row.order.status,
            payment_status: row.order.paymentStatus,
            total_amount: Number(row.order.totalAmount),
            currency: row.order.currency,
          }
        : null,
    };
  }

  private toListItem(
    row: Prisma.CustomerPaymentRecoveryGetPayload<{
      include: {
        customer: { select: { id: true; name: true; email: true; phone: true } };
        event: {
          select: {
            id: true;
            slug: true;
            translations: { select: { title: true } };
          };
        };
        order: { select: { id: true; commonOrder: true; status: true } };
      };
    }>,
  ) {
    return {
      id: row.id,
      common_order: row.commonOrder,
      order_id: row.orderId,
      customer_id: row.customerId,
      customer_email: row.customerEmail ?? row.customer?.email ?? null,
      customer_name: row.customer?.name ?? null,
      customer_phone: row.customer?.phone ?? null,
      event_id: row.eventId,
      event_slug: row.eventSlug ?? row.event?.slug ?? null,
      event_title: row.event?.translations?.[0]?.title ?? row.eventSlug ?? null,
      gateway: row.gateway,
      status: row.status,
      reason: row.reason,
      amount: Number(row.amount),
      currency: row.currency,
      idempotency_key: row.idempotencyKey,
      provider_session_id: row.providerSessionId,
      provider_invoice_id: row.providerInvoiceId,
      provider_payment_id: row.providerPaymentId,
      failure_message: row.failureMessage,
      resolved_at: row.resolvedAt?.toISOString() ?? null,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      linked_order_status: row.order?.status ?? null,
    };
  }
}
