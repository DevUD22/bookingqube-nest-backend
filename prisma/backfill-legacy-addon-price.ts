/**
 * Backfill metadata.legacy.addon_price from MySQL first-booking addon_price
 * so Vendors & POS product breakdown matches old Tickets Info.
 *
 *   npx tsx --env-file=.env prisma/backfill-legacy-addon-price.ts --event=kids-city-driving-school
 *   npx tsx --env-file=.env prisma/backfill-legacy-addon-price.ts --event=kids-city-driving-school --apply
 */
import { Prisma } from '@prisma/client';
import { PrismaClient } from '@prisma/client';
import {
  getMysqlPool,
  useMysqlSource,
} from '../src/modules/admin-legacy-migration/legacy/mysql-client';
import { loadLegacyMysqlConfig } from '../src/modules/admin-legacy-migration/legacy/config';

const prisma = new PrismaClient();

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

async function main() {
  const slug = argValue('--event');
  const apply = process.argv.includes('--apply');
  if (!slug) throw new Error('Pass --event=<slug>');

  const event = await prisma.event.findUnique({ where: { slug } });
  if (!event) throw new Error(`Event not found: ${slug}`);

  const source = process.env.LEGACY_MYSQL_LIVE_HOST ? 'live' : 'local';
  loadLegacyMysqlConfig(source);
  await useMysqlSource(source);
  const pool = await getMysqlPool(source);

  // Resolve legacy event ids
  const samples = await prisma.order.findMany({
    where: { eventId: event.id },
    take: 30,
    select: { metadata: true },
  });
  const legacyEventIds = new Set<number>();
  for (const o of samples) {
    const ids = (o.metadata as any)?.legacy?.event_ids;
    if (Array.isArray(ids)) ids.forEach((id: any) => legacyEventIds.add(Number(id)));
  }
  if (!legacyEventIds.size) throw new Error('No legacy event ids in order metadata');

  const [rows] = await pool.query<any[]>(
    `
    SELECT b.common_order, b.addon_price
    FROM bookings b
    JOIN (
      SELECT MIN(id) AS min_id
      FROM bookings
      WHERE event_id IN (?) AND common_order IS NOT NULL
      GROUP BY common_order
    ) f ON b.id = f.min_id
    WHERE b.event_id IN (?)
    `,
    [[...legacyEventIds], [...legacyEventIds]],
  );
  const byCo = new Map<string, number>();
  for (const r of rows as any[]) {
    byCo.set(String(r.common_order), Number(r.addon_price || 0));
  }
  console.log(`Loaded ${byCo.size} legacy first-booking addon_price rows`);

  let scanned = 0;
  let updated = 0;
  let missing = 0;
  let cursor: string | undefined;
  const batchSize = 1000;

  for (;;) {
    const orders = await prisma.order.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: { eventId: event.id },
      orderBy: { id: 'asc' },
      select: { id: true, metadata: true },
    });
    if (!orders.length) break;
    cursor = orders[orders.length - 1].id;

    for (const order of orders) {
      scanned += 1;
      const meta = (order.metadata ?? {}) as Record<string, any>;
      const legacy = meta.legacy;
      if (!legacy || typeof legacy !== 'object') continue;
      const co = legacy.common_order != null ? String(legacy.common_order) : null;
      if (!co) continue;
      if (!byCo.has(co)) {
        missing += 1;
        continue;
      }
      const addonPrice = byCo.get(co)!;
      if (Number(legacy.addon_price) === addonPrice) continue;

      if (!apply) {
        updated += 1;
        continue;
      }

      const nextMeta = {
        ...meta,
        legacy: {
          ...legacy,
          addon_price: addonPrice,
        },
      };
      await prisma.order.update({
        where: { id: order.id },
        data: { metadata: nextMeta as Prisma.InputJsonValue },
      });
      updated += 1;
    }
  }

  console.log({ scanned, updated, missing, apply });
  if (apply) {
    console.log(
      `\nRebuild:\n  npx tsx --env-file=.env prisma/sync-perf-order-rollups.ts --event=${slug}`,
    );
  } else {
    console.log('\nRe-run with --apply to write.');
  }
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
