/**
 * Builds Reporting v2 rollups + sales counters from paid orders.
 * Dashboard / insights / tickets tab read these tables — not raw orders.
 *
 * Usage:
 *   npx tsx prisma/sync-perf-order-rollups.ts
 *   npx tsx prisma/sync-perf-order-rollups.ts --event=kids-driving-school
 *   npx tsx prisma/sync-perf-order-rollups.ts --all-paid
 */
import { randomUUID } from 'crypto';
import {
  OrderItemType,
  PrismaClient,
  ReportBasis,
  ReportPaymentMode,
  VisitorType,
} from '@prisma/client';
import { normalizeCustomerAgeGroup } from '../src/modules/reporting/camp-age-groups';
import {
  buildNamedExtraRollupBuckets,
} from '../src/modules/reporting/named-extra-breakdown';
import {
  calendarDay,
  calendarDayKey,
  normalizeReportingTimeZone,
} from '../src/modules/reporting/report-timezone.util';
import {
  buildVendorProductBuckets,
  isLegacyMigratedOrder,
  legacyFirstAddonAmountFromMetadata,
  withLegacyLineSortKeys,
  type VendorProductKind,
} from '../src/modules/reporting/vendor-product-rollup';

const prisma = new PrismaClient();

const SEED_TAG = 'perf_seed';
const EVENT_SLUG_PREFIX = 'perf-load-';
const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];

let REPORT_TIME_ZONE = 'UTC';

async function loadReportTimeZone() {
  const row = await prisma.appSetting.findUnique({
    where: { group: 'regional' },
    select: { enabled: true, configJson: true },
  });
  let timeZone = 'UTC';
  if (row?.enabled && row.configJson && typeof row.configJson === 'object') {
    const raw = (row.configJson as Record<string, unknown>).timezone_default;
    if (typeof raw === 'string') timeZone = normalizeReportingTimeZone(raw);
  }
  REPORT_TIME_ZONE = timeZone;
  return timeZone;
}

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function utcDay(date: Date) {
  return calendarDay(date, REPORT_TIME_ZONE);
}

function dayKey(date: Date) {
  return calendarDayKey(date, REPORT_TIME_ZONE);
}

function eventDay(date: Date) {
  // Visit date is a calendar date key — do not shift by reporting TZ.
  return calendarDay(date, 'UTC');
}

function scopeKey(eventId: string, sessionId?: string | null, inventoryItemId?: string | null) {
  return `${eventId}|${sessionId ?? '*'}|${inventoryItemId ?? '*'}`;
}

type DailyAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  paymentMode: ReportPaymentMode;
  orderCount: number;
  admitCount: number;
  ticketQty: number;
  revenueTotal: number;
  ticketsNet: number;
  addonsNet: number;
  currency: string;
};

type PayAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  paymentMethodLabel: string;
  orderCount: number;
  admitCount: number;
  revenueTotal: number;
  currency: string;
};

type VisitorAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  visitorType: VisitorType;
  orderCount: number;
  admitCount: number;
  ticketQty: number;
  revenueTotal: number;
  currency: string;
};

type TicketAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  ticketItemId: string;
  ticketLabel: string;
  itemType: OrderItemType;
  orderCount: number;
  ticketQty: number;
  admitCount: number;
  revenueTotal: number;
  currency: string;
};

type DemoAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  ageGroup: string;
  region: string;
  orderCount: number;
  admitCount: number;
  revenueTotal: number;
  currency: string;
};

type PosAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  bookedByAgentId: string;
  paymentMode: ReportPaymentMode;
  orderCount: number;
  admitCount: number;
  revenueTotal: number;
  cashAmount: number;
  cardAmount: number;
  currency: string;
};

type ShareAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  thirdPartyVendorId: string;
  orderCount: number;
  ticketQty: number;
  admitCount: number;
  revenueTotal: number;
  currency: string;
};

type VendorProductAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
  thirdPartyVendorId: string;
  productId: string;
  productLabel: string;
  productKind: VendorProductKind;
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

type NamedExtraAgg = {
  eventId: string;
  reportDay: Date;
  reportBasis: ReportBasis;
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

type CounterAgg = {
  scopeKey: string;
  eventId: string;
  eventSessionId: string | null;
  soldQty: number;
  orderCount: number;
  revenuePaid: number;
  currency: string;
};

function bumpDaily(map: Map<string, DailyAgg>, row: DailyAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.paymentMode,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.admitCount += row.admitCount;
  cur.ticketQty += row.ticketQty;
  cur.revenueTotal += row.revenueTotal;
  cur.ticketsNet += row.ticketsNet;
  cur.addonsNet += row.addonsNet;
}

function bumpPay(map: Map<string, PayAgg>, row: PayAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.paymentMethodLabel,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.admitCount += row.admitCount;
  cur.revenueTotal += row.revenueTotal;
}

function bumpVisitor(map: Map<string, VisitorAgg>, row: VisitorAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.visitorType,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.admitCount += row.admitCount;
  cur.ticketQty += row.ticketQty;
  cur.revenueTotal += row.revenueTotal;
}

function bumpTicket(map: Map<string, TicketAgg>, row: TicketAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.ticketItemId,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.ticketQty += row.ticketQty;
  cur.admitCount += row.admitCount;
  cur.revenueTotal += row.revenueTotal;
  cur.ticketLabel = row.ticketLabel;
}

function bumpDemo(map: Map<string, DemoAgg>, row: DemoAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.ageGroup,
    row.region,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.admitCount += row.admitCount;
  cur.revenueTotal += row.revenueTotal;
}

function bumpPos(map: Map<string, PosAgg>, row: PosAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.bookedByAgentId,
    row.paymentMode,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.admitCount += row.admitCount;
  cur.revenueTotal += row.revenueTotal;
  cur.cashAmount += row.cashAmount;
  cur.cardAmount += row.cardAmount;
}

function bumpShare(map: Map<string, ShareAgg>, row: ShareAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.thirdPartyVendorId,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.ticketQty += row.ticketQty;
  cur.admitCount += row.admitCount;
  cur.revenueTotal += row.revenueTotal;
}

function bumpVendorProduct(map: Map<string, VendorProductAgg>, row: VendorProductAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.thirdPartyVendorId,
    row.productKind,
    row.productId,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.ticketQty += row.ticketQty;
  cur.admitCount += row.admitCount;
  cur.addonAmount += row.addonAmount;
  cur.timeExtensionAmount += row.timeExtensionAmount;
  cur.ticketRevenue += row.ticketRevenue;
  cur.discountAmount += row.discountAmount;
  cur.netRevenue += row.netRevenue;
  cur.productLabel = row.productLabel;
}

function bumpNamedExtra(map: Map<string, NamedExtraAgg>, row: NamedExtraAgg) {
  const key = [
    row.eventId,
    dayKey(row.reportDay),
    row.reportBasis,
    row.thirdPartyVendorId,
    row.productKind,
    row.nameKey,
    row.currency,
  ].join('|');
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { ...row, reportDay: utcDay(row.reportDay) });
    return;
  }
  cur.orderCount += row.orderCount;
  cur.itemQty += row.itemQty;
  cur.withTicketQty += row.withTicketQty;
  cur.standaloneQty += row.standaloneQty;
  cur.revenueTotal += row.revenueTotal;
  cur.productId = row.productId;
  cur.productLabel = row.productLabel;
}

function bumpCounter(map: Map<string, CounterAgg>, row: CounterAgg) {
  const cur = map.get(row.scopeKey);
  if (!cur) {
    map.set(row.scopeKey, { ...row });
    return;
  }
  cur.soldQty += row.soldQty;
  cur.orderCount += row.orderCount;
  cur.revenuePaid += row.revenuePaid;
}

async function resolveEvents(args: string[]) {
  const eventSlug = args.find((a) => a.startsWith('--event='))?.slice('--event='.length);
  const allPaid = args.includes('--all-paid');

  if (eventSlug) {
    const event = await prisma.event.findUnique({
      where: { slug: eventSlug },
      select: { id: true, slug: true },
    });
    if (!event) throw new Error(`Event not found: ${eventSlug}`);
    return [event];
  }

  if (allPaid) {
    const rows = await prisma.order.groupBy({
      by: ['eventId'],
      where: { status: { in: ['paid', 'refunded', 'partially_refunded'] } },
    });
    const ids = rows.map((r) => r.eventId);
    return prisma.event.findMany({
      where: { id: { in: ids } },
      select: { id: true, slug: true },
      orderBy: { slug: 'asc' },
    });
  }

  return prisma.event.findMany({
    where: { slug: { startsWith: EVENT_SLUG_PREFIX } },
    select: { id: true, slug: true },
  });
}

export async function rebuildEventRollups(
  client: PrismaClient,
  events: Array<{ id: string; slug: string }>,
  options?: { source?: string },
) {
  if (!events.length) {
    console.log('No events to sync.');
    return { events: 0, dailyRows: 0, ticketRows: 0, scanned: 0 };
  }

  const eventIds = events.map((e) => e.id);
  console.log(`Syncing rollups for ${events.length} events…`);

  await client.bookingReportDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportPaymentDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportVisitorDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportPosDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportThirdPartyVendorDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportTicketDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportVendorProductDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportNamedExtraDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportDemoDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportCafeDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportCafeAgentDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.bookingReportCafeItemDaily.deleteMany({ where: { eventId: { in: eventIds } } });
  await client.eventSalesCounter.deleteMany({ where: { eventId: { in: eventIds } } });

  const dailyMap = new Map<string, DailyAgg>();
  const payMap = new Map<string, PayAgg>();
  const visitorMap = new Map<string, VisitorAgg>();
  const ticketMap = new Map<string, TicketAgg>();
  const demoMap = new Map<string, DemoAgg>();
  const posMap = new Map<string, PosAgg>();
  const shareMap = new Map<string, ShareAgg>();
  const vendorProductMap = new Map<string, VendorProductAgg>();
  const namedExtraMap = new Map<string, NamedExtraAgg>();
  const counterMap = new Map<string, CounterAgg>();

  const batchSize = 2000;
  let cursor: string | undefined;
  let scanned = 0;

  for (;;) {
    const orders = await client.order.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        eventId: { in: eventIds },
        status: { in: ['paid', 'refunded', 'partially_refunded'] },
        ...(options?.source ? { source: options.source } : {}),
      },
      orderBy: { id: 'asc' },
      include: {
        items: {
          select: {
            id: true,
            itemId: true,
            itemType: true,
            displayName: true,
            quantity: true,
            admitCount: true,
            totalAmount: true,
            discountAmount: true,
            visitorType: true,
            thirdPartyVendorId: true,
            ticketIsCafe: true,
            parentOrderItemId: true,
            createdAt: true,
            ticketCode: true,
          },
        },
      },
    });
    if (!orders.length) break;

    for (const order of orders) {
      // Paid contribution only (refunds can be extended later).
      if (order.status !== 'paid') continue;

      const trxDay = utcDay(order.paidAt ?? order.createdAt);
      const targets: Array<{ reportDay: Date; reportBasis: ReportBasis }> = [
        { reportDay: trxDay, reportBasis: ReportBasis.trx },
      ];
      if (order.eventStartDate) {
        targets.push({
          reportDay: eventDay(order.eventStartDate),
          reportBasis: ReportBasis.event,
        });
      }

      const revenue = order.totalAmount.toNumber();
      const orderPromo = isLegacyMigratedOrder(order.metadata)
        ? 0
        : order.discountAmount.toNumber();
      const ticketsNet = Math.max(
        0,
        Math.round((order.ticketsNet.toNumber() - orderPromo) * 1000) / 1000,
      );
      const addonsNet = order.addonsNet.toNumber();
      const admitCount = order.totalAdmits;
      const ticketQty = order.totalQuantity;
      const ageGroup = normalizeCustomerAgeGroup(order.customerAgeGroup);
      const region = order.customerGeographicRegion?.trim() || 'Unknown';
      const productBuckets = buildVendorProductBuckets({
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
            ticketIsCafe: Boolean(item.ticketIsCafe),
            parentOrderItemId: item.parentOrderItemId,
            createdAt: item.createdAt,
            ticketCode: item.ticketCode,
          })),
          order.metadata,
        ),
      });
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

      for (const target of targets) {
        bumpDaily(dailyMap, {
          eventId: order.eventId,
          reportDay: target.reportDay,
          reportBasis: target.reportBasis,
          paymentMode: order.paymentMode,
          orderCount: 1,
          admitCount,
          ticketQty,
          revenueTotal: revenue,
          ticketsNet,
          addonsNet,
          currency: order.currency,
        });
        bumpPay(payMap, {
          eventId: order.eventId,
          reportDay: target.reportDay,
          reportBasis: target.reportBasis,
          paymentMethodLabel: order.paymentMethodLabel,
          orderCount: 1,
          admitCount,
          revenueTotal: revenue,
          currency: order.currency,
        });
        bumpDemo(demoMap, {
          eventId: order.eventId,
          reportDay: target.reportDay,
          reportBasis: target.reportBasis,
          ageGroup,
          region,
          orderCount: 1,
          admitCount,
          revenueTotal: revenue,
          currency: order.currency,
        });

        if (order.bookedByAgentId) {
          bumpPos(posMap, {
            eventId: order.eventId,
            reportDay: target.reportDay,
            reportBasis: target.reportBasis,
            bookedByAgentId: order.bookedByAgentId,
            paymentMode: order.paymentMode,
            orderCount: 1,
            admitCount,
            revenueTotal: revenue,
            cashAmount: order.cashAmount.toNumber(),
            cardAmount: order.cardAmount.toNumber(),
            currency: order.currency,
          });
        }

        const visitorSeen = new Set<string>();
        const ticketSeen = new Set<string>();
        const shareSeen = new Set<string>();
        for (const item of order.items) {
          const itemRevenue = item.totalAmount.toNumber();
          const isCafe = Boolean(item.ticketIsCafe);
          const itemAdmits = isCafe ? 0 : item.admitCount * item.quantity;
          const itemTicketQty = isCafe ? 0 : item.quantity;
          const isTicket = TICKET_TYPES.includes(item.itemType);

          if (isTicket) {
            bumpVisitor(visitorMap, {
              eventId: order.eventId,
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              visitorType: item.visitorType,
              orderCount: visitorSeen.has(item.visitorType) ? 0 : 1,
              admitCount: itemAdmits,
              ticketQty: itemTicketQty,
              revenueTotal: itemRevenue,
              currency: order.currency,
            });
            visitorSeen.add(item.visitorType);

            bumpTicket(ticketMap, {
              eventId: order.eventId,
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              ticketItemId: item.itemId,
              ticketLabel: item.displayName,
              itemType: item.itemType,
              orderCount: ticketSeen.has(item.itemId) ? 0 : 1,
              ticketQty: itemTicketQty,
              admitCount: itemAdmits,
              revenueTotal: itemRevenue,
              currency: order.currency,
            });
            ticketSeen.add(item.itemId);
          }

          if (item.thirdPartyVendorId) {
            const shareIsTicket = isTicket && !isCafe;
            bumpShare(shareMap, {
              eventId: order.eventId,
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              thirdPartyVendorId: item.thirdPartyVendorId,
              orderCount: shareSeen.has(item.thirdPartyVendorId) ? 0 : 1,
              ticketQty: shareIsTicket ? item.quantity : 0,
              admitCount: shareIsTicket ? itemAdmits : 0,
              revenueTotal: itemRevenue,
              currency: order.currency,
            });
            shareSeen.add(item.thirdPartyVendorId);
          }
        }

        if (orderPromo > 0 && shareSeen.size > 0) {
          const firstVendorId = [...shareSeen][0];
          bumpShare(shareMap, {
            eventId: order.eventId,
            reportDay: target.reportDay,
            reportBasis: target.reportBasis,
            thirdPartyVendorId: firstVendorId,
            orderCount: 0,
            ticketQty: 0,
            admitCount: 0,
            revenueTotal: -orderPromo,
            currency: order.currency,
          });
        }

        for (const bucket of productBuckets) {
          bumpVendorProduct(vendorProductMap, {
            eventId: order.eventId,
            reportDay: target.reportDay,
            reportBasis: target.reportBasis,
            thirdPartyVendorId: bucket.thirdPartyVendorId,
            productId: bucket.productId,
            productLabel: bucket.productLabel,
            productKind: bucket.productKind,
            orderCount: bucket.orderCount,
            ticketQty: bucket.ticketQty,
            admitCount: bucket.admitCount,
            addonAmount: bucket.addonAmount,
            timeExtensionAmount: bucket.timeExtensionAmount,
            ticketRevenue: bucket.ticketRevenue,
            discountAmount: bucket.discountAmount,
            netRevenue: bucket.netRevenue,
            currency: order.currency,
          });
        }
        for (const bucket of namedExtraBuckets) {
          bumpNamedExtra(namedExtraMap, {
            eventId: order.eventId,
            reportDay: target.reportDay,
            reportBasis: target.reportBasis,
            thirdPartyVendorId: bucket.thirdPartyVendorId,
            productKind: bucket.productKind,
            nameKey: bucket.nameKey,
            productId: bucket.productId,
            productLabel: bucket.productLabel,
            orderCount: bucket.orderCount,
            itemQty: bucket.itemQty,
            withTicketQty: bucket.withTicketQty,
            standaloneQty: bucket.standaloneQty,
            revenueTotal: bucket.revenueTotal,
            currency: order.currency,
          });
        }
      }

      bumpCounter(counterMap, {
        scopeKey: scopeKey(order.eventId),
        eventId: order.eventId,
        eventSessionId: null,
        soldQty: admitCount,
        orderCount: 1,
        revenuePaid: revenue,
        currency: order.currency,
      });
      bumpCounter(counterMap, {
        scopeKey: scopeKey(order.eventId, order.eventSessionId),
        eventId: order.eventId,
        eventSessionId: order.eventSessionId,
        soldQty: admitCount,
        orderCount: 1,
        revenuePaid: revenue,
        currency: order.currency,
      });
    }

    scanned += orders.length;
    cursor = orders[orders.length - 1]?.id;
    process.stdout.write(`\r  scanned ${scanned.toLocaleString()} orders…`);
  }

  console.log('');

  const dailyRows = [...dailyMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    paymentMode: row.paymentMode,
    orderCount: row.orderCount,
    admitCount: row.admitCount,
    ticketQty: row.ticketQty,
    revenueTotal: money(row.revenueTotal),
    ticketsNet: money(row.ticketsNet),
    addonsNet: money(row.addonsNet),
    currency: row.currency,
  }));

  const payRows = [...payMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    paymentMethodLabel: row.paymentMethodLabel,
    orderCount: row.orderCount,
    admitCount: row.admitCount,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const visitorRows = [...visitorMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    visitorType: row.visitorType,
    orderCount: row.orderCount,
    admitCount: row.admitCount,
    ticketQty: row.ticketQty,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const ticketRows = [...ticketMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    ticketItemId: row.ticketItemId,
    ticketLabel: row.ticketLabel,
    itemType: row.itemType,
    orderCount: row.orderCount,
    ticketQty: row.ticketQty,
    admitCount: row.admitCount,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const demoRows = [...demoMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    ageGroup: row.ageGroup,
    region: row.region,
    orderCount: row.orderCount,
    admitCount: row.admitCount,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const posRows = [...posMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    bookedByAgentId: row.bookedByAgentId,
    paymentMode: row.paymentMode,
    orderCount: row.orderCount,
    admitCount: row.admitCount,
    revenueTotal: money(row.revenueTotal),
    cashAmount: money(row.cashAmount),
    cardAmount: money(row.cardAmount),
    currency: row.currency,
  }));

  const shareRows = [...shareMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    thirdPartyVendorId: row.thirdPartyVendorId,
    orderCount: row.orderCount,
    ticketQty: row.ticketQty,
    admitCount: row.admitCount,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const vendorProductRows = [...vendorProductMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    thirdPartyVendorId: row.thirdPartyVendorId,
    productId: row.productId,
    productLabel: row.productLabel,
    productKind: row.productKind,
    orderCount: row.orderCount,
    ticketQty: row.ticketQty,
    admitCount: row.admitCount,
    addonAmount: money(row.addonAmount),
    timeExtensionAmount: money(row.timeExtensionAmount),
    ticketRevenue: money(row.ticketRevenue),
    discountAmount: money(row.discountAmount),
    netRevenue: money(row.netRevenue),
    currency: row.currency,
  }));

  const namedExtraRows = [...namedExtraMap.values()].map((row) => ({
    id: randomUUID(),
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    thirdPartyVendorId: row.thirdPartyVendorId,
    productKind: row.productKind,
    nameKey: row.nameKey,
    productId: row.productId,
    productLabel: row.productLabel,
    orderCount: row.orderCount,
    itemQty: row.itemQty,
    withTicketQty: row.withTicketQty,
    standaloneQty: row.standaloneQty,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const counterRows = [...counterMap.values()].map((row) => ({
    id: randomUUID(),
    scopeKey: row.scopeKey,
    eventId: row.eventId,
    eventSessionId: row.eventSessionId,
    inventoryItemId: null as string | null,
    soldQty: row.soldQty,
    heldQty: 0,
    orderCount: row.orderCount,
    revenuePaid: money(row.revenuePaid),
    currency: row.currency,
  }));

  const chunk = 500;
  for (let i = 0; i < dailyRows.length; i += chunk) {
    await client.bookingReportDaily.createMany({ data: dailyRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < payRows.length; i += chunk) {
    await client.bookingReportPaymentDaily.createMany({ data: payRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < visitorRows.length; i += chunk) {
    await client.bookingReportVisitorDaily.createMany({ data: visitorRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < ticketRows.length; i += chunk) {
    await client.bookingReportTicketDaily.createMany({ data: ticketRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < demoRows.length; i += chunk) {
    await client.bookingReportDemoDaily.createMany({ data: demoRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < posRows.length; i += chunk) {
    await client.bookingReportPosDaily.createMany({ data: posRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < shareRows.length; i += chunk) {
    await client.bookingReportThirdPartyVendorDaily.createMany({ data: shareRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < vendorProductRows.length; i += chunk) {
    await client.bookingReportVendorProductDaily.createMany({
      data: vendorProductRows.slice(i, i + chunk),
    });
  }
  for (let i = 0; i < namedExtraRows.length; i += chunk) {
    await client.bookingReportNamedExtraDaily.createMany({
      data: namedExtraRows.slice(i, i + chunk),
    });
  }
  for (let i = 0; i < counterRows.length; i += chunk) {
    await client.eventSalesCounter.createMany({ data: counterRows.slice(i, i + chunk) });
  }

  const cafeRollups = await rebuildCafeRollupsForEvents(client, eventIds, options);

  const revenue = dailyRows
    .filter((r) => r.reportBasis === ReportBasis.trx)
    .reduce((sum, r) => sum + Number(r.revenueTotal), 0);

  console.log({
    events: events.map((e) => e.slug),
    orders_scanned: scanned,
    booking_report_daily: dailyRows.length,
    booking_report_payment_daily: payRows.length,
    booking_report_visitor_daily: visitorRows.length,
    booking_report_ticket_daily: ticketRows.length,
    booking_report_demo_daily: demoRows.length,
    booking_report_pos_daily: posRows.length,
    booking_report_third_party_vendor_daily: shareRows.length,
    booking_report_vendor_product_daily: vendorProductRows.length,
    booking_report_named_extra_daily: namedExtraRows.length,
    booking_report_cafe_daily: cafeRollups.daily,
    booking_report_cafe_agent_daily: cafeRollups.agents,
    booking_report_cafe_item_daily: cafeRollups.items,
    event_sales_counters: counterRows.length,
    trx_revenue_total: Number(revenue.toFixed(3)),
  });

  return {
    events: events.length,
    dailyRows: dailyRows.length,
    ticketRows: ticketRows.length,
    posRows: posRows.length,
    shareRows: shareRows.length,
    scanned,
  };
}

async function rebuildCafeRollupsForEvents(
  client: PrismaClient,
  eventIds: string[],
  options?: { source?: string },
) {
  type CafeDaily = {
    cafeId: string;
    eventId: string;
    reportDay: Date;
    reportBasis: ReportBasis;
    paymentMode: ReportPaymentMode;
    orderCount: number;
    itemQty: number;
    revenueTotal: number;
    cashAmount: number;
    cardAmount: number;
    onlineAmount: number;
    currency: string;
  };
  type CafeAgent = {
    cafeId: string;
    eventId: string;
    reportDay: Date;
    reportBasis: ReportBasis;
    bookedByAgentId: string;
    paymentMode: ReportPaymentMode;
    orderCount: number;
    itemQty: number;
    revenueTotal: number;
    cashAmount: number;
    cardAmount: number;
    currency: string;
  };
  type CafeItem = {
    cafeId: string;
    eventId: string;
    reportDay: Date;
    reportBasis: ReportBasis;
    menuItemId: string;
    itemLabel: string;
    orderCount: number;
    itemQty: number;
    revenueTotal: number;
    currency: string;
  };

  const dailyMap = new Map<string, CafeDaily>();
  const agentMap = new Map<string, CafeAgent>();
  const itemMap = new Map<string, CafeItem>();
  const menuToCafe = new Map<string, string>();

  const menuItems = await client.cafeMenuItem.findMany({
    where: {
      subcategory: {
        category: {
          OR: [
            { cafe: { activeEventId: { in: eventIds } } },
            {
              cafe: {
                assignments: {
                  some: { eventId: { in: eventIds }, unassignedAt: null },
                },
              },
            },
          ],
        },
      },
    },
    select: {
      id: true,
      subcategory: { select: { category: { select: { cafeId: true } } } },
    },
  });
  for (const item of menuItems) {
    menuToCafe.set(item.id, item.subcategory.category.cafeId);
  }

  const batchSize = 2000;
  let cursor: string | undefined;
  for (;;) {
    const orders = await client.order.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        eventId: { in: eventIds },
        status: 'paid',
        ...(options?.source ? { source: options.source } : {}),
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        eventId: true,
        paidAt: true,
        createdAt: true,
        eventStartDate: true,
        paymentMode: true,
        currency: true,
        totalAmount: true,
        discountAmount: true,
        cashAmount: true,
        cardAmount: true,
        onlineAmount: true,
        bookedByAgentId: true,
        metadata: true,
        items: {
          select: {
            itemId: true,
            itemType: true,
            ticketIsCafe: true,
            displayName: true,
            quantity: true,
            totalAmount: true,
            bookedByAgentId: true,
          },
        },
      },
    });
    if (!orders.length) break;
    cursor = orders[orders.length - 1]!.id;

    for (const order of orders) {
      const cafeLines = order.items.filter(
        (item) =>
          item.itemType === OrderItemType.cafe_item || item.ticketIsCafe,
      );
      if (!cafeLines.length) continue;
      const meta = order.metadata as { cafe_id?: string; cafe_ids?: string[] } | null;
      const metaCafeId =
        typeof meta?.cafe_id === 'string' && meta.cafe_id
          ? meta.cafe_id
          : Array.isArray(meta?.cafe_ids) && meta.cafe_ids.length === 1
            ? meta.cafe_ids[0]
            : null;

      const trxDay = utcDay(order.paidAt ?? order.createdAt);
      const targets: Array<{ reportDay: Date; reportBasis: ReportBasis }> = [
        { reportDay: trxDay, reportBasis: ReportBasis.trx },
      ];
      if (order.eventStartDate) {
        targets.push({
          reportDay: eventDay(order.eventStartDate),
          reportBasis: ReportBasis.event,
        });
      }

      const byCafe = new Map<
        string,
        {
          revenue: number;
          itemQty: number;
          byAgent: Map<string, { revenue: number; itemQty: number }>;
          byItem: Map<string, { label: string; revenue: number; itemQty: number }>;
        }
      >();

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
        bucket.revenue += lineRev;
        bucket.itemQty += item.quantity;
        const agentId = item.bookedByAgentId || order.bookedByAgentId;
        if (agentId) {
          const agent = bucket.byAgent.get(agentId) ?? { revenue: 0, itemQty: 0 };
          agent.revenue += lineRev;
          agent.itemQty += item.quantity;
          bucket.byAgent.set(agentId, agent);
        }
        const itemRow = bucket.byItem.get(item.itemId) ?? {
          label: item.displayName,
          revenue: 0,
          itemQty: 0,
        };
        itemRow.revenue += lineRev;
        itemRow.itemQty += item.quantity;
        itemRow.label = item.displayName || itemRow.label;
        bucket.byItem.set(item.itemId, itemRow);
        byCafe.set(cafeId, bucket);
      }

      if (!byCafe.size) continue;

      // Cafe POS: line totals are pre-promo; net down by order.discountAmount for
      // cafe-only / cafe-tagged orders (ticket rollups already consume ticket promos).
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
        const netScale =
          Math.max(0, orderCafeRevenueGross - orderPromoForCafe) /
          orderCafeRevenueGross;
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

      const orderCafeRevenue = [...byCafe.values()].reduce((s, b) => s + b.revenue, 0);
      const orderTotal = Math.max(order.totalAmount.toNumber(), orderCafeRevenue, 0.000001);
      const cafeShareRatio = Math.min(1, orderCafeRevenue / orderTotal);

      for (const target of targets) {
        for (const [cafeId, bucket] of byCafe) {
          const cafeRatio =
            orderCafeRevenue > 0 ? bucket.revenue / orderCafeRevenue : 0;
          const tenderRatio = cafeShareRatio * cafeRatio;
          const dKey = [
            cafeId,
            order.eventId,
            dayKey(target.reportDay),
            target.reportBasis,
            order.paymentMode,
            order.currency,
          ].join('|');
          const daily = dailyMap.get(dKey) ?? {
            cafeId,
            eventId: order.eventId,
            reportDay: target.reportDay,
            reportBasis: target.reportBasis,
            paymentMode: order.paymentMode,
            orderCount: 0,
            itemQty: 0,
            revenueTotal: 0,
            cashAmount: 0,
            cardAmount: 0,
            onlineAmount: 0,
            currency: order.currency,
          };
          daily.orderCount += 1;
          daily.itemQty += bucket.itemQty;
          daily.revenueTotal += bucket.revenue;
          daily.cashAmount += order.cashAmount.toNumber() * tenderRatio;
          daily.cardAmount += order.cardAmount.toNumber() * tenderRatio;
          daily.onlineAmount += order.onlineAmount.toNumber() * tenderRatio;
          dailyMap.set(dKey, daily);

          for (const [agentId, agent] of bucket.byAgent) {
            const agentRatio = bucket.revenue > 0 ? agent.revenue / bucket.revenue : 0;
            const aKey = [
              cafeId,
              order.eventId,
              dayKey(target.reportDay),
              target.reportBasis,
              agentId,
              order.paymentMode,
              order.currency,
            ].join('|');
            const row = agentMap.get(aKey) ?? {
              cafeId,
              eventId: order.eventId,
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              bookedByAgentId: agentId,
              paymentMode: order.paymentMode,
              orderCount: 0,
              itemQty: 0,
              revenueTotal: 0,
              cashAmount: 0,
              cardAmount: 0,
              currency: order.currency,
            };
            row.orderCount += 1;
            row.itemQty += agent.itemQty;
            row.revenueTotal += agent.revenue;
            row.cashAmount += order.cashAmount.toNumber() * tenderRatio * agentRatio;
            row.cardAmount += order.cardAmount.toNumber() * tenderRatio * agentRatio;
            agentMap.set(aKey, row);
          }

          for (const [menuItemId, item] of bucket.byItem) {
            const iKey = [
              cafeId,
              order.eventId,
              dayKey(target.reportDay),
              target.reportBasis,
              menuItemId,
              order.currency,
            ].join('|');
            const row = itemMap.get(iKey) ?? {
              cafeId,
              eventId: order.eventId,
              reportDay: target.reportDay,
              reportBasis: target.reportBasis,
              menuItemId,
              itemLabel: item.label,
              orderCount: 0,
              itemQty: 0,
              revenueTotal: 0,
              currency: order.currency,
            };
            row.orderCount += 1;
            row.itemQty += item.itemQty;
            row.revenueTotal += item.revenue;
            row.itemLabel = item.label || row.itemLabel;
            itemMap.set(iKey, row);
          }
        }
      }
    }
  }

  const dailyRows = [...dailyMap.values()].map((row) => ({
    id: randomUUID(),
    cafeId: row.cafeId,
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    paymentMode: row.paymentMode,
    orderCount: row.orderCount,
    itemQty: row.itemQty,
    revenueTotal: money(row.revenueTotal),
    cashAmount: money(row.cashAmount),
    cardAmount: money(row.cardAmount),
    onlineAmount: money(row.onlineAmount),
    currency: row.currency,
  }));
  const agentRows = [...agentMap.values()].map((row) => ({
    id: randomUUID(),
    cafeId: row.cafeId,
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    bookedByAgentId: row.bookedByAgentId,
    paymentMode: row.paymentMode,
    orderCount: row.orderCount,
    itemQty: row.itemQty,
    revenueTotal: money(row.revenueTotal),
    cashAmount: money(row.cashAmount),
    cardAmount: money(row.cardAmount),
    currency: row.currency,
  }));
  const itemRows = [...itemMap.values()].map((row) => ({
    id: randomUUID(),
    cafeId: row.cafeId,
    eventId: row.eventId,
    reportDay: row.reportDay,
    reportBasis: row.reportBasis,
    menuItemId: row.menuItemId,
    itemLabel: row.itemLabel.slice(0, 190),
    orderCount: row.orderCount,
    itemQty: row.itemQty,
    revenueTotal: money(row.revenueTotal),
    currency: row.currency,
  }));

  const chunk = 500;
  for (let i = 0; i < dailyRows.length; i += chunk) {
    await client.bookingReportCafeDaily.createMany({ data: dailyRows.slice(i, i + chunk) });
  }
  for (let i = 0; i < agentRows.length; i += chunk) {
    await client.bookingReportCafeAgentDaily.createMany({
      data: agentRows.slice(i, i + chunk),
    });
  }
  for (let i = 0; i < itemRows.length; i += chunk) {
    await client.bookingReportCafeItemDaily.createMany({
      data: itemRows.slice(i, i + chunk),
    });
  }

  return {
    daily: dailyRows.length,
    agents: agentRows.length,
    items: itemRows.length,
  };
}

/** Used by seed-perf-orders-50k.ts */
export async function syncPerfOrderRollups(client: PrismaClient = prisma) {
  const events = await client.event.findMany({
    where: { slug: { startsWith: EVENT_SLUG_PREFIX } },
    select: { id: true, slug: true },
  });
  return rebuildEventRollups(client, events, { source: SEED_TAG });
}

async function main() {
  const args = process.argv.slice(2);
  const tz = await loadReportTimeZone();
  console.log(`Reporting timezone: ${tz}`);
  const events = await resolveEvents(args);
  const sourceOnly =
    !args.includes('--all-paid') && !args.some((a) => a.startsWith('--event='))
      ? SEED_TAG
      : undefined;
  await rebuildEventRollups(prisma, events, { source: sourceOnly });
}

const invokedDirectly = process.argv[1]?.includes('sync-perf-order-rollups');
if (invokedDirectly) {
  main()
    .catch(async (error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
