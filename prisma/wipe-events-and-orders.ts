/**
 * Deletes ALL bookings (orders) and ALL events from the database.
 *
 * Usage:
 *   npx tsx prisma/wipe-events-and-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    holds: await prisma.ticketHold.count(),
  };
  console.log('Before:', before);

  // Orders reference events/sessions/holds — remove bookings first.
  // Cascades: order_items, payments, refunds, tax lines, promo redemptions, report ledger, etc.
  const deletedOrders = await prisma.order.deleteMany({});
  console.log(`Deleted orders: ${deletedOrders.count.toLocaleString()}`);

  // Clear report rollups / counters (also cascade from event, but wipe explicitly for clarity).
  const [
    daily,
    payment,
    visitor,
    pos,
    share,
    ticket,
    demo,
    salesCounters,
    attendanceCounters,
  ] = await Promise.all([
    prisma.bookingReportDaily.deleteMany({}),
    prisma.bookingReportPaymentDaily.deleteMany({}),
    prisma.bookingReportVisitorDaily.deleteMany({}),
    prisma.bookingReportPosDaily.deleteMany({}),
    prisma.bookingReportThirdPartyVendorDaily.deleteMany({}),
    prisma.bookingReportTicketDaily.deleteMany({}),
    prisma.bookingReportDemoDaily.deleteMany({}),
    prisma.eventSalesCounter.deleteMany({}),
    prisma.eventAttendanceCounter.deleteMany({}),
  ]);
  console.log(
    `Deleted rollups/counters: daily=${daily.count}, payment=${payment.count}, visitor=${visitor.count}, pos=${pos.count}, share=${share.count}, ticket=${ticket.count}, demo=${demo.count}, sales=${salesCounters.count}, attendance=${attendanceCounters.count}`,
  );

  // Detach primary media FK so event rows can be removed cleanly.
  await prisma.event.updateMany({ data: { primaryMediaId: null } });

  // Events cascade most children (sessions, tickets, holds, media links, addons, etc.).
  // Clear any leftover order_items / inventory / holds that might block deletes.
  await prisma.orderItem.deleteMany({});
  await prisma.ticketHold.deleteMany({});
  await prisma.inventoryItem.deleteMany({});
  await prisma.advancePayment.deleteMany({});

  const deletedEvents = await prisma.event.deleteMany({});
  console.log(`Deleted events: ${deletedEvents.count.toLocaleString()}`);

  const after = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    holds: await prisma.ticketHold.count(),
  };
  console.log('After:', after);
}

main()
  .catch(async (error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
