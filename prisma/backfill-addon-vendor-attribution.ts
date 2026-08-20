/**
 * Backfill third_party_vendor_id on addon order_items so Vendors & POS /
 * revenue settlement matches old BookingQube org-group revenue (tickets + addons).
 *
 * Usage:
 *   npx tsx prisma/backfill-addon-vendor-attribution.ts --event=kids-city-driving-school
 *   npx tsx prisma/backfill-addon-vendor-attribution.ts --event-id=<uuid>
 */
import { config } from 'dotenv';
import { resolve } from 'path';
import { OrderItemType, PrismaClient } from '@prisma/client';
import { rebuildEventRollups } from './sync-perf-order-rollups';

config({ path: resolve(__dirname, '../.env') });

const prisma = new PrismaClient();

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const slug = arg('event');
  const eventIdArg = arg('event-id');
  const event = eventIdArg
    ? await prisma.event.findUnique({ where: { id: eventIdArg }, select: { id: true, slug: true } })
    : slug
      ? await prisma.event.findUnique({ where: { slug }, select: { id: true, slug: true } })
      : null;

  if (!event) {
    throw new Error('Pass --event=<slug> or --event-id=<uuid>');
  }

  const eventId = event.id;
  console.log(`Backfilling addon vendor attribution for ${event.slug} (${eventId})`);

  // 1) Linked addons: inherit from highest-revenue ticket line on same order
  const linked = await prisma.$executeRaw`
    UPDATE order_items AS addon
    SET third_party_vendor_id = sibling.vendor_id
    FROM (
      SELECT oi_addon.id AS addon_id,
        (
          SELECT oi_t.third_party_vendor_id
          FROM order_items oi_t
          WHERE oi_t.order_id = oi_addon.order_id
            AND oi_t.third_party_vendor_id IS NOT NULL
            AND oi_t.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
          ORDER BY oi_t.total_amount DESC
          LIMIT 1
        ) AS vendor_id
      FROM order_items oi_addon
      WHERE oi_addon.event_id = ${eventId}::uuid
        AND oi_addon.item_type = 'addon'::"OrderItemType"
        AND oi_addon.third_party_vendor_id IS NULL
    ) AS sibling
    WHERE addon.id = sibling.addon_id
      AND sibling.vendor_id IS NOT NULL
  `;
  console.log(`Linked addon rows updated: ${linked}`);

  // 2) Separate addons: agent → dominant ticket vendor
  const agentVendors = await prisma.$queryRaw<
    Array<{ agent_id: string; vendor_id: string }>
  >`
    SELECT booked_by_agent_id AS agent_id, third_party_vendor_id AS vendor_id
    FROM (
      SELECT booked_by_agent_id,
        third_party_vendor_id,
        SUM(total_amount) AS rev,
        ROW_NUMBER() OVER (
          PARTITION BY booked_by_agent_id
          ORDER BY SUM(total_amount) DESC
        ) AS rn
      FROM order_items
      WHERE event_id = ${eventId}::uuid
        AND booked_by_agent_id IS NOT NULL
        AND third_party_vendor_id IS NOT NULL
        AND item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
      GROUP BY booked_by_agent_id, third_party_vendor_id
    ) ranked
    WHERE rn = 1
  `;

  let agentUpdated = 0;
  for (const row of agentVendors) {
    const res = await prisma.orderItem.updateMany({
      where: {
        eventId,
        itemType: OrderItemType.addon,
        thirdPartyVendorId: null,
        bookedByAgentId: row.agent_id,
      },
      data: { thirdPartyVendorId: row.vendor_id },
    });
    agentUpdated += res.count;
  }
  console.log(`Separate addon rows via agent map: ${agentUpdated}`);

  // 3) Remaining null addons → main vendor (is_main) else first vendor
  const mainVendor =
    (await prisma.thirdPartyVendor.findFirst({
      where: { eventId, isMain: true },
      select: { id: true, name: true },
    })) ??
    (await prisma.thirdPartyVendor.findFirst({
      where: { eventId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true },
    }));

  let fallbackUpdated = 0;
  if (mainVendor) {
    const res = await prisma.orderItem.updateMany({
      where: {
        eventId,
        itemType: OrderItemType.addon,
        thirdPartyVendorId: null,
      },
      data: { thirdPartyVendorId: mainVendor.id },
    });
    fallbackUpdated = res.count;
    console.log(
      `Fallback addon rows → ${mainVendor.name}: ${fallbackUpdated}`,
    );
  }

  const remaining = await prisma.orderItem.count({
    where: {
      eventId,
      itemType: OrderItemType.addon,
      thirdPartyVendorId: null,
    },
  });
  console.log(`Addon rows still without vendor: ${remaining}`);

  const byVendor = await prisma.$queryRawUnsafe(
    `SELECT tpv.name,
       COALESCE(SUM(oi.total_amount),0) as revenue,
       COALESCE(SUM(CASE WHEN oi.item_type = 'addon' THEN oi.total_amount ELSE 0 END),0) as addon_rev,
       COALESCE(SUM(CASE WHEN oi.item_type IN ('ticket_type','ticket_variant') THEN oi.quantity ELSE 0 END),0)::int as qty
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id AND o.payment_status = 'paid'
     LEFT JOIN third_party_vendors tpv ON tpv.id = oi.third_party_vendor_id
     WHERE oi.event_id = $1::uuid
     GROUP BY tpv.name
     ORDER BY revenue DESC`,
    eventId,
  );
  console.log(
    'LIVE_BY_VENDOR',
    JSON.stringify(byVendor, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2),
  );

  console.log('Rebuilding rollups…');
  await rebuildEventRollups(prisma, [event]);

  const rollups = await prisma.$queryRawUnsafe(
    `SELECT tpv.name,
       COALESCE(SUM(d.revenue_total),0) as rollup_revenue,
       COALESCE(SUM(d.ticket_qty),0)::int as qty
     FROM third_party_vendors tpv
     LEFT JOIN booking_report_third_party_vendor_daily d
       ON d.third_party_vendor_id = tpv.id AND d.report_basis = 'event'
     WHERE tpv.event_id = $1::uuid
     GROUP BY tpv.id
     ORDER BY rollup_revenue DESC`,
    eventId,
  );
  console.log(
    'VENDOR_ROLLUPS',
    JSON.stringify(rollups, (_, v) => (typeof v === 'bigint' ? Number(v) : v), 2),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
