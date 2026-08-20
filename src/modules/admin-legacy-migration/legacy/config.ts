/**
 * Legacy MySQL → V2 PostgreSQL migration config.
 *
 * Sources:
 *   local  → LEGACY_MYSQL_*        (Laragon / local dump)
 *   live   → LEGACY_MYSQL_LIVE_*   (Azure / production)
 *
 * New DB always uses DATABASE_URL (Prisma / PostgreSQL).
 */
import { createHash } from 'crypto';

export type LegacyMysqlSource = 'local' | 'live';

export type LegacyMysqlConfig = {
  source: LegacyMysqlSource;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  /** Azure MySQL requires TLS. */
  ssl: boolean;
};

function clean(value: string | undefined, fallback: string) {
  return (value ?? fallback).replace(/^"|"$/g, '').trim();
}

export function loadLegacyMysqlConfig(source: LegacyMysqlSource = 'local'): LegacyMysqlConfig {
  if (source === 'live') {
    return {
      source: 'live',
      host: clean(process.env.LEGACY_MYSQL_LIVE_HOST, ''),
      port: Number(process.env.LEGACY_MYSQL_LIVE_PORT || 3306),
      user: clean(process.env.LEGACY_MYSQL_LIVE_USER, ''),
      password: clean(process.env.LEGACY_MYSQL_LIVE_PASSWORD, ''),
      database: clean(process.env.LEGACY_MYSQL_LIVE_DATABASE, ''),
      ssl: process.env.LEGACY_MYSQL_LIVE_SSL !== 'false',
    };
  }

  return {
    source: 'local',
    host: clean(process.env.LEGACY_MYSQL_HOST, '127.0.0.1'),
    port: Number(process.env.LEGACY_MYSQL_PORT || 3306),
    user: clean(process.env.LEGACY_MYSQL_USER, 'root'),
    password: clean(process.env.LEGACY_MYSQL_PASSWORD, ''),
    database: clean(process.env.LEGACY_MYSQL_DATABASE, 'bookingqube'),
    ssl: process.env.LEGACY_MYSQL_SSL === 'true',
  };
}

export function parseLegacyMysqlSource(raw?: string | null): LegacyMysqlSource {
  return raw === 'live' ? 'live' : 'local';
}

export function assertLegacyMysqlConfig(cfg: LegacyMysqlConfig) {
  if (!cfg.host || !cfg.user || !cfg.database) {
    const prefix = cfg.source === 'live' ? 'LEGACY_MYSQL_LIVE_*' : 'LEGACY_MYSQL_*';
    throw new Error(
      `Legacy MySQL (${cfg.source}) is not configured. Set ${prefix} in bookingqube-backend/.env`,
    );
  }
}

/** Orders imported from legacy MySQL carry these source tags. */
export const LEGACY_ORDER_SOURCE = 'legacy_mysql';
export const LEGACY_ORDER_SOURCE_ADDON = 'legacy_mysql_addon';
export const LEGACY_ORDER_SOURCE_CAFE = 'legacy_mysql_cafe';
export const LEGACY_ORDER_SOURCE_E3 = 'legacy_mysql_e3';
export const LEGACY_ORDER_SOURCE_TIME_EXTENSION = 'legacy_mysql_time_extension';

export const LEGACY_ORDER_SOURCES = [
  LEGACY_ORDER_SOURCE,
  LEGACY_ORDER_SOURCE_ADDON,
  LEGACY_ORDER_SOURCE_CAFE,
  LEGACY_ORDER_SOURCE_E3,
  LEGACY_ORDER_SOURCE_TIME_EXTENSION,
] as const;

/** Idempotency / commonOrder prefixes for safe re-runs. */
export const LEGACY_IDEM_PREFIX = 'legacy-mysql:';
export const LEGACY_COMMON_ORDER_PREFIX = 'LEGACY-';

/** Ticket externalKey for auto-created catalog rows. */
export function legacyTicketExternalKey(oldTicketId: number) {
  return `legacy-ticket-${oldTicketId}`;
}

/** Playtime-pack → TicketVariant externalKey. */
export function legacyPlaytimePackExternalKey(oldPackId: number) {
  return `legacy-pack-${oldPackId}`;
}

/** Ticket activity → TicketCustomizationOption externalKey. */
export function legacyTicketActivityExternalKey(oldActivityId: number) {
  return `legacy-ticket-activity-${oldActivityId}`;
}

export function legacyCafeEodExternalKey(eventId: string) {
  return `legacy-cafe-eod-${eventId}`;
}

/**
 * Marker stored in Cafe.details for idempotent re-imports.
 * Includes V2 eventId so the same legacy org-group name/id never reuses a
 * cafe belonging to a different migrated event.
 */
export function legacyCafeOrgGroupMarker(orgGroupId: number, eventId?: string) {
  if (eventId) {
    return `[legacy:organiser_group:${orgGroupId}|event:${eventId}]`;
  }
  return `[legacy:organiser_group:${orgGroupId}]`;
}

/** True when `text` contains the full `marker` token (not a digit-prefix of another id). */
export function hasExactLegacyMarker(
  text: string | null | undefined,
  marker: string,
): boolean {
  if (!text || !marker) return false;
  let from = 0;
  while (from <= text.length) {
    const idx = text.indexOf(marker, from);
    if (idx < 0) return false;
    const afterIdx = idx + marker.length;
    const after = text[afterIdx];
    // If marker already ends with `]` (our standard format), a hit is exact.
    // Otherwise reject when the next char continues a numeric id (e.g. "10" vs "100").
    if (marker.endsWith(']')) return true;
    if (after == null || !/[0-9]/.test(after)) return true;
    from = idx + 1;
  }
  return false;
}

/** Marker stored in CafeMenuItem.description for pack → item mapping. */
export function legacyCafePackItemMarker(packId: number) {
  return `[legacy:playtime_pack:${packId}]`;
}

/** Marker for default cafe item when a cafe ticket has no playtime packs. */
export function legacyCafeTicketDefaultItemMarker(ticketId: number) {
  return `[legacy:ticket-default:${ticketId}]`;
}

/** Marker on CafeMenuCategory.titleAr (fallback slot) for ticket → category. */
export function legacyCafeTicketCategoryMarker(ticketId: number) {
  return `[legacy:ticket:${ticketId}]`;
}

export function legacyE3OnsiteExternalKey(eventId: string) {
  return `legacy-e3-onsite-${eventId}`;
}

export function legacyCommonOrder(oldCommonOrder: string) {
  return `${LEGACY_COMMON_ORDER_PREFIX}${oldCommonOrder}`;
}

export function legacyIdempotencyKey(oldCommonOrder: string) {
  return `${LEGACY_IDEM_PREFIX}${oldCommonOrder}`;
}

export function legacySeparateAddonCommonOrder(addonId: number) {
  return `${LEGACY_COMMON_ORDER_PREFIX}ADDON-${addonId}`;
}

export function legacySeparateAddonIdempotencyKey(addonId: number) {
  return `${LEGACY_IDEM_PREFIX}addon-${addonId}`;
}

export function legacyCafeCommonOrder(closingId: number) {
  return `${LEGACY_COMMON_ORDER_PREFIX}CAFE-${closingId}`;
}

export function legacyCafeIdempotencyKey(closingId: number) {
  return `${LEGACY_IDEM_PREFIX}cafe-${closingId}`;
}

export function legacyE3CommonOrder(e3Id: number) {
  return `${LEGACY_COMMON_ORDER_PREFIX}E3-${e3Id}`;
}

export function legacyE3IdempotencyKey(e3Id: number) {
  return `${LEGACY_IDEM_PREFIX}e3-${e3Id}`;
}

/** Addon catalog externalKey for auto-created rows. */
export function legacyAddonExternalKey(oldAddonId: number) {
  return `legacy-addon-${oldAddonId}`;
}

/** Deterministic UUID for a legacy time_extensions catalog row (moreOps + order itemId). */
export function legacyTimeExtensionPackId(oldExtensionId: number) {
  const h = createHash('md5')
    .update(`bookingqube:legacy-te-pack:${oldExtensionId}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function legacyTimeExtensionExternalKey(eventId: string) {
  return `legacy-time-extension-${eventId}`;
}

export function legacyTimeExtensionCommonOrder(extensionId: number) {
  return `${LEGACY_COMMON_ORDER_PREFIX}TE-${extensionId}`;
}

export function legacyTimeExtensionIdempotencyKey(extensionId: number) {
  return `${LEGACY_IDEM_PREFIX}te-${extensionId}`;
}
