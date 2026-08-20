/**
 * Repair order lines wrongly merged onto another ticket because migration
 * matched duplicate titles (e.g. City Pass legacy #828 → #343).
 *
 * Usage:
 *   npx tsx --env-file=.env prisma/repair-merged-legacy-tickets.ts --event=kids-city-driving-school
 *   npx tsx --env-file=.env prisma/repair-merged-legacy-tickets.ts --event=kids-city-driving-school --apply
 */
import { OrderItemType, PrismaClient } from '@prisma/client';
import {
  legacyTicketExternalKey,
  loadLegacyMysqlConfig,
} from '../src/modules/admin-legacy-migration/legacy/config';
import {
  getMysqlPool,
  useMysqlSource,
} from '../src/modules/admin-legacy-migration/legacy/mysql-client';

const prisma = new PrismaClient();

type BookingLineMeta = {
  ticket_id?: number;
  playtime_pack_id?: number | string | null;
  order_number?: string | null;
};

function argValue(flag: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
  return hit ? hit.slice(flag.length + 1) : undefined;
}

function hasFlag(flag: string) {
  return process.argv.includes(flag);
}

async function main() {
  const slug = argValue('--event');
  const apply = hasFlag('--apply');
  if (!slug) throw new Error('Pass --event=<slug>');

  const event = await prisma.event.findUnique({
    where: { slug },
    select: { id: true, slug: true },
  });
  if (!event) throw new Error(`Event not found: ${slug}`);

  console.log(
    `${apply ? 'APPLY' : 'DRY-RUN'} repair for ${event.slug} (${event.id})`,
  );

  const source = process.env.LEGACY_MYSQL_LIVE_HOST ? 'live' : 'local';
  loadLegacyMysqlConfig(source);
  await useMysqlSource(source);
  const pool = await getMysqlPool(source);

  // Discover legacy event ids from migrated orders
  const legacyEventIds = new Set<number>();
  const samples = await prisma.order.findMany({
    where: { eventId: event.id },
    take: 50,
    select: { metadata: true },
  });
  for (const order of samples) {
    const ids = (order.metadata as any)?.legacy?.event_ids;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        const n = Number(id);
        if (Number.isFinite(n)) legacyEventIds.add(n);
      }
    }
  }
  if (!legacyEventIds.size) {
    throw new Error('Could not resolve legacy event id from order metadata');
  }

  const [ticketsRows] = await pool.query<any[]>(
    `SELECT id, title, is_active, is_pos_only, price, admits
     FROM tickets WHERE event_id IN (?)`,
    [[...legacyEventIds]],
  );
  const legacyById = new Map<number, any>();
  const byTitle = new Map<string, number[]>();
  for (const t of ticketsRows as any[]) {
    const id = Number(t.id);
    legacyById.set(id, t);
    const title = String(t.title || '').trim();
    const list = byTitle.get(title) ?? [];
    list.push(id);
    byTitle.set(title, list);
  }
  const collidingLegacyIds = new Set<number>();
  for (const ids of byTitle.values()) {
    if (ids.length > 1) ids.forEach((id) => collidingLegacyIds.add(id));
  }
  console.log(
    'Colliding legacy ticket ids:',
    [...collidingLegacyIds].sort((a, b) => a - b),
  );
  if (!collidingLegacyIds.size) {
    console.log('Nothing to repair.');
    await prisma.$disconnect();
    return;
  }

  // Existing V2 types keyed by legacy ticket id
  const typeByLegacyId = new Map<
    number,
    { id: string; title: string; thirdPartyVendorId: string | null }
  >();
  const existingTypes = await prisma.ticketType.findMany({
    where: { eventId: event.id },
    include: { variants: true },
  });
  for (const t of existingTypes) {
    const m = /^legacy-ticket-(\d+)$/.exec(t.externalKey);
    if (m) {
      typeByLegacyId.set(Number(m[1]), {
        id: t.id,
        title: t.title,
        thirdPartyVendorId: t.thirdPartyVendorId,
      });
    }
  }

  // Create missing types for colliding legacy ids (e.g. City Pass #828)
  for (const legacyId of collidingLegacyIds) {
    if (typeByLegacyId.has(legacyId)) continue;
    const lt = legacyById.get(legacyId);
    if (!lt) continue;
    const siblings = byTitle.get(String(lt.title).trim()) ?? [];
    let vendorId: string | null = null;
    for (const sib of siblings) {
      const existing = typeByLegacyId.get(sib);
      if (existing?.thirdPartyVendorId) {
        vendorId = existing.thirdPartyVendorId;
        break;
      }
    }
    if (!apply) {
      console.log(
        `Would create ticket type for legacy #${legacyId} "${lt.title}"`,
      );
      // Placeholder so dry-run remaps can resolve targets
      typeByLegacyId.set(legacyId, {
        id: `dry-run-${legacyId}`,
        title: lt.title,
        thirdPartyVendorId: vendorId,
      });
      continue;
    }
    const created = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        externalKey: legacyTicketExternalKey(legacyId),
        title: lt.title,
        iconType: 'simple',
        hasVariants: false,
        basePrice: lt.price != null ? Number(lt.price) : null,
        admitCount: Number(lt.admits || 1),
        hideFromOnline: Boolean(lt.is_pos_only) || !lt.is_active,
        status: lt.is_active ? 'active' : 'hidden',
        sortOrder: legacyId,
        thirdPartyVendorId: vendorId,
      },
    });
    typeByLegacyId.set(legacyId, {
      id: created.id,
      title: created.title,
      thirdPartyVendorId: created.thirdPartyVendorId,
    });
    console.log(`Created ${created.id} for legacy #${legacyId}`);
  }

  // Refresh maps (skip in dry-run placeholders)
  const variantByPackId = new Map<
    number,
    { id: string; ticketTypeId: string; name: string }
  >();
  if (apply) {
    typeByLegacyId.clear();
    const types = await prisma.ticketType.findMany({
      where: { eventId: event.id },
      include: { variants: true },
    });
    for (const t of types) {
      const m = /^legacy-ticket-(\d+)$/.exec(t.externalKey);
      if (m) {
        typeByLegacyId.set(Number(m[1]), {
          id: t.id,
          title: t.title,
          thirdPartyVendorId: t.thirdPartyVendorId,
        });
      }
      for (const v of t.variants) {
        const pm = /^legacy-pack-(\d+)$/.exec(v.externalKey);
        if (pm) {
          variantByPackId.set(Number(pm[1]), {
            id: v.id,
            ticketTypeId: t.id,
            name: v.name,
          });
        }
      }
    }

    for (const legacyId of collidingLegacyIds) {
      const lt = legacyById.get(legacyId);
      const type = typeByLegacyId.get(legacyId);
      if (!lt || !type) continue;
      await prisma.ticketType.update({
        where: { id: type.id },
        data: {
          status: lt.is_active ? 'active' : 'hidden',
          hideFromOnline: Boolean(lt.is_pos_only) || !lt.is_active,
        },
      });
      console.log(
        `Status legacy #${legacyId} → ${lt.is_active ? 'active' : 'hidden'}`,
      );
    }
  } else {
    for (const t of existingTypes) {
      for (const v of t.variants) {
        const pm = /^legacy-pack-(\d+)$/.exec(v.externalKey);
        if (pm) {
          variantByPackId.set(Number(pm[1]), {
            id: v.id,
            ticketTypeId: t.id,
            name: v.name,
          });
        }
      }
    }
  }

  let scanned = 0;
  let remapped = 0;
  let skipped = 0;
  const batchSize = 500;
  let cursor: string | undefined;

  for (;;) {
    const items = await prisma.orderItem.findMany({
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      where: {
        eventId: event.id,
        itemType: {
          in: [OrderItemType.ticket_type, OrderItemType.ticket_variant],
        },
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        itemId: true,
        itemType: true,
        displayName: true,
        ticketCode: true,
        order: { select: { metadata: true } },
      },
    });
    if (!items.length) break;
    cursor = items[items.length - 1].id;

    for (const item of items) {
      scanned += 1;
      const legacy = (item.order.metadata as any)?.legacy;
      if (!legacy) {
        skipped += 1;
        continue;
      }
      const lines = (legacy.booking_lines ?? []) as BookingLineMeta[];
      const line = lines.find(
        (l) =>
          l.order_number != null &&
          String(l.order_number) === String(item.ticketCode ?? ''),
      );
      if (!line?.ticket_id) {
        skipped += 1;
        continue;
      }
      const legacyTicketId = Number(line.ticket_id);
      if (!collidingLegacyIds.has(legacyTicketId)) continue;

      const targetType = typeByLegacyId.get(legacyTicketId);
      if (!targetType || targetType.id.startsWith('dry-run-')) {
        if (!apply) {
          // dry-run still counts intended remaps below using placeholder
        } else {
          skipped += 1;
          continue;
        }
      }
      if (!targetType) {
        skipped += 1;
        continue;
      }

      const packRaw = line.playtime_pack_id;
      const packId =
        packRaw == null || packRaw === '' ? null : Number(packRaw);

      let nextItemId = targetType.id;
      let nextType: OrderItemType = OrderItemType.ticket_type;
      let nextName = targetType.title;

      if (packId != null && Number.isFinite(packId)) {
        const variant = variantByPackId.get(packId);
        if (variant && variant.ticketTypeId === targetType.id) {
          nextItemId = variant.id;
          nextType = OrderItemType.ticket_variant;
          nextName = `${targetType.title} - ${variant.name}`;
        }
      }

      if (item.itemId === nextItemId && item.itemType === nextType) continue;

      if (!apply) {
        if (remapped < 20) {
          console.log('Would remap', {
            legacyTicketId,
            packId,
            from: {
              itemId: item.itemId,
              type: item.itemType,
              name: item.displayName,
            },
            to: { itemId: nextItemId, type: nextType, name: nextName },
          });
        }
        remapped += 1;
        continue;
      }

      await prisma.orderItem.update({
        where: { id: item.id },
        data: {
          itemId: nextItemId,
          itemType: nextType,
          displayName: nextName,
        },
      });
      remapped += 1;
    }
  }

  console.log({ scanned, remapped, skipped, apply });
  if (apply) {
    console.log(
      `\nRebuild rollups:\n  npx tsx --env-file=.env prisma/sync-perf-order-rollups.ts --event=${slug}`,
    );
  } else {
    console.log('\nRe-run with --apply to write changes.');
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
