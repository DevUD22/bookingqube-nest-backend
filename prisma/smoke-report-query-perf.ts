/**
 * Smoke: time rollup-backed report queries (no multi-join scans).
 * Usage: npx tsx prisma/smoke-report-query-perf.ts [eventId]
 */
import { PrismaClient, ReportBasis } from '@prisma/client';

const prisma = new PrismaClient();

async function timed<T>(label: string, fn: () => Promise<T>) {
  const start = performance.now();
  const result = await fn();
  const ms = Math.round(performance.now() - start);
  console.log(`${label}: ${ms}ms`);
  return { ms, result };
}

async function main() {
  const argEventId = process.argv[2];
  const event =
    (argEventId
      ? await prisma.event.findUnique({ where: { id: argEventId } })
      : await prisma.event.findFirst({ orderBy: { updatedAt: 'desc' } })) ?? null;

  if (!event) {
    console.log('No events found — skipping.');
    return;
  }

  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  from.setUTCHours(0, 0, 0, 0);
  const reportDayGte = from;
  const reportDayLte = to;

  console.log(`Event ${event.id} (${event.slug})`);

  const results = await Promise.all([
    timed('booking_report_daily range', () =>
      prisma.bookingReportDaily.findMany({
        where: {
          eventId: event.id,
          reportBasis: ReportBasis.trx,
          reportDay: { gte: reportDayGte, lte: reportDayLte },
        },
      }),
    ),
    timed('booking_report_ticket_daily range', () =>
      prisma.bookingReportTicketDaily.findMany({
        where: {
          eventId: event.id,
          reportBasis: ReportBasis.trx,
          reportDay: { gte: reportDayGte, lte: reportDayLte },
        },
      }),
    ),
    timed('booking_report_demo_daily range', () =>
      prisma.bookingReportDemoDaily.findMany({
        where: {
          eventId: event.id,
          reportBasis: ReportBasis.trx,
          reportDay: { gte: reportDayGte, lte: reportDayLte },
        },
      }),
    ),
    timed('event_sales_counters', () =>
      prisma.eventSalesCounter.findMany({
        where: { eventId: event.id, eventSessionId: null, inventoryItemId: null },
      }),
    ),
    timed('orders page 25 snapshots', () =>
      prisma.order.findMany({
        where: { eventId: event.id, createdAt: { gte: from, lte: to } },
        orderBy: { createdAt: 'desc' },
        take: 25,
      }),
    ),
  ]);

  const slow = results.filter((r) => r.ms > 300);
  if (slow.length) {
    console.error(`FAIL: ${slow.length} queries exceeded 300ms`);
    process.exitCode = 1;
  } else {
    console.log('OK: all smoke queries under 300ms');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
