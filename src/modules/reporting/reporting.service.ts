import { Injectable, Logger } from '@nestjs/common';
import {
  AttendanceStatus,
  OrderItemType,
  Prisma,
  ReportBasis,
  ReportPaymentMode,
  VisitorType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { normalizeCustomerAgeGroup } from './camp-age-groups';
import { buildNamedExtraRollupBuckets } from './named-extra-breakdown';
import { ReportTimezoneService } from './report-timezone.service';
import { calendarDay } from './report-timezone.util';
import {
  buildVendorProductBuckets,
  isLegacyMigratedOrder,
  legacyFirstAddonAmountFromMetadata,
  withLegacyLineSortKeys,
} from './vendor-product-rollup';

export type ReportSyncPayload = {
  orderId: string;
  action: 'hold' | 'paid' | 'expire' | 'refund';
};

export type AttendanceSyncPayload = {
  eventId: string;
  fromStatus: AttendanceStatus;
  toStatus: AttendanceStatus;
  quantity?: number;
};

const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];

type TxClient = Prisma.TransactionClient;

type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

@Injectable()
export class ReportingService {
  private readonly logger = new Logger(ReportingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reportTz: ReportTimezoneService,
  ) {}

  static scopeKey(eventId: string, sessionId?: string | null, inventoryItemId?: string | null) {
    return `${eventId}|${sessionId ?? '*'}|${inventoryItemId ?? '*'}`;
  }

  async syncOrder(payload: ReportSyncPayload): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: payload.orderId },
      include: { items: true },
    });
    if (!order) return;

    const actionKey = payload.action;
    const existing = await this.prisma.orderReportLedger.findUnique({
      where: { orderId_actionKey: { orderId: order.id, actionKey } },
    });
    if (existing) return;

    if (payload.action === 'refund') {
      const paid = await this.prisma.orderReportLedger.findUnique({
        where: { orderId_actionKey: { orderId: order.id, actionKey: 'paid' } },
      });
      if (!paid) {
        this.logger.warn(`Skipping refund sync for ${order.id} — no paid ledger`);
        return;
      }
    }
    if (payload.action === 'expire') {
      const paid = await this.prisma.orderReportLedger.findUnique({
        where: { orderId_actionKey: { orderId: order.id, actionKey: 'paid' } },
      });
      if (paid) return;
    }

    const sign =
      payload.action === 'refund' || payload.action === 'expire' ? -1 : 1;
    // Cafe-only settles store totalAdmits/totalQuantity as 0. Do not fall back to
    // summing all line qty — that would inflate event admits with cafe items.
    const computedTicketAdmits = order.items
      .filter((i) => TICKET_TYPES.includes(i.itemType) && !i.ticketIsCafe)
      .reduce((s, i) => s + i.admitCount * i.quantity, 0);
    const admitCount =
      order.totalAdmits > 0 ? order.totalAdmits : computedTicketAdmits;
    const computedTicketQty = order.items
      .filter((i) => TICKET_TYPES.includes(i.itemType) && !i.ticketIsCafe)
      .reduce((s, i) => s + i.quantity, 0);
    const ticketQty =
      order.totalQuantity > 0 ? order.totalQuantity : computedTicketQty;
    const revenue =
      payload.action === 'paid' || payload.action === 'refund'
        ? order.totalAmount.toNumber() * sign
        : 0;
    // Tickets only — cafe_item / ticketIsCafe stay on cafe rollups, not ticketsNet.
    const ticketsNetFromItems = order.items
      .filter((i) => TICKET_TYPES.includes(i.itemType) && !i.ticketIsCafe)
      .reduce((s, i) => s + i.totalAmount.toNumber(), 0);
    // Native checkout: line ticketsNet is pre-promo; subtract order promo so
    // Overview Tickets + Other matches gross_sales (paid totalAmount).
    const orderPromoForTickets = isLegacyMigratedOrder(order.metadata)
      ? 0
      : order.discountAmount.toNumber();
    const ticketsNet =
      payload.action === 'paid' || payload.action === 'refund'
        ? Math.max(0, ticketsNetFromItems - orderPromoForTickets) * sign
        : 0;
    const addonsNet =
      payload.action === 'paid' || payload.action === 'refund'
        ? order.addonsNet.toNumber() * sign
        : 0;
    const heldDelta =
      payload.action === 'hold' ? admitCount : payload.action === 'expire' ? -admitCount : 0;
    const soldDelta =
      payload.action === 'paid' ? admitCount : payload.action === 'refund' ? -admitCount : 0;
    const orderDelta =
      payload.action === 'hold' || payload.action === 'paid'
        ? 1
        : payload.action === 'expire' || payload.action === 'refund'
          ? -1
          : 0;

    const scopes = [
      {
        scopeKey: ReportingService.scopeKey(order.eventId),
        eventId: order.eventId,
        eventSessionId: null as string | null,
        inventoryItemId: null as string | null,
        qty: admitCount,
      },
      {
        scopeKey: ReportingService.scopeKey(order.eventId, order.eventSessionId),
        eventId: order.eventId,
        eventSessionId: order.eventSessionId,
        inventoryItemId: null as string | null,
        qty: admitCount,
      },
      ...order.items
        .filter((item) => item.inventoryItemId)
        .map((item) => ({
          scopeKey: ReportingService.scopeKey(
            order.eventId,
            order.eventSessionId,
            item.inventoryItemId,
          ),
          eventId: order.eventId,
          eventSessionId: order.eventSessionId,
          inventoryItemId: item.inventoryItemId,
          qty: item.quantity,
        })),
    ];

    const deltasJson = {
      action: payload.action,
      admitCount,
      ticketQty,
      revenue,
      ticketsNet,
      addonsNet,
      heldDelta,
      soldDelta,
      orderDelta,
    };

    const reportTimeZone =
      payload.action === 'paid' || payload.action === 'refund'
        ? await this.reportTz.getTimeZone()
        : 'UTC';

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.orderReportLedger.create({
          data: {
            orderId: order.id,
            actionKey,
            reportVersion: order.reportVersion,
            deltasJson,
          },
        });

        for (const scope of scopes) {
          const itemQty = scope.qty;
          const scopedHeld =
            payload.action === 'hold'
              ? itemQty
              : payload.action === 'expire'
                ? -itemQty
                : 0;
          const scopedSold =
            payload.action === 'paid'
              ? itemQty
              : payload.action === 'refund'
                ? -itemQty
                : 0;

          await tx.eventSalesCounter.upsert({
            where: { scopeKey: scope.scopeKey },
            create: {
              scopeKey: scope.scopeKey,
              eventId: scope.eventId,
              eventSessionId: scope.eventSessionId,
              inventoryItemId: scope.inventoryItemId,
              soldQty: Math.max(0, scopedSold),
              heldQty: Math.max(0, scopedHeld),
              orderCount: Math.max(0, orderDelta),
              revenuePaid: Math.max(0, revenue),
              currency: order.currency,
            },
            update: {
              soldQty: { increment: scopedSold },
              heldQty: { increment: scopedHeld },
              orderCount: { increment: orderDelta },
              revenuePaid: { increment: revenue },
            },
          });
        }

        if (payload.action === 'paid' || payload.action === 'refund') {
          const targets = reportDayTargets(order, reportTimeZone);
          for (const target of targets) {
            await this.applyDailyRollups(tx, order, {
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              sign,
              orderDelta,
              admitCount,
              ticketQty,
              revenue,
              ticketsNet,
              addonsNet,
            });
          }
        }

        await tx.order.update({
          where: { id: order.id },
          data: { reportSyncPending: false },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return;
      }
      await this.prisma.order
        .update({
          where: { id: order.id },
          data: { reportSyncPending: true },
        })
        .catch(() => undefined);
      throw error;
    }
  }

  /**
   * Update lightweight attendance counters on check-in / undo.
   * checkedOutCount increments when leaving checked_in (legacy checkout parity).
   */
  async syncAttendance(payload: AttendanceSyncPayload): Promise<void> {
    const qty = Math.max(1, payload.quantity ?? 1);
    let checkedInDelta = 0;
    let checkedOutDelta = 0;

    if (
      payload.fromStatus !== AttendanceStatus.checked_in &&
      payload.toStatus === AttendanceStatus.checked_in
    ) {
      checkedInDelta = qty;
    }
    if (
      payload.fromStatus === AttendanceStatus.checked_in &&
      payload.toStatus !== AttendanceStatus.checked_in
    ) {
      checkedInDelta = -qty;
      checkedOutDelta = qty;
    }

    if (checkedInDelta === 0 && checkedOutDelta === 0) return;

    await this.prisma.eventAttendanceCounter.upsert({
      where: { eventId: payload.eventId },
      create: {
        eventId: payload.eventId,
        checkedInCount: Math.max(0, checkedInDelta),
        checkedOutCount: Math.max(0, checkedOutDelta),
      },
      update: {
        checkedInCount: { increment: checkedInDelta },
        checkedOutCount: { increment: checkedOutDelta },
      },
    });
  }

  private async applyDailyRollups(
    tx: TxClient,
    order: OrderWithItems,
    ctx: {
      reportDay: Date;
      reportBasis: ReportBasis;
      sign: number;
      orderDelta: number;
      admitCount: number;
      ticketQty: number;
      revenue: number;
      ticketsNet: number;
      addonsNet: number;
    },
  ) {
    const {
      reportDay,
      reportBasis,
      sign,
      orderDelta,
      admitCount,
      ticketQty,
      revenue,
      ticketsNet,
      addonsNet,
    } = ctx;
    const paymentMode = order.paymentMode;

    await tx.bookingReportDaily.upsert({
      where: {
        eventId_reportDay_reportBasis_paymentMode_currency: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          paymentMode,
          currency: order.currency,
        },
      },
      create: {
        eventId: order.eventId,
        reportDay,
        reportBasis,
        paymentMode,
        orderCount: Math.max(0, orderDelta),
        admitCount: Math.max(0, admitCount * sign),
        ticketQty: Math.max(0, ticketQty * sign),
        revenueTotal: Math.max(0, revenue),
        ticketsNet: Math.max(0, ticketsNet),
        addonsNet: Math.max(0, addonsNet),
        currency: order.currency,
      },
      update: {
        orderCount: { increment: orderDelta },
        admitCount: { increment: admitCount * sign },
        ticketQty: { increment: ticketQty * sign },
        revenueTotal: { increment: revenue },
        ticketsNet: { increment: ticketsNet },
        addonsNet: { increment: addonsNet },
      },
    });

    await tx.bookingReportPaymentDaily.upsert({
      where: {
        eventId_reportDay_reportBasis_paymentMethodLabel_currency: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          paymentMethodLabel: order.paymentMethodLabel,
          currency: order.currency,
        },
      },
      create: {
        eventId: order.eventId,
        reportDay,
        reportBasis,
        paymentMethodLabel: order.paymentMethodLabel,
        orderCount: Math.max(0, orderDelta),
        admitCount: Math.max(0, admitCount * sign),
        revenueTotal: Math.max(0, revenue),
        currency: order.currency,
      },
      update: {
        orderCount: { increment: orderDelta },
        admitCount: { increment: admitCount * sign },
        revenueTotal: { increment: revenue },
      },
    });

    const byType = new Map<VisitorType, { admits: number; qty: number; revenue: number }>();
    for (const item of order.items) {
      if (!TICKET_TYPES.includes(item.itemType)) continue;
      const key = item.visitorType;
      const current = byType.get(key) ?? { admits: 0, qty: 0, revenue: 0 };
      if (!item.ticketIsCafe) {
        current.admits += item.admitCount * item.quantity;
        current.qty += item.quantity;
      }
      current.revenue += item.totalAmount.toNumber();
      byType.set(key, current);
    }
    for (const [visitorType, bucket] of byType) {
      await tx.bookingReportVisitorDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_visitorType_currency: {
            eventId: order.eventId,
            reportDay,
            reportBasis,
            visitorType,
            currency: order.currency,
          },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          visitorType,
          orderCount: Math.max(0, orderDelta),
          admitCount: Math.max(0, bucket.admits * sign),
          ticketQty: Math.max(0, bucket.qty * sign),
          revenueTotal: Math.max(0, bucket.revenue * sign),
          currency: order.currency,
        },
        update: {
          orderCount: { increment: orderDelta },
          admitCount: { increment: bucket.admits * sign },
          ticketQty: { increment: bucket.qty * sign },
          revenueTotal: { increment: bucket.revenue * sign },
        },
      });
    }

    if (order.bookedByAgentId) {
      const cashAmt = order.cashAmount.toNumber() * sign;
      const cardAmt = order.cardAmount.toNumber() * sign;
      await tx.bookingReportPosDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_bookedByAgentId_paymentMode_currency: {
            eventId: order.eventId,
            reportDay,
            reportBasis,
            bookedByAgentId: order.bookedByAgentId,
            paymentMode,
            currency: order.currency,
          },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          bookedByAgentId: order.bookedByAgentId,
          paymentMode,
          orderCount: Math.max(0, orderDelta),
          admitCount: Math.max(0, admitCount * sign),
          revenueTotal: Math.max(0, revenue),
          cashAmount: Math.max(0, cashAmt),
          cardAmount: Math.max(0, cardAmt),
          currency: order.currency,
        },
        update: {
          orderCount: { increment: orderDelta },
          admitCount: { increment: admitCount * sign },
          revenueTotal: { increment: revenue },
          cashAmount: { increment: cashAmt },
          cardAmount: { increment: cardAmt },
        },
      });
    }

    const byShare = new Map<
      string,
      { admits: number; qty: number; revenue: number; orders: Set<string> }
    >();
    for (const item of order.items) {
      if (!item.thirdPartyVendorId) continue;
      // Tickets, addons, and customizations (incl. time extensions) feed Vendors & POS.
      // Cafe lines stay on cafe rollups. Keep this list tight so sync stays O(items).
      if (
        !TICKET_TYPES.includes(item.itemType) &&
        item.itemType !== OrderItemType.addon &&
        item.itemType !== OrderItemType.addon_variant &&
        item.itemType !== OrderItemType.customization
      ) {
        continue;
      }
      const current = byShare.get(item.thirdPartyVendorId) ?? {
        admits: 0,
        qty: 0,
        revenue: 0,
        orders: new Set<string>(),
      };
      if (TICKET_TYPES.includes(item.itemType) && !item.ticketIsCafe) {
        current.admits += item.admitCount * item.quantity;
        current.qty += item.quantity;
      }
      current.revenue += item.totalAmount.toNumber();
      current.orders.add(order.id);
      byShare.set(item.thirdPartyVendorId, current);
    }
    // Native checkout keeps promo on order.discountAmount while line totals stay
    // pre-promo. Attribute once to the first vendor (same as product rollup).
    const orderPromo = isLegacyMigratedOrder(order.metadata)
      ? 0
      : order.discountAmount.toNumber();
    if (orderPromo > 0 && byShare.size > 0) {
      const firstVendorId = [...byShare.keys()][0];
      const bucket = byShare.get(firstVendorId)!;
      bucket.revenue = Math.max(
        0,
        Math.round((bucket.revenue - orderPromo) * 1000) / 1000,
      );
    }
    for (const [thirdPartyVendorId, bucket] of byShare) {
      await tx.bookingReportThirdPartyVendorDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_thirdPartyVendorId_currency: {
            eventId: order.eventId,
            reportDay,
            reportBasis,
            thirdPartyVendorId,
            currency: order.currency,
          },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId,
          orderCount: Math.max(0, bucket.orders.size * (sign > 0 ? 1 : 0)),
          ticketQty: Math.max(0, bucket.qty * sign),
          admitCount: Math.max(0, bucket.admits * sign),
          revenueTotal: Math.max(0, bucket.revenue * sign),
          currency: order.currency,
        },
        update: {
          orderCount: { increment: orderDelta },
          ticketQty: { increment: bucket.qty * sign },
          admitCount: { increment: bucket.admits * sign },
          revenueTotal: { increment: bucket.revenue * sign },
        },
      });
    }

    const byTicket = new Map<
      string,
      {
        label: string;
        itemType: OrderItemType;
        admits: number;
        qty: number;
        revenue: number;
      }
    >();
    for (const item of order.items) {
      if (!TICKET_TYPES.includes(item.itemType)) continue;
      const current = byTicket.get(item.itemId) ?? {
        label: item.displayName,
        itemType: item.itemType,
        admits: 0,
        qty: 0,
        revenue: 0,
      };
      if (!item.ticketIsCafe) {
        current.admits += item.admitCount * item.quantity;
        current.qty += item.quantity;
      }
      current.revenue += item.totalAmount.toNumber();
      byTicket.set(item.itemId, current);
    }
    for (const [ticketItemId, bucket] of byTicket) {
      await tx.bookingReportTicketDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_ticketItemId_currency: {
            eventId: order.eventId,
            reportDay,
            reportBasis,
            ticketItemId,
            currency: order.currency,
          },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          ticketItemId,
          ticketLabel: bucket.label,
          itemType: bucket.itemType,
          orderCount: Math.max(0, orderDelta),
          ticketQty: Math.max(0, bucket.qty * sign),
          admitCount: Math.max(0, bucket.admits * sign),
          revenueTotal: Math.max(0, bucket.revenue * sign),
          currency: order.currency,
        },
        update: {
          ticketLabel: bucket.label,
          orderCount: { increment: orderDelta },
          ticketQty: { increment: bucket.qty * sign },
          admitCount: { increment: bucket.admits * sign },
          revenueTotal: { increment: bucket.revenue * sign },
        },
      });
    }

    const productBuckets = buildVendorProductBuckets({
      // Legacy lines already carry promocode_reward; don't re-apply order discount.
      orderDiscountAmount: isLegacyMigratedOrder(order.metadata)
        ? 0
        : order.discountAmount.toNumber(),
      legacyFirstAddonAmount: legacyFirstAddonAmountFromMetadata(order.metadata),
      items: withLegacyLineSortKeys(
        order.items.map((item) => ({
          id: item.id,
          itemId: item.itemId,
          itemType: item.itemType,
          displayName: item.displayName,
          quantity: item.quantity,
          admitCount: item.admitCount,
          totalAmount: item.totalAmount.toNumber(),
          discountAmount: item.discountAmount.toNumber(),
          thirdPartyVendorId: item.thirdPartyVendorId,
          ticketIsCafe: item.ticketIsCafe,
          parentOrderItemId: item.parentOrderItemId,
          createdAt: item.createdAt,
          ticketCode: item.ticketCode,
        })),
        order.metadata,
      ),
    });
    for (const bucket of productBuckets) {
      await tx.bookingReportVendorProductDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_thirdPartyVendorId_productKind_productId_currency:
            {
              eventId: order.eventId,
              reportDay,
              reportBasis,
              thirdPartyVendorId: bucket.thirdPartyVendorId,
              productKind: bucket.productKind,
              productId: bucket.productId,
              currency: order.currency,
            },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId: bucket.thirdPartyVendorId,
          productId: bucket.productId,
          productLabel: bucket.productLabel,
          productKind: bucket.productKind,
          orderCount: Math.max(0, bucket.orderCount * (sign > 0 ? 1 : 0)),
          ticketQty: Math.max(0, bucket.ticketQty * sign),
          admitCount: Math.max(0, bucket.admitCount * sign),
          addonAmount: Math.max(0, bucket.addonAmount * sign),
          timeExtensionAmount: Math.max(0, bucket.timeExtensionAmount * sign),
          ticketRevenue: Math.max(0, bucket.ticketRevenue * sign),
          discountAmount: Math.max(0, bucket.discountAmount * sign),
          netRevenue: Math.max(0, bucket.netRevenue * sign),
          currency: order.currency,
        },
        update: {
          productLabel: bucket.productLabel,
          orderCount: { increment: bucket.orderCount * sign },
          ticketQty: { increment: bucket.ticketQty * sign },
          admitCount: { increment: bucket.admitCount * sign },
          addonAmount: { increment: bucket.addonAmount * sign },
          timeExtensionAmount: { increment: bucket.timeExtensionAmount * sign },
          ticketRevenue: { increment: bucket.ticketRevenue * sign },
          discountAmount: { increment: bucket.discountAmount * sign },
          netRevenue: { increment: bucket.netRevenue * sign },
        },
      });
    }

    const namedExtraBuckets = buildNamedExtraRollupBuckets(
      order.items.map((item) => ({
        itemId: item.itemId,
        itemType: item.itemType,
        displayName: item.displayName,
        quantity: item.quantity,
        totalAmount: item.totalAmount.toNumber(),
        parentOrderItemId: item.parentOrderItemId,
        orderId: order.id,
        thirdPartyVendorId: item.thirdPartyVendorId,
      })),
    );
    for (const bucket of namedExtraBuckets) {
      await tx.bookingReportNamedExtraDaily.upsert({
        where: {
          eventId_reportDay_reportBasis_thirdPartyVendorId_productKind_nameKey_currency:
            {
              eventId: order.eventId,
              reportDay,
              reportBasis,
              thirdPartyVendorId: bucket.thirdPartyVendorId,
              productKind: bucket.productKind,
              nameKey: bucket.nameKey,
              currency: order.currency,
            },
        },
        create: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId: bucket.thirdPartyVendorId,
          productKind: bucket.productKind,
          nameKey: bucket.nameKey,
          productId: bucket.productId,
          productLabel: bucket.productLabel,
          orderCount: Math.max(0, bucket.orderCount * (sign > 0 ? 1 : 0)),
          itemQty: Math.max(0, bucket.itemQty * sign),
          withTicketQty: Math.max(0, bucket.withTicketQty * sign),
          standaloneQty: Math.max(0, bucket.standaloneQty * sign),
          revenueTotal: Math.max(0, bucket.revenueTotal * sign),
          currency: order.currency,
        },
        update: {
          productId: bucket.productId,
          productLabel: bucket.productLabel,
          orderCount: { increment: bucket.orderCount * sign },
          itemQty: { increment: bucket.itemQty * sign },
          withTicketQty: { increment: bucket.withTicketQty * sign },
          standaloneQty: { increment: bucket.standaloneQty * sign },
          revenueTotal: { increment: bucket.revenueTotal * sign },
        },
      });
    }

    const ageGroup = normalizeCustomerAgeGroup(order.customerAgeGroup);
    const region = order.customerGeographicRegion?.trim() || 'Unknown';
    await tx.bookingReportDemoDaily.upsert({
      where: {
        eventId_reportDay_reportBasis_ageGroup_region_currency: {
          eventId: order.eventId,
          reportDay,
          reportBasis,
          ageGroup,
          region,
          currency: order.currency,
        },
      },
      create: {
        eventId: order.eventId,
        reportDay,
        reportBasis,
        ageGroup,
        region,
        orderCount: Math.max(0, orderDelta),
        admitCount: Math.max(0, admitCount * sign),
        revenueTotal: Math.max(0, revenue),
        currency: order.currency,
      },
      update: {
        orderCount: { increment: orderDelta },
        admitCount: { increment: admitCount * sign },
        revenueTotal: { increment: revenue },
      },
    });

    await this.applyCafeDailyRollups(tx, order, {
      reportDay,
      reportBasis,
      sign,
      orderDelta,
    });
  }

  /** Resolve cafe_id for cafe lines and upsert cafe / agent / item daily rollups. */
  private async applyCafeDailyRollups(
    tx: TxClient,
    order: OrderWithItems,
    ctx: {
      reportDay: Date;
      reportBasis: ReportBasis;
      sign: number;
      orderDelta: number;
    },
  ) {
    const cafeLines = order.items.filter(
      (item) =>
        item.itemType === OrderItemType.cafe_item || item.ticketIsCafe,
    );
    if (!cafeLines.length) return;

    const meta = order.metadata as { cafe_id?: string; cafe_ids?: string[] } | null;
    const metaCafeId =
      typeof meta?.cafe_id === 'string' && meta.cafe_id
        ? meta.cafe_id
        : Array.isArray(meta?.cafe_ids) && meta.cafe_ids.length === 1
          ? meta.cafe_ids[0]
          : null;

    const menuIds = [
      ...new Set(
        cafeLines
          .filter((item) => item.itemType === OrderItemType.cafe_item)
          .map((item) => item.itemId),
      ),
    ];
    const menuToCafe = new Map<string, string>();
    if (menuIds.length) {
      const rows = await tx.cafeMenuItem.findMany({
        where: { id: { in: menuIds } },
        select: {
          id: true,
          subcategory: { select: { category: { select: { cafeId: true } } } },
        },
      });
      for (const row of rows) {
        menuToCafe.set(row.id, row.subcategory.category.cafeId);
      }
    }

    type CafeBucket = {
      revenue: number;
      itemQty: number;
      byAgent: Map<string, { revenue: number; itemQty: number }>;
      byItem: Map<string, { label: string; revenue: number; itemQty: number }>;
    };
    const byCafe = new Map<string, CafeBucket>();

    for (const item of cafeLines) {
      const cafeId = metaCafeId || menuToCafe.get(item.itemId) || null;
      if (!cafeId) continue;

      const bucket = byCafe.get(cafeId) ?? {
        revenue: 0,
        itemQty: 0,
        byAgent: new Map(),
        byItem: new Map(),
      };
      const lineRev = item.totalAmount.toNumber();
      const lineQty = item.quantity;
      bucket.revenue += lineRev;
      bucket.itemQty += lineQty;

      const agentId = item.bookedByAgentId || order.bookedByAgentId;
      if (agentId) {
        const agent = bucket.byAgent.get(agentId) ?? { revenue: 0, itemQty: 0 };
        agent.revenue += lineRev;
        agent.itemQty += lineQty;
        bucket.byAgent.set(agentId, agent);
      }

      const itemRow = bucket.byItem.get(item.itemId) ?? {
        label: item.displayName,
        revenue: 0,
        itemQty: 0,
      };
      itemRow.revenue += lineRev;
      itemRow.itemQty += lineQty;
      itemRow.label = item.displayName || itemRow.label;
      bucket.byItem.set(item.itemId, itemRow);

      byCafe.set(cafeId, bucket);
    }

    if (!byCafe.size) return;

    // Cafe POS keeps promo on order.discountAmount while line totals stay pre-promo.
    // Attribute promo to cafe when this is a cafe-tagged / cafe-only order (ticket
    // rollups already subtract order promo for ticket checkouts).
    const orderCafeRevenueGross = [...byCafe.values()].reduce(
      (s, b) => s + b.revenue,
      0,
    );
    const hasNonCafeTickets = order.items.some(
      (item) => TICKET_TYPES.includes(item.itemType) && !item.ticketIsCafe,
    );
    const orderPromoForCafe =
      isLegacyMigratedOrder(order.metadata) || hasNonCafeTickets
        ? 0
        : order.discountAmount.toNumber();
    if (orderPromoForCafe > 0 && orderCafeRevenueGross > 0) {
      const netScale = Math.max(0, orderCafeRevenueGross - orderPromoForCafe) / orderCafeRevenueGross;
      for (const bucket of byCafe.values()) {
        bucket.revenue *= netScale;
        for (const agent of bucket.byAgent.values()) {
          agent.revenue *= netScale;
        }
        for (const item of bucket.byItem.values()) {
          item.revenue *= netScale;
        }
      }
    }

    const { reportDay, reportBasis, sign, orderDelta } = ctx;
    const paymentMode = order.paymentMode;
    const orderCafeRevenue = [...byCafe.values()].reduce((s, b) => s + b.revenue, 0);
    const orderTotal = Math.max(order.totalAmount.toNumber(), orderCafeRevenue, 0.000001);
    const cafeShareRatio = Math.min(1, orderCafeRevenue / orderTotal);

    for (const [cafeId, bucket] of byCafe) {
      const cafeRatio =
        orderCafeRevenue > 0 ? bucket.revenue / orderCafeRevenue : 0;
      const tenderRatio = cafeShareRatio * cafeRatio;
      const cashAmt = order.cashAmount.toNumber() * tenderRatio * sign;
      const cardAmt = order.cardAmount.toNumber() * tenderRatio * sign;
      const onlineAmt = order.onlineAmount.toNumber() * tenderRatio * sign;
      const revenue = bucket.revenue * sign;

      await tx.bookingReportCafeDaily.upsert({
        where: {
          cafeId_eventId_reportDay_reportBasis_paymentMode_currency: {
            cafeId,
            eventId: order.eventId,
            reportDay,
            reportBasis,
            paymentMode,
            currency: order.currency,
          },
        },
        create: {
          cafeId,
          eventId: order.eventId,
          reportDay,
          reportBasis,
          paymentMode,
          orderCount: Math.max(0, orderDelta),
          itemQty: Math.max(0, bucket.itemQty * sign),
          revenueTotal: Math.max(0, revenue),
          cashAmount: Math.max(0, cashAmt),
          cardAmount: Math.max(0, cardAmt),
          onlineAmount: Math.max(0, onlineAmt),
          currency: order.currency,
        },
        update: {
          orderCount: { increment: orderDelta },
          itemQty: { increment: bucket.itemQty * sign },
          revenueTotal: { increment: revenue },
          cashAmount: { increment: cashAmt },
          cardAmount: { increment: cardAmt },
          onlineAmount: { increment: onlineAmt },
        },
      });

      for (const [agentId, agent] of bucket.byAgent) {
        const agentRatio = bucket.revenue > 0 ? agent.revenue / bucket.revenue : 0;
        await tx.bookingReportCafeAgentDaily.upsert({
          where: {
            cafeId_eventId_reportDay_reportBasis_bookedByAgentId_paymentMode_currency: {
              cafeId,
              eventId: order.eventId,
              reportDay,
              reportBasis,
              bookedByAgentId: agentId,
              paymentMode,
              currency: order.currency,
            },
          },
          create: {
            cafeId,
            eventId: order.eventId,
            reportDay,
            reportBasis,
            bookedByAgentId: agentId,
            paymentMode,
            orderCount: Math.max(0, orderDelta),
            itemQty: Math.max(0, agent.itemQty * sign),
            revenueTotal: Math.max(0, agent.revenue * sign),
            cashAmount: Math.max(0, cashAmt * agentRatio),
            cardAmount: Math.max(0, cardAmt * agentRatio),
            currency: order.currency,
          },
          update: {
            orderCount: { increment: orderDelta },
            itemQty: { increment: agent.itemQty * sign },
            revenueTotal: { increment: agent.revenue * sign },
            cashAmount: { increment: cashAmt * agentRatio },
            cardAmount: { increment: cardAmt * agentRatio },
          },
        });
      }

      for (const [menuItemId, item] of bucket.byItem) {
        await tx.bookingReportCafeItemDaily.upsert({
          where: {
            cafeId_eventId_reportDay_reportBasis_menuItemId_currency: {
              cafeId,
              eventId: order.eventId,
              reportDay,
              reportBasis,
              menuItemId,
              currency: order.currency,
            },
          },
          create: {
            cafeId,
            eventId: order.eventId,
            reportDay,
            reportBasis,
            menuItemId,
            itemLabel: item.label.slice(0, 190),
            orderCount: Math.max(0, orderDelta),
            itemQty: Math.max(0, item.itemQty * sign),
            revenueTotal: Math.max(0, item.revenue * sign),
            currency: order.currency,
          },
          update: {
            orderCount: { increment: orderDelta },
            itemQty: { increment: item.itemQty * sign },
            revenueTotal: { increment: item.revenue * sign },
            itemLabel: item.label.slice(0, 190),
          },
        });
      }
    }
  }

  async getEventCounters(eventId: string) {
    return this.prisma.eventSalesCounter.findMany({
      where: { eventId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async sweepPending(limit = 50) {
    const pending = await this.prisma.order.findMany({
      where: { reportSyncPending: true },
      select: { id: true, status: true },
      take: limit,
      orderBy: { updatedAt: 'asc' },
    });
    for (const order of pending) {
      const action =
        order.status === 'paid'
          ? 'paid'
          : order.status === 'expired' || order.status === 'cancelled'
            ? 'expire'
            : order.status === 'refunded' || order.status === 'partially_refunded'
              ? 'refund'
              : 'hold';
      await this.syncOrder({ orderId: order.id, action }).catch((error) => {
        this.logger.error(`Pending sync failed for ${order.id}`, error);
      });
    }
    return pending.length;
  }

  /**
   * Rebuild daily rollups for one event day from paid order snapshots (trx basis).
   * Also rebuilds event-basis rows whose eventStartDate falls on this day.
   */
  async reconcileEventDay(eventId: string, day: Date) {
    const timeZone = await this.reportTz.getTimeZone();
    const reportDay = calendarDay(day, timeZone);
    const dayKey = reportDay.toISOString().slice(0, 10);
    const { start: trxStart, endExclusive: trxEnd } =
      await this.reportTz.zonedDayUtcBounds(dayKey);
    const nextDay = new Date(reportDay);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);

    const [trxOrders, eventOrders] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          eventId,
          status: { in: ['paid', 'refunded', 'partially_refunded'] },
          OR: [
            { paidAt: { gte: trxStart, lt: trxEnd } },
            { paidAt: null, createdAt: { gte: trxStart, lt: trxEnd } },
          ],
        },
        include: { items: true },
      }),
      this.prisma.order.findMany({
        where: {
          eventId,
          status: { in: ['paid', 'refunded', 'partially_refunded'] },
          // eventStartDate is a calendar date — keep date-key equality, not TZ shift of instants.
          eventStartDate: { gte: reportDay, lt: nextDay },
        },
        include: { items: true },
      }),
    ]);

    await this.prisma.$transaction(async (tx) => {
      await this.clearDayRollups(tx, eventId, reportDay, ReportBasis.trx);
      await this.clearDayRollups(tx, eventId, reportDay, ReportBasis.event);
      await this.writeReconciledDay(tx, eventId, reportDay, ReportBasis.trx, trxOrders);
      await this.writeReconciledDay(tx, eventId, reportDay, ReportBasis.event, eventOrders);
    });

    const checkedIn = await this.prisma.orderItem.count({
      where: { eventId, attendanceStatus: AttendanceStatus.checked_in },
    });
    await this.prisma.eventAttendanceCounter.upsert({
      where: { eventId },
      create: { eventId, checkedInCount: checkedIn, checkedOutCount: 0 },
      update: { checkedInCount: checkedIn },
    });

    return {
      trxOrderCount: trxOrders.length,
      eventOrderCount: eventOrders.length,
      checkedIn,
    };
  }

  private async clearDayRollups(
    tx: TxClient,
    eventId: string,
    reportDay: Date,
    reportBasis: ReportBasis,
  ) {
    const where = { eventId, reportDay, reportBasis };
    await tx.bookingReportDaily.deleteMany({ where });
    await tx.bookingReportPaymentDaily.deleteMany({ where });
    await tx.bookingReportVisitorDaily.deleteMany({ where });
    await tx.bookingReportPosDaily.deleteMany({ where });
    await tx.bookingReportThirdPartyVendorDaily.deleteMany({ where });
    await tx.bookingReportTicketDaily.deleteMany({ where });
    await tx.bookingReportDemoDaily.deleteMany({ where });
    await tx.bookingReportCafeDaily.deleteMany({ where });
    await tx.bookingReportCafeAgentDaily.deleteMany({ where });
    await tx.bookingReportCafeItemDaily.deleteMany({ where });
    await tx.bookingReportNamedExtraDaily.deleteMany({ where });
    await tx.bookingReportVendorProductDaily.deleteMany({ where });
  }

  private async writeReconciledDay(
    tx: TxClient,
    eventId: string,
    reportDay: Date,
    reportBasis: ReportBasis,
    orders: OrderWithItems[],
  ) {
    type DailyAgg = {
      orderCount: number;
      admitCount: number;
      ticketQty: number;
      revenueTotal: number;
      ticketsNet: number;
      addonsNet: number;
    };
    const byMode = new Map<string, DailyAgg>();
    const byPayLabel = new Map<
      string,
      { orderCount: number; admitCount: number; revenueTotal: number }
    >();
    const byVisitor = new Map<string, DailyAgg>();
    const byPos = new Map<
      string,
      {
        orderCount: number;
        admitCount: number;
        revenueTotal: number;
        cashAmount: number;
        cardAmount: number;
      }
    >();
    const byShare = new Map<
      string,
      { orderCount: number; ticketQty: number; admitCount: number; revenueTotal: number }
    >();
    const byTicket = new Map<
      string,
      {
        label: string;
        itemType: OrderItemType;
        orderCount: number;
        ticketQty: number;
        admitCount: number;
        revenueTotal: number;
      }
    >();
    const byDemo = new Map<
      string,
      { orderCount: number; admitCount: number; revenueTotal: number }
    >();

    for (const order of orders) {
      if (order.status !== 'paid') continue;
      const modeKey = `${order.paymentMode}|${order.currency}`;
      const mode = byMode.get(modeKey) ?? {
        orderCount: 0,
        admitCount: 0,
        ticketQty: 0,
        revenueTotal: 0,
        ticketsNet: 0,
        addonsNet: 0,
      };
      mode.orderCount += 1;
      mode.admitCount += order.totalAdmits;
      mode.ticketQty += order.totalQuantity;
      mode.revenueTotal += order.totalAmount.toNumber();
      const orderPromo = isLegacyMigratedOrder(order.metadata)
        ? 0
        : order.discountAmount.toNumber();
      const ticketsNetFromItems = order.items
        .filter((i) => TICKET_TYPES.includes(i.itemType) && !i.ticketIsCafe)
        .reduce((s, i) => s + i.totalAmount.toNumber(), 0);
      mode.ticketsNet += Math.max(0, ticketsNetFromItems - orderPromo);
      mode.addonsNet += order.addonsNet.toNumber();
      byMode.set(modeKey, mode);

      if (order.bookedByAgentId) {
        const posKey = `${order.bookedByAgentId}|${order.paymentMode}|${order.currency}`;
        const pos = byPos.get(posKey) ?? {
          orderCount: 0,
          admitCount: 0,
          revenueTotal: 0,
          cashAmount: 0,
          cardAmount: 0,
        };
        pos.orderCount += 1;
        pos.admitCount += order.totalAdmits;
        pos.revenueTotal += order.totalAmount.toNumber();
        pos.cashAmount += order.cashAmount.toNumber();
        pos.cardAmount += order.cardAmount.toNumber();
        byPos.set(posKey, pos);
      }

      const sharesOnOrder = new Set<string>();
      const ticketsOnOrder = new Set<string>();
      let firstShareKey: string | null = null;
      for (const item of order.items) {
        const isCafe = Boolean(item.ticketIsCafe);
        const itemQty = isCafe ? 0 : item.quantity;
        const itemAdmits = isCafe ? 0 : item.admitCount * item.quantity;
        if (item.thirdPartyVendorId) {
          const shareKey = `${item.thirdPartyVendorId}|${order.currency}`;
          if (!firstShareKey) firstShareKey = shareKey;
          sharesOnOrder.add(shareKey);
          const share = byShare.get(shareKey) ?? {
            orderCount: 0,
            ticketQty: 0,
            admitCount: 0,
            revenueTotal: 0,
          };
          if (TICKET_TYPES.includes(item.itemType)) {
            share.ticketQty += itemQty;
            share.admitCount += itemAdmits;
          }
          share.revenueTotal += item.totalAmount.toNumber();
          byShare.set(shareKey, share);
        }

        if (TICKET_TYPES.includes(item.itemType)) {
          const tKey = `${item.itemId}|${order.currency}`;
          ticketsOnOrder.add(tKey);
          const ticket = byTicket.get(tKey) ?? {
            label: item.displayName,
            itemType: item.itemType,
            orderCount: 0,
            ticketQty: 0,
            admitCount: 0,
            revenueTotal: 0,
          };
          ticket.ticketQty += itemQty;
          ticket.admitCount += itemAdmits;
          ticket.revenueTotal += item.totalAmount.toNumber();
          byTicket.set(tKey, ticket);

          const vKey = `${item.visitorType}|${order.currency}`;
          const bucket = byVisitor.get(vKey) ?? {
            orderCount: 0,
            admitCount: 0,
            ticketQty: 0,
            revenueTotal: 0,
            ticketsNet: 0,
            addonsNet: 0,
          };
          bucket.admitCount += itemAdmits;
          bucket.ticketQty += itemQty;
          bucket.revenueTotal += item.totalAmount.toNumber();
          byVisitor.set(vKey, bucket);
        }
      }
      if (orderPromo > 0 && firstShareKey) {
        const share = byShare.get(firstShareKey);
        if (share) {
          share.revenueTotal = Math.max(
            0,
            Math.round((share.revenueTotal - orderPromo) * 1000) / 1000,
          );
        }
      }
      for (const shareKey of sharesOnOrder) {
        const share = byShare.get(shareKey);
        if (share) share.orderCount += 1;
      }
      for (const tKey of ticketsOnOrder) {
        const ticket = byTicket.get(tKey);
        if (ticket) ticket.orderCount += 1;
      }

      const labelKey = `${order.paymentMethodLabel}|${order.currency}`;
      const label = byPayLabel.get(labelKey) ?? {
        orderCount: 0,
        admitCount: 0,
        revenueTotal: 0,
      };
      label.orderCount += 1;
      label.admitCount += order.totalAdmits;
      label.revenueTotal += order.totalAmount.toNumber();
      byPayLabel.set(labelKey, label);

      const ageGroup = normalizeCustomerAgeGroup(order.customerAgeGroup);
      const region = order.customerGeographicRegion?.trim() || 'Unknown';
      const demoKey = `${ageGroup}|${region}|${order.currency}`;
      const demo = byDemo.get(demoKey) ?? {
        orderCount: 0,
        admitCount: 0,
        revenueTotal: 0,
      };
      demo.orderCount += 1;
      demo.admitCount += order.totalAdmits;
      demo.revenueTotal += order.totalAmount.toNumber();
      byDemo.set(demoKey, demo);
    }

    for (const [key, agg] of byMode) {
      const [paymentMode, currency] = key.split('|') as [ReportPaymentMode, string];
      await tx.bookingReportDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          paymentMode,
          currency,
          orderCount: agg.orderCount,
          admitCount: agg.admitCount,
          ticketQty: agg.ticketQty,
          revenueTotal: agg.revenueTotal,
          ticketsNet: agg.ticketsNet,
          addonsNet: agg.addonsNet,
        },
      });
    }
    for (const [key, agg] of byPayLabel) {
      const [paymentMethodLabel, currency] = key.split('|');
      await tx.bookingReportPaymentDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          paymentMethodLabel,
          currency,
          orderCount: agg.orderCount,
          admitCount: agg.admitCount,
          revenueTotal: agg.revenueTotal,
        },
      });
    }
    for (const [key, agg] of byVisitor) {
      const [visitorType, currency] = key.split('|') as [VisitorType, string];
      await tx.bookingReportVisitorDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          visitorType,
          currency,
          orderCount: 0,
          admitCount: agg.admitCount,
          ticketQty: agg.ticketQty,
          revenueTotal: agg.revenueTotal,
        },
      });
    }
    for (const [key, agg] of byPos) {
      const [bookedByAgentId, paymentMode, currency] = key.split('|') as [
        string,
        ReportPaymentMode,
        string,
      ];
      await tx.bookingReportPosDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          bookedByAgentId,
          paymentMode,
          currency,
          orderCount: agg.orderCount,
          admitCount: agg.admitCount,
          revenueTotal: agg.revenueTotal,
          cashAmount: agg.cashAmount,
          cardAmount: agg.cardAmount,
        },
      });
    }
    for (const [key, agg] of byShare) {
      const [thirdPartyVendorId, currency] = key.split('|');
      await tx.bookingReportThirdPartyVendorDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId,
          currency,
          orderCount: agg.orderCount,
          ticketQty: agg.ticketQty,
          admitCount: agg.admitCount,
          revenueTotal: agg.revenueTotal,
        },
      });
    }
    for (const [key, agg] of byTicket) {
      const [ticketItemId, currency] = key.split('|');
      await tx.bookingReportTicketDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          ticketItemId,
          ticketLabel: agg.label,
          itemType: agg.itemType,
          currency,
          orderCount: agg.orderCount,
          ticketQty: agg.ticketQty,
          admitCount: agg.admitCount,
          revenueTotal: agg.revenueTotal,
        },
      });
    }
    for (const [key, agg] of byDemo) {
      const [ageGroup, region, currency] = key.split('|');
      await tx.bookingReportDemoDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          ageGroup,
          region,
          currency,
          orderCount: agg.orderCount,
          admitCount: agg.admitCount,
          revenueTotal: agg.revenueTotal,
        },
      });
    }

    type NamedExtraAgg = {
      thirdPartyVendorId: string;
      productKind: string;
      nameKey: string;
      productId: string;
      productLabel: string;
      orderCount: number;
      itemQty: number;
      withTicketQty: number;
      standaloneQty: number;
      revenueTotal: number;
      currency: string;
    };
    const byNamedExtra = new Map<string, NamedExtraAgg>();
    for (const order of orders) {
      if (order.status !== 'paid') continue;
      const buckets = buildNamedExtraRollupBuckets(
        order.items.map((item) => ({
          itemId: item.itemId,
          itemType: item.itemType,
          displayName: item.displayName,
          quantity: item.quantity,
          totalAmount: item.totalAmount.toNumber(),
          parentOrderItemId: item.parentOrderItemId,
          orderId: order.id,
          thirdPartyVendorId: item.thirdPartyVendorId,
        })),
      );
      for (const bucket of buckets) {
        const key = `${bucket.thirdPartyVendorId}|${bucket.productKind}|${bucket.nameKey}|${order.currency}`;
        const current = byNamedExtra.get(key) ?? {
          thirdPartyVendorId: bucket.thirdPartyVendorId,
          productKind: bucket.productKind,
          nameKey: bucket.nameKey,
          productId: bucket.productId,
          productLabel: bucket.productLabel,
          orderCount: 0,
          itemQty: 0,
          withTicketQty: 0,
          standaloneQty: 0,
          revenueTotal: 0,
          currency: order.currency,
        };
        current.orderCount += bucket.orderCount;
        current.itemQty += bucket.itemQty;
        current.withTicketQty += bucket.withTicketQty;
        current.standaloneQty += bucket.standaloneQty;
        current.revenueTotal += bucket.revenueTotal;
        current.productId = bucket.productId;
        current.productLabel = bucket.productLabel;
        byNamedExtra.set(key, current);
      }
    }
    for (const agg of byNamedExtra.values()) {
      await tx.bookingReportNamedExtraDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId: agg.thirdPartyVendorId,
          productKind: agg.productKind,
          nameKey: agg.nameKey,
          productId: agg.productId,
          productLabel: agg.productLabel,
          orderCount: agg.orderCount,
          itemQty: agg.itemQty,
          withTicketQty: agg.withTicketQty,
          standaloneQty: agg.standaloneQty,
          revenueTotal: agg.revenueTotal,
          currency: agg.currency,
        },
      });
    }

    type VendorProductAgg = {
      thirdPartyVendorId: string;
      productId: string;
      productLabel: string;
      productKind: string;
      orderCount: number;
      ticketQty: number;
      admitCount: number;
      addonAmount: number;
      timeExtensionAmount: number;
      ticketRevenue: number;
      discountAmount: number;
      netRevenue: number;
      currency: string;
    };
    const byVendorProduct = new Map<string, VendorProductAgg>();
    for (const order of orders) {
      if (order.status !== 'paid') continue;
      const buckets = buildVendorProductBuckets({
        orderDiscountAmount: isLegacyMigratedOrder(order.metadata)
          ? 0
          : order.discountAmount.toNumber(),
        legacyFirstAddonAmount: legacyFirstAddonAmountFromMetadata(
          order.metadata,
        ),
        items: withLegacyLineSortKeys(
          order.items.map((item) => ({
            id: item.id,
            itemId: item.itemId,
            itemType: item.itemType,
            displayName: item.displayName,
            quantity: item.quantity,
            admitCount: item.admitCount,
            totalAmount: item.totalAmount.toNumber(),
            discountAmount: item.discountAmount.toNumber(),
            thirdPartyVendorId: item.thirdPartyVendorId,
            ticketIsCafe: item.ticketIsCafe,
            parentOrderItemId: item.parentOrderItemId,
            createdAt: item.createdAt,
            ticketCode: item.ticketCode,
          })),
          order.metadata,
        ),
      });
      for (const bucket of buckets) {
        const key = `${bucket.thirdPartyVendorId}|${bucket.productKind}|${bucket.productId}|${order.currency}`;
        const current = byVendorProduct.get(key) ?? {
          thirdPartyVendorId: bucket.thirdPartyVendorId,
          productId: bucket.productId,
          productLabel: bucket.productLabel,
          productKind: bucket.productKind,
          orderCount: 0,
          ticketQty: 0,
          admitCount: 0,
          addonAmount: 0,
          timeExtensionAmount: 0,
          ticketRevenue: 0,
          discountAmount: 0,
          netRevenue: 0,
          currency: order.currency,
        };
        current.orderCount += bucket.orderCount;
        current.ticketQty += bucket.ticketQty;
        current.admitCount += bucket.admitCount;
        current.addonAmount += bucket.addonAmount;
        current.timeExtensionAmount += bucket.timeExtensionAmount;
        current.ticketRevenue += bucket.ticketRevenue;
        current.discountAmount += bucket.discountAmount;
        current.netRevenue += bucket.netRevenue;
        current.productLabel = bucket.productLabel;
        byVendorProduct.set(key, current);
      }
    }
    for (const agg of byVendorProduct.values()) {
      await tx.bookingReportVendorProductDaily.create({
        data: {
          eventId,
          reportDay,
          reportBasis,
          thirdPartyVendorId: agg.thirdPartyVendorId,
          productId: agg.productId,
          productLabel: agg.productLabel,
          productKind: agg.productKind,
          orderCount: agg.orderCount,
          ticketQty: agg.ticketQty,
          admitCount: agg.admitCount,
          addonAmount: agg.addonAmount,
          timeExtensionAmount: agg.timeExtensionAmount,
          ticketRevenue: agg.ticketRevenue,
          discountAmount: agg.discountAmount,
          netRevenue: agg.netRevenue,
          currency: agg.currency,
        },
      });
    }

    for (const order of orders) {
      if (order.status !== 'paid') continue;
      await this.applyCafeDailyRollups(tx, order, {
        reportDay,
        reportBasis,
        sign: 1,
        orderDelta: 1,
      });
    }
  }
}

function reportDayTargets(
  order: OrderWithItems,
  timeZone: string,
): Array<{
  reportDay: Date;
  reportBasis: ReportBasis;
}> {
  const trxDay = calendarDay(order.paidAt ?? order.createdAt, timeZone);
  const targets: Array<{ reportDay: Date; reportBasis: ReportBasis }> = [
    { reportDay: trxDay, reportBasis: ReportBasis.trx },
  ];
  if (order.eventStartDate) {
    // Date-only visit day — use the stored calendar date (UTC midnight key).
    const eventDay = calendarDay(order.eventStartDate, 'UTC');
    targets.push({ reportDay: eventDay, reportBasis: ReportBasis.event });
  }
  return targets;
}
