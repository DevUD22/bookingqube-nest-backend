import { randomUUID } from 'crypto';
import {
  OrderItemType,
  PaymentProvider,
  PaymentTransactionStatus,
  PrismaClient,
  type Prisma,
} from '@prisma/client';

import { rebuildEventRollups as syncEventRollups } from '../../../../prisma/sync-perf-order-rollups';
import {
  LEGACY_ORDER_SOURCE,
  LEGACY_ORDER_SOURCE_ADDON,
  LEGACY_ORDER_SOURCE_CAFE,
  LEGACY_ORDER_SOURCE_E3,
  LEGACY_ORDER_SOURCE_TIME_EXTENSION,
  legacyCafeCommonOrder,
  legacyCafeEodExternalKey,
  legacyCafeIdempotencyKey,
  legacyCommonOrder,
  legacyE3CommonOrder,
  legacyE3IdempotencyKey,
  legacyE3OnsiteExternalKey,
  legacyIdempotencyKey,
  legacySeparateAddonCommonOrder,
  legacySeparateAddonIdempotencyKey,
  legacyTicketExternalKey,
  legacyPlaytimePackExternalKey,
  legacyTicketActivityExternalKey,
  legacyAddonExternalKey,
  legacyTimeExtensionPackId,
  legacyTimeExtensionCommonOrder,
  legacyTimeExtensionIdempotencyKey,
} from './config';
import {
  getLegacyMetrics,
  loadE3Bookings,
  loadLegacyAddonCatalog,
  loadLegacyAddonsForOrders,
  loadLegacyBookings,
  loadLegacyOrganiserGroups,
  loadLegacyStaffUsers,
  loadLegacyPlaytimePacks,
  loadLegacyTicketActivities,
  loadLegacyTickets,
  loadLegacyTimeExtensionCatalog,
  loadPosCafeClosings,
  loadSeparateAddons,
  loadSplitCommonOrders,
  loadTimeExtensionPurchases,
  resolveLegacyEventIds,
  type LegacyAddonCatalog,
  type LegacyBookingLine,
  type LegacyOrganiserGroup,
  type LegacyPlaytimePack,
  type LegacyStaffUser,
  type LegacyTicket,
  type LegacyTicketActivity,
  type LegacyTimeExtensionCatalog,
  type LegacyTimeExtensionPurchase,
  type LegacyTimeExtensionSnapshotItem,
} from './extract';
import {
  attendanceFromCheckedIn,
  cafePaymentLegs,
  classifyAddonPaymentMode,
  classifyE3PaymentMode,
  classifyPaymentMode,
  classifyTimeExtensionPaymentMode,
  classifyVisitorType,
  formatDisplayTime,
  guestEmail,
  legacyDateOnlyQatar,
  legacyLineDiscount,
  money3,
  normalizeTitle,
  parseDateOnly,
  paymentLegsForMode,
  safeEmail,
  safePhone,
  slugify,
} from './mappers';
import {
  collectCafeAgentsByOrgGroup,
  ensureCafeCatalogs,
  ensureCafePosAgents,
  resolveCafeMenuItemForLine,
} from './migrate-cafe';
import {
  loadLegacyEventTiming,
  mapLegacyTimingToApplyDto,
  materializeTimingOnEvent,
} from './map-legacy-timing';

/** Pre-report_basis unique indexes that break trx+event rollup inserts. */
const OBSOLETE_REPORT_UNIQUES = [
  'booking_report_daily_event_id_report_day_payment_mode_curre_key',
  'booking_report_payment_daily_event_id_report_day_payment_me_key',
  'booking_report_visitor_daily_event_id_report_day_visitor_ty_key',
  'booking_report_ticket_daily_event_id_report_day_ticket_item_id_key',
  'booking_report_demo_daily_event_id_report_day_age_group_region_key',
];

async function ensureReportIndexes(prisma: PrismaClient) {
  for (const name of OBSOLETE_REPORT_UNIQUES) {
    await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS ${name}`);
  }
}

async function rebuildEventRollups(
  prisma: PrismaClient,
  events: Array<{ id: string; slug: string }>,
) {
  // Call in-process — spawning npx.cmd fails on Windows/Node 24+ (spawn EINVAL).
  await syncEventRollups(prisma, events);
}

/**
 * Migration-only: stamp addon lines with third_party_vendor_id so vendor rollups
 * include addon revenue (write-time attribution — reporting stays rollup/SQL based).
 */
function pickDominantVendorId(
  candidates: Array<string | null | undefined>,
): string | null {
  const counts = new Map<string, number>();
  for (const id of candidates) {
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id;
      bestCount = count;
    }
  }
  return best;
}

/** Map V2 staff user → dominant third-party vendor from tickets they sold. */
function buildAgentDominantVendorMap(
  bookings: LegacyBookingLine[],
  staffByLegacyId: Map<number, { userId: string; email: string }>,
  thirdPartyVendorsByLegacyId: Map<number, string>,
  cafeOrgGroupIds: Set<number>,
): Map<string, string> {
  const byAgent = new Map<string, Map<string, number>>();
  for (const line of bookings) {
    if (line.pos_id == null || line.pos_id <= 0) continue;
    if (!line.ticket_org_group_id || line.ticket_org_group_id <= 0) continue;
    if (cafeOrgGroupIds.has(line.ticket_org_group_id)) continue;
    const staff = staffByLegacyId.get(line.pos_id);
    const vendorId = thirdPartyVendorsByLegacyId.get(line.ticket_org_group_id);
    if (!staff || !vendorId) continue;
    const counts = byAgent.get(staff.userId) ?? new Map<string, number>();
    counts.set(vendorId, (counts.get(vendorId) ?? 0) + Number(line.quantity || 1));
    byAgent.set(staff.userId, counts);
  }
  const out = new Map<string, string>();
  for (const [userId, counts] of byAgent) {
    let best: string | null = null;
    let bestCount = 0;
    for (const [vendorId, count] of counts) {
      if (count > bestCount) {
        best = vendorId;
        bestCount = count;
      }
    }
    if (best) out.set(userId, best);
  }
  return out;
}

export type MigrateOptions = {
  oldEvent: string;
  newEventSlug?: string;
  createEvent?: boolean;
  organizationSlug?: string;
  dryRun?: boolean;
  createMissingTickets?: boolean;
  includeAddons?: boolean;
  /** Separate addons (addon_booking_no IS NULL). Default on. */
  includeSeparateAddons?: boolean;
  /** pos_cafe_closings EOD sales. Default on. */
  includeCafeClosings?: boolean;
  /** e3_bookings historical onsite sales. Default on. */
  includeE3?: boolean;
  /** Standalone time_extension_purchases. Default on. */
  includeTimeExtensions?: boolean;
  skipRollups?: boolean;
  force?: boolean;
  ticketMap?: Record<string, string>; // oldTicketId -> newTicketTypeId or externalKey
};

export type MigrateResult = {
  legacy: {
    eventIds: number[];
    title: string;
    slug: string;
    metrics: Awaited<ReturnType<typeof getLegacyMetrics>>;
  };
  target: {
    eventId: string;
    slug: string;
    title: string;
    created: boolean;
  };
  ticketMap: Array<{
    oldTicketId: number;
    oldTitle: string;
    newTicketTypeId: string;
    newTitle: string;
    matchedBy: 'map' | 'externalKey' | 'title' | 'created';
    thirdPartyVendorId?: string | null;
    hasVariants?: boolean;
    isCustomizable?: boolean;
    variants?: Array<{
      oldPackId: number;
      oldTitle: string;
      newVariantId: string;
    }>;
    customizations?: Array<{
      oldActivityId: number;
      oldTitle: string;
      newOptionId: string;
    }>;
  }>;
  /** Legacy addons.id → V2 Addon.id */
  addonMap?: Array<{
    oldAddonId: number;
    oldTitle: string;
    newAddonId: string;
    matchedBy: 'externalKey' | 'created';
  }>;
  /** Legacy time_extensions.id → moreOpsConfig pack id */
  timeExtensionMap?: Array<{
    oldExtensionId: number;
    oldTitle: string;
    newPackId: string;
    minutes: number;
    matchedBy: 'legacy_id' | 'created';
  }>;
  thirdPartyVendors?: Array<{
    legacyId: number;
    name: string;
    thirdPartyVendorId: string;
    created: boolean;
  }>;
  cafes?: Array<{
    legacyOrgGroupId: number;
    cafeId: string;
    name: string;
    created: boolean;
    categories: number;
    items: number;
    agents: number;
  }>;
  organiser?: { legacyUserId: number; userId: string; email: string } | null;
  posAgents?: Array<{ legacyUserId: number; userId: string; email: string }>;
  planned: {
    customers: number;
    orders: number;
    orderItems: number;
    payments: number;
    sessions: number;
    separateAddonOrders?: number;
    cafeOrders?: number;
    e3Orders?: number;
    timeExtensionOrders?: number;
  };
  written?: {
    customersCreated: number;
    ordersCreated: number;
    ordersSkippedExisting: number;
    orderItemsCreated: number;
    paymentsCreated: number;
  };
  warnings?: string[];
  timing?: {
    mode: string;
    sessionsCreated: number;
    sessionsRemoved: number;
    applied: boolean;
  };
  verify?: {
    old: {
      orders: number;
      tickets: number;
      admits: number;
      revenue: number;
      parity?: { tickets: number; admits: number; revenue: number };
    };
    neu: { orders: number; tickets: number; admits: number; revenue: number };
    match: boolean;
  };
};

function groupByCommonOrder(lines: LegacyBookingLine[]) {
  const map = new Map<string, LegacyBookingLine[]>();
  for (const line of lines) {
    const list = map.get(line.common_order) ?? [];
    list.push(line);
    map.set(line.common_order, list);
  }
  return map;
}

async function resolveOrganization(prisma: PrismaClient, slug?: string) {
  if (slug) {
    const org = await prisma.organization.findUnique({ where: { slug } });
    if (!org) throw new Error(`Organization not found: ${slug}`);
    return org;
  }
  const org =
    (await prisma.organization.findUnique({ where: { slug: 'bookingqube' } })) ??
    (await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' } }));
  if (!org) throw new Error('No organization found. Run prisma:seed first.');
  return org;
}

async function ensureTargetEvent(
  prisma: PrismaClient,
  opts: MigrateOptions,
  legacy: {
    title: string;
    slug: string;
    start_date: string | null;
    end_date: string | null;
    start_time: string | null;
    end_time: string | null;
    registration_only: number | null;
    summer_camp: number | null;
    description: string | null;
    publish: number | null;
    featured?: number | null;
  },
) {
  if (opts.newEventSlug) {
    const existing = await prisma.event.findUnique({
      where: { slug: opts.newEventSlug },
      include: {
        translations: { where: { locale: 'en' }, take: 1 },
        ticketTypes: true,
        sessions: { take: 1, orderBy: { startsAt: 'asc' } },
      },
    });
    if (!existing) {
      throw new Error(
        `New event slug not found: ${opts.newEventSlug}. Pass --create-event to create from legacy, or create the event in admin first.`,
      );
    }
    return {
      event: existing,
      title: existing.translations[0]?.title || existing.slug,
      created: false,
    };
  }

  if (!opts.createEvent) {
    throw new Error('Pass --new-event=<slug> to migrate into an existing event, or --create-event.');
  }

  const org = await resolveOrganization(prisma, opts.organizationSlug);
  let slug = slugify(legacy.slug || legacy.title);
  const clash = await prisma.event.findUnique({ where: { slug } });
  if (clash) slug = `${slug}-legacy-${Date.now().toString(36)}`;

  if (opts.dryRun) {
    return {
      event: {
        id: randomUUID(),
        slug,
        organizationId: org.id,
        venueId: null,
        eventType: legacy.summer_camp
          ? ('summer_camp' as const)
          : legacy.registration_only
            ? ('registration_only' as const)
            : ('general' as const),
        translations: [{ title: legacy.title }],
        ticketTypes: [],
        sessions: [],
      } as never,
      title: legacy.title,
      created: true,
    };
  }

  const startsAt = legacy.start_date
    ? new Date(
        `${legacy.start_date}T${(legacy.start_time || '00:00:00').toString().slice(0, 8)}+03:00`,
      )
    : null;
  const endsAt = legacy.end_date
    ? new Date(
        `${legacy.end_date}T${(legacy.end_time || '23:59:59').toString().slice(0, 8)}+03:00`,
      )
    : null;

  const eventType =
    legacy.summer_camp ? 'summer_camp' : legacy.registration_only ? 'registration_only' : 'general';
  const bookingMode = legacy.registration_only ? 'registration' : 'ticketed';

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      slug,
      eventType,
      bookingMode,
      status: legacy.publish ? 'published' : 'draft',
      visibility: 'private',
      isFeatured: Boolean(legacy.featured),
      currency: 'QAR',
      startsAt,
      endsAt,
      publishedAt: legacy.publish ? new Date() : null,
      translations: {
        create: [
          {
            locale: 'en',
            title: legacy.title,
            description: legacy.description?.slice(0, 5000) || null,
            subtitle: 'Migrated from legacy BookingQube',
          },
        ],
      },
      moreOpsConfig: {
        migratedFrom: 'legacy_mysql',
        legacySlug: legacy.slug,
      },
    },
    include: {
      translations: { where: { locale: 'en' }, take: 1 },
      ticketTypes: true,
      sessions: { take: 1 },
    },
  });

  return { event, title: legacy.title, created: true };
}

type VariantMapEntry = {
  id: string;
  name: string;
};

type TicketMapEntry = {
  id: string;
  title: string;
  admitCount: number;
  isPosOnly: boolean;
  isCafe: boolean;
  thirdPartyVendorId: string | null;
  /** legacy playtime_pack_id → V2 ticket_variant */
  variantsByPackId: Map<number, VariantMapEntry>;
};

function parsePackDurationMinutes(slot: string | null | undefined): number | null {
  if (slot == null) return null;
  const n = Number(String(slot).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function stripHtml(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || null;
}

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

function activitiesByTicketId(
  activities: LegacyTicketActivity[],
): Map<number, LegacyTicketActivity[]> {
  const map = new Map<number, LegacyTicketActivity[]>();
  for (const activity of activities) {
    const list = map.get(activity.ticket_id) ?? [];
    list.push(activity);
    map.set(activity.ticket_id, list);
  }
  return map;
}

function parseActivityDurationMinutes(
  duration: string | null | undefined,
): number | null {
  if (duration == null) return null;
  const n = Number(String(duration).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

async function ensureCustomizationOptionsForTicketType(
  prisma: PrismaClient,
  ticketTypeId: string,
  activities: LegacyTicketActivity[],
  dryRun: boolean,
): Promise<{
  result: Array<{
    oldActivityId: number;
    oldTitle: string;
    newOptionId: string;
  }>;
}> {
  const result: Array<{
    oldActivityId: number;
    oldTitle: string;
    newOptionId: string;
  }> = [];
  if (!activities.length) {
    return { result };
  }

  const hasDuration = activities.some(
    (a) =>
      a.activity_type === 'duration' ||
      parseActivityDurationMinutes(a.duration) != null,
  );

  if (dryRun) {
    for (const activity of activities) {
      const fakeId = `dry-activity-${activity.id}`;
      result.push({
        oldActivityId: activity.id,
        oldTitle: activity.title,
        newOptionId: fakeId,
      });
    }
    return { result };
  }

  await prisma.ticketType.update({
    where: { id: ticketTypeId },
    data: {
      isCustomizable: true,
      hasVariants: false,
      iconType: 'simple',
      hasDuration,
      durationMinutes: null,
    },
  });

  const existing = await prisma.ticketCustomizationOption.findMany({
    where: { ticketTypeId },
  });
  const byExternal = new Map(existing.map((o) => [o.externalKey, o]));

  for (let index = 0; index < activities.length; index++) {
    const activity = activities[index]!;
    const externalKey = legacyTicketActivityExternalKey(activity.id);
    const durationMinutes = hasDuration
      ? parseActivityDurationMinutes(activity.duration)
      : null;
    const isActive = activity.status === 'ACTIVE';
    const payload = {
      externalKey,
      name: activity.title.slice(0, 120),
      description: stripHtml(activity.description)?.slice(0, 500) ?? null,
      price: money3(activity.price),
      currency: 'QAR',
      hasDuration,
      durationMinutes,
      maxQtyPerTicket: 99,
      status: (isActive ? 'active' : 'hidden') as 'active' | 'hidden',
      sortOrder: index + 1,
    };

    let option = byExternal.get(externalKey);
    if (!option) {
      option = await prisma.ticketCustomizationOption.create({
        data: { ticketTypeId, ...payload },
      });
      byExternal.set(externalKey, option);
    } else {
      option = await prisma.ticketCustomizationOption.update({
        where: { id: option.id },
        data: payload,
      });
    }

    result.push({
      oldActivityId: activity.id,
      oldTitle: activity.title,
      newOptionId: option.id,
    });
  }

  return { result };
}

async function ensureVariantsForTicketType(
  prisma: PrismaClient,
  ticketTypeId: string,
  packs: LegacyPlaytimePack[],
  dryRun: boolean,
): Promise<{
  variantsByPackId: Map<number, VariantMapEntry>;
  result: Array<{ oldPackId: number; oldTitle: string; newVariantId: string }>;
}> {
  const variantsByPackId = new Map<number, VariantMapEntry>();
  const result: Array<{ oldPackId: number; oldTitle: string; newVariantId: string }> =
    [];
  if (!packs.length) {
    return { variantsByPackId, result };
  }

  const hasDuration = packs.some((p) => parsePackDurationMinutes(p.slot) != null);

  if (dryRun) {
    for (const pack of packs) {
      const fakeId = `dry-pack-${pack.id}`;
      variantsByPackId.set(pack.id, { id: fakeId, name: pack.title });
      result.push({
        oldPackId: pack.id,
        oldTitle: pack.title,
        newVariantId: fakeId,
      });
    }
    return { variantsByPackId, result };
  }

  await prisma.ticketType.update({
    where: { id: ticketTypeId },
    data: {
      hasVariants: true,
      iconType: 'variants',
      basePrice: null,
      hasDuration,
      durationMinutes: null,
    },
  });

  const existing = await prisma.ticketVariant.findMany({
    where: { ticketTypeId },
  });
  const byExternal = new Map(existing.map((v) => [v.externalKey, v]));

  for (let index = 0; index < packs.length; index++) {
    const pack = packs[index]!;
    const externalKey = legacyPlaytimePackExternalKey(pack.id);
    const durationMinutes = hasDuration
      ? parsePackDurationMinutes(pack.slot)
      : null;
    const maxQty =
      pack.max_per_ticket_qty > 0 ? pack.max_per_ticket_qty : 10;
    const payload = {
      externalKey,
      name: pack.title.slice(0, 120),
      description: stripHtml(pack.description)?.slice(0, 240) ?? null,
      basePrice: money3(pack.price),
      currency: (pack.currency || 'QAR').slice(0, 5) || 'QAR',
      durationMinutes,
      maxQtyPerOrder: maxQty,
      status: 'active' as const,
      sortOrder: index + 1,
    };

    let variant = byExternal.get(externalKey);
    if (!variant) {
      variant = await prisma.ticketVariant.create({
        data: { ticketTypeId, ...payload },
      });
      byExternal.set(externalKey, variant);
    } else {
      variant = await prisma.ticketVariant.update({
        where: { id: variant.id },
        data: payload,
      });
    }

    variantsByPackId.set(pack.id, { id: variant.id, name: variant.name });
    result.push({
      oldPackId: pack.id,
      oldTitle: pack.title,
      newVariantId: variant.id,
    });
  }

  return { variantsByPackId, result };
}

async function buildTicketMap(
  prisma: PrismaClient,
  eventId: string,
  legacyTickets: LegacyTicket[],
  packsByTicket: Map<number, LegacyPlaytimePack[]>,
  activitiesByTicket: Map<number, LegacyTicketActivity[]>,
  opts: MigrateOptions,
  thirdPartyVendorByLegacyId: Map<number, string>,
  cafeOrgGroupIds: Set<number>,
  warnings: string[],
) {
  // Dry-run + brand-new event: no V2 tickets exist yet — plan creates only.
  if (opts.dryRun && opts.createEvent && !opts.newEventSlug) {
    const result: MigrateResult['ticketMap'] = [];
    const map = new Map<number, TicketMapEntry>();
    for (const lt of legacyTickets) {
      const fakeId = randomUUID();
      const isCustomizable = !!lt.is_customizable;
      const packs = isCustomizable ? [] : packsByTicket.get(lt.id) ?? [];
      const activities = isCustomizable
        ? activitiesByTicket.get(lt.id) ?? []
        : [];
      if (isCustomizable && (packsByTicket.get(lt.id)?.length ?? 0) > 0) {
        warnings.push(
          `Ticket #${lt.id} "${lt.title}" is customizable; skipping ${packsByTicket.get(lt.id)!.length} playtime pack(s)`,
        );
      }
      const thirdPartyVendorId =
        lt.org_group_id > 0 ? thirdPartyVendorByLegacyId.get(lt.org_group_id) ?? null : null;
      const { variantsByPackId, result: variantResult } =
        await ensureVariantsForTicketType(prisma, fakeId, packs, true);
      const { result: customizationResult } =
        await ensureCustomizationOptionsForTicketType(
          prisma,
          fakeId,
          activities,
          true,
        );
      map.set(lt.id, {
        id: fakeId,
        title: lt.title,
        admitCount: lt.admits || 1,
        isPosOnly: !!lt.is_pos_only,
        isCafe: cafeOrgGroupIds.has(lt.org_group_id),
        thirdPartyVendorId,
        variantsByPackId,
      });
      result.push({
        oldTicketId: lt.id,
        oldTitle: lt.title,
        newTicketTypeId: fakeId,
        newTitle: lt.title,
        matchedBy: 'created',
        thirdPartyVendorId,
        hasVariants: packs.length > 0,
        isCustomizable,
        variants: variantResult,
        customizations: customizationResult,
      });
    }
    return { map, result };
  }

  const existing = await prisma.ticketType.findMany({
    where: { eventId },
  });
  const byExternal = new Map(existing.map((t) => [t.externalKey, t]));
  const byTitle = new Map(existing.map((t) => [normalizeTitle(t.title), t]));
  const byId = new Map(existing.map((t) => [t.id, t]));

  const result: MigrateResult['ticketMap'] = [];
  const map = new Map<number, TicketMapEntry>();

  for (const lt of legacyTickets) {
    const isCustomizable = !!lt.is_customizable;
    const packs = isCustomizable ? [] : packsByTicket.get(lt.id) ?? [];
    const activities = isCustomizable
      ? activitiesByTicket.get(lt.id) ?? []
      : [];
    if (isCustomizable && (packsByTicket.get(lt.id)?.length ?? 0) > 0) {
      warnings.push(
        `Ticket #${lt.id} "${lt.title}" is customizable; skipping ${packsByTicket.get(lt.id)!.length} playtime pack(s)`,
      );
    }
    const hasPacks = packs.length > 0;
    const hasActivityDuration = activities.some(
      (a) =>
        a.activity_type === 'duration' ||
        parseActivityDurationMinutes(a.duration) != null,
    );
    const hasPackDuration = packs.some(
      (p) => parsePackDurationMinutes(p.slot) != null,
    );
    const thirdPartyVendorId =
      lt.org_group_id > 0 ? thirdPartyVendorByLegacyId.get(lt.org_group_id) ?? null : null;
    const isCafe = cafeOrgGroupIds.has(lt.org_group_id);
    const forced = opts.ticketMap?.[String(lt.id)];
    let matched = forced
      ? byId.get(forced) || byExternal.get(forced) || existing.find((t) => t.id === forced)
      : undefined;
    let matchedBy: MigrateResult['ticketMap'][number]['matchedBy'] = 'map';

    if (!matched) {
      const ext = legacyTicketExternalKey(lt.id);
      matched = byExternal.get(ext);
      if (matched) matchedBy = 'externalKey';
    }
    if (!matched) {
      // Title match is only safe when the existing row is not already bound to a
      // *different* legacy ticket id (e.g. two "City Pass" tickets 343 + 828).
      const byTitleCandidate = byTitle.get(normalizeTitle(lt.title));
      if (byTitleCandidate) {
        const bound = /^legacy-ticket-(\d+)$/.exec(byTitleCandidate.externalKey);
        if (!bound || Number(bound[1]) === lt.id) {
          matched = byTitleCandidate;
          matchedBy = 'title';
        }
      }
    }

    if (!matched && opts.createMissingTickets !== false) {
      if (opts.dryRun) {
        const fakeId = `dry-run-${lt.id}`;
        const { variantsByPackId, result: variantResult } =
          await ensureVariantsForTicketType(prisma, fakeId, packs, true);
        const { result: customizationResult } =
          await ensureCustomizationOptionsForTicketType(
            prisma,
            fakeId,
            activities,
            true,
          );
        map.set(lt.id, {
          id: fakeId,
          title: lt.title,
          admitCount: lt.admits || 1,
          isPosOnly: !!lt.is_pos_only,
          isCafe,
          thirdPartyVendorId,
          variantsByPackId,
        });
        result.push({
          oldTicketId: lt.id,
          oldTitle: lt.title,
          newTicketTypeId: fakeId,
          newTitle: lt.title,
          matchedBy: 'created',
          thirdPartyVendorId,
          hasVariants: hasPacks,
          isCustomizable,
          variants: variantResult,
          customizations: customizationResult,
        });
        continue;
      }
      matched = await prisma.ticketType.create({
        data: {
          eventId,
          externalKey: legacyTicketExternalKey(lt.id),
          title: lt.title,
          iconType: hasPacks ? 'variants' : 'simple',
          hasVariants: hasPacks,
          isCustomizable,
          basePrice: hasPacks ? null : money3(lt.price),
          admitCount: lt.admits || 1,
          hasDuration: isCustomizable
            ? hasActivityDuration
            : hasPacks
              ? hasPackDuration
              : false,
          durationMinutes: null,
          hideFromOnline: !!lt.is_pos_only || !lt.is_active,
          status: lt.is_active ? 'active' : 'hidden',
          sortOrder: lt.id,
          thirdPartyVendorId,
        },
      });
      byExternal.set(matched.externalKey, matched);
      byTitle.set(normalizeTitle(matched.title), matched);
      matchedBy = 'created';
    }

    if (!matched) {
      throw new Error(
        `No ticket mapping for legacy ticket #${lt.id} "${lt.title}". Pass --create-missing-tickets or --ticket-map=${lt.id}:<newTicketTypeId>`,
      );
    }

    if (
      !opts.dryRun &&
      (matched.status !== (lt.is_active ? 'active' : 'hidden') ||
        matched.hideFromOnline !== (!!lt.is_pos_only || !lt.is_active) ||
        matched.isCustomizable !== isCustomizable ||
        (thirdPartyVendorId && matched.thirdPartyVendorId !== thirdPartyVendorId) ||
        (!hasPacks &&
          matched.basePrice != null &&
          Number(matched.basePrice) !== Number(money3(lt.price))))
    ) {
      matched = await prisma.ticketType.update({
        where: { id: matched.id },
        data: {
          status: lt.is_active ? 'active' : 'hidden',
          hideFromOnline: !!lt.is_pos_only || !lt.is_active,
          isCustomizable,
          ...(!hasPacks
            ? {
                basePrice: money3(lt.price),
                iconType: 'simple',
                hasVariants: false,
              }
            : {}),
          ...(thirdPartyVendorId && matched.thirdPartyVendorId !== thirdPartyVendorId
            ? { thirdPartyVendorId }
            : {}),
        },
      });
    }

    const { variantsByPackId, result: variantResult } =
      await ensureVariantsForTicketType(
        prisma,
        matched.id,
        packs,
        !!opts.dryRun,
      );
    const { result: customizationResult } =
      await ensureCustomizationOptionsForTicketType(
        prisma,
        matched.id,
        activities,
        !!opts.dryRun,
      );

    if (isCustomizable && !activities.length) {
      warnings.push(
        `Ticket #${lt.id} "${lt.title}" is customizable but has no ticket_activities rows`,
      );
    }

    map.set(lt.id, {
      id: matched.id,
      title: matched.title,
      admitCount: matched.admitCount,
      isPosOnly: matched.hideFromOnline,
      isCafe,
      thirdPartyVendorId: matched.thirdPartyVendorId ?? thirdPartyVendorId,
      variantsByPackId,
    });
    result.push({
      oldTicketId: lt.id,
      oldTitle: lt.title,
      newTicketTypeId: matched.id,
      newTitle: matched.title,
      matchedBy,
      thirdPartyVendorId: matched.thirdPartyVendorId ?? thirdPartyVendorId,
      hasVariants: hasPacks,
      isCustomizable,
      variants: variantResult,
      customizations: customizationResult,
    });
  }

  return { map, result };
}

type AddonMapEntry = { id: string; title: string };

function mapAddonVisibility(applicableFor: string | null | undefined): {
  hideFromOnline: boolean;
  hideFromPos: boolean;
} {
  const value = (applicableFor || 'Both').trim().toLowerCase();
  if (value === 'offline') return { hideFromOnline: true, hideFromPos: false };
  if (value === 'online') return { hideFromOnline: false, hideFromPos: true };
  return { hideFromOnline: false, hideFromPos: false };
}

async function buildAddonMap(
  prisma: PrismaClient,
  eventId: string,
  catalog: LegacyAddonCatalog[],
  orphanRefs: Array<{ addon_id: number; title: string; price: number }>,
  dryRun: boolean,
): Promise<{
  map: Map<number, AddonMapEntry>;
  result: NonNullable<MigrateResult['addonMap']>;
}> {
  const byLegacyId = new Map<number, LegacyAddonCatalog>();
  for (const row of catalog) byLegacyId.set(row.id, row);
  for (const orphan of orphanRefs) {
    if (byLegacyId.has(orphan.addon_id)) continue;
    byLegacyId.set(orphan.addon_id, {
      id: orphan.addon_id,
      event_id: 0,
      title: orphan.title || `Addon #${orphan.addon_id}`,
      title_ar: null,
      price: orphan.price || 0,
      quantity: 0,
      description: null,
      for_cafe_only: false,
      applicable_for: 'Both',
    });
  }

  const map = new Map<number, AddonMapEntry>();
  const result: NonNullable<MigrateResult['addonMap']> = [];
  if (!byLegacyId.size) return { map, result };

  if (dryRun) {
    for (const row of byLegacyId.values()) {
      const fakeId = randomUUID();
      map.set(row.id, { id: fakeId, title: row.title });
      result.push({
        oldAddonId: row.id,
        oldTitle: row.title,
        newAddonId: fakeId,
        matchedBy: 'created',
      });
    }
    return { map, result };
  }

  const existing = await prisma.addon.findMany({ where: { eventId } });
  const byExternal = new Map(existing.map((a) => [a.externalKey, a]));

  for (const row of byLegacyId.values()) {
    const externalKey = legacyAddonExternalKey(row.id);
    let matched = byExternal.get(externalKey) ?? null;
    let matchedBy: 'externalKey' | 'created' = 'externalKey';
    const visibility = mapAddonVisibility(row.applicable_for);

    if (!matched) {
      matched = await prisma.addon.create({
        data: {
          eventId,
          externalKey,
          title: row.title.slice(0, 200) || `Addon ${row.id}`,
          titleAr: row.title_ar?.slice(0, 200) || null,
          subtitle: stripHtml(row.description)?.slice(0, 500) || null,
          forCafeOnly: row.for_cafe_only,
          hideFromOnline: visibility.hideFromOnline,
          hideFromPos: visibility.hideFromPos,
          hasVariants: false,
          basePrice: money3(row.price),
          currency: 'QAR',
          maxQtyPerOrder: row.quantity > 0 ? row.quantity : null,
          status: 'active',
          sortOrder: row.id,
        },
      });
      matchedBy = 'created';
      byExternal.set(externalKey, matched);
    }

    map.set(row.id, { id: matched.id, title: matched.title });
    result.push({
      oldAddonId: row.id,
      oldTitle: row.title,
      newAddonId: matched.id,
      matchedBy,
    });
  }

  return { map, result };
}

type TimeExtensionPackEntry = {
  id: string;
  title: string;
  title_ar: string;
  minutes: number;
  price: number;
  legacy_id: number;
};

async function seedTimeExtensionPacks(
  prisma: PrismaClient,
  eventId: string,
  catalog: LegacyTimeExtensionCatalog[],
  dryRun: boolean,
): Promise<{
  map: Map<number, TimeExtensionPackEntry>;
  result: NonNullable<MigrateResult['timeExtensionMap']>;
}> {
  const map = new Map<number, TimeExtensionPackEntry>();
  const result: NonNullable<MigrateResult['timeExtensionMap']> = [];
  if (!catalog.length) return { map, result };

  const packs: TimeExtensionPackEntry[] = catalog.map((row) => ({
    id: legacyTimeExtensionPackId(row.id),
    title: row.title_en.slice(0, 120) || `Time Extension #${row.id}`,
    title_ar: (row.title_ar || '').slice(0, 120),
    minutes: Math.max(1, Math.round(row.duration || 1)),
    price: Number(row.price || 0),
    legacy_id: row.id,
  }));

  for (const pack of packs) {
    map.set(pack.legacy_id, pack);
    result.push({
      oldExtensionId: pack.legacy_id,
      oldTitle: pack.title,
      newPackId: pack.id,
      minutes: pack.minutes,
      matchedBy: 'created',
    });
  }

  if (dryRun) return { map, result };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { moreOpsConfig: true },
  });
  const base =
    event?.moreOpsConfig &&
    typeof event.moreOpsConfig === 'object' &&
    !Array.isArray(event.moreOpsConfig)
      ? { ...(event.moreOpsConfig as Record<string, unknown>) }
      : {};

  const existingRaw = Array.isArray(base.time_extensions)
    ? (base.time_extensions as Array<Record<string, unknown>>)
    : [];
  const byLegacyId = new Map<number, Record<string, unknown>>();
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of existingRaw) {
    if (typeof row?.id === 'string') byId.set(row.id, row);
    if (row?.legacy_id != null && Number.isFinite(Number(row.legacy_id))) {
      byLegacyId.set(Number(row.legacy_id), row);
    }
  }

  const merged: Array<Record<string, unknown>> = [...existingRaw];
  for (const pack of packs) {
    const existing =
      byLegacyId.get(pack.legacy_id) ?? byId.get(pack.id) ?? null;
    if (existing) {
      existing.id = pack.id;
      existing.legacy_id = pack.legacy_id;
      existing.title = pack.title;
      existing.title_ar = pack.title_ar;
      existing.minutes = pack.minutes;
      existing.price = pack.price;
      const idx = result.findIndex((r) => r.oldExtensionId === pack.legacy_id);
      if (idx >= 0) result[idx].matchedBy = 'legacy_id';
      continue;
    }
    merged.push({
      id: pack.id,
      legacy_id: pack.legacy_id,
      title: pack.title,
      title_ar: pack.title_ar,
      minutes: pack.minutes,
      price: pack.price,
    });
  }

  await prisma.event.update({
    where: { id: eventId },
    data: {
      moreOpsConfig: {
        ...base,
        time_extensions: merged,
      } as Prisma.InputJsonValue,
    },
  });

  return { map, result };
}

function resolveAddonProductId(
  addonMap: Map<number, AddonMapEntry>,
  addonId: number | null | undefined,
  fallbackTitle?: string,
): { itemId: string; displayName: string; legacyAddonId: number | null } {
  if (addonId != null && addonMap.has(addonId)) {
    const entry = addonMap.get(addonId)!;
    return {
      itemId: entry.id,
      displayName: entry.title,
      legacyAddonId: addonId,
    };
  }
  return {
    itemId: randomUUID(),
    displayName: fallbackTitle || 'Addon',
    legacyAddonId: addonId ?? null,
  };
}

function resolveTimeExtensionLines(
  te: LegacyTimeExtensionPurchase,
  teMap: Map<number, TimeExtensionPackEntry>,
): Array<{
  itemId: string;
  displayName: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  legacyExtensionId: number | null;
  minutes: number;
}> {
  const snapshot = te.extension_snapshot ?? [];
  if (snapshot.length > 0) {
    return snapshot.map((item: LegacyTimeExtensionSnapshotItem) => {
      const mapped =
        item.time_extension_id != null
          ? teMap.get(item.time_extension_id)
          : undefined;
      const minutes = item.duration || mapped?.minutes || 0;
      const title =
        mapped?.title ||
        item.title_en ||
        (minutes > 0 ? `Time Extension (${minutes} min)` : 'Time Extension');
      const unitPrice = Number(item.price || mapped?.price || 0);
      return {
        itemId: mapped?.id ?? randomUUID(),
        displayName: title,
        quantity: 1,
        unitPrice,
        totalAmount: unitPrice,
        legacyExtensionId: item.time_extension_id,
        minutes,
      };
    });
  }

  const byMinutes =
    te.total_duration_minutes > 0
      ? [...teMap.values()].find(
          (pack) => pack.minutes === te.total_duration_minutes,
        )
      : undefined;
  const minutes = te.total_duration_minutes || byMinutes?.minutes || 0;
  return [
    {
      itemId: byMinutes?.id ?? randomUUID(),
      displayName:
        byMinutes?.title ||
        (minutes > 0 ? `Time Extension (${minutes} min)` : 'Time Extension'),
      quantity: 1,
      unitPrice: Number(te.total_amount || 0),
      totalAmount: Number(te.total_amount || 0),
      legacyExtensionId: byMinutes?.legacy_id ?? null,
      minutes,
    },
  ];
}

async function ensureSession(
  prisma: PrismaClient,
  eventId: string,
  dateStr: string | null,
  timeStr: string | null,
  cache: Map<string, string>,
  dryRun: boolean,
  endTimeStr?: string | null,
) {
  const dateKey =
    legacyDateOnlyQatar(dateStr) ||
    legacyDateOnlyQatar(new Date()) ||
    new Date().toISOString().slice(0, 10);
  const date = parseDateOnly(dateKey)!;
  const displayTime = formatDisplayTime(timeStr);
  const key = `${dateKey}|${displayTime}`;
  const cached = cache.get(key);
  if (cached) return cached;

  if (dryRun) {
    const fake = `dry-session-${cache.size + 1}`;
    cache.set(key, fake);
    return fake;
  }

  let eventDate = await prisma.eventDate.findFirst({
    where: { eventId, date },
  });
  if (!eventDate) {
    eventDate = await prisma.eventDate.create({
      data: { eventId, date, status: 'active' },
    });
  }

  let session = await prisma.eventSession.findFirst({
    where: { eventId, eventDateId: eventDate.id, displayTime },
  });
  if (!session) {
    const parseHm = (raw: string | null | undefined, fallbackH: number, fallbackM: number) => {
      const display = formatDisplayTime(raw);
      const ampm = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(display);
      const hhmm = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(raw || '').trim());
      if (ampm) {
        let hour = Number(ampm[1]) % 12;
        if (ampm[3].toUpperCase() === 'PM') hour += 12;
        return { hour, minute: Number(ampm[2]) };
      }
      if (hhmm) return { hour: Number(hhmm[1]), minute: Number(hhmm[2]) };
      return { hour: fallbackH, minute: fallbackM };
    };
    const startHm = parseHm(timeStr, 10, 0);
    const endHm = endTimeStr ? parseHm(endTimeStr, startHm.hour, startHm.minute) : null;
    const startsAt = new Date(
      `${dateKey}T${String(startHm.hour).padStart(2, '0')}:${String(startHm.minute).padStart(2, '0')}:00+03:00`,
    );
    const endsAt = endHm
      ? new Date(
          `${dateKey}T${String(endHm.hour).padStart(2, '0')}:${String(endHm.minute).padStart(2, '0')}:00+03:00`,
        )
      : null;
    session = await prisma.eventSession.create({
      data: {
        eventId,
        eventDateId: eventDate.id,
        startsAt,
        endsAt,
        displayTime,
        status: 'active',
      },
    });
  }

  cache.set(key, session.id);
  return session.id;
}

async function ensureCustomers(
  prisma: PrismaClient,
  lines: LegacyBookingLine[],
  dryRun: boolean,
) {
  const byEmail = new Map<string, { name: string; phone: string | null }>();
  for (const line of lines) {
    const email = safeEmail(line.customer_email, line.common_order);
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        name: line.customer_name || 'Guest',
        phone: safePhone(line.customer_phone),
      });
    }
  }

  const emails = [...byEmail.keys()];
  const existing = dryRun
    ? []
    : await prisma.user.findMany({
        where: { email: { in: emails } },
        select: { id: true, email: true },
      });
  const idByEmail = new Map(existing.map((u) => [u.email.toLowerCase(), u.id]));

  let created = 0;
  const phoneTaken = new Set<string>();
  if (!dryRun) {
    const phones = [...byEmail.values()].map((v) => v.phone).filter(Boolean) as string[];
    if (phones.length) {
      const phoneUsers = await prisma.user.findMany({
        where: { phone: { in: phones } },
        select: { phone: true },
      });
      for (const u of phoneUsers) if (u.phone) phoneTaken.add(u.phone);
    }
  }

  for (const [email, info] of byEmail) {
    if (idByEmail.has(email)) continue;
    if (dryRun) {
      idByEmail.set(email, `dry-user-${created + 1}`);
      created += 1;
      continue;
    }
    let phone = info.phone;
    if (phone && phoneTaken.has(phone)) phone = null;
    try {
      const user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email,
          name: info.name.slice(0, 190) || 'Guest',
          phone,
          status: 'active',
        },
      });
      idByEmail.set(email, user.id);
      if (phone) phoneTaken.add(phone);
      created += 1;
      await prisma.customerProfile.createMany({
        data: [{ userId: user.id, defaultLocale: 'en' }],
        skipDuplicates: true,
      });
    } catch (err: unknown) {
      // Race / unique collision — reload
      const again = await prisma.user.findUnique({ where: { email } });
      if (!again) throw err;
      idByEmail.set(email, again.id);
    }
  }

  return { idByEmail, created, uniqueEmails: emails.length };
}

async function ensureStaffUsers(
  prisma: PrismaClient,
  legacyUsers: LegacyStaffUser[],
  dryRun: boolean,
) {
  const byLegacyId = new Map<number, { userId: string; email: string }>();
  if (!legacyUsers.length) return { byLegacyId, created: 0 };

  let created = 0;
  for (const lu of legacyUsers) {
    const email = safeEmail(lu.email, `staff-${lu.id}`);
    if (dryRun) {
      byLegacyId.set(lu.id, { userId: `dry-staff-${lu.id}`, email });
      created += 1;
      continue;
    }

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      let phone = safePhone(lu.phone);
      if (phone) {
        const taken = await prisma.user.findFirst({
          where: { phone },
          select: { id: true },
        });
        if (taken) phone = null;
      }
      user = await prisma.user.create({
        data: {
          id: randomUUID(),
          email,
          name: (lu.name || `User ${lu.id}`).slice(0, 190),
          phone,
          status: 'active',
        },
      });
      created += 1;
    }
    byLegacyId.set(lu.id, { userId: user.id, email: user.email });
  }

  return { byLegacyId, created };
}

async function ensureThirdPartyVendors(
  prisma: PrismaClient,
  eventId: string,
  groups: LegacyOrganiserGroup[],
  dryRun: boolean,
) {
  const byLegacyId = new Map<number, string>();
  const result: NonNullable<MigrateResult['thirdPartyVendors']> = [];
  if (!groups.length) return { byLegacyId, result, created: 0 };

  const existing = dryRun
    ? []
    : await prisma.thirdPartyVendor.findMany({ where: { eventId } });
  const byName = new Map(existing.map((s) => [s.name.trim().toLowerCase(), s]));
  /** A vendor row may only be claimed by one legacy organiser_groups.id. */
  const claimedVendorIds = new Set<string>();
  const claimedNames = new Set(existing.map((s) => s.name.trim().toLowerCase()));
  let created = 0;
  let sortOrder = existing.reduce((max, s) => Math.max(max, s.sortOrder), 0);

  for (const g of groups) {
    const baseName =
      (g.name || `Group ${g.id}`).trim().slice(0, 180) || `Group ${g.id}`;
    const altName = `${baseName} (#${g.id})`.slice(0, 190);

    // Prefer the disambiguated name first so re-runs stay tied to legacy id.
    // Never reuse a bare display name already claimed by another legacy group —
    // same shareholder name across sibling/legacy events must get different V2 ids.
    let name = altName;
    let share = byName.get(altName.toLowerCase()) ?? null;
    if (share && claimedVendorIds.has(share.id)) share = null;

    if (!share) {
      const bare = byName.get(baseName.toLowerCase()) ?? null;
      if (bare && !claimedVendorIds.has(bare.id)) {
        share = bare;
        name = baseName;
      }
    }

    if (!share) {
      // Prefer clean display name when free; otherwise keep legacy-id suffix.
      name = claimedNames.has(baseName.toLowerCase()) ? altName : baseName;
      if (dryRun) {
        const fakeId = `dry-share-${g.id}`;
        byLegacyId.set(g.id, fakeId);
        claimedVendorIds.add(fakeId);
        claimedNames.add(name.toLowerCase());
        result.push({
          legacyId: g.id,
          name,
          thirdPartyVendorId: fakeId,
          created: true,
        });
        created += 1;
        continue;
      }
      sortOrder += 1;
      share = await prisma.thirdPartyVendor.create({
        data: {
          eventId,
          name: name.slice(0, 190),
          isMain: !!g.is_main,
          organiserShare: Number(g.org_share || 0).toFixed(2),
          vendorSharePct: Number(g.third_share || 0).toFixed(2),
          isCafe: !!g.is_cafe,
          collectedBy: g.collected_by?.slice(0, 190) || null,
          ownerName: g.owner_name?.slice(0, 190) || null,
          ownerPercentageType: g.owner_percentage_type?.slice(0, 64) || null,
          sortOrder,
        },
      });
      byName.set(share.name.toLowerCase(), share);
      claimedNames.add(share.name.toLowerCase());
      created += 1;
      result.push({
        legacyId: g.id,
        name: share.name,
        thirdPartyVendorId: share.id,
        created: true,
      });
    } else {
      if (!dryRun) {
        await prisma.thirdPartyVendor.update({
          where: { id: share.id },
          data: {
            isMain: !!g.is_main,
            organiserShare: Number(g.org_share || 0).toFixed(2),
            vendorSharePct: Number(g.third_share || 0).toFixed(2),
            isCafe: !!g.is_cafe,
            collectedBy: g.collected_by?.slice(0, 190) || null,
            ownerName: g.owner_name?.slice(0, 190) || null,
            ownerPercentageType: g.owner_percentage_type?.slice(0, 64) || null,
          },
        });
      }
      result.push({
        legacyId: g.id,
        name: share.name,
        thirdPartyVendorId: share.id,
        created: false,
      });
    }
    claimedVendorIds.add(share.id);
    claimedNames.add(share.name.toLowerCase());
    byLegacyId.set(g.id, share.id);
  }

  return { byLegacyId, result, created };
}

async function attachOrganiserToEvent(
  prisma: PrismaClient,
  args: {
    eventId: string;
    organizationId: string;
    organiserUserId: string | null;
    dryRun: boolean;
  },
) {
  if (!args.organiserUserId || args.dryRun) return;
  await prisma.event.update({
    where: { id: args.eventId },
    data: {
      createdByUserId: args.organiserUserId,
      primaryOrganizerId: args.organiserUserId,
      organizerAssignedAt: new Date(),
    },
  });
  await prisma.organizationMember.createMany({
    data: [
      {
        organizationId: args.organizationId,
        userId: args.organiserUserId,
        role: 'owner',
        status: 'active',
      },
    ],
    skipDuplicates: true,
  });

  // Panel login requires AdminProfile + panel.access — org membership alone is not enough.
  const organiserRole = await prisma.role.findUnique({
    where: { name: 'organiser' },
    select: { id: true },
  });
  if (organiserRole) {
    await prisma.adminProfile.upsert({
      where: { userId: args.organiserUserId },
      update: { status: 'active' },
      create: {
        userId: args.organiserUserId,
        roleId: organiserRole.id,
        status: 'active',
      },
    });
  }
}

async function ensurePosStaffAssignments(
  prisma: PrismaClient,
  args: {
    organizationId: string;
    eventId: string;
    agentUserIds: string[];
    managedByUserId: string | null;
    dryRun: boolean;
  },
) {
  if (args.dryRun || !args.agentUserIds.length) return 0;
  const posRole = await prisma.role.findUnique({ where: { name: 'pos' } });
  if (!posRole) return 0;

  let created = 0;
  for (const userId of args.agentUserIds) {
    const existing = await prisma.staffAssignment.findFirst({
      where: {
        userId,
        eventId: args.eventId,
        roleId: posRole.id,
        status: 'active',
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.staffAssignment.create({
        data: {
          userId,
          roleId: posRole.id,
          organizationId: args.organizationId,
          eventId: args.eventId,
          managedByUserId: args.managedByUserId,
          thirdPartyVendorIds: [],
          ticketTypeIds: [],
          status: 'active',
        },
      });
      created += 1;
    }
    await prisma.adminProfile.upsert({
      where: { userId },
      update: { status: 'active' },
      create: { userId, roleId: posRole.id, status: 'active' },
    });
  }
  return created;
}

async function ensureSyntheticTicketType(
  prisma: PrismaClient,
  args: {
    eventId: string;
    externalKey: string;
    title: string;
    dryRun: boolean;
    thirdPartyVendorId?: string | null;
  },
): Promise<{ id: string; title: string; thirdPartyVendorId: string | null }> {
  if (args.dryRun) {
    return {
      id: `dry-${args.externalKey}`,
      title: args.title,
      thirdPartyVendorId: args.thirdPartyVendorId ?? null,
    };
  }
  const existing = await prisma.ticketType.findFirst({
    where: { eventId: args.eventId, externalKey: args.externalKey },
    select: { id: true, title: true, thirdPartyVendorId: true },
  });
  if (existing) {
    return {
      id: existing.id,
      title: existing.title,
      thirdPartyVendorId: existing.thirdPartyVendorId,
    };
  }
  const created = await prisma.ticketType.create({
    data: {
      eventId: args.eventId,
      externalKey: args.externalKey,
      title: args.title,
      basePrice: money3(0),
      admitCount: 1,
      hideFromOnline: true,
      status: 'active',
      thirdPartyVendorId: args.thirdPartyVendorId ?? null,
    },
  });
  return {
    id: created.id,
    title: created.title,
    thirdPartyVendorId: created.thirdPartyVendorId,
  };
}

async function ensureGuestCustomerId(
  prisma: PrismaClient,
  seed: string,
  name: string,
  dryRun: boolean,
  idByEmail: Map<string, string>,
): Promise<string> {
  const email = guestEmail(seed);
  const existing = idByEmail.get(email);
  if (existing) return existing;
  if (dryRun) {
    const fake = `dry-guest-${seed}`;
    idByEmail.set(email, fake);
    return fake;
  }
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        id: randomUUID(),
        email,
        name: (name || 'Legacy Guest').slice(0, 190),
        status: 'active',
      },
    });
    await prisma.customerProfile.createMany({
      data: [{ userId: user.id, defaultLocale: 'en' }],
      skipDuplicates: true,
    });
  }
  idByEmail.set(email, user.id);
  return user.id;
}

export async function migrateEvent(
  prisma: PrismaClient,
  opts: MigrateOptions,
): Promise<MigrateResult> {
  const { primary, eventIds, commonEventId } = await resolveLegacyEventIds(opts.oldEvent);
  const metrics = await getLegacyMetrics(eventIds, commonEventId);
  const legacyTickets = await loadLegacyTickets(eventIds);
  const legacyPacks = await loadLegacyPlaytimePacks(legacyTickets.map((t) => t.id));
  const packsByTicket = packsByTicketId(legacyPacks);
  const legacyActivities = await loadLegacyTicketActivities(
    legacyTickets.map((t) => t.id),
  );
  const activitiesByTicket = activitiesByTicketId(legacyActivities);
  const warnings: string[] = [];
  const bookings = await loadLegacyBookings(eventIds);
  const ordersMap = groupByCommonOrder(bookings);
  const commonOrders = [...ordersMap.keys()];
  const splitSet = await loadSplitCommonOrders(commonOrders);
  const addons = opts.includeAddons === false
    ? []
    : await loadLegacyAddonsForOrders(eventIds, commonOrders);
  const addonsByOrder = new Map<string, typeof addons>();
  for (const a of addons) {
    if (!a.common_order) continue;
    const list = addonsByOrder.get(a.common_order) ?? [];
    list.push(a);
    addonsByOrder.set(a.common_order, list);
  }

  const includeSeparateAddons = opts.includeSeparateAddons !== false;
  const includeCafeClosings = opts.includeCafeClosings !== false;
  const includeE3 = opts.includeE3 !== false;
  const includeTimeExtensions = opts.includeTimeExtensions !== false;

  const separateAddons = includeSeparateAddons ? await loadSeparateAddons(eventIds) : [];
  const cafeClosings = includeCafeClosings ? await loadPosCafeClosings(eventIds) : [];
  const e3Bookings = includeE3 ? await loadE3Bookings(commonEventId) : [];
  const timeExtensions = includeTimeExtensions
    ? await loadTimeExtensionPurchases(eventIds)
    : [];

  const target = await ensureTargetEvent(prisma, opts, primary);
  const event = target.event;

  let timingResult: MigrateResult['timing'];
  try {
    const legacyTiming = await loadLegacyEventTiming(primary.id);
    const timingDto = legacyTiming ? mapLegacyTimingToApplyDto(legacyTiming) : null;
    if (timingDto && !opts.dryRun) {
      const existingConfig = await prisma.$queryRawUnsafe<Array<{ timing_config: unknown }>>(
        `SELECT timing_config FROM events WHERE id = $1::uuid`,
        event.id,
      );
      const hasConfig = existingConfig[0]?.timing_config != null;
      const shouldApply = target.created || !!opts.force || !hasConfig;
      if (shouldApply) {
        const applied = await materializeTimingOnEvent(prisma, event.id, timingDto);
        timingResult = {
          mode: applied.mode,
          sessionsCreated: applied.sessionsCreated,
          sessionsRemoved: applied.sessionsRemoved,
          applied: true,
        };
      } else {
        warnings.push(
          'Skipped importing event schedule — target already has timing_config. Pass --force to replace.',
        );
        timingResult = {
          mode: timingDto.mode,
          sessionsCreated: 0,
          sessionsRemoved: 0,
          applied: false,
        };
      }
    } else if (timingDto && opts.dryRun) {
      timingResult = {
        mode: timingDto.mode,
        sessionsCreated: 0,
        sessionsRemoved: 0,
        applied: false,
      };
    } else if (!timingDto) {
      warnings.push('No legacy event_timing / preferred window found to import as schedule.');
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    warnings.push(`Failed to import legacy event schedule: ${message}`);
  }

  const organiserGroups = await loadLegacyOrganiserGroups(eventIds);
  const cafeOrgGroupIds = new Set(
    organiserGroups.filter((g) => g.is_cafe).map((g) => g.id),
  );
  const posLegacyIds = [
    ...new Set(
      [
        ...bookings.map((b) => b.pos_id),
        ...cafeClosings.map((c) => c.agent_id),
        ...separateAddons.map((a) => a.booked_by),
        ...timeExtensions.map((t) => t.agent_id),
      ].filter((id): id is number => id != null && id > 0),
    ),
  ];
  const staffLegacyIds = [
    ...new Set(
      [primary.user_id, ...posLegacyIds].filter(
        (id): id is number => id != null && id > 0,
      ),
    ),
  ];
  const legacyStaff = await loadLegacyStaffUsers(staffLegacyIds);
  const staffUsers = await ensureStaffUsers(prisma, legacyStaff, !!opts.dryRun);
  const organiserRef = primary.user_id
    ? staffUsers.byLegacyId.get(primary.user_id) ?? null
    : null;

  await attachOrganiserToEvent(prisma, {
    eventId: event.id,
    organizationId: event.organizationId,
    organiserUserId: organiserRef?.userId ?? null,
    dryRun: !!opts.dryRun,
  });

  const thirdPartyVendors = await ensureThirdPartyVendors(
    prisma,
    event.id,
    organiserGroups,
    !!opts.dryRun,
  );

  // Include sold tickets, booking-referenced tickets, playtime-pack tickets,
  // and customizable tickets (so activities become customization options).
  // Cafe org-group tickets become Cafe menu categories/items — not TicketTypes.
  const ticketsForMap = legacyTickets.filter(
    (t) =>
      !cafeOrgGroupIds.has(t.org_group_id) &&
      (t.sold_qty > 0 ||
        bookings.some((b) => b.ticket_id === t.id) ||
        (packsByTicket.get(t.id)?.length ?? 0) > 0 ||
        !!t.is_customizable),
  );

  const cafeTicketsForCatalog = legacyTickets.filter((t) =>
    cafeOrgGroupIds.has(t.org_group_id),
  );

  const orphanCafeTickets = (() => {
    const seen = new Set(cafeTicketsForCatalog.map((t) => t.id));
    const orphans: Array<{
      id: number;
      title: string;
      price: number;
      org_group_id: number;
    }> = [];
    for (const line of bookings) {
      const isCafe =
        !!line.is_cafe || cafeOrgGroupIds.has(line.ticket_org_group_id);
      if (!isCafe || seen.has(line.ticket_id)) continue;
      seen.add(line.ticket_id);
      orphans.push({
        id: line.ticket_id,
        title: line.ticket_title || `Ticket ${line.ticket_id}`,
        price: Number(line.ticket_price || line.price || 0),
        org_group_id: line.ticket_org_group_id,
      });
    }
    return orphans;
  })();

  const cafeCatalog = await ensureCafeCatalogs({
    prisma,
    organizationId: event.organizationId,
    eventId: event.id,
    cafeGroups: organiserGroups.filter((g) => g.is_cafe),
    cafeTickets: cafeTicketsForCatalog,
    packs: legacyPacks,
    thirdPartyVendorByLegacyId: thirdPartyVendors.byLegacyId,
    orphanCafeTickets,
    dryRun: !!opts.dryRun,
  });

  const { map: ticketMap, result: ticketMapResult } = await buildTicketMap(
    prisma,
    event.id,
    ticketsForMap,
    packsByTicket,
    activitiesByTicket,
    { ...opts, createMissingTickets: opts.createMissingTickets !== false },
    thirdPartyVendors.byLegacyId,
    cafeOrgGroupIds,
    warnings,
  );

  const addonCatalog = await loadLegacyAddonCatalog(eventIds);
  const teCatalog = await loadLegacyTimeExtensionCatalog(eventIds);
  const orphanAddonRefs: Array<{ addon_id: number; title: string; price: number }> =
    [];
  const seenOrphanAddon = new Set<number>();
  for (const row of [...addons, ...separateAddons]) {
    const addonId = 'addon_id' in row ? row.addon_id : null;
    if (addonId == null || seenOrphanAddon.has(addonId)) continue;
    if (addonCatalog.some((c) => c.id === addonId)) continue;
    seenOrphanAddon.add(addonId);
    orphanAddonRefs.push({
      addon_id: addonId,
      title: row.title,
      price: row.price,
    });
  }
  const { map: addonMap, result: addonMapResult } = await buildAddonMap(
    prisma,
    event.id,
    addonCatalog,
    orphanAddonRefs,
    !!opts.dryRun,
  );
  const { map: timeExtensionMap, result: timeExtensionMapResult } =
    await seedTimeExtensionPacks(prisma, event.id, teCatalog, !!opts.dryRun);

  // Also cover tickets that appear on bookings but not in tickets table (edge).
  // Skip cafe lines — those are covered by cafeCatalog.
  for (const line of bookings) {
    if (ticketMap.has(line.ticket_id)) continue;
    if (cafeCatalog.byTicketId.has(line.ticket_id)) continue;
    const isCafe =
      !!line.is_cafe || cafeOrgGroupIds.has(line.ticket_org_group_id);
    if (isCafe) continue;
    const thirdPartyVendorId =
      line.ticket_org_group_id > 0
        ? thirdPartyVendors.byLegacyId.get(line.ticket_org_group_id) ?? null
        : null;
    const orphanPacks = packsByTicket.get(line.ticket_id) ?? [];
    if (opts.dryRun) {
      const fakeId = `dry-orphan-${line.ticket_id}`;
      const { variantsByPackId, result: variantResult } =
        await ensureVariantsForTicketType(prisma, fakeId, orphanPacks, true);
      ticketMap.set(line.ticket_id, {
        id: fakeId,
        title: line.ticket_title,
        admitCount: line.admits || 1,
        isPosOnly: !!line.is_pos_only,
        isCafe: false,
        thirdPartyVendorId,
        variantsByPackId,
      });
      ticketMapResult.push({
        oldTicketId: line.ticket_id,
        oldTitle: line.ticket_title,
        newTicketTypeId: fakeId,
        newTitle: line.ticket_title,
        matchedBy: 'created',
        thirdPartyVendorId,
        hasVariants: orphanPacks.length > 0,
        variants: variantResult,
      });
      continue;
    }
    if (opts.createMissingTickets === false) {
      throw new Error(`Booking references missing ticket #${line.ticket_id} (${line.ticket_title})`);
    }
    const created = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        externalKey: legacyTicketExternalKey(line.ticket_id),
        title: line.ticket_title || `Ticket ${line.ticket_id}`,
        iconType: orphanPacks.length ? 'variants' : 'simple',
        hasVariants: orphanPacks.length > 0,
        basePrice: orphanPacks.length ? null : money3(line.ticket_price),
        admitCount: line.admits || 1,
        hideFromOnline: !!line.is_pos_only,
        status: 'active',
        thirdPartyVendorId,
      },
    });
    const { variantsByPackId, result: variantResult } =
      await ensureVariantsForTicketType(
        prisma,
        created.id,
        orphanPacks,
        false,
      );
    ticketMap.set(line.ticket_id, {
      id: created.id,
      title: created.title,
      admitCount: created.admitCount,
      isPosOnly: created.hideFromOnline,
      isCafe: false,
      thirdPartyVendorId: created.thirdPartyVendorId,
      variantsByPackId,
    });
    ticketMapResult.push({
      oldTicketId: line.ticket_id,
      oldTitle: line.ticket_title,
      newTicketTypeId: created.id,
      newTitle: created.title,
      matchedBy: 'created',
      thirdPartyVendorId: created.thirdPartyVendorId,
      hasVariants: orphanPacks.length > 0,
      variants: variantResult,
    });
  }

  const cafeAgentsByOrgGroup = collectCafeAgentsByOrgGroup({
    bookings,
    cafeOrgGroupIds,
    staffByLegacyId: staffUsers.byLegacyId,
    closingAgentLegacyIds: cafeClosings
      .map((c) => c.agent_id)
      .filter((id): id is number => id != null && id > 0),
  });
  await ensureCafePosAgents({
    prisma,
    organizationId: event.organizationId,
    eventId: event.id,
    cafeCatalog,
    agentsByOrgGroupId: cafeAgentsByOrgGroup,
    managedByUserId: organiserRef?.userId ?? null,
    dryRun: !!opts.dryRun,
  });

  const posAgentUserIds = [
    ...new Set(
      posLegacyIds
        .map((id) => staffUsers.byLegacyId.get(id)?.userId)
        .filter((id): id is string => !!id),
    ),
  ];
  await ensurePosStaffAssignments(prisma, {
    organizationId: event.organizationId,
    eventId: event.id,
    agentUserIds: posAgentUserIds,
    managedByUserId: organiserRef?.userId ?? null,
    dryRun: !!opts.dryRun,
  });

  const customers = await ensureCustomers(prisma, bookings, !!opts.dryRun);
  const sessionCache = new Map<string, string>();
  const agentDominantVendor = buildAgentDominantVendorMap(
    bookings,
    staffUsers.byLegacyId,
    thirdPartyVendors.byLegacyId,
    cafeOrgGroupIds,
  );
  const mainLegacyGroup = organiserGroups.find((g) => g.is_main) ?? organiserGroups[0];
  const mainVendorId = mainLegacyGroup
    ? thirdPartyVendors.byLegacyId.get(mainLegacyGroup.id) ?? null
    : null;

  // Planned unique keys for all streams (common_order is globally unique in V2).
  const plannedBookingCommons = commonOrders.map(legacyCommonOrder);
  const plannedBookingIdems = commonOrders.map(legacyIdempotencyKey);
  const plannedAddonCommons = separateAddons.map((a) => legacySeparateAddonCommonOrder(a.id));
  const plannedAddonIdems = separateAddons.map((a) => legacySeparateAddonIdempotencyKey(a.id));
  const plannedCafeCommons = cafeClosings.map((c) => legacyCafeCommonOrder(c.id));
  const plannedCafeIdems = cafeClosings.map((c) => legacyCafeIdempotencyKey(c.id));
  const plannedE3Commons = e3Bookings.map((e) => legacyE3CommonOrder(e.id));
  const plannedE3Idems = e3Bookings.map((e) => legacyE3IdempotencyKey(e.id));
  const plannedTeCommons = timeExtensions.map((t) => legacyTimeExtensionCommonOrder(t.id));
  const plannedTeIdems = timeExtensions.map((t) => legacyTimeExtensionIdempotencyKey(t.id));

  const allPlannedIdems = [
    ...plannedBookingIdems,
    ...plannedAddonIdems,
    ...plannedCafeIdems,
    ...plannedE3Idems,
    ...plannedTeIdems,
  ];
  const allPlannedCommons = [
    ...plannedBookingCommons,
    ...plannedAddonCommons,
    ...plannedCafeCommons,
    ...plannedE3Commons,
    ...plannedTeCommons,
  ];

  async function deleteOrdersByKeys(idemKeys: string[], commonOrdersKeys: string[]) {
    const chunk = 500;
    for (let i = 0; i < idemKeys.length; i += chunk) {
      await prisma.order.deleteMany({
        where: { idempotencyKey: { in: idemKeys.slice(i, i + chunk) } },
      });
    }
    for (let i = 0; i < commonOrdersKeys.length; i += chunk) {
      await prisma.order.deleteMany({
        where: { commonOrder: { in: commonOrdersKeys.slice(i, i + chunk) } },
      });
    }
  }

  // Prefetch existing rows by idem OR common_order (may live on another V2 event).
  // Skip when --force: we delete those keys next.
  const existingIdem = new Set<string>();
  const existingCommon = new Set<string>();
  if (!opts.dryRun && !opts.force && allPlannedIdems.length) {
    const chunk = 500;
    for (let i = 0; i < allPlannedIdems.length; i += chunk) {
      const slice = allPlannedIdems.slice(i, i + chunk);
      const rows = await prisma.order.findMany({
        where: { idempotencyKey: { in: slice } },
        select: { idempotencyKey: true, commonOrder: true },
      });
      for (const r of rows) {
        existingIdem.add(r.idempotencyKey);
        existingCommon.add(r.commonOrder);
      }
    }
    for (let i = 0; i < allPlannedCommons.length; i += chunk) {
      const slice = allPlannedCommons.slice(i, i + chunk);
      const rows = await prisma.order.findMany({
        where: { commonOrder: { in: slice } },
        select: { idempotencyKey: true, commonOrder: true },
      });
      for (const r of rows) {
        existingIdem.add(r.idempotencyKey);
        existingCommon.add(r.commonOrder);
      }
    }
  }

  if (opts.force && !opts.dryRun) {
    // common_order / idempotency_key are globally unique — clear prior imports
    // for these legacy keys on ANY V2 event (create-event + force used to only
    // wipe the new empty event and then collide with the previous import).
    await deleteOrdersByKeys(allPlannedIdems, allPlannedCommons);
    existingIdem.clear();
    existingCommon.clear();
  }

  let ordersCreated = 0;
  let ordersSkipped = 0;
  const warnedMissingPacks = new Set<string>();
  let orderItemsCreated = 0;
  let paymentsCreated = 0;
  let plannedItems = 0;
  let plannedPayments = 0;

  const orderCreates: Prisma.OrderCreateManyInput[] = [];
  const itemCreates: Prisma.OrderItemCreateManyInput[] = [];
  const paymentCreates: Prisma.PaymentCreateManyInput[] = [];
  const FLUSH_EVERY = 250;

  function shouldSkipLegacyOrder(idem: string, commonOrderNew: string) {
    return existingIdem.has(idem) || existingCommon.has(commonOrderNew);
  }

  function markOrderQueued(idem: string, commonOrderNew: string) {
    // Prevent duplicates within the same run / flush batch.
    existingIdem.add(idem);
    existingCommon.add(commonOrderNew);
  }

  async function flushPendingCreates() {
    if (opts.dryRun || !orderCreates.length) return;
    const chunk = 200;
    const orders = orderCreates.splice(0, orderCreates.length);
    const items = itemCreates.splice(0, itemCreates.length);
    const pays = paymentCreates.splice(0, paymentCreates.length);
    for (let i = 0; i < orders.length; i += chunk) {
      await prisma.order.createMany({
        data: orders.slice(i, i + chunk),
        skipDuplicates: true,
      });
    }
    for (let i = 0; i < items.length; i += chunk) {
      await prisma.orderItem.createMany({ data: items.slice(i, i + chunk) });
    }
    for (let i = 0; i < pays.length; i += chunk) {
      await prisma.payment.createMany({ data: pays.slice(i, i + chunk) });
    }
  }

  for (const [commonOrder, lines] of ordersMap) {
    plannedItems += lines.length;
    const orderAddons = addonsByOrder.get(commonOrder) ?? [];
    plannedItems += orderAddons.length;

    const first = lines[0]!;
    const ticketNet = lines.reduce((s, l) => s + Number(l.net_price || 0), 0);
    const ticketGross = lines.reduce(
      (s, l) => s + Number(l.price || 0) * Number(l.quantity || 1),
      0,
    );
    const ticketDiscount = lines.reduce((s, l) => s + legacyLineDiscount(l), 0);
    const promoCode =
      lines.map((l) => (l.promocode || '').trim()).find((c) => c.length > 0) || null;
    const promoCodeId =
      lines.map((l) => l.promocode_id).find((id) => id != null && Number(id) > 0) ?? null;
    // Prefer real addon table totals; fallback to denormalized first-row addon_price
    const addonNet = orderAddons.length
      ? orderAddons.reduce((s, a) => s + Number(a.total || 0), 0)
      : Number(first.addon_price || 0);
    const totalAmount = ticketNet + addonNet;
    // Cafe org-group lines keep revenue but do not count as tickets/admits
    const totalQty = lines.reduce((s, l) => {
      const isCafe = !!l.is_cafe || cafeOrgGroupIds.has(l.ticket_org_group_id);
      return isCafe ? s : s + Number(l.quantity || 0);
    }, 0);
    const totalAdmits = lines.reduce((s, l) => {
      const isCafe = !!l.is_cafe || cafeOrgGroupIds.has(l.ticket_org_group_id);
      return isCafe ? s : s + Number(l.admits || 0);
    }, 0);
    const hasCafe = lines.some(
      (l) => !!l.is_cafe || cafeOrgGroupIds.has(l.ticket_org_group_id),
    );
    const hasTicket = lines.some(
      (l) => !(!!l.is_cafe || cafeOrgGroupIds.has(l.ticket_org_group_id)),
    );
    const bookingKind =
      hasCafe && hasTicket ? 'mixed' : hasCafe ? 'cafe' : 'ticket';
    const cafeIdsForOrder = [
      ...new Set(
        lines
          .map((l) => cafeCatalog.byTicketId.get(l.ticket_id)?.cafe.cafeId)
          .filter((id): id is string => !!id),
      ),
    ];
    const pay = classifyPaymentMode({
      payment_type: first.payment_type,
      payment_cash_card: first.payment_cash_card,
      net_total: totalAmount,
      has_split: splitSet.has(commonOrder),
    });
    plannedPayments += paymentLegsForMode(pay.mode, totalAmount).length;

    if (opts.dryRun) continue;

    const idem = legacyIdempotencyKey(commonOrder);
    const commonOrderNew = legacyCommonOrder(commonOrder);
    if (shouldSkipLegacyOrder(idem, commonOrderNew)) {
      ordersSkipped += 1;
      continue;
    }

    const email = safeEmail(first.customer_email, commonOrder);
    const customerId = customers.idByEmail.get(email);
    if (!customerId) throw new Error(`Customer missing for ${email}`);

    const sessionId = await ensureSession(
      prisma,
      event.id,
      first.event_start_date || primary.start_date,
      first.event_start_time || primary.start_time,
      sessionCache,
      false,
      first.event_end_time || primary.end_time,
    );

    const orderId = randomUUID();
    const createdAt = new Date(first.created_at);
    const paidAt = first.is_paid ? createdAt : null;
    const currency = (first.currency || 'QAR').slice(0, 5) || 'QAR';
    /** Preserve legacy booking insert order when timestamps would otherwise tie. */
    const lineCreatedAt = (lineIndex: number) =>
      new Date(createdAt.getTime() + Math.max(0, lineIndex - 1));

    let cashAmount = 0;
    let cardAmount = 0;
    let onlineAmount = 0;
    let compAmount = 0;
    if (pay.mode === 'offline_cash') cashAmount = totalAmount;
    else if (pay.mode === 'offline_card') cardAmount = totalAmount;
    else if (pay.mode === 'online') onlineAmount = totalAmount;
    else if (pay.mode === 'comp' || pay.mode === 'free') compAmount = 0;
    else if (pay.mode === 'split') {
      cashAmount = Math.round((totalAmount / 2) * 1000) / 1000;
      cardAmount = Math.round((totalAmount - cashAmount) * 1000) / 1000;
    }

    const bookedByAgentId =
      first.pos_id != null
        ? staffUsers.byLegacyId.get(first.pos_id)?.userId ?? null
        : null;

    const linkedAddonProducts = orderAddons.map((addon) => ({
      addon,
      product: resolveAddonProductId(addonMap, addon.addon_id, addon.title),
    }));

    orderCreates.push({
      id: orderId,
      commonOrder: commonOrderNew,
      idempotencyKey: idem,
      customerId,
      eventId: event.id,
      eventSessionId: sessionId,
      status: first.is_paid || totalAmount <= 0 ? 'paid' : 'pending_payment',
      paymentStatus: first.is_paid || totalAmount <= 0 ? 'paid' : 'pending',
      currency,
      // Gross before discount so order detail shows Subtotal − Discount = Total
      subtotalAmount: money3(ticketGross + addonNet),
      discountAmount: money3(ticketDiscount),
      taxAmount: money3(lines.reduce((s, l) => s + Number(l.tax || 0), 0)),
      totalAmount: money3(totalAmount),
      promoCode,
      source: LEGACY_ORDER_SOURCE,
      locale: 'en',
      metadata: {
        ...(cafeIdsForOrder.length === 1 ? { cafe_id: cafeIdsForOrder[0] } : {}),
        ...(cafeIdsForOrder.length > 1 ? { cafe_ids: cafeIdsForOrder } : {}),
        legacy: {
          kind: bookingKind,
          common_order: commonOrder,
          event_ids: eventIds,
          booking_ids: lines.map((l) => l.id),
          booking_lines: lines.map((l) => ({
            booking_id: l.id,
            ticket_id: l.ticket_id,
            playtime_pack_id: l.playtime_pack_id,
            ticket_title: l.ticket_title || null,
            order_number: l.order_number,
          })),
          booked_via: first.booked_via,
          pos_id: first.pos_id,
          organiser_user_id: primary.user_id,
          promocode: promoCode,
          promocode_id: promoCodeId,
          promocode_reward: ticketDiscount,
          // Denormalized first-row addon_price — Tickets Info / product breakdown source of truth in old BQ
          addon_price: Number(first.addon_price || 0),
          linked_addons: linkedAddonProducts.map(({ addon, product }) => ({
            addon_booking_id: addon.id,
            addon_id: product.legacyAddonId,
            new_addon_id: product.itemId,
            title: product.displayName,
            quantity: addon.quantity || 1,
            total: Number(addon.total || 0),
          })),
        },
      },
      createdAt,
      updatedAt: first.updated_at ? new Date(first.updated_at) : createdAt,
      paidAt,
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle: target.title,
      eventStartDate: parseDateOnly(first.event_start_date || primary.start_date),
      eventStartTime: formatDisplayTime(first.event_start_time || primary.start_time),
      customerName: (first.customer_name || 'Guest').slice(0, 190),
      customerEmail: email,
      customerPhone: safePhone(first.customer_phone),
      // Snapshot from legacy users — mapped to camp Group 1–4 for
      // demographics (age group + geographic region charts).
      customerAgeGroup: first.customer_age_group,
      customerGeographicRegion: first.customer_geographic_region,
      paymentMode: pay.mode,
      paymentMethodLabel: pay.label,
      cashAmount: money3(cashAmount),
      cardAmount: money3(cardAmount),
      onlineAmount: money3(onlineAmount),
      compAmount: money3(compAmount),
      ticketsNet: money3(ticketNet),
      addonsNet: money3(addonNet),
      extensionsNet: money3(0),
      totalQuantity: totalQty,
      totalAdmits,
      isSummerCamp: event.eventType === 'summer_camp',
      bookedByAgentId,
      reportVersion: 1,
      reportSyncPending: false,
    });

    let lineNo = 0;
    for (const line of lines) {
      lineNo += 1;
      const isCafe =
        !!line.is_cafe || cafeOrgGroupIds.has(line.ticket_org_group_id);
      const qty = Number(line.quantity || 1);
      const unitList = Number(line.price || 0);
      const lineGross = unitList * qty;
      const lineDiscount = legacyLineDiscount(line);

      if (isCafe) {
        const cafeLine = resolveCafeMenuItemForLine(cafeCatalog, line);
        if (!cafeLine) {
          warnings.push(
            `Cafe booking line ticket #${line.ticket_id} has no cafe menu mapping; skipped item`,
          );
          continue;
        }
        if (
          line.playtime_pack_id != null &&
          !cafeLine.category.itemsByPackId.has(line.playtime_pack_id)
        ) {
          const warnKey = `cafe:${line.ticket_id}:${line.playtime_pack_id}`;
          if (!warnedMissingPacks.has(warnKey)) {
            warnedMissingPacks.add(warnKey);
            warnings.push(
              `cafe playtime_pack_id=${line.playtime_pack_id} on ticket #${line.ticket_id} not mapped; using default cafe item`,
            );
          }
        }
        itemCreates.push({
          id: randomUUID(),
          orderId,
          eventId: event.id,
          eventSessionId: sessionId,
          itemType: OrderItemType.cafe_item,
          itemId: cafeLine.item.id,
          displayName: cafeLine.displayName,
          quantity: qty,
          unitPrice: money3(unitList),
          subtotalAmount: money3(lineGross),
          discountAmount: money3(lineDiscount),
          taxAmount: money3(line.tax),
          totalAmount: money3(line.net_price),
          currency,
          ticketCode: line.order_number || `${commonOrderNew}-${String(lineNo).padStart(2, '0')}`,
          qrCodePayload: line.order_number || undefined,
          attendanceStatus: attendanceFromCheckedIn(line.checked_in),
          checkedInAt: line.checked_in ? createdAt : null,
          visitorType: classifyVisitorType(line),
          admitCount: 0,
          ticketIsCafe: true,
          ticketIsPosOnly: true,
          ticketHideFromOnline: true,
          thirdPartyVendorId: cafeLine.cafe.thirdPartyVendorId,
          bookedByAgentId,
          createdAt: lineCreatedAt(lineNo),
          updatedAt: lineCreatedAt(lineNo),
        });
        orderItemsCreated += 1;
        continue;
      }

      const ticket = ticketMap.get(line.ticket_id);
      if (!ticket) throw new Error(`Unmapped ticket ${line.ticket_id}`);
      const variant =
        line.playtime_pack_id != null
          ? ticket.variantsByPackId.get(line.playtime_pack_id)
          : undefined;
      if (line.playtime_pack_id != null && !variant) {
        const warnKey = `${line.ticket_id}:${line.playtime_pack_id}`;
        if (!warnedMissingPacks.has(warnKey)) {
          warnedMissingPacks.add(warnKey);
          warnings.push(
            `playtime_pack_id=${line.playtime_pack_id} on ticket #${line.ticket_id} not mapped; lines stored as ticket_type`,
          );
        }
      }
      const admitPerUnit =
        qty > 0
          ? Math.max(1, Math.round(Number(line.admits || 1) / qty))
          : Number(line.admits || 1);
      const displayName = variant
        ? `${ticket.title} - ${variant.name}`
        : line.ticket_title || ticket.title;
      itemCreates.push({
        id: randomUUID(),
        orderId,
        eventId: event.id,
        eventSessionId: sessionId,
        itemType: variant ? OrderItemType.ticket_variant : OrderItemType.ticket_type,
        itemId: variant ? variant.id : ticket.id,
        displayName,
        quantity: qty,
        unitPrice: money3(unitList),
        subtotalAmount: money3(lineGross),
        discountAmount: money3(lineDiscount),
        taxAmount: money3(line.tax),
        totalAmount: money3(line.net_price),
        currency,
        ticketCode: line.order_number || `${commonOrderNew}-${String(lineNo).padStart(2, '0')}`,
        qrCodePayload: line.order_number || undefined,
        attendanceStatus: attendanceFromCheckedIn(line.checked_in),
        checkedInAt: line.checked_in ? createdAt : null,
        visitorType: classifyVisitorType(line),
        admitCount: admitPerUnit,
        ticketIsCafe: false,
        ticketIsPosOnly: !!line.is_pos_only || ticket.isPosOnly,
        ticketHideFromOnline: !!line.is_pos_only || ticket.isPosOnly,
        thirdPartyVendorId: ticket.thirdPartyVendorId,
        bookedByAgentId,
        createdAt: lineCreatedAt(lineNo),
        updatedAt: lineCreatedAt(lineNo),
      });
      orderItemsCreated += 1;
    }

    for (const { addon, product } of linkedAddonProducts) {
      lineNo += 1;
      const addonVendorId = pickDominantVendorId(
        lines.map((l) => {
          const t = ticketMap.get(l.ticket_id);
          return t?.thirdPartyVendorId ?? null;
        }),
      );
      itemCreates.push({
        id: randomUUID(),
        orderId,
        eventId: event.id,
        eventSessionId: sessionId,
        itemType: OrderItemType.addon,
        itemId: product.itemId,
        displayName: product.displayName,
        quantity: addon.quantity || 1,
        unitPrice: money3(addon.price),
        subtotalAmount: money3(addon.total),
        discountAmount: money3(0),
        taxAmount: money3(0),
        totalAmount: money3(addon.total),
        currency,
        ticketCode: `${commonOrderNew}-A${String(lineNo).padStart(2, '0')}`,
        visitorType: 'paid',
        admitCount: 0,
        thirdPartyVendorId: addonVendorId,
        bookedByAgentId,
        createdAt: lineCreatedAt(lineNo),
        updatedAt: lineCreatedAt(lineNo),
      });
      orderItemsCreated += 1;
    }

    for (const leg of paymentLegsForMode(pay.mode, totalAmount)) {
      paymentCreates.push({
        id: randomUUID(),
        orderId,
        provider:
          leg.legType === 'online_gateway'
            ? PaymentProvider.myfatoorah
            : PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: money3(leg.amount),
        currency,
        providerResponse: {
          legacy: {
            common_order: commonOrder,
            payment_type: first.payment_type,
            payment_cash_card: first.payment_cash_card,
            transaction_id: first.transaction_id,
          },
        },
        createdAt,
        updatedAt: createdAt,
        paidAt: paidAt ?? createdAt,
      });
      paymentsCreated += 1;
    }

    markOrderQueued(idem, commonOrderNew);
    ordersCreated += 1;
    if (orderCreates.length >= FLUSH_EVERY) {
      await flushPendingCreates();
    }
  }

  // --- Historical streams: separate addons, cafe EOD, e3 onsite ---
  const cafeTicket = await ensureSyntheticTicketType(prisma, {
    eventId: event.id,
    externalKey: legacyCafeEodExternalKey(event.id),
    title: 'Legacy Cafe EOD',
    dryRun: !!opts.dryRun,
  });
  const e3Ticket = await ensureSyntheticTicketType(prisma, {
    eventId: event.id,
    externalKey: legacyE3OnsiteExternalKey(event.id),
    title: 'Legacy Onsite (E3)',
    dryRun: !!opts.dryRun,
  });

  for (const addon of separateAddons) {
    plannedItems += 1;
    const totalAmount = Number(addon.total || 0);
    const pay = classifyAddonPaymentMode({
      booking_type: addon.booking_type,
      payment_type: addon.payment_type,
      net_total: totalAmount,
    });
    plannedPayments += paymentLegsForMode(pay.mode, totalAmount).length;
    if (opts.dryRun) continue;

    const idem = legacySeparateAddonIdempotencyKey(addon.id);
    const commonOrderNew = legacySeparateAddonCommonOrder(addon.id);
    if (shouldSkipLegacyOrder(idem, commonOrderNew)) {
      ordersSkipped += 1;
      continue;
    }

    const customerId = await ensureGuestCustomerId(
      prisma,
      `addon-${addon.id}`,
      'Legacy Addon Guest',
      false,
      customers.idByEmail,
    );
    const sessionId = await ensureSession(
      prisma,
      event.id,
      addon.created_at
        ? legacyDateOnlyQatar(addon.created_at)
        : primary.start_date,
      primary.start_time,
      sessionCache,
      false,
    );
    const orderId = randomUUID();
    const createdAt = new Date(addon.created_at);
    const currency = 'QAR';
    const bookedByAgentId =
      addon.booked_by != null
        ? staffUsers.byLegacyId.get(addon.booked_by)?.userId ?? null
        : null;
    const separateAddonVendorId = bookedByAgentId
      ? agentDominantVendor.get(bookedByAgentId) ?? mainVendorId
      : mainVendorId;

    let cashAmount = 0;
    let cardAmount = 0;
    let onlineAmount = 0;
    let compAmount = 0;
    if (pay.mode === 'offline_cash') cashAmount = totalAmount;
    else if (pay.mode === 'offline_card') cardAmount = totalAmount;
    else if (pay.mode === 'online') onlineAmount = totalAmount;
    else if (pay.mode === 'comp' || pay.mode === 'free') compAmount = 0;

    const product = resolveAddonProductId(addonMap, addon.addon_id, addon.title);

    orderCreates.push({
      id: orderId,
      commonOrder: commonOrderNew,
      idempotencyKey: idem,
      customerId,
      eventId: event.id,
      eventSessionId: sessionId,
      status: 'paid',
      paymentStatus: 'paid',
      currency,
      subtotalAmount: money3(totalAmount),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalAmount),
      source: LEGACY_ORDER_SOURCE_ADDON,
      locale: 'en',
      metadata: {
        legacy: {
          kind: 'separate_addon',
          addon_booking_id: addon.id,
          addon_id: addon.addon_id,
          new_addon_id: product.itemId,
          event_ids: eventIds,
        },
      },
      createdAt,
      updatedAt: addon.updated_at ? new Date(addon.updated_at) : createdAt,
      paidAt: createdAt,
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle: target.title,
      eventStartDate: parseDateOnly(addon.created_at || primary.start_date),
      eventStartTime: formatDisplayTime(primary.start_time),
      customerName: 'Legacy Addon Guest',
      customerEmail: guestEmail(`addon-${addon.id}`),
      customerPhone: null,
      paymentMode: pay.mode,
      paymentMethodLabel: pay.label,
      cashAmount: money3(cashAmount),
      cardAmount: money3(cardAmount),
      onlineAmount: money3(onlineAmount),
      compAmount: money3(compAmount),
      ticketsNet: money3(0),
      addonsNet: money3(totalAmount),
      extensionsNet: money3(0),
      totalQuantity: 0,
      totalAdmits: 0,
      isSummerCamp: event.eventType === 'summer_camp',
      bookedByAgentId,
      reportVersion: 1,
      reportSyncPending: false,
    });

    itemCreates.push({
      id: randomUUID(),
      orderId,
      eventId: event.id,
      eventSessionId: sessionId,
      itemType: OrderItemType.addon,
      itemId: product.itemId,
      displayName: product.displayName,
      quantity: addon.quantity || 1,
      unitPrice: money3(addon.price),
      subtotalAmount: money3(totalAmount),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalAmount),
      currency,
      ticketCode: `${commonOrderNew}-A01`,
      visitorType: totalAmount <= 0 ? 'comp' : 'paid',
      admitCount: 0,
      thirdPartyVendorId: separateAddonVendorId,
      bookedByAgentId,
      createdAt,
      updatedAt: createdAt,
    });
    orderItemsCreated += 1;

    for (const leg of paymentLegsForMode(pay.mode, totalAmount)) {
      paymentCreates.push({
        id: randomUUID(),
        orderId,
        provider:
          leg.legType === 'online_gateway'
            ? PaymentProvider.myfatoorah
            : PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: money3(leg.amount),
        currency,
        providerResponse: {
          legacy: { kind: 'separate_addon', addon_booking_id: addon.id },
        },
        createdAt,
        updatedAt: createdAt,
        paidAt: createdAt,
      });
      paymentsCreated += 1;
    }
    markOrderQueued(idem, commonOrderNew);
    ordersCreated += 1;
    if (orderCreates.length >= FLUSH_EVERY) {
      await flushPendingCreates();
    }
  }

  for (const closing of cafeClosings) {
    plannedItems += 1;
    const totalSales = Number(closing.total_sales || 0);
    const pay = cafePaymentLegs(closing.total_cash, closing.total_card, totalSales);
    plannedPayments += pay.legs.length;
    if (opts.dryRun) continue;

    const idem = legacyCafeIdempotencyKey(closing.id);
    const commonOrderNew = legacyCafeCommonOrder(closing.id);
    if (shouldSkipLegacyOrder(idem, commonOrderNew)) {
      ordersSkipped += 1;
      continue;
    }

    const mappedCafeTicket =
      closing.ticket_id != null
        ? cafeCatalog.byTicketId.get(closing.ticket_id)
        : null;
    // Prefer cafe org-groups that belong to the same legacy event_id as the closing
    // (sibling events under common_event_id must not share cafe sales).
    const cafesForClosingLegacyEvent = organiserGroups
      .filter((g) => g.is_cafe && g.event_id === closing.event_id)
      .map((g) => cafeCatalog.byOrgGroupId.get(g.id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const legacyEventCafe =
      cafesForClosingLegacyEvent.length === 1
        ? cafesForClosingLegacyEvent[0]
        : cafesForClosingLegacyEvent.find((c) => c.thirdPartyVendorId) ??
          cafesForClosingLegacyEvent[0] ??
          null;
    const singleCafeFallback =
      cafeCatalog.result.length === 1
        ? cafeCatalog.byOrgGroupId.get(cafeCatalog.result[0]!.legacyOrgGroupId)
        : null;
    const cafeForClosing =
      mappedCafeTicket?.cafe ?? legacyEventCafe ?? singleCafeFallback ?? null;
    const cafeMenuItem =
      mappedCafeTicket?.category.defaultItem ??
      (cafeForClosing
        ? [...cafeForClosing.categoriesByTicketId.values()][0]?.defaultItem
        : null);

    const mappedTicket =
      closing.ticket_id != null ? ticketMap.get(closing.ticket_id) : null;
    const useCafeItem = !!cafeMenuItem;
    const ticketId = mappedTicket?.id ?? cafeTicket.id;
    const ticketTitle =
      mappedCafeTicket?.category.title ??
      mappedTicket?.title ??
      cafeTicket.title;
    const thirdPartyVendorId =
      cafeForClosing?.thirdPartyVendorId ??
      mappedTicket?.thirdPartyVendorId ??
      cafeTicket.thirdPartyVendorId;

    const customerId = await ensureGuestCustomerId(
      prisma,
      `cafe-${closing.id}`,
      'Legacy Cafe Guest',
      false,
      customers.idByEmail,
    );
    const sessionId = await ensureSession(
      prisma,
      event.id,
      closing.closing_date || primary.start_date,
      primary.start_time,
      sessionCache,
      false,
    );
    const orderId = randomUUID();
    const createdAt = closing.created_at
      ? new Date(closing.created_at)
      : new Date(`${closing.closing_date}T12:00:00.000Z`);
    const currency = 'QAR';
    const bookedByAgentId =
      closing.agent_id != null
        ? staffUsers.byLegacyId.get(closing.agent_id)?.userId ?? null
        : null;

    orderCreates.push({
      id: orderId,
      commonOrder: commonOrderNew,
      idempotencyKey: idem,
      customerId,
      eventId: event.id,
      eventSessionId: sessionId,
      status: 'paid',
      paymentStatus: 'paid',
      currency,
      subtotalAmount: money3(totalSales),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalSales),
      source: LEGACY_ORDER_SOURCE_CAFE,
      locale: 'en',
      metadata: {
        ...(cafeForClosing ? { cafe_id: cafeForClosing.cafeId } : {}),
        legacy: {
          kind: 'pos_cafe_closing',
          cafe_closing_id: closing.id,
          ticket_id: closing.ticket_id,
          agent_id: closing.agent_id,
          total_transactions: closing.total_transactions,
          event_ids: eventIds,
        },
      },
      createdAt,
      updatedAt: createdAt,
      paidAt: createdAt,
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle: target.title,
      eventStartDate: parseDateOnly(closing.closing_date || primary.start_date),
      eventStartTime: formatDisplayTime(primary.start_time),
      customerName: 'Legacy Cafe Guest',
      customerEmail: guestEmail(`cafe-${closing.id}`),
      customerPhone: null,
      paymentMode: pay.mode,
      paymentMethodLabel: pay.label,
      cashAmount: money3(pay.cashAmount),
      cardAmount: money3(pay.cardAmount),
      onlineAmount: money3(0),
      compAmount: money3(0),
      ticketsNet: money3(totalSales),
      addonsNet: money3(0),
      extensionsNet: money3(0),
      totalQuantity: 0,
      totalAdmits: 0,
      isSummerCamp: event.eventType === 'summer_camp',
      bookedByAgentId,
      reportVersion: 1,
      reportSyncPending: false,
    });

    itemCreates.push({
      id: randomUUID(),
      orderId,
      eventId: event.id,
      eventSessionId: sessionId,
      itemType: useCafeItem ? OrderItemType.cafe_item : OrderItemType.ticket_type,
      itemId: useCafeItem ? cafeMenuItem!.id : ticketId,
      displayName: ticketTitle,
      quantity: 0,
      unitPrice: money3(totalSales),
      subtotalAmount: money3(totalSales),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalSales),
      currency,
      ticketCode: `${commonOrderNew}-C01`,
      visitorType: 'paid',
      admitCount: 0,
      ticketIsCafe: true,
      ticketHideFromOnline: true,
      thirdPartyVendorId,
      bookedByAgentId,
      createdAt,
      updatedAt: createdAt,
    });
    orderItemsCreated += 1;

    for (const leg of pay.legs) {
      paymentCreates.push({
        id: randomUUID(),
        orderId,
        provider: PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: money3(leg.amount),
        currency,
        providerResponse: {
          legacy: { kind: 'pos_cafe_closing', cafe_closing_id: closing.id },
        },
        createdAt,
        updatedAt: createdAt,
        paidAt: createdAt,
      });
      paymentsCreated += 1;
    }
    markOrderQueued(idem, commonOrderNew);
    ordersCreated += 1;
    if (orderCreates.length >= FLUSH_EVERY) {
      await flushPendingCreates();
    }
  }

  for (const e3 of e3Bookings) {
    plannedItems += 1;
    const qty = Math.max(0, Math.round(Number(e3.tickets || 0)));
    const admits = Math.max(0, Math.round(Number(e3.admit || 0)));
    const totalPaid = Number(e3.total_paid || 0);
    const pay = classifyE3PaymentMode(e3.payment_srouce, totalPaid);
    plannedPayments += paymentLegsForMode(pay.mode, totalPaid).length;
    if (opts.dryRun) continue;

    const idem = legacyE3IdempotencyKey(e3.id);
    const commonOrderNew = legacyE3CommonOrder(e3.id);
    if (shouldSkipLegacyOrder(idem, commonOrderNew)) {
      ordersSkipped += 1;
      continue;
    }

    const thirdPartyVendorId =
      e3.org_group_id != null && e3.org_group_id > 0
        ? thirdPartyVendors.byLegacyId.get(e3.org_group_id) ?? null
        : null;

    const customerId = await ensureGuestCustomerId(
      prisma,
      `e3-${e3.id}`,
      e3.name || 'Legacy E3 Guest',
      false,
      customers.idByEmail,
    );
    const sessionId = await ensureSession(
      prisma,
      event.id,
      e3.created_at ? legacyDateOnlyQatar(e3.created_at) : primary.start_date,
      primary.start_time,
      sessionCache,
      false,
    );
    const orderId = randomUUID();
    const createdAt = new Date(e3.created_at);
    const currency = (e3.currency || 'QAR').slice(0, 5) || 'QAR';

    let cashAmount = 0;
    let cardAmount = 0;
    let onlineAmount = 0;
    let compAmount = 0;
    if (pay.mode === 'offline_cash') cashAmount = totalPaid;
    else if (pay.mode === 'offline_card') cardAmount = totalPaid;
    else if (pay.mode === 'online') onlineAmount = totalPaid;
    else if (pay.mode === 'comp' || pay.mode === 'free') compAmount = 0;

    orderCreates.push({
      id: orderId,
      commonOrder: commonOrderNew,
      idempotencyKey: idem,
      customerId,
      eventId: event.id,
      eventSessionId: sessionId,
      status: 'paid',
      paymentStatus: 'paid',
      currency,
      subtotalAmount: money3(totalPaid),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalPaid),
      source: LEGACY_ORDER_SOURCE_E3,
      locale: 'en',
      metadata: {
        legacy: {
          kind: 'e3_booking',
          e3_booking_id: e3.id,
          activity: e3.activity,
          payment_srouce: e3.payment_srouce,
          org_group_id: e3.org_group_id,
          common_event_id: e3.common_event_id,
          event_ids: eventIds,
        },
      },
      createdAt,
      updatedAt: createdAt,
      paidAt: createdAt,
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle: target.title,
      eventStartDate: parseDateOnly(e3.created_at || primary.start_date),
      eventStartTime: formatDisplayTime(primary.start_time),
      customerName: (e3.name || 'Legacy E3 Guest').slice(0, 190),
      customerEmail: guestEmail(`e3-${e3.id}`),
      customerPhone: null,
      paymentMode: pay.mode,
      paymentMethodLabel: pay.label,
      cashAmount: money3(cashAmount),
      cardAmount: money3(cardAmount),
      onlineAmount: money3(onlineAmount),
      compAmount: money3(compAmount),
      ticketsNet: money3(totalPaid),
      addonsNet: money3(0),
      extensionsNet: money3(0),
      totalQuantity: qty,
      totalAdmits: admits,
      isSummerCamp: event.eventType === 'summer_camp',
      bookedByAgentId: null,
      reportVersion: 1,
      reportSyncPending: false,
    });

    const unit = qty > 0 ? totalPaid / qty : totalPaid;
    const admitPerUnit = qty > 0 ? Math.max(1, Math.round(admits / qty)) : admits || 1;
    itemCreates.push({
      id: randomUUID(),
      orderId,
      eventId: event.id,
      eventSessionId: sessionId,
      itemType: OrderItemType.ticket_type,
      itemId: e3Ticket.id,
      displayName: e3.activity
        ? `E3 · ${e3.activity}`
        : e3Ticket.title,
      quantity: Math.max(qty, qty === 0 && totalPaid > 0 ? 0 : qty),
      unitPrice: money3(unit),
      subtotalAmount: money3(totalPaid),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalPaid),
      currency,
      ticketCode: `${commonOrderNew}-E01`,
      visitorType: 'third_party',
      admitCount: admitPerUnit,
      ticketHideFromOnline: true,
      thirdPartyVendorId,
      createdAt,
      updatedAt: createdAt,
    });
    orderItemsCreated += 1;

    for (const leg of paymentLegsForMode(pay.mode, totalPaid)) {
      paymentCreates.push({
        id: randomUUID(),
        orderId,
        provider:
          leg.legType === 'online_gateway'
            ? PaymentProvider.myfatoorah
            : PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: money3(leg.amount),
        currency,
        providerResponse: {
          legacy: { kind: 'e3_booking', e3_booking_id: e3.id },
        },
        createdAt,
        updatedAt: createdAt,
        paidAt: createdAt,
      });
      paymentsCreated += 1;
    }
    markOrderQueued(idem, commonOrderNew);
    ordersCreated += 1;
    if (orderCreates.length >= FLUSH_EVERY) {
      await flushPendingCreates();
    }
  }

  // Standalone time extensions — revenue only (tickets/admits = 0)
  for (const te of timeExtensions) {
    const teLines = resolveTimeExtensionLines(te, timeExtensionMap);
    plannedItems += teLines.length;
    const totalAmount = Number(te.total_amount || 0);
    const pay = classifyTimeExtensionPaymentMode(te.payment_method, totalAmount);
    plannedPayments += paymentLegsForMode(pay.mode, totalAmount).length;
    if (opts.dryRun) continue;

    const idem = legacyTimeExtensionIdempotencyKey(te.id);
    const commonOrderNew = legacyTimeExtensionCommonOrder(te.id);
    if (shouldSkipLegacyOrder(idem, commonOrderNew)) {
      ordersSkipped += 1;
      continue;
    }

    const customerId = await ensureGuestCustomerId(
      prisma,
      `te-${te.id}`,
      'Legacy Time Extension Guest',
      false,
      customers.idByEmail,
    );
    const sessionId = await ensureSession(
      prisma,
      event.id,
      te.created_at ? legacyDateOnlyQatar(te.created_at) : primary.start_date,
      primary.start_time,
      sessionCache,
      false,
    );
    const orderId = randomUUID();
    const createdAt = new Date(te.created_at);
    const currency = (te.currency || 'QAR').slice(0, 5) || 'QAR';
    const bookedByAgentId =
      te.agent_id != null
        ? staffUsers.byLegacyId.get(te.agent_id)?.userId ?? null
        : null;
    // Match old dashboard: time extensions count toward main/event-owner share revenue.
    const timeExtensionVendorId = bookedByAgentId
      ? agentDominantVendor.get(bookedByAgentId) ?? mainVendorId
      : mainVendorId;

    let cashAmount = 0;
    let cardAmount = 0;
    let onlineAmount = 0;
    let compAmount = 0;
    if (pay.mode === 'offline_cash') cashAmount = totalAmount;
    else if (pay.mode === 'offline_card') cardAmount = totalAmount;
    else if (pay.mode === 'online') onlineAmount = totalAmount;
    else if (pay.mode === 'comp' || pay.mode === 'free') compAmount = 0;

    orderCreates.push({
      id: orderId,
      commonOrder: commonOrderNew,
      idempotencyKey: idem,
      customerId,
      eventId: event.id,
      eventSessionId: sessionId,
      status: 'paid',
      paymentStatus: 'paid',
      currency,
      subtotalAmount: money3(totalAmount),
      discountAmount: money3(0),
      taxAmount: money3(0),
      totalAmount: money3(totalAmount),
      source: LEGACY_ORDER_SOURCE_TIME_EXTENSION,
      locale: 'en',
      metadata: {
        legacy: {
          kind: 'time_extension',
          time_extension_id: te.id,
          booking_id: te.booking_id,
          common_order: te.common_order,
          barcode: te.barcode,
          total_duration_minutes: te.total_duration_minutes,
          new_pack_ids: teLines.map((line) => line.itemId),
          catalog_extension_ids: teLines
            .map((line) => line.legacyExtensionId)
            .filter((id): id is number => id != null),
          event_ids: eventIds,
        },
      },
      createdAt,
      updatedAt: te.updated_at ? new Date(te.updated_at) : createdAt,
      paidAt: createdAt,
      organizationId: event.organizationId,
      venueId: event.venueId,
      eventSlug: event.slug,
      eventTitle: target.title,
      eventStartDate: parseDateOnly(te.created_at || primary.start_date),
      eventStartTime: formatDisplayTime(primary.start_time),
      customerName: 'Legacy Time Extension Guest',
      customerEmail: guestEmail(`te-${te.id}`),
      customerPhone: null,
      paymentMode: pay.mode,
      paymentMethodLabel: pay.label,
      cashAmount: money3(cashAmount),
      cardAmount: money3(cardAmount),
      onlineAmount: money3(onlineAmount),
      compAmount: money3(compAmount),
      ticketsNet: money3(0),
      addonsNet: money3(0),
      extensionsNet: money3(totalAmount),
      totalQuantity: 0,
      totalAdmits: 0,
      isSummerCamp: event.eventType === 'summer_camp',
      bookedByAgentId,
      reportVersion: 1,
      reportSyncPending: false,
    });

    teLines.forEach((line, index) => {
      itemCreates.push({
        id: randomUUID(),
        orderId,
        eventId: event.id,
        eventSessionId: sessionId,
        itemType: OrderItemType.customization,
        itemId: line.itemId,
        displayName: line.displayName,
        quantity: line.quantity,
        unitPrice: money3(line.unitPrice),
        subtotalAmount: money3(line.totalAmount),
        discountAmount: money3(0),
        taxAmount: money3(0),
        totalAmount: money3(line.totalAmount),
        currency,
        ticketCode: `${commonOrderNew}-TE${String(index + 1).padStart(2, '0')}`,
        visitorType: line.totalAmount <= 0 ? 'comp' : 'paid',
        admitCount: 0,
        ticketIsCafe: false,
        thirdPartyVendorId: timeExtensionVendorId,
        bookedByAgentId,
        createdAt,
        updatedAt: createdAt,
      });
      orderItemsCreated += 1;
    });

    for (const leg of paymentLegsForMode(pay.mode, totalAmount)) {
      paymentCreates.push({
        id: randomUUID(),
        orderId,
        provider:
          leg.legType === 'online_gateway'
            ? PaymentProvider.myfatoorah
            : PaymentProvider.internal,
        methodKey: leg.methodKey,
        legType: leg.legType,
        status: PaymentTransactionStatus.paid,
        amount: money3(leg.amount),
        currency,
        providerResponse: {
          legacy: {
            kind: 'time_extension',
            time_extension_id: te.id,
            new_pack_ids: teLines.map((line) => line.itemId),
          },
        },
        createdAt,
        updatedAt: createdAt,
        paidAt: createdAt,
      });
      paymentsCreated += 1;
    }
    markOrderQueued(idem, commonOrderNew);
    ordersCreated += 1;
    if (orderCreates.length >= FLUSH_EVERY) {
      await flushPendingCreates();
    }
  }

  if (!opts.dryRun) {
    await flushPendingCreates();

    // Batch third-party-vendor backfill only (agent is set on create — avoid N+1 updates).
    for (const ticket of ticketMap.values()) {
      if (!ticket.thirdPartyVendorId) continue;
      await prisma.orderItem.updateMany({
        where: {
          eventId: event.id,
          itemType: OrderItemType.ticket_type,
          itemId: ticket.id,
          thirdPartyVendorId: null,
          order: { idempotencyKey: { startsWith: 'legacy-mysql:' } },
        },
        data: { thirdPartyVendorId: ticket.thirdPartyVendorId },
      });
    }

    // Linked addons inherit vendor from sibling ticket lines on the same order.
    await prisma.$executeRaw`
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
        WHERE oi_addon.event_id = ${event.id}::uuid
          AND oi_addon.item_type = 'addon'::"OrderItemType"
          AND oi_addon.third_party_vendor_id IS NULL
      ) AS sibling
      WHERE addon.id = sibling.addon_id
        AND sibling.vendor_id IS NOT NULL
    `;

    // Ticket-linked customizations inherit parent ticket vendor.
    await prisma.$executeRaw`
      UPDATE order_items AS cust
      SET third_party_vendor_id = parent.third_party_vendor_id
      FROM order_items AS parent
      WHERE cust.event_id = ${event.id}::uuid
        AND cust.item_type = 'customization'::"OrderItemType"
        AND cust.third_party_vendor_id IS NULL
        AND cust.parent_order_item_id = parent.id
        AND parent.third_party_vendor_id IS NOT NULL
    `;

    // Separate / orphan addons: attribute via agent dominant ticket vendor, else main vendor.
    if (agentDominantVendor.size || mainVendorId) {
      const agentRows = [...agentDominantVendor.entries()];
      for (const [agentId, vendorId] of agentRows) {
        await prisma.orderItem.updateMany({
          where: {
            eventId: event.id,
            itemType: OrderItemType.addon,
            thirdPartyVendorId: null,
            bookedByAgentId: agentId,
          },
          data: { thirdPartyVendorId: vendorId },
        });
      }
      if (mainVendorId) {
        await prisma.orderItem.updateMany({
          where: {
            eventId: event.id,
            itemType: OrderItemType.addon,
            thirdPartyVendorId: null,
          },
          data: { thirdPartyVendorId: mainVendorId },
        });
      }
    }

    // Standalone time-extension customizations (no parent): agent dominant, else main vendor.
    if (agentDominantVendor.size || mainVendorId) {
      const agentRows = [...agentDominantVendor.entries()];
      for (const [agentId, vendorId] of agentRows) {
        await prisma.orderItem.updateMany({
          where: {
            eventId: event.id,
            itemType: OrderItemType.customization,
            thirdPartyVendorId: null,
            parentOrderItemId: null,
            bookedByAgentId: agentId,
          },
          data: { thirdPartyVendorId: vendorId },
        });
      }
      if (mainVendorId) {
        await prisma.orderItem.updateMany({
          where: {
            eventId: event.id,
            itemType: OrderItemType.customization,
            thirdPartyVendorId: null,
            parentOrderItemId: null,
          },
          data: { thirdPartyVendorId: mainVendorId },
        });
      }
    }

    // Large events: rollups can take longer than HTTP clients allow.
    const largeImport =
      commonOrders.length +
        separateAddons.length +
        cafeClosings.length +
        e3Bookings.length +
        timeExtensions.length >
      15_000;
    const skipRollups = opts.skipRollups || largeImport;
    if (largeImport && !opts.skipRollups) {
      warnings.push(
        'Skipped rollup rebuild for large import (>15k orders). Run rollups later or re-migrate with skipRollups=false after verifying orders.',
      );
    }

    if (!skipRollups) {
      try {
        await ensureReportIndexes(prisma);
        await rebuildEventRollups(prisma, [{ id: event.id, slug: event.slug }]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        warnings.push(`Rollup rebuild failed (orders were still imported): ${message}`);
      }
    }
  }

  const verify = await verifyParity(prisma, {
    eventId: event.id,
    legacyMetrics: metrics,
    dryRun: !!opts.dryRun,
    plannedOrders:
      commonOrders.length +
      separateAddons.length +
      cafeClosings.length +
      e3Bookings.length +
      timeExtensions.length,
  });

  return {
    legacy: {
      eventIds,
      title: primary.title,
      slug: primary.slug,
      metrics,
    },
    target: {
      eventId: event.id,
      slug: event.slug,
      title: target.title,
      created: target.created,
    },
    ticketMap: ticketMapResult,
    addonMap: addonMapResult,
    timeExtensionMap: timeExtensionMapResult,
    thirdPartyVendors: thirdPartyVendors.result,
    cafes: cafeCatalog.result,
    organiser: organiserRef
      ? {
          legacyUserId: primary.user_id!,
          userId: organiserRef.userId,
          email: organiserRef.email,
        }
      : null,
    posAgents: posLegacyIds
      .map((legacyUserId) => {
        const ref = staffUsers.byLegacyId.get(legacyUserId);
        if (!ref) return null;
        return { legacyUserId, userId: ref.userId, email: ref.email };
      })
      .filter((row): row is { legacyUserId: number; userId: string; email: string } => !!row),
    planned: {
      customers: customers.uniqueEmails,
      orders:
        commonOrders.length +
        separateAddons.length +
        cafeClosings.length +
        e3Bookings.length +
        timeExtensions.length,
      orderItems: plannedItems,
      payments: plannedPayments,
      sessions: sessionCache.size || 1,
      separateAddonOrders: separateAddons.length,
      cafeOrders: cafeClosings.length,
      e3Orders: e3Bookings.length,
      timeExtensionOrders: timeExtensions.length,
    },
    written: opts.dryRun
      ? undefined
      : {
          customersCreated: customers.created,
          ordersCreated,
          ordersSkippedExisting: ordersSkipped,
          orderItemsCreated,
          paymentsCreated,
        },
    warnings: warnings.length ? warnings : undefined,
    timing: timingResult,
    verify,
  };
}

async function verifyParity(
  prisma: PrismaClient,
  args: {
    eventId: string;
    legacyMetrics: Awaited<ReturnType<typeof getLegacyMetrics>>;
    dryRun: boolean;
    plannedOrders: number;
  },
) {
  const parity = args.legacyMetrics.parity;
  const old = {
    orders: args.legacyMetrics.orders,
    tickets: args.legacyMetrics.tickets,
    admits: args.legacyMetrics.admits,
    revenue: Number(args.legacyMetrics.revenue.toFixed(3)),
    parity: {
      tickets: parity.tickets,
      admits: parity.admits,
      revenue: Number(parity.revenue.toFixed(3)),
    },
  };

  if (args.dryRun) {
    return {
      old,
      neu: {
        orders: args.plannedOrders,
        tickets: parity.tickets,
        admits: parity.admits,
        revenue: Number(parity.revenue.toFixed(3)),
      },
      match: true,
    };
  }

  const legacyAgg = await prisma.order.aggregate({
    where: {
      eventId: args.eventId,
      idempotencyKey: { startsWith: 'legacy-mysql:' },
    },
    _count: { _all: true },
    _sum: {
      totalQuantity: true,
      totalAdmits: true,
      ticketsNet: true,
      addonsNet: true,
      extensionsNet: true,
    },
  });

  const neuRevenue =
    Number(legacyAgg._sum.ticketsNet ?? 0) +
    Number(legacyAgg._sum.addonsNet ?? 0) +
    Number(legacyAgg._sum.extensionsNet ?? 0);
  const neu = {
    orders: legacyAgg._count._all,
    tickets: legacyAgg._sum.totalQuantity ?? 0,
    admits: legacyAgg._sum.totalAdmits ?? 0,
    revenue: Number(neuRevenue.toFixed(3)),
  };

  const match =
    neu.tickets === parity.tickets &&
    neu.admits === parity.admits &&
    Math.abs(neu.revenue - parity.revenue) < 0.02;

  return { old, neu, match };
}

export async function verifyMigratedEvent(
  prisma: PrismaClient,
  oldEvent: string,
  newEventSlug: string,
) {
  const { primary, eventIds, commonEventId } = await resolveLegacyEventIds(oldEvent);
  const metrics = await getLegacyMetrics(eventIds, commonEventId);
  const event = await prisma.event.findUnique({
    where: { slug: newEventSlug },
    select: { id: true, slug: true },
  });
  if (!event) throw new Error(`New event not found: ${newEventSlug}`);

  const legacyAgg = await prisma.order.aggregate({
    where: {
      eventId: event.id,
      idempotencyKey: { startsWith: 'legacy-mysql:' },
    },
    _count: { _all: true },
    _sum: {
      totalQuantity: true,
      totalAdmits: true,
      ticketsNet: true,
      addonsNet: true,
      extensionsNet: true,
      totalAmount: true,
    },
  });

  const ticketBreakdown = await prisma.orderItem.groupBy({
    by: ['displayName'],
    where: {
      eventId: event.id,
      itemType: { in: ['ticket_type', 'ticket_variant'] },
      order: { idempotencyKey: { startsWith: 'legacy-mysql:' } },
    },
    _sum: { quantity: true, admitCount: true, totalAmount: true },
    _count: { _all: true },
  });

  const neuRevenue =
    Number(legacyAgg._sum.ticketsNet ?? 0) +
    Number(legacyAgg._sum.addonsNet ?? 0) +
    Number(legacyAgg._sum.extensionsNet ?? 0);
  const parity = metrics.parity;

  return {
    legacyEvent: { id: primary.id, title: primary.title, slug: primary.slug, eventIds },
    newEvent: event,
    old: {
      orders: metrics.orders,
      tickets: metrics.tickets,
      admits: metrics.admits,
      revenue: Number(metrics.revenue.toFixed(3)),
      addon_revenue: Number(metrics.addon_revenue.toFixed(3)),
      separate_addon_revenue: Number(metrics.separate_addon_revenue.toFixed(3)),
      cafe_sales: Number(metrics.cafe_sales.toFixed(3)),
      cafe_tickets: metrics.cafe_tickets,
      cafe_admits: metrics.cafe_admits,
      time_extension_revenue: Number(metrics.time_extension_revenue.toFixed(3)),
      time_extension_orders: metrics.time_extension_orders,
      e3_tickets: metrics.e3_tickets,
      e3_admits: metrics.e3_admits,
      e3_revenue: Number(metrics.e3_revenue.toFixed(3)),
      parity: {
        tickets: parity.tickets,
        admits: parity.admits,
        revenue: Number(parity.revenue.toFixed(3)),
      },
      by_ticket: metrics.by_ticket,
    },
    neu: {
      orders: legacyAgg._count._all,
      tickets: legacyAgg._sum.totalQuantity ?? 0,
      admits: legacyAgg._sum.totalAdmits ?? 0,
      ticketsNet: Number(Number(legacyAgg._sum.ticketsNet ?? 0).toFixed(3)),
      addonsNet: Number(Number(legacyAgg._sum.addonsNet ?? 0).toFixed(3)),
      extensionsNet: Number(Number(legacyAgg._sum.extensionsNet ?? 0).toFixed(3)),
      totalAmount: Number(Number(legacyAgg._sum.totalAmount ?? 0).toFixed(3)),
      revenue: Number(neuRevenue.toFixed(3)),
      by_ticket: ticketBreakdown.map((r) => ({
        title: r.displayName,
        lines: r._count._all,
        qty: r._sum.quantity ?? 0,
        admits: r._sum.admitCount ?? 0,
        revenue: Number(Number(r._sum.totalAmount ?? 0).toFixed(3)),
      })),
    },
    match: {
      tickets: (legacyAgg._sum.totalQuantity ?? 0) === parity.tickets,
      admits: (legacyAgg._sum.totalAdmits ?? 0) === parity.admits,
      revenue: Math.abs(neuRevenue - parity.revenue) < 0.02,
    },
  };
}
