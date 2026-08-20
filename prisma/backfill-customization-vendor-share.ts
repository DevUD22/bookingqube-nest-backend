/**
 * Backfill vendor attribution for customization / time-extension lines, then
 * rebuild report rollups so Vendors & POS matches old bookingqube revenue.
 *
 * Fast path: one-time UPDATE on order_items + rebuild of daily rollup tables.
 * Report reads stay on rollups (no live order_items scans).
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/backfill-customization-vendor-share.ts
 *   npx tsx --env-file=.env prisma/backfill-customization-vendor-share.ts --event=urban-arena
 */
import { OrderItemType, PrismaClient } from '@prisma/client';
import { rebuildEventRollups } from './sync-perf-order-rollups';

const prisma = new PrismaClient();

function argValue(flag: string): string | undefined {
  const prefix = `${flag}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main() {
  const eventSlug = argValue('--event');
  const events = await prisma.event.findMany({
    where: eventSlug ? { slug: eventSlug } : undefined,
    select: {
      id: true,
      slug: true,
      thirdPartyVendors: {
        orderBy: [{ isMain: 'desc' }, { sortOrder: 'asc' }],
        select: { id: true, name: true, isMain: true, isCafe: true },
      },
    },
  });

  if (!events.length) {
    console.log(eventSlug ? `No event found for slug=${eventSlug}` : 'No events found.');
    return;
  }

  const touched: Array<{ id: string; slug: string }> = [];

  for (const event of events) {
    const mainVendor =
      event.thirdPartyVendors.find((v) => v.isMain && !v.isCafe) ??
      event.thirdPartyVendors.find((v) => !v.isCafe) ??
      event.thirdPartyVendors[0] ??
      null;
    if (!mainVendor) {
      console.log(`[skip] ${event.slug}: no third-party vendor`);
      continue;
    }

    // Parent-linked customizations inherit the ticket vendor.
    const linked = await prisma.$executeRaw`
      UPDATE order_items AS cust
      SET third_party_vendor_id = parent.third_party_vendor_id
      FROM order_items AS parent
      WHERE cust.event_id = ${event.id}::uuid
        AND cust.item_type = 'customization'::"OrderItemType"
        AND cust.third_party_vendor_id IS NULL
        AND cust.parent_order_item_id = parent.id
        AND parent.third_party_vendor_id IS NOT NULL
    `;

    // Standalone time extensions (and any orphan customization) → main vendor.
    const orphan = await prisma.orderItem.updateMany({
      where: {
        eventId: event.id,
        itemType: OrderItemType.customization,
        thirdPartyVendorId: null,
        parentOrderItemId: null,
      },
      data: { thirdPartyVendorId: mainVendor.id },
    });

    const linkedCount = Number(linked ?? 0);
    const orphanCount = orphan.count;
    if (linkedCount + orphanCount === 0) {
      console.log(`[ok] ${event.slug}: nothing to backfill (main=${mainVendor.name})`);
      continue;
    }

    console.log(
      `[fix] ${event.slug}: linked=${linkedCount} orphan/TE=${orphanCount} → ${mainVendor.name}`,
    );
    touched.push({ id: event.id, slug: event.slug });
  }

  if (!touched.length) {
    console.log('No rollup rebuild needed.');
    return;
  }

  console.log(`Rebuilding rollups for ${touched.length} event(s)...`);
  await rebuildEventRollups(prisma, touched);
  console.log('Done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
