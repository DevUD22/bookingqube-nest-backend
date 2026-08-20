/**
 * Wipe all V2 events, bookings, cafes, and cafe report rollups.
 * Keeps orgs, users, venues, roles, etc.
 *
 * Usage: npx tsx --env-file=.env scripts/wipe-events-cafes.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const before = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    cafes: await prisma.cafe.count(),
    cafeDaily: await prisma.bookingReportCafeDaily.count(),
    cafeAgents: await prisma.bookingReportCafeAgentDaily.count(),
    cafeItems: await prisma.bookingReportCafeItemDaily.count(),
  };
  console.log('Before:', before);

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "events" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "cafes" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "booking_report_cafe_daily" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "booking_report_cafe_agent_daily" CASCADE`);
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "booking_report_cafe_item_daily" CASCADE`);

  const after = {
    events: await prisma.event.count(),
    orders: await prisma.order.count(),
    orderItems: await prisma.orderItem.count(),
    cafes: await prisma.cafe.count(),
    cafeDaily: await prisma.bookingReportCafeDaily.count(),
    cafeAgents: await prisma.bookingReportCafeAgentDaily.count(),
    cafeItems: await prisma.bookingReportCafeItemDaily.count(),
  };
  console.log('After:', after);
  console.log('Done — events, bookings, cafes, and cafe reports removed.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
