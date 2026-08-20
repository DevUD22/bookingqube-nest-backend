/**
 * Wipe ALL events and their bookings/orders from V2 (destructive, fast SQL).
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/wipe-all-events-and-bookings.ts --confirm
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Refusing to run without --confirm');
    process.exit(1);
  }

  const before = await prisma.$queryRaw<Array<{ events: bigint; orders: bigint }>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM events) AS events,
      (SELECT COUNT(*)::bigint FROM orders) AS orders
  `;
  console.log(
    `Before: events=${before[0]?.events ?? 0} orders=${before[0]?.orders ?? 0}`,
  );

  // Truncate order graph + event graph. CASCADE clears dependent FKs.
  // Keep users / orgs / roles intact.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      orders,
      events
    RESTART IDENTITY CASCADE
  `);

  const after = await prisma.$queryRaw<Array<{ events: bigint; orders: bigint }>>`
    SELECT
      (SELECT COUNT(*)::bigint FROM events) AS events,
      (SELECT COUNT(*)::bigint FROM orders) AS orders
  `;
  console.log(
    `After: events=${after[0]?.events ?? 0} orders=${after[0]?.orders ?? 0}`,
  );
  console.log('Done. Remigrate events to recreate organisers (one per event via createdByUserId).');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
