import { randomUUID } from 'crypto';
import type { PrismaClient } from '@prisma/client';

import {
  hasExactLegacyMarker,
  legacyCafeOrgGroupMarker,
  legacyCafePackItemMarker,
  legacyCafeTicketCategoryMarker,
  legacyCafeTicketDefaultItemMarker,
} from './config';
import type {
  LegacyBookingLine,
  LegacyOrganiserGroup,
  LegacyPlaytimePack,
  LegacyTicket,
} from './extract';
import { money3 } from './mappers';

const UNGROUPED_SUBCATEGORY_TITLE = 'Ungrouped';

function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

export type CafeMenuItemRef = {
  id: string;
  title: string;
};

export type CafeTicketCategoryRef = {
  categoryId: string;
  title: string;
  /** legacy playtime_pack_id → CafeMenuItem */
  itemsByPackId: Map<number, CafeMenuItemRef>;
  /** Used when booking line has no playtime_pack_id */
  defaultItem: CafeMenuItemRef;
};

export type CafeCatalogEntry = {
  cafeId: string;
  name: string;
  legacyOrgGroupId: number;
  thirdPartyVendorId: string | null;
  /** legacy ticket_id → category + items */
  categoriesByTicketId: Map<number, CafeTicketCategoryRef>;
};

export type CafeCatalogResult = {
  /** legacy organiser_groups.id → cafe */
  byOrgGroupId: Map<number, CafeCatalogEntry>;
  /** legacy ticket_id → cafe + category (for booking lines) */
  byTicketId: Map<
    number,
    { cafe: CafeCatalogEntry; category: CafeTicketCategoryRef }
  >;
  result: Array<{
    legacyOrgGroupId: number;
    cafeId: string;
    name: string;
    created: boolean;
    categories: number;
    items: number;
    agents: number;
  }>;
};

function packsByTicketId(
  packs: LegacyPlaytimePack[],
): Map<number, LegacyPlaytimePack[]> {
  const map = new Map<number, LegacyPlaytimePack[]>();
  for (const pack of packs) {
    const list = map.get(pack.ticket_id) ?? [];
    list.push(pack);
    map.set(pack.ticket_id, list);
  }
  return map;
}

function itemHasMarker(description: string | null | undefined, marker: string) {
  return hasExactLegacyMarker(description, marker);
}

async function ensureUngroupedSubcategory(
  prisma: PrismaClient,
  categoryId: string,
  dryRun: boolean,
): Promise<string> {
  if (dryRun) return `dry-ungrouped-${categoryId}`;
  const existing = await prisma.cafeMenuSubcategory.findFirst({
    where: { categoryId, isUngrouped: true },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.cafeMenuSubcategory.create({
    data: {
      categoryId,
      titleEn: UNGROUPED_SUBCATEGORY_TITLE,
      isUngrouped: true,
      sortOrder: 0,
      status: 'active',
    },
    select: { id: true },
  });
  return created.id;
}

async function ensureMenuItem(args: {
  prisma: PrismaClient;
  subcategoryId: string;
  title: string;
  price: number;
  currency: string;
  description: string | null;
  marker: string;
  sortOrder: number;
  dryRun: boolean;
}): Promise<{ item: CafeMenuItemRef; created: boolean }> {
  const { prisma, subcategoryId, title, price, currency, description, marker, sortOrder, dryRun } =
    args;

  if (dryRun) {
    return {
      item: { id: `dry-item-${marker}`, title },
      created: true,
    };
  }

  const existingItems = await prisma.cafeMenuItem.findMany({
    where: { subcategoryId },
    select: { id: true, titleEn: true, description: true },
  });
  const matched = existingItems.find((row) => itemHasMarker(row.description, marker));
  if (matched) {
    const updated = await prisma.cafeMenuItem.update({
      where: { id: matched.id },
      data: {
        titleEn: title.slice(0, 190),
        description:
          description || matched.description || marker,
        price: money3(price),
        currency: currency.slice(0, 5) || 'QAR',
        status: 'active',
      },
      select: { id: true, titleEn: true },
    });
    return { item: { id: updated.id, title: updated.titleEn }, created: false };
  }

  const created = await prisma.cafeMenuItem.create({
    data: {
      subcategoryId,
      titleEn: title.slice(0, 190),
      description: description ? `${marker} ${description}`.slice(0, 2000) : marker,
      price: money3(price),
      currency: currency.slice(0, 5) || 'QAR',
      sortOrder,
      status: 'active',
    },
    select: { id: true, titleEn: true },
  });
  return { item: { id: created.id, title: created.titleEn }, created: true };
}

async function ensureCategoryForTicket(args: {
  prisma: PrismaClient;
  cafeId: string;
  ticket: Pick<LegacyTicket, 'id' | 'title' | 'price'>;
  packs: LegacyPlaytimePack[];
  dryRun: boolean;
}): Promise<{ category: CafeTicketCategoryRef; categoriesCreated: number; itemsCreated: number }> {
  const { prisma, cafeId, ticket, packs, dryRun } = args;
  const marker = legacyCafeTicketCategoryMarker(ticket.id);
  const title = (ticket.title || `Ticket ${ticket.id}`).slice(0, 190);

  let categoryId: string;
  let categoriesCreated = 0;

  if (dryRun) {
    categoryId = `dry-cat-${ticket.id}`;
    categoriesCreated = 1;
  } else {
    // Match by exact legacy ticket marker only — never by title alone
    // (same item names across cafes/events must stay separate).
    const existing = await prisma.cafeMenuCategory.findFirst({
      where: {
        cafeId,
        titleAr: marker,
      },
      select: { id: true, titleEn: true, titleAr: true },
    });
    if (existing) {
      categoryId = existing.id;
      if (existing.titleEn !== title) {
        await prisma.cafeMenuCategory.update({
          where: { id: existing.id },
          data: { titleEn: title, titleAr: marker, status: 'active' },
        });
      }
    } else {
      const created = await prisma.cafeMenuCategory.create({
        data: {
          cafeId,
          titleEn: title,
          titleAr: marker,
          sortOrder: ticket.id,
          status: 'active',
        },
        select: { id: true },
      });
      categoryId = created.id;
      categoriesCreated = 1;
    }
  }

  const subcategoryId = await ensureUngroupedSubcategory(prisma, categoryId, dryRun);
  const itemsByPackId = new Map<number, CafeMenuItemRef>();
  let itemsCreated = 0;
  let defaultItem: CafeMenuItemRef | null = null;

  if (packs.length) {
    for (const [index, pack] of packs.entries()) {
      const packMarker = legacyCafePackItemMarker(pack.id);
      const packTitle = (pack.title || `Pack ${pack.id}`).slice(0, 190);
      const desc = stripHtml(pack.description);
      const { item, created } = await ensureMenuItem({
        prisma,
        subcategoryId,
        title: packTitle,
        price: Number(pack.price || 0),
        currency: pack.currency || 'QAR',
        description: desc,
        marker: packMarker,
        sortOrder: index,
        dryRun,
      });
      itemsByPackId.set(pack.id, item);
      if (created) itemsCreated += 1;
      if (!defaultItem) defaultItem = item;
    }
  } else {
    const defaultMarker = legacyCafeTicketDefaultItemMarker(ticket.id);
    const { item, created } = await ensureMenuItem({
      prisma,
      subcategoryId,
      title,
      price: Number(ticket.price || 0),
      currency: 'QAR',
      description: null,
      marker: defaultMarker,
      sortOrder: 0,
      dryRun,
    });
    defaultItem = item;
    if (created) itemsCreated += 1;
  }

  if (!defaultItem) {
    // Should not happen; keep a synthetic fallback for dry-run safety.
    defaultItem = { id: randomUUID(), title };
  }

  return {
    category: {
      categoryId,
      title,
      itemsByPackId,
      defaultItem,
    },
    categoriesCreated,
    itemsCreated,
  };
}

/**
 * For organiser_groups with is_cafe=1:
 * create a Cafe per (legacy org group × V2 event) + menu when tickets exist.
 * Same cafe display names across events are allowed but must remain separate cafes.
 */
export async function ensureCafeCatalogs(args: {
  prisma: PrismaClient;
  organizationId: string;
  eventId: string;
  cafeGroups: LegacyOrganiserGroup[];
  cafeTickets: LegacyTicket[];
  packs: LegacyPlaytimePack[];
  thirdPartyVendorByLegacyId: Map<number, string>;
  /** Booking-only tickets not in tickets table (orphan lines). */
  orphanCafeTickets?: Array<{
    id: number;
    title: string;
    price: number;
    org_group_id: number;
  }>;
  dryRun: boolean;
}): Promise<CafeCatalogResult> {
  const {
    prisma,
    organizationId,
    eventId,
    cafeGroups,
    cafeTickets,
    packs,
    thirdPartyVendorByLegacyId,
    orphanCafeTickets = [],
    dryRun,
  } = args;

  const packsByTicket = packsByTicketId(packs);
  const byOrgGroupId = new Map<number, CafeCatalogEntry>();
  const byTicketId = new Map<
    number,
    { cafe: CafeCatalogEntry; category: CafeTicketCategoryRef }
  >();
  const result: CafeCatalogResult['result'] = [];

  const ticketsByGroup = new Map<number, LegacyTicket[]>();
  for (const ticket of cafeTickets) {
    if (!ticket.org_group_id || ticket.org_group_id <= 0) continue;
    const list = ticketsByGroup.get(ticket.org_group_id) ?? [];
    list.push(ticket);
    ticketsByGroup.set(ticket.org_group_id, list);
  }
  for (const orphan of orphanCafeTickets) {
    if (!orphan.org_group_id || orphan.org_group_id <= 0) continue;
    if (cafeTickets.some((t) => t.id === orphan.id)) continue;
    const list = ticketsByGroup.get(orphan.org_group_id) ?? [];
    list.push({
      id: orphan.id,
      event_id: 0,
      title: orphan.title,
      ticket_type: 'normal',
      price: orphan.price,
      admits: 1,
      is_pos_only: 1,
      only_for_third_party: 0,
      is_complementary: 0,
      is_customizable: 0,
      is_active: 1,
      org_group_id: orphan.org_group_id,
      quantity: null,
      booking_rows: 0,
      sold_qty: 0,
      sold_admits: 0,
      sold_revenue: 0,
    });
    ticketsByGroup.set(orphan.org_group_id, list);
  }

  for (const group of cafeGroups) {
    const groupTickets = ticketsByGroup.get(group.id) ?? [];
    // Always create a cafe per cafe org-group for this event (even with no menu
    // tickets yet) so closings / sales never fall onto another event's cafe.

    const marker = legacyCafeOrgGroupMarker(group.id, eventId);
    const legacyUnscopedMarker = legacyCafeOrgGroupMarker(group.id);
    const baseName =
      (group.name || `Cafe ${group.id}`).trim().slice(0, 180) || `Cafe ${group.id}`;
    const thirdPartyVendorId = thirdPartyVendorByLegacyId.get(group.id) ?? null;

    let cafeId: string;
    let created = false;

    if (dryRun) {
      cafeId = `dry-cafe-${eventId}-${group.id}`;
      created = true;
    } else {
      // Prefer event-scoped marker. Fall back to unscoped marker only when that
      // cafe is already assigned to THIS event (never steal another event's cafe).
      const candidates = await prisma.cafe.findMany({
        where: {
          organizationId,
          OR: [
            { details: { contains: marker } },
            { details: { contains: legacyUnscopedMarker } },
          ],
        },
        select: {
          id: true,
          name: true,
          details: true,
          activeEventId: true,
          assignments: {
            where: { eventId, unassignedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      });

      const existing =
        candidates.find((c) => hasExactLegacyMarker(c.details, marker)) ??
        candidates.find(
          (c) =>
            hasExactLegacyMarker(c.details, legacyUnscopedMarker) &&
            (c.activeEventId === eventId || c.assignments.length > 0),
        ) ??
        null;

      if (existing) {
        cafeId = existing.id;
        await prisma.cafe.update({
          where: { id: cafeId },
          data: {
            name: baseName,
            details: `${marker} Migrated from legacy BookingQube`,
            status: 'published',
            activeEventId: eventId,
          },
        });
      } else {
        const createdCafe = await prisma.cafe.create({
          data: {
            organizationId,
            name: baseName,
            details: `${marker} Migrated from legacy BookingQube`,
            tableCount: 1,
            status: 'published',
            activeEventId: eventId,
          },
          select: { id: true },
        });
        cafeId = createdCafe.id;
        created = true;
      }

      const openAssignment = await prisma.cafeEventAssignment.findFirst({
        where: { cafeId, eventId, unassignedAt: null },
        select: { id: true },
      });
      if (!openAssignment) {
        // Only close assignments for THIS cafe — do not touch other events' cafes.
        await prisma.cafeEventAssignment.updateMany({
          where: { cafeId, unassignedAt: null },
          data: { unassignedAt: new Date() },
        });
        await prisma.cafeEventAssignment.create({
          data: { cafeId, eventId },
        });
      }
    }

    const entry: CafeCatalogEntry = {
      cafeId,
      name: baseName,
      legacyOrgGroupId: group.id,
      thirdPartyVendorId,
      categoriesByTicketId: new Map(),
    };

    let categories = 0;
    let items = 0;
    for (const ticket of groupTickets) {
      const { category, categoriesCreated, itemsCreated } = await ensureCategoryForTicket({
        prisma,
        cafeId,
        ticket,
        packs: packsByTicket.get(ticket.id) ?? [],
        dryRun,
      });
      entry.categoriesByTicketId.set(ticket.id, category);
      byTicketId.set(ticket.id, { cafe: entry, category });
      categories += categoriesCreated;
      items += itemsCreated;
    }

    byOrgGroupId.set(group.id, entry);
    result.push({
      legacyOrgGroupId: group.id,
      cafeId,
      name: baseName,
      created,
      categories,
      items,
      agents: 0,
    });
  }

  return { byOrgGroupId, byTicketId, result };
}

/**
 * Register POS agents from cafe booking / closing lines under each cafe.
 * Also syncs cafe_pos (or pos + isCafeAgent) staff assignment on the event.
 */
export async function ensureCafePosAgents(args: {
  prisma: PrismaClient;
  organizationId: string;
  eventId: string;
  cafeCatalog: CafeCatalogResult;
  /** legacy org_group_id → set of V2 user ids that sold under that cafe */
  agentsByOrgGroupId: Map<number, Set<string>>;
  managedByUserId: string | null;
  dryRun: boolean;
}): Promise<number> {
  const {
    prisma,
    organizationId,
    eventId,
    cafeCatalog,
    agentsByOrgGroupId,
    managedByUserId,
    dryRun,
  } = args;

  if (dryRun) return 0;

  const cafePosRole = await prisma.role.findUnique({ where: { name: 'cafe_pos' } });
  const posRole = await prisma.role.findUnique({ where: { name: 'pos' } });
  let created = 0;

  for (const [orgGroupId, userIds] of agentsByOrgGroupId) {
    const cafe = cafeCatalog.byOrgGroupId.get(orgGroupId);
    if (!cafe || !userIds.size) continue;

    const summary = cafeCatalog.result.find((r) => r.legacyOrgGroupId === orgGroupId);
    let agentsForCafe = 0;

    for (const userId of userIds) {
      const existing = await prisma.cafePosAgent.findUnique({
        where: { cafeId_userId: { cafeId: cafe.cafeId, userId } },
        select: { id: true, status: true },
      });
      if (existing) {
        if (existing.status !== 'active') {
          await prisma.cafePosAgent.update({
            where: { id: existing.id },
            data: { status: 'active' },
          });
        }
      } else {
        await prisma.cafePosAgent.create({
          data: {
            cafeId: cafe.cafeId,
            userId,
            status: 'active',
          },
        });
        created += 1;
        agentsForCafe += 1;
      }

      // Staff assignment on the event (cafe_pos preferred).
      const roleId = cafePosRole?.id ?? posRole?.id;
      if (!roleId) continue;

      const existingStaff = await prisma.staffAssignment.findFirst({
        where: {
          userId,
          eventId,
          OR: [
            ...(cafePosRole ? [{ roleId: cafePosRole.id }] : []),
            ...(posRole ? [{ roleId: posRole.id, isCafeAgent: true }] : []),
          ],
        },
        select: { id: true, status: true },
      });
      if (existingStaff) {
        if (existingStaff.status !== 'active') {
          await prisma.staffAssignment.update({
            where: { id: existingStaff.id },
            data: { status: 'active', isCafeAgent: true },
          });
        }
      } else {
        await prisma.staffAssignment.create({
          data: {
            userId,
            roleId,
            organizationId,
            eventId,
            managedByUserId,
            isCafeAgent: true,
            thirdPartyVendorIds: cafe.thirdPartyVendorId ? [cafe.thirdPartyVendorId] : [],
            ticketTypeIds: [],
            status: 'active',
          },
        });
      }

      await prisma.adminProfile.upsert({
        where: { userId },
        update: { status: 'active' },
        create: { userId, roleId, status: 'active' },
      });
    }

    if (summary) summary.agents = agentsForCafe;
  }

  return created;
}

/** Resolve cafe menu item for a legacy cafe booking line. */
export function resolveCafeMenuItemForLine(
  cafeCatalog: CafeCatalogResult,
  line: Pick<LegacyBookingLine, 'ticket_id' | 'playtime_pack_id' | 'ticket_title'>,
): {
  cafe: CafeCatalogEntry;
  category: CafeTicketCategoryRef;
  item: CafeMenuItemRef;
  displayName: string;
} | null {
  const mapped = cafeCatalog.byTicketId.get(line.ticket_id);
  if (!mapped) return null;

  const { cafe, category } = mapped;
  let item = category.defaultItem;
  if (line.playtime_pack_id != null) {
    item = category.itemsByPackId.get(line.playtime_pack_id) ?? category.defaultItem;
  }

  const displayName =
    line.playtime_pack_id != null && category.itemsByPackId.has(line.playtime_pack_id)
      ? `${category.title} - ${item.title}`
      : line.ticket_title || category.title || item.title;

  return { cafe, category, item, displayName };
}

/** Collect pos agents that sold cafe lines, keyed by legacy org group. */
export function collectCafeAgentsByOrgGroup(args: {
  bookings: LegacyBookingLine[];
  cafeOrgGroupIds: Set<number>;
  staffByLegacyId: Map<number, { userId: string }>;
  /** Optional: closing.agent_id → attach to every cafe if org group unknown */
  closingAgentLegacyIds?: number[];
}): Map<number, Set<string>> {
  const map = new Map<number, Set<string>>();

  const add = (orgGroupId: number, userId: string) => {
    const set = map.get(orgGroupId) ?? new Set<string>();
    set.add(userId);
    map.set(orgGroupId, set);
  };

  for (const line of args.bookings) {
    const isCafe =
      !!line.is_cafe || args.cafeOrgGroupIds.has(line.ticket_org_group_id);
    if (!isCafe) continue;
    const orgGroupId = line.ticket_org_group_id;
    if (!orgGroupId || orgGroupId <= 0) continue;
    if (line.pos_id == null) continue;
    const userId = args.staffByLegacyId.get(line.pos_id)?.userId;
    if (!userId) continue;
    add(orgGroupId, userId);
  }

  // Closings have no org_group — register agent under every cafe for this event.
  if (args.closingAgentLegacyIds?.length) {
    for (const legacyId of args.closingAgentLegacyIds) {
      const userId = args.staffByLegacyId.get(legacyId)?.userId;
      if (!userId) continue;
      for (const orgGroupId of args.cafeOrgGroupIds) {
        add(orgGroupId, userId);
      }
    }
  }

  return map;
}
