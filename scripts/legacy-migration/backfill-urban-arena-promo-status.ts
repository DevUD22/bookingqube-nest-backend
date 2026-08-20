/**
 * One-shot backfill for Urban Arena:
 *  - sync ticket active/inactive (legacy is_active → V2 active|hidden)
 *  - backfill promoCode + discountAmount on booking orders / ticket lines
 *
 * Usage:
 *   npx tsx --env-file=.env scripts/legacy-migration/backfill-urban-arena-promo-status.ts
 *   npx tsx --env-file=.env scripts/legacy-migration/backfill-urban-arena-promo-status.ts --source=live
 */
import { OrderItemType, PrismaClient } from '@prisma/client';

import {
  LEGACY_ORDER_SOURCE,
  legacyCommonOrder,
  legacyTicketExternalKey,
  parseLegacyMysqlSource,
} from '../../src/modules/admin-legacy-migration/legacy/config';
import {
  loadLegacyBookings,
  loadLegacyTickets,
  resolveLegacyEventIds,
} from '../../src/modules/admin-legacy-migration/legacy/extract';
import {
  legacyLineDiscount,
  money3,
} from '../../src/modules/admin-legacy-migration/legacy/mappers';
import {
  closeMysql,
  useMysqlSource,
} from '../../src/modules/admin-legacy-migration/legacy/mysql-client';

const EVENT_SLUG = 'urban-arena';
const OLD_EVENT = '133';

async function main() {
  const source = parseLegacyMysqlSource(
    process.argv.find((a) => a.startsWith('--source='))?.split('=')[1] ?? 'live',
  );
  await useMysqlSource(source);
  const prisma = new PrismaClient();

  try {
    const event = await prisma.event.findFirst({
      where: { slug: EVENT_SLUG },
      select: { id: true, slug: true },
    });
    if (!event) throw new Error(`V2 event not found: ${EVENT_SLUG}`);

    const { eventIds } = await resolveLegacyEventIds(OLD_EVENT);
    console.log(`Source=${source} legacyEvents=${eventIds.join(',')} → ${event.slug} (${event.id})`);

    // --- tickets active/inactive ---
    const legacyTickets = await loadLegacyTickets(eventIds);
    let ticketsUpdated = 0;
    let ticketsCreated = 0;
    let ticketsInactive = 0;
    for (const lt of legacyTickets) {
      const status = lt.is_active ? 'active' : 'hidden';
      if (!lt.is_active) ticketsInactive += 1;
      const hideFromOnline = !!lt.is_pos_only || !lt.is_active;
      const externalKey = legacyTicketExternalKey(lt.id);
      const existing = await prisma.ticketType.findFirst({
        where: { eventId: event.id, externalKey },
        select: { id: true, status: true, hideFromOnline: true },
      });
      if (!existing) {
        // Create missing inactive tickets so they appear in manage UI as Inactive
        if (!lt.is_active) {
          await prisma.ticketType.create({
            data: {
              eventId: event.id,
              externalKey,
              title: lt.title,
              basePrice: money3(lt.price),
              admitCount: lt.admits || 1,
              hideFromOnline,
              status,
              sortOrder: lt.id,
            },
          });
          ticketsCreated += 1;
        }
        continue;
      }
      if (existing.status !== status || existing.hideFromOnline !== hideFromOnline) {
        await prisma.ticketType.update({
          where: { id: existing.id },
          data: { status, hideFromOnline },
        });
        ticketsUpdated += 1;
      }
    }
    console.log(
      `Tickets: legacy=${legacyTickets.length} inactive=${ticketsInactive} updated=${ticketsUpdated} created=${ticketsCreated}`,
    );

    // --- promo / discount on booking orders ---
    const bookings = await loadLegacyBookings(eventIds);
    const byOrder = new Map<string, typeof bookings>();
    for (const line of bookings) {
      const list = byOrder.get(line.common_order) ?? [];
      list.push(line);
      byOrder.set(line.common_order, list);
    }

    const ticketByLegacyId = new Map(
      (
        await prisma.ticketType.findMany({
          where: { eventId: event.id, externalKey: { startsWith: 'legacy-ticket-' } },
          select: { id: true, externalKey: true },
        })
      ).map((t) => [Number(t.externalKey.replace('legacy-ticket-', '')), t.id] as const),
    );

    let ordersScanned = 0;
    let ordersUpdated = 0;
    let itemsUpdated = 0;
    let withPromo = 0;
    let withDiscount = 0;
    let missingOrders = 0;

    for (const [commonOrder, lines] of byOrder) {
      ordersScanned += 1;
      const commonOrderNew = legacyCommonOrder(commonOrder);
      const order = await prisma.order.findFirst({
        where: {
          eventId: event.id,
          source: LEGACY_ORDER_SOURCE,
          commonOrder: commonOrderNew,
        },
        select: {
          id: true,
          promoCode: true,
          discountAmount: true,
          subtotalAmount: true,
          totalAmount: true,
          addonsNet: true,
          metadata: true,
          items: {
            where: { itemType: OrderItemType.ticket_type },
            select: {
              id: true,
              itemId: true,
              ticketCode: true,
              quantity: true,
              unitPrice: true,
              subtotalAmount: true,
              discountAmount: true,
              totalAmount: true,
            },
          },
        },
      });
      if (!order) {
        missingOrders += 1;
        continue;
      }

      const ticketGross = lines.reduce(
        (s, l) => s + Number(l.price || 0) * Number(l.quantity || 1),
        0,
      );
      const ticketDiscount = lines.reduce((s, l) => s + legacyLineDiscount(l), 0);
      const promoCode =
        lines.map((l) => (l.promocode || '').trim()).find((c) => c.length > 0) || null;
      const promoCodeId =
        lines.map((l) => l.promocode_id).find((id) => id != null && Number(id) > 0) ?? null;
      const addonNet = Number(order.addonsNet);
      const subtotal = ticketGross + addonNet;

      if (promoCode) withPromo += 1;
      if (ticketDiscount > 0) withDiscount += 1;

      const prevMeta =
        order.metadata && typeof order.metadata === 'object' && !Array.isArray(order.metadata)
          ? (order.metadata as Record<string, unknown>)
          : {};
      const prevLegacy =
        prevMeta.legacy && typeof prevMeta.legacy === 'object' && !Array.isArray(prevMeta.legacy)
          ? (prevMeta.legacy as Record<string, unknown>)
          : {};

      await prisma.order.update({
        where: { id: order.id },
        data: {
          promoCode,
          discountAmount: money3(ticketDiscount),
          subtotalAmount: money3(subtotal),
          metadata: {
            ...prevMeta,
            legacy: {
              ...prevLegacy,
              promocode: promoCode,
              promocode_id: promoCodeId,
              promocode_reward: ticketDiscount,
            },
          },
        },
      });
      ordersUpdated += 1;

      // Match ticket lines: prefer order_number → ticketCode, else itemId + qty
      const usedItemIds = new Set<string>();
      for (const line of lines) {
        const qty = Number(line.quantity || 1);
        const unitList = Number(line.price || 0);
        const lineGross = unitList * qty;
        const lineDiscount = legacyLineDiscount(line);
        const ticketTypeId = ticketByLegacyId.get(line.ticket_id);

        let item =
          line.order_number != null
            ? order.items.find(
                (i) => i.ticketCode === line.order_number && !usedItemIds.has(i.id),
              )
            : undefined;
        if (!item && ticketTypeId) {
          item = order.items.find(
            (i) =>
              i.itemId === ticketTypeId &&
              i.quantity === qty &&
              !usedItemIds.has(i.id),
          );
        }
        if (!item && ticketTypeId) {
          item = order.items.find((i) => i.itemId === ticketTypeId && !usedItemIds.has(i.id));
        }
        if (!item) continue;
        usedItemIds.add(item.id);

        await prisma.orderItem.update({
          where: { id: item.id },
          data: {
            unitPrice: money3(unitList),
            subtotalAmount: money3(lineGross),
            discountAmount: money3(lineDiscount),
            totalAmount: money3(line.net_price),
          },
        });
        itemsUpdated += 1;
      }

      if (ordersUpdated % 500 === 0) {
        console.log(`… orders updated ${ordersUpdated}/${byOrder.size}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          ordersScanned,
          ordersUpdated,
          itemsUpdated,
          withPromo,
          withDiscount,
          missingOrders,
          ticketsUpdated,
          ticketsCreated,
          ticketsInactive,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await closeMysql();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
