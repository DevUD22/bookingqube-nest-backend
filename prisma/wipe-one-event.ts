/**
 * Delete one event (by slug) and all its bookings/orders — fast path.
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/wipe-one-event.ts inflatapark
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const slugArg = (process.argv[2] || '').trim().toLowerCase();

async function exec(label: string, sql: string, ...params: unknown[]) {
  const started = Date.now();
  process.stdout.write(`  ${label}… `);
  const n = await prisma.$executeRawUnsafe(sql, ...params);
  console.log(`${n} (${Date.now() - started}ms)`);
  return Number(n) || 0;
}

async function main() {
  if (!slugArg) {
    throw new Error('Pass event slug, e.g. npx tsx prisma/wipe-one-event.ts inflatapark');
  }

  const events = await prisma.event.findMany({
    where: {
      OR: [
        { slug: slugArg },
        { slug: { contains: slugArg, mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      slug: true,
      translations: { where: { locale: 'en' }, select: { title: true }, take: 1 },
      _count: { select: { orders: true, sessions: true, ticketTypes: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!events.length) {
    console.log(`No events matched slug "${slugArg}".`);
    return;
  }

  console.log('Matched events:');
  for (const e of events) {
    console.log(
      `  ${e.slug} (${e.translations[0]?.title || 'untitled'}) orders=${e._count.orders} sessions=${e._count.sessions} tickets=${e._count.ticketTypes}`,
    );
  }

  const exact = events.filter((e) => e.slug.toLowerCase() === slugArg);
  const toDelete = exact.length ? exact : events;

  for (const event of toDelete) {
    const eventId = event.id;
    console.log(`\nWiping ${event.slug} (${eventId})…`);

    await prisma.$executeRawUnsafe(`SET statement_timeout = 0`);
    await prisma.$executeRawUnsafe(`SET synchronous_commit = off`);
    // Skip FK/trigger overhead for bulk wipe (requires sufficient DB role).
    try {
      await prisma.$executeRawUnsafe(`SET session_replication_role = replica`);
      console.log('  session_replication_role=replica');
    } catch (err) {
      console.log(
        '  warning: could not set session_replication_role (deletes may be slower)',
        err instanceof Error ? err.message : err,
      );
    }

    await exec(
      'clear primary media',
      `UPDATE events SET primary_media_id = NULL WHERE id = $1::uuid`,
      eventId,
    );
    await exec(
      'detach cafe active event',
      `UPDATE cafes SET active_event_id = NULL WHERE active_event_id = $1::uuid`,
      eventId,
    );

    for (const table of [
      'booking_report_daily',
      'booking_report_payment_daily',
      'booking_report_visitor_daily',
      'booking_report_pos_daily',
      'booking_report_third_party_vendor_daily',
      'booking_report_ticket_daily',
      'booking_report_demo_daily',
      'booking_report_cafe_daily',
      'booking_report_cafe_agent_daily',
      'booking_report_cafe_item_daily',
      'event_sales_counters',
      'event_attendance_counters',
    ]) {
      await exec(`rollup ${table}`, `DELETE FROM ${table} WHERE event_id = $1::uuid`, eventId);
    }

    await exec(
      'null parent order_items',
      `UPDATE order_items SET parent_order_item_id = NULL WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec(
      'order_items',
      `DELETE FROM order_items WHERE event_id = $1::uuid`,
      eventId,
    );

    for (const table of [
      'order_report_ledger',
      'payments',
      'refunds',
      'promo_code_redemptions',
      'order_tax_lines',
      'registration_submissions',
      'event_reviews',
      'booking_feedback',
      'customer_payment_recoveries',
    ]) {
      await exec(
        table,
        `DELETE FROM ${table}
         WHERE order_id IN (SELECT id FROM orders WHERE event_id = $1::uuid)`,
        eventId,
      );
    }

    await exec(
      'detach order holds',
      `UPDATE orders SET hold_id = NULL WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec(
      'advance_payments',
      `DELETE FROM advance_payments WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec(
      'ticket_holds',
      `DELETE FROM ticket_holds WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec(
      'inventory_items',
      `DELETE FROM inventory_items WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec(
      'cafe_orders',
      `DELETE FROM cafe_orders WHERE event_id = $1::uuid`,
      eventId,
    );
    await exec('orders', `DELETE FROM orders WHERE event_id = $1::uuid`, eventId);
    await exec('event', `DELETE FROM events WHERE id = $1::uuid`, eventId);

    try {
      await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
    } catch {
      /* ignore */
    }
  }

  const left = await prisma.event.findMany({
    where: { slug: { contains: slugArg, mode: 'insensitive' } },
    select: { slug: true, _count: { select: { orders: true } } },
  });
  console.log(
    left.length
      ? `Remaining: ${left.map((e) => `${e.slug}(${e._count.orders})`).join(', ')}`
      : `No remaining events matching "${slugArg}".`,
  );
  console.log('Done.');
}

main()
  .catch(async (error) => {
    console.error(error);
    try {
      await prisma.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
    } catch {
      /* ignore */
    }
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
