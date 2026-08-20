/**
 * Wipe all V2 events + bookings/orders (fast TRUNCATE).
 * Keeps orgs, users, venues, roles, etc.
 *
 * Usage: npx tsx --env-file=.env scripts/wipe-events-orders.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    ticketTypes: await prisma.ticketType.count(),
    ticketVariants: await prisma.ticketVariant.count(),
  };
  console.log('Before:', before);

  // CASCADE pulls in orders, items, payments, reports, tickets, sessions, etc.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "events" CASCADE`);

  const after = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    ticketTypes: await prisma.ticketType.count(),
    ticketVariants: await prisma.ticketVariant.count(),
  };
  console.log('After:', after);
  console.log('Done — all events and bookings removed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
