import { OrderItemType } from '@prisma/client';

const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];
const ADDON_TYPES: OrderItemType[] = [
  OrderItemType.addon,
  OrderItemType.addon_variant,
];

/** Stable ids for synthetic Vendors & POS product rows. */
export const SEPARATE_ADDON_PRODUCT_ID = '00000000-0000-4000-8000-000000000001';
export const TIME_EXTENSION_PRODUCT_ID = '00000000-0000-4000-8000-000000000002';

export type VendorProductKind = 'ticket' | 'separate_addon' | 'time_extension';

export type VendorProductLineInput = {
  id: string;
  itemId: string;
  itemType: OrderItemType;
  displayName: string;
  quantity: number;
  admitCount: number;
  totalAmount: number;
  discountAmount: number;
  thirdPartyVendorId: string | null;
  ticketIsCafe: boolean;
  parentOrderItemId: string | null;
  createdAt: Date;
  /**
   * Optional stable line order (legacy bookings.id). When present, used instead
   * of createdAt/UUID so addon attribution matches old MIN(bookings.id).
   */
  lineSortKey?: number | null;
  /** Ticket code / legacy order_number — used to resolve lineSortKey from metadata. */
  ticketCode?: string | null;
};

export type VendorProductBucket = {
  thirdPartyVendorId: string;
  productId: string;
  productLabel: string;
  productKind: VendorProductKind;
  /** 1 if this order contributes an order to the product row, else 0. */
  orderCount: number;
  ticketQty: number;
  admitCount: number;
  addonAmount: number;
  /** With-ticket time extensions / customizations, or standalone TE row total. */
  timeExtensionAmount: number;
  ticketRevenue: number;
  discountAmount: number;
  netRevenue: number;
};

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

/** True when order.metadata comes from legacy MySQL migration. */
export function isLegacyMigratedOrder(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object') return false;
  return Boolean((metadata as Record<string, unknown>).legacy);
}

/** Read legacy bookings.addon_price for Tickets Info parity (may be 0). */
export function legacyFirstAddonAmountFromMetadata(
  metadata: unknown,
): number | null {
  if (!isLegacyMigratedOrder(metadata)) return null;
  const legacy = (metadata as Record<string, unknown>).legacy as
    | Record<string, unknown>
    | undefined;
  if (!legacy) return null;
  if (legacy.addon_price == null) return null;
  const n = Number(legacy.addon_price);
  return Number.isFinite(n) ? n : null;
}

type LegacyBookingLineMeta = {
  booking_id?: unknown;
  order_number?: unknown;
};

/**
 * Map legacy order_number → bookings.id from order.metadata.legacy.booking_lines.
 * Used so migrated multi-ticket carts attribute addons to the same first line as old.
 */
export function legacyBookingSortKeysByTicketCode(
  metadata: unknown,
): Map<string, number> {
  const out = new Map<string, number>();
  if (!metadata || typeof metadata !== 'object') return out;
  const legacy = (metadata as Record<string, unknown>).legacy;
  if (!legacy || typeof legacy !== 'object') return out;
  const lines = (legacy as Record<string, unknown>).booking_lines;
  if (!Array.isArray(lines)) return out;

  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const line = raw as LegacyBookingLineMeta;
    const orderNumber =
      typeof line.order_number === 'string'
        ? line.order_number.trim()
        : line.order_number != null
          ? String(line.order_number).trim()
          : '';
    const bookingId = Number(line.booking_id);
    if (!orderNumber || !Number.isFinite(bookingId)) continue;
    out.set(orderNumber, bookingId);
  }
  return out;
}

export function withLegacyLineSortKeys<T extends VendorProductLineInput>(
  items: T[],
  metadata: unknown,
): T[] {
  const byCode = legacyBookingSortKeysByTicketCode(metadata);
  if (byCode.size === 0) return items;
  return items.map((item) => {
    if (item.lineSortKey != null) return item;
    const code = item.ticketCode?.trim();
    if (!code) return item;
    const key = byCode.get(code);
    if (key == null) return item;
    return { ...item, lineSortKey: key };
  });
}

function compareTicketLines(
  a: VendorProductLineInput,
  b: VendorProductLineInput,
): number {
  const aKey = a.lineSortKey;
  const bKey = b.lineSortKey;
  if (aKey != null && bKey != null && aKey !== bKey) return aKey - bKey;
  if (aKey != null && bKey == null) return -1;
  if (aKey == null && bKey != null) return 1;
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/**
 * Per-order vendor product buckets for Vendors & POS Product breakdown.
 * Matches legacy Tickets Info: with-ticket addons on first ticket, separate
 * addons + standalone time extensions as synthetic rows, discount on tickets.
 * Parent-linked customizations (time extensions booked with a ticket) land in
 * timeExtensionAmount on that ticket — not addonAmount.
 * Free (zero net) ticket lines still receive addons when first, but do not
 * increment ticket/visitor counts — same as old net_price = 0 handling.
 */
export function buildVendorProductBuckets(input: {
  orderDiscountAmount: number;
  /**
   * Legacy Tickets Info uses bookings.addon_price on MIN(id), not SUM(addons_booking).
   * When set (including 0), with-ticket addon lines are ignored and this amount is
   * attributed to the first ticket instead — keeps migrated reports aligned with old.
   */
  legacyFirstAddonAmount?: number | null;
  items: VendorProductLineInput[];
}): VendorProductBucket[] {
  const items = input.items;
  const tickets = items
    .filter(
      (item) =>
        TICKET_TYPES.includes(item.itemType) &&
        !item.ticketIsCafe &&
        !!item.thirdPartyVendorId,
    )
    .sort(compareTicketLines);

  // Event-owner tickets (null vendor) are omitted from ticket product buckets
  // (FK requires a real vendor), but they still mean the cart is not addon-only.
  const hasTickets =
    tickets.length > 0 ||
    items.some(
      (item) => TICKET_TYPES.includes(item.itemType) && !item.ticketIsCafe,
    );
  const byKey = new Map<string, VendorProductBucket>();
  const useLegacyAddon = input.legacyFirstAddonAmount != null && hasTickets;

  const ensureTicket = (item: VendorProductLineInput) => {
    const vendorId = item.thirdPartyVendorId!;
    const key = `ticket:${vendorId}:${item.itemId}`;
    const current = byKey.get(key) ?? {
      thirdPartyVendorId: vendorId,
      productId: item.itemId,
      productLabel: item.displayName,
      productKind: 'ticket' as const,
      orderCount: 0,
      ticketQty: 0,
      admitCount: 0,
      addonAmount: 0,
      timeExtensionAmount: 0,
      ticketRevenue: 0,
      discountAmount: 0,
      netRevenue: 0,
    };
    byKey.set(key, current);
    return current;
  };

  for (const item of tickets) {
    const bucket = ensureTicket(item);
    bucket.orderCount = 1;
    // Legacy Tickets Info zeros quantity/admits when net_price = 0.
    if (item.totalAmount !== 0) {
      bucket.ticketQty += item.quantity;
      bucket.admitCount += item.admitCount * item.quantity;
    }
    bucket.ticketRevenue = money(bucket.ticketRevenue + item.totalAmount);
    if (item.totalAmount !== 0) {
      bucket.discountAmount = money(bucket.discountAmount + item.discountAmount);
    }
    bucket.productLabel = item.displayName;
  }

  const firstTicketByVendor = new Map<string, VendorProductLineInput>();
  for (const item of tickets) {
    const vendorId = item.thirdPartyVendorId!;
    if (!firstTicketByVendor.has(vendorId)) {
      firstTicketByVendor.set(vendorId, item);
    }
  }

  const lineDiscountTotal = money(
    tickets.reduce(
      (sum, item) =>
        sum + (item.totalAmount !== 0 ? item.discountAmount : 0),
      0,
    ),
  );
  if (input.orderDiscountAmount > 0 && lineDiscountTotal <= 0) {
    for (const [vendorId, first] of firstTicketByVendor) {
      // Attribute full order promo once (legacy first-booking style). Prefer main/first vendor.
      if ([...firstTicketByVendor.keys()][0] !== vendorId) continue;
      const bucket = ensureTicket(first);
      bucket.discountAmount = money(
        bucket.discountAmount + input.orderDiscountAmount,
      );
    }
  }

  if (useLegacyAddon) {
    // One amount on the overall first ticket (legacy MIN(bookings.id) product).
    const firstVendorId = [...firstTicketByVendor.keys()][0];
    const first = firstVendorId
      ? firstTicketByVendor.get(firstVendorId)
      : undefined;
    if (first) {
      const bucket = ensureTicket(first);
      bucket.addonAmount = money(
        bucket.addonAmount + Number(input.legacyFirstAddonAmount || 0),
      );
    }
  }

  const itemById = new Map(items.map((item) => [item.id, item]));

  for (const item of items) {
    if (!item.thirdPartyVendorId) continue;

    if (ADDON_TYPES.includes(item.itemType)) {
      if (hasTickets) {
        if (useLegacyAddon) continue;
        const first = firstTicketByVendor.get(item.thirdPartyVendorId);
        // No matching vendor ticket bucket (e.g. event-owner tickets + mis-stamped
        // shareholder addon) — skip rather than inventing a Separate Addons row.
        if (!first) continue;
        const bucket = ensureTicket(first);
        bucket.addonAmount = money(bucket.addonAmount + item.totalAmount);
      } else {
        const key = `separate_addon:${item.thirdPartyVendorId}`;
        const current = byKey.get(key) ?? {
          thirdPartyVendorId: item.thirdPartyVendorId,
          productId: SEPARATE_ADDON_PRODUCT_ID,
          productLabel: 'Separate Addons',
          productKind: 'separate_addon' as const,
          orderCount: 0,
          ticketQty: 0,
          admitCount: 0,
          addonAmount: 0,
          timeExtensionAmount: 0,
          ticketRevenue: 0,
          discountAmount: 0,
          netRevenue: 0,
        };
        current.orderCount = 1;
        current.ticketQty += item.quantity;
        current.addonAmount = money(current.addonAmount + item.totalAmount);
        byKey.set(key, current);
      }
      continue;
    }

    if (item.itemType !== OrderItemType.customization) continue;

    if (item.parentOrderItemId) {
      const parent = itemById.get(item.parentOrderItemId);
      if (
        !parent ||
        !parent.thirdPartyVendorId ||
        !TICKET_TYPES.includes(parent.itemType) ||
        parent.ticketIsCafe
      ) {
        continue;
      }
      const bucket = ensureTicket(parent);
      bucket.timeExtensionAmount = money(
        bucket.timeExtensionAmount + item.totalAmount,
      );
      continue;
    }

    const key = `time_extension:${item.thirdPartyVendorId}`;
    const current = byKey.get(key) ?? {
      thirdPartyVendorId: item.thirdPartyVendorId,
      productId: TIME_EXTENSION_PRODUCT_ID,
      productLabel: 'Time Extension Purchase',
      productKind: 'time_extension' as const,
      orderCount: 0,
      ticketQty: 0,
      admitCount: 0,
      addonAmount: 0,
      timeExtensionAmount: 0,
      ticketRevenue: 0,
      discountAmount: 0,
      netRevenue: 0,
    };
    current.orderCount = 1;
    current.ticketQty += item.quantity;
    current.timeExtensionAmount = money(
      current.timeExtensionAmount + item.totalAmount,
    );
    current.netRevenue = money(current.netRevenue + item.totalAmount);
    byKey.set(key, current);
  }

  // Line totals stay pre-promo for native checkout (order.discountAmount holds the
  // promo). When we attribute that order promo onto a ticket's discountAmount,
  // subtract it here so Net = Gross − Discount. Line-level discountAmount (legacy
  // promocode_reward) means totalAmount is already net — do not subtract again.
  const subtractOrderPromoFromNet =
    input.orderDiscountAmount > 0 && lineDiscountTotal <= 0;

  for (const bucket of byKey.values()) {
    if (bucket.productKind === 'ticket') {
      const gross = money(
        bucket.ticketRevenue + bucket.addonAmount + bucket.timeExtensionAmount,
      );
      bucket.netRevenue = subtractOrderPromoFromNet
        ? money(Math.max(0, gross - bucket.discountAmount))
        : gross;
    } else if (bucket.productKind === 'separate_addon') {
      bucket.netRevenue = bucket.addonAmount;
    } else if (bucket.productKind === 'time_extension') {
      bucket.netRevenue = bucket.timeExtensionAmount;
    }
  }

  return [...byKey.values()].filter(
    (bucket) => bucket.netRevenue !== 0 || bucket.ticketQty > 0,
  );
}
