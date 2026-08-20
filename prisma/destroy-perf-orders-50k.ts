/**
 * Removes temporary PERF50K load-test bookings (and optional scaffold).
 *
 * Usage:
 *   npx tsx prisma/destroy-perf-orders-50k.ts
 *   npx tsx prisma/destroy-perf-orders-50k.ts --all   # also delete perf events + customers
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SEED_TAG = 'perf_seed';
const ORDER_PREFIX = 'PERF50K-';
const IDEM_PREFIX = 'perf50k-';
const EVENT_SLUG_PREFIX = 'perf-load-';
const CUSTOMER_EMAIL_PREFIX = 'perf50k.customer.';

async function main() {
  const wipeAll = process.argv.includes('--all');

  const events = await prisma.event.findMany({
    where: { slug: { startsWith: EVENT_SLUG_PREFIX } },
    select: { id: true, slug: true },
  });
  const eventIds = events.map((e) => e.id);

  const deletedOrders = await prisma.order.deleteMany({
    where: {
      OR: [
        { commonOrder: { startsWith: ORDER_PREFIX } },
        { source: SEED_TAG },
        { idempotencyKey: { startsWith: IDEM_PREFIX } },
      ],
    },
  });
  console.log(`Deleted orders: ${deletedOrders.count.toLocaleString()}`);

  // Dashboard KPIs come from rollups/counters — clear them even if events are kept.
  if (eventIds.length) {
    const [daily, payment, visitor, pos, share, ticket, demo, counters] =
      await Promise.all([
        prisma.bookingReportDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportPaymentDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportVisitorDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportPosDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportThirdPartyVendorDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportTicketDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.bookingReportDemoDaily.deleteMany({ where: { eventId: { in: eventIds } } }),
        prisma.eventSalesCounter.deleteMany({ where: { eventId: { in: eventIds } } }),
      ]);
    console.log(
      `Deleted rollups/counters: daily=${daily.count}, payment=${payment.count}, visitor=${visitor.count}, pos=${pos.count}, share=${share.count}, ticket=${ticket.count}, demo=${demo.count}, counters=${counters.count}`,
    );
  }

  if (!wipeAll) {
    console.log('Scaffold kept (events/customers). Pass --all to remove those too.');
    return;
  }

  if (events.length) {
    // Child rows that may not cascade from Event in all cases.
    await prisma.orderItem.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.inventoryItem.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketHold.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketType.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.ticketGroup.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventSession.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventDate.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.eventTranslation.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    console.log(
      `Deleted events: ${events.length} (${events.map((e) => e.slug).join(', ')})`,
    );
  } else {
    console.log('Deleted events: 0');
  }

  const customers = await prisma.user.findMany({
    where: { email: { startsWith: CUSTOMER_EMAIL_PREFIX } },
    select: { id: true },
  });
  if (customers.length) {
    const ids = customers.map((c) => c.id);
    await prisma.customerProfile.deleteMany({ where: { userId: { in: ids } } });
    const deletedUsers = await prisma.user.deleteMany({ where: { id: { in: ids } } });
    console.log(`Deleted customers: ${deletedUsers.count.toLocaleString()}`);
  } else {
    console.log('Deleted customers: 0');
  }
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
