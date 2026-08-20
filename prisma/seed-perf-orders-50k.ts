/**
 * TEMP load test only — seeds ~50K paid bookings across events,
 * with createdAt/paidAt spread from ~3 months ago through today.
 *
 * Tag: common_order prefix PERF50K- / source=perf_seed
 * Destroy later: npm run prisma:destroy-perf-orders-50k
 *
 * Usage:
 *   npx tsx prisma/seed-perf-orders-50k.ts
 *   npx tsx prisma/seed-perf-orders-50k.ts --force   # wipe previous PERF50K rows first
 *   npx tsx prisma/seed-perf-orders-50k.ts --count=50000
 */
import { randomUUID } from 'crypto';
import {
  PrismaClient,
  type Prisma,
  ReportPaymentMode,
} from '@prisma/client';

import { syncPerfOrderRollups } from './sync-perf-order-rollups';

const prisma = new PrismaClient();

const SEED_TAG = 'perf_seed';
const ORDER_PREFIX = 'PERF50K-';
const IDEM_PREFIX = 'perf50k-';
const EVENT_SLUG_PREFIX = 'perf-load-';
const CUSTOMER_EMAIL_PREFIX = 'perf50k.customer.';
const DEFAULT_COUNT = 50_000;
const EVENT_COUNT = 5;
const CUSTOMER_POOL = 250;
const ORDER_BATCH = 400;
const ITEM_BATCH = 800;

const PAYMENT_MODES: Array<{
  mode: ReportPaymentMode;
  label: string;
  source: string;
}> = [
  { mode: ReportPaymentMode.online, label: 'Online', source: 'web' },
  { mode: ReportPaymentMode.online, label: 'Online', source: 'web' },
  { mode: ReportPaymentMode.online, label: 'Online', source: 'web' },
  { mode: ReportPaymentMode.offline_cash, label: 'Cash', source: 'pos' },
  { mode: ReportPaymentMode.offline_card, label: 'Card', source: 'pos' },
  { mode: ReportPaymentMode.split, label: 'Split', source: 'pos' },
];

type EventTarget = {
  id: string;
  slug: string;
  organizationId: string;
  venueId: string | null;
  title: string;
  sessionId: string;
  eventStartDate: Date | null;
  eventStartTime: string | null;
  ticketTypeId: string;
  ticketTitle: string;
  unitPrice: number;
};

function parseArgs(argv: string[]) {
  let force = false;
  let count = DEFAULT_COUNT;
  for (const arg of argv) {
    if (arg === '--force') force = true;
    if (arg.startsWith('--count=')) {
      const n = Number(arg.slice('--count='.length));
      if (Number.isFinite(n) && n > 0) count = Math.floor(n);
    }
  }
  return { force, count };
}

function money(value: number) {
  return (Math.round((value + Number.EPSILON) * 1000) / 1000).toFixed(3);
}

function dayOffset(from: Date, dayIndex: number, withinDayMs: number) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + dayIndex);
  d.setUTCMilliseconds(d.getUTCMilliseconds() + withinDayMs);
  return d;
}

async function destroyPerfOrders() {
  const deleted = await prisma.order.deleteMany({
    where: {
      OR: [
        { commonOrder: { startsWith: ORDER_PREFIX } },
        { source: SEED_TAG },
        { idempotencyKey: { startsWith: IDEM_PREFIX } },
      ],
    },
  });
  return deleted.count;
}

async function ensureCustomers() {
  const emails = Array.from(
    { length: CUSTOMER_POOL },
    (_, i) => `${CUSTOMER_EMAIL_PREFIX}${String(i + 1).padStart(4, '0')}@bookingqube.test`,
  );

  const existing = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, name: true },
  });
  const byEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u]));

  const missing = emails.filter((email) => !byEmail.has(email.toLowerCase()));
  if (missing.length) {
    await prisma.user.createMany({
      data: missing.map((email, index) => ({
        id: randomUUID(),
        email,
        name: `Perf Customer ${byEmail.size + index + 1}`,
        status: 'active',
      })),
      skipDuplicates: true,
    });
  }

  const customers = await prisma.user.findMany({
    where: { email: { in: emails } },
    select: { id: true, email: true, name: true },
    orderBy: { email: 'asc' },
  });

  // Best-effort customer profiles (ignore if already present).
  await prisma.customerProfile.createMany({
    data: customers.map((c) => ({
      userId: c.id,
      defaultLocale: 'en',
    })),
    skipDuplicates: true,
  });

  return customers;
}

async function ensurePerfEvents(): Promise<EventTarget[]> {
  const org =
    (await prisma.organization.findUnique({ where: { slug: 'bookingqube' } })) ??
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!org) {
    throw new Error('No organization found. Run `npm run prisma:seed` first.');
  }

  const venue = await prisma.venue.findFirst({
    orderBy: { createdAt: 'asc' },
  });

  const targets: EventTarget[] = [];

  for (let i = 1; i <= EVENT_COUNT; i += 1) {
    const slug = `${EVENT_SLUG_PREFIX}${i}`;
    const title = `Perf Load Event ${i}`;
    const startsAt = new Date('2026-08-01T07:00:00.000Z');
    startsAt.setUTCDate(startsAt.getUTCDate() + (i - 1) * 7);

    const event = await prisma.event.upsert({
      where: { slug },
      update: {
        organizationId: org.id,
        status: 'published',
        visibility: 'unlisted',
        venueId: venue?.id ?? null,
      },
      create: {
        organizationId: org.id,
        slug,
        eventType: 'general',
        status: 'published',
        visibility: 'unlisted',
        venueId: venue?.id ?? null,
        bookingMode: 'ticketed',
        currency: 'QAR',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 8 * 60 * 60 * 1000),
        publishedAt: new Date(),
        translations: {
          create: [
            {
              locale: 'en',
              title,
              subtitle: 'Temporary load-test event (safe to delete)',
              description: 'Seeded only for query performance testing.',
            },
          ],
        },
      },
      include: {
        translations: { where: { locale: 'en' }, take: 1 },
      },
    });

    const eventDateValue = new Date(startsAt);
    eventDateValue.setUTCHours(0, 0, 0, 0);

    const eventDate = await prisma.eventDate.upsert({
      where: {
        eventId_date: {
          eventId: event.id,
          date: eventDateValue,
        },
      },
      update: {},
      create: {
        eventId: event.id,
        date: eventDateValue,
        status: 'active',
      },
    });

    const session =
      (await prisma.eventSession.findFirst({
        where: { eventId: event.id, eventDateId: eventDate.id },
        orderBy: { startsAt: 'asc' },
      })) ??
      (await prisma.eventSession.create({
        data: {
          eventId: event.id,
          eventDateId: eventDate.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
          displayTime: '10:00 AM',
          status: 'active',
          capacity: 50_000,
        },
      }));

    const ticketGroup =
      (await prisma.ticketGroup.findFirst({
        where: { eventId: event.id, title: 'Perf Admission' },
      })) ??
      (await prisma.ticketGroup.create({
        data: {
          eventId: event.id,
          title: 'Perf Admission',
          subtitle: 'Load-test tickets',
          iconType: 'ticket',
          sortOrder: 1,
        },
      }));

    const unitPrice = 50 + i * 10;
    const ticket = await prisma.ticketType.upsert({
      where: {
        eventId_externalKey: {
          eventId: event.id,
          externalKey: 'perf-adult',
        },
      },
      update: {
        ticketGroupId: ticketGroup.id,
        title: 'Perf Adult',
        basePrice: money(unitPrice),
        status: 'active',
      },
      create: {
        eventId: event.id,
        ticketGroupId: ticketGroup.id,
        externalKey: 'perf-adult',
        title: 'Perf Adult',
        subtitle: 'Load test',
        iconType: 'ticket',
        hasVariants: false,
        basePrice: money(unitPrice),
        currency: 'QAR',
        maxQtyPerOrder: 10,
        status: 'active',
        sortOrder: 1,
      },
    });

    targets.push({
      id: event.id,
      slug: event.slug,
      organizationId: event.organizationId,
      venueId: event.venueId,
      title: event.translations[0]?.title ?? title,
      sessionId: session.id,
      eventStartDate: eventDate.date,
      eventStartTime: session.displayTime,
      ticketTypeId: ticket.id,
      ticketTitle: ticket.title,
      unitPrice,
    });
  }

  return targets;
}

async function seedOrders(count: number, events: EventTarget[], customers: Array<{
  id: string;
  email: string;
  name: string;
}>) {
  const now = new Date();
  const rangeStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1, 0, 0, 0));
  const totalDays = Math.max(
    1,
    Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
      rangeStart.getTime()) /
      86_400_000) + 1,
  );

  console.log(
    `Seeding ${count.toLocaleString()} orders across ${events.length} events, ${totalDays} days (${rangeStart.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)})`,
  );

  let inserted = 0;
  const started = Date.now();

  while (inserted < count) {
    const batchSize = Math.min(ORDER_BATCH, count - inserted);
    const orders: Prisma.OrderCreateManyInput[] = [];
    const items: Prisma.OrderItemCreateManyInput[] = [];

    for (let i = 0; i < batchSize; i += 1) {
      const seq = inserted + i + 1;
      const event = events[seq % events.length]!;
      const customer = customers[seq % customers.length]!;
      const pay = PAYMENT_MODES[seq % PAYMENT_MODES.length]!;
      const dayIndex = seq % totalDays;
      const withinDayMs = (seq * 17_000) % 86_400_000;
      const at = dayOffset(rangeStart, dayIndex, withinDayMs);
      const qty = (seq % 3) + 1;
      const unit = event.unitPrice;
      const lineTotal = unit * qty;
      const orderId = randomUUID();
      const commonOrder = `${ORDER_PREFIX}${String(seq).padStart(6, '0')}`;
      const cash =
        pay.mode === ReportPaymentMode.offline_cash
          ? lineTotal
          : pay.mode === ReportPaymentMode.split
            ? lineTotal / 2
            : 0;
      const card =
        pay.mode === ReportPaymentMode.offline_card
          ? lineTotal
          : pay.mode === ReportPaymentMode.split
            ? lineTotal / 2
            : 0;
      const online = pay.mode === ReportPaymentMode.online ? lineTotal : 0;

      orders.push({
        id: orderId,
        commonOrder,
        idempotencyKey: `${IDEM_PREFIX}${String(seq).padStart(6, '0')}`,
        customerId: customer.id,
        eventId: event.id,
        eventSessionId: event.sessionId,
        status: 'paid',
        paymentStatus: 'paid',
        currency: 'QAR',
        subtotalAmount: money(lineTotal),
        discountAmount: money(0),
        taxAmount: money(0),
        totalAmount: money(lineTotal),
        source: SEED_TAG,
        locale: 'en',
        metadata: { seed: SEED_TAG, seq },
        createdAt: at,
        updatedAt: at,
        paidAt: at,
        organizationId: event.organizationId,
        venueId: event.venueId,
        eventSlug: event.slug,
        eventTitle: event.title,
        eventStartDate: event.eventStartDate,
        eventStartTime: event.eventStartTime,
        customerName: customer.name,
        customerEmail: customer.email,
        paymentMode: pay.mode,
        paymentMethodLabel: pay.label,
        cashAmount: money(cash),
        cardAmount: money(card),
        onlineAmount: money(online),
        compAmount: money(0),
        ticketsNet: money(lineTotal),
        addonsNet: money(0),
        extensionsNet: money(0),
        totalQuantity: qty,
        totalAdmits: qty,
        isSummerCamp: false,
        reportVersion: 1,
        reportSyncPending: false,
      });

      items.push({
        id: randomUUID(),
        orderId,
        eventId: event.id,
        eventSessionId: event.sessionId,
        itemType: 'ticket_type',
        itemId: event.ticketTypeId,
        displayName: event.ticketTitle,
        quantity: qty,
        unitPrice: money(unit),
        subtotalAmount: money(lineTotal),
        discountAmount: money(0),
        taxAmount: money(0),
        totalAmount: money(lineTotal),
        currency: 'QAR',
        ticketCode: `${commonOrder}-01`,
        attendanceStatus: 'not_checked_in',
        visitorType: 'paid',
        admitCount: 1,
        ticketIsCafe: false,
        ticketIsPosOnly: false,
        ticketHideFromOnline: false,
        createdAt: at,
        updatedAt: at,
      });
    }

    await prisma.order.createMany({ data: orders });
    for (let offset = 0; offset < items.length; offset += ITEM_BATCH) {
      await prisma.orderItem.createMany({
        data: items.slice(offset, offset + ITEM_BATCH),
      });
    }

    inserted += batchSize;
    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    const rate = Math.round(inserted / Math.max(0.001, (Date.now() - started) / 1000));
    process.stdout.write(
      `\r  inserted ${inserted.toLocaleString()} / ${count.toLocaleString()} (${elapsed}s, ~${rate}/s)   `,
    );
  }

  console.log('');
}

async function main() {
  const { force, count } = parseArgs(process.argv.slice(2));

  const existing = await prisma.order.count({
    where: {
      OR: [
        { commonOrder: { startsWith: ORDER_PREFIX } },
        { source: SEED_TAG },
      ],
    },
  });

  if (existing > 0) {
    if (!force) {
      console.log(
        `Found ${existing.toLocaleString()} existing PERF50K orders. Re-run with --force to wipe and reseed.`,
      );
      return;
    }
    console.log(`--force: deleting ${existing.toLocaleString()} existing PERF50K orders…`);
    const removed = await destroyPerfOrders();
    console.log(`Deleted ${removed.toLocaleString()} orders.`);
  }

  const customers = await ensureCustomers();
  const events = await ensurePerfEvents();
  await seedOrders(count, events, customers);

  // Dashboard / insights read rollups + counters, not raw orders.
  console.log('Building report rollups + sales counters…');
  await syncPerfOrderRollups(prisma);

  const byEvent = await prisma.order.groupBy({
    by: ['eventSlug'],
    where: { source: SEED_TAG },
    _count: { _all: true },
    orderBy: { eventSlug: 'asc' },
  });

  const oldest = await prisma.order.findFirst({
    where: { source: SEED_TAG },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  const newest = await prisma.order.findFirst({
    where: { source: SEED_TAG },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  console.log({
    tag: SEED_TAG,
    total: count,
    events: byEvent.map((row) => ({
      slug: row.eventSlug,
      orders: row._count._all,
    })),
    createdAt_from: oldest?.createdAt?.toISOString() ?? null,
    createdAt_to: newest?.createdAt?.toISOString() ?? null,
    destroy: 'npm run prisma:destroy-perf-orders-50k',
  });
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
