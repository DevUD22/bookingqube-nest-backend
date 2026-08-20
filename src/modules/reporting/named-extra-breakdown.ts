import { createHash } from 'crypto';
import { OrderItemType } from '@prisma/client';

/** Additive detail rows — does not feed vendor-product / tickets-by-type rollups. */
export type NamedExtraKind = 'addon' | 'time_extension';

/** Unattributed vendor bucket for lines without third_party_vendor_id (no FK). */
export const NAMED_EXTRA_UNATTRIBUTED_VENDOR_ID =
  '00000000-0000-4000-8000-000000000099';

export type NamedExtraLineInput = {
  itemId: string;
  itemType: OrderItemType;
  displayName: string;
  quantity: number;
  totalAmount: number;
  parentOrderItemId: string | null;
  orderId: string;
  thirdPartyVendorId?: string | null;
};

export type NamedExtraBucket = {
  kind: NamedExtraKind;
  /** Stable catalog id when available; otherwise a name-derived key. */
  product_id: string;
  name: string;
  quantity: number;
  order_count: number;
  revenue: number;
  with_ticket_qty: number;
  standalone_qty: number;
};

/** One order's contribution to daily named-extra rollups (fast write path). */
export type NamedExtraRollupBucket = {
  thirdPartyVendorId: string;
  productKind: NamedExtraKind;
  nameKey: string;
  productId: string;
  productLabel: string;
  orderCount: number;
  itemQty: number;
  withTicketQty: number;
  standaloneQty: number;
  revenueTotal: number;
};

const ADDON_TYPES: OrderItemType[] = [
  OrderItemType.addon,
  OrderItemType.addon_variant,
];

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

export function normalizeNamedExtraLabel(value: string, kind: NamedExtraKind) {
  const trimmed = value.trim();
  if (trimmed) return trimmed;
  return kind === 'addon' ? 'Addon' : 'Time Extension';
}

export function namedExtraNameKey(kind: NamedExtraKind, label: string) {
  return `${kind}|${normalizeNamedExtraLabel(label, kind).toLowerCase()}`.slice(
    0,
    190,
  );
}

/** Deterministic UUID so productId stays a UUID column even for name-only keys. */
export function namedExtraProductIdFromKey(nameKey: string) {
  const h = createHash('md5')
    .update(`bookingqube:named-extra:${nameKey}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function kindForItemType(itemType: OrderItemType): NamedExtraKind | null {
  if (ADDON_TYPES.includes(itemType)) return 'addon';
  if (itemType === OrderItemType.customization) return 'time_extension';
  return null;
}

/**
 * Per-order rollup buckets keyed by vendor + kind + name.
 * Used by ReportingService sync + rebuild scripts (not live order_items reads).
 */
export function buildNamedExtraRollupBuckets(
  items: NamedExtraLineInput[],
): NamedExtraRollupBucket[] {
  type Acc = NamedExtraRollupBucket & {
    itemIdCounts: Map<string, number>;
    orderIds: Set<string>;
  };
  const byKey = new Map<string, Acc>();

  for (const item of items) {
    const kind = kindForItemType(item.itemType);
    if (!kind) continue;
    const label = normalizeNamedExtraLabel(item.displayName, kind);
    const nameKey = namedExtraNameKey(kind, label);
    const vendorId =
      item.thirdPartyVendorId || NAMED_EXTRA_UNATTRIBUTED_VENDOR_ID;
    const key = `${vendorId}|${nameKey}`;
    const qty = Math.max(0, Number(item.quantity) || 0);
    const current = byKey.get(key) ?? {
      thirdPartyVendorId: vendorId,
      productKind: kind,
      nameKey,
      productId: item.itemId,
      productLabel: label,
      orderCount: 0,
      itemQty: 0,
      withTicketQty: 0,
      standaloneQty: 0,
      revenueTotal: 0,
      itemIdCounts: new Map<string, number>(),
      orderIds: new Set<string>(),
    };

    current.itemQty += qty;
    current.revenueTotal = money(
      current.revenueTotal + Number(item.totalAmount || 0),
    );
    if (item.parentOrderItemId) current.withTicketQty += qty;
    else current.standaloneQty += qty;
    current.orderIds.add(item.orderId);
    current.itemIdCounts.set(
      item.itemId,
      (current.itemIdCounts.get(item.itemId) ?? 0) + qty,
    );
    byKey.set(key, current);
  }

  return [...byKey.values()]
    .map((row) => {
      let bestId = row.productId;
      let bestQty = -1;
      for (const [id, qty] of row.itemIdCounts) {
        if (qty > bestQty) {
          bestQty = qty;
          bestId = id;
        }
      }
      return {
        thirdPartyVendorId: row.thirdPartyVendorId,
        productKind: row.productKind,
        nameKey: row.nameKey,
        productId: bestId || namedExtraProductIdFromKey(row.nameKey),
        productLabel: row.productLabel,
        // Per-order sync calls still resolve to 1; multi-order rebuild uses distinct count.
        orderCount: Math.max(1, row.orderIds.size),
        itemQty: row.itemQty,
        withTicketQty: row.withTicketQty,
        standaloneQty: row.standaloneQty,
        revenueTotal: row.revenueTotal,
      };
    })
    .filter((row) => row.itemQty > 0 || row.revenueTotal > 0);
}

/**
 * Group addon / time-extension lines by kind + display name (in-memory / tests).
 */
export function buildNamedExtraBuckets(
  items: NamedExtraLineInput[],
): NamedExtraBucket[] {
  const rollups = buildNamedExtraRollupBuckets(items);
  const byName = new Map<string, NamedExtraBucket>();
  for (const row of rollups) {
    const key = row.nameKey;
    const current = byName.get(key) ?? {
      kind: row.productKind,
      product_id: row.productId,
      name: row.productLabel,
      quantity: 0,
      order_count: 0,
      revenue: 0,
      with_ticket_qty: 0,
      standalone_qty: 0,
    };
    current.quantity += row.itemQty;
    current.order_count += row.orderCount;
    current.revenue = money(current.revenue + row.revenueTotal);
    current.with_ticket_qty += row.withTicketQty;
    current.standalone_qty += row.standaloneQty;
    current.product_id = row.productId;
    byName.set(key, current);
  }

  return [...byName.values()]
    .filter((row) => row.quantity > 0 || row.revenue > 0)
    .sort((a, b) => {
      const byKind = a.kind.localeCompare(b.kind);
      if (byKind !== 0) return byKind;
      return b.quantity - a.quantity || b.revenue - a.revenue;
    });
}

/** Merge daily rollup rows into API-shaped named-extra buckets. */
export function mergeNamedExtraDailyRows(
  rows: Array<{
    productKind: string;
    productId: string;
    productLabel: string;
    orderCount: number;
    itemQty: number;
    withTicketQty: number;
    standaloneQty: number;
    revenueTotal: number;
  }>,
): NamedExtraBucket[] {
  const byKey = new Map<string, NamedExtraBucket>();
  for (const row of rows) {
    const kind =
      row.productKind === 'time_extension' ? 'time_extension' : 'addon';
    const label = normalizeNamedExtraLabel(row.productLabel, kind);
    const key = namedExtraNameKey(kind, label);
    const current = byKey.get(key) ?? {
      kind,
      product_id: row.productId,
      name: label,
      quantity: 0,
      order_count: 0,
      revenue: 0,
      with_ticket_qty: 0,
      standalone_qty: 0,
    };
    current.quantity += row.itemQty;
    current.order_count += row.orderCount;
    current.revenue = money(current.revenue + row.revenueTotal);
    current.with_ticket_qty += row.withTicketQty;
    current.standalone_qty += row.standaloneQty;
    current.product_id = row.productId;
    byKey.set(key, current);
  }
  return [...byKey.values()]
    .filter((row) => row.quantity > 0 || row.revenue > 0)
    .sort((a, b) => {
      const byKind = a.kind.localeCompare(b.kind);
      if (byKind !== 0) return byKind;
      return b.quantity - a.quantity || b.revenue - a.revenue;
    });
}
