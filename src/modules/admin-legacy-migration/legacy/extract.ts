import type { RowDataPacket } from 'mysql2';
import { normalizeCustomerAgeGroup } from '../../reporting/camp-age-groups';
import { legacyDateOnlyQatar } from './mappers';
import { mysqlQuery } from './mysql-client';

export type LegacyEventSummary = {
  id: number;
  title: string;
  slug: string;
  common_event_id: string | null;
  organiser_id: number | null;
  start_date: string | null;
  end_date: string | null;
  publish: number | null;
  booking_rows: number;
  orders: number;
  tickets: number;
  admits: number;
  revenue: number;
  event_ids: number[];
};

export type LegacyTicket = {
  id: number;
  event_id: number;
  title: string;
  /** Legacy tickets.ticket_type — e.g. normal | playtime_pack */
  ticket_type: string;
  price: number;
  admits: number;
  is_pos_only: number;
  only_for_third_party: number;
  is_complementary: number;
  /** 1 = guest picks activities at checkout → V2 TicketCustomizationOption. */
  is_customizable: number;
  /** 1 = sellable, 0 = inactive in legacy manage UI. */
  is_active: number;
  /** Legacy organiser_groups.id (0 = unassigned). */
  org_group_id: number;
  quantity: number | null;
  booking_rows: number;
  sold_qty: number;
  sold_admits: number;
  sold_revenue: number;
};

/** Legacy playtime_packs row — becomes a TicketVariant under its parent ticket. */
export type LegacyPlaytimePack = {
  id: number;
  ticket_id: number;
  title: string;
  /** Duration minutes as string in legacy (e.g. "15"); "0" = none. */
  slot: string;
  price: number;
  quantity: number | null;
  admits: number;
  max_per_ticket_qty: number;
  currency: string;
  description: string | null;
};

/** Legacy ticket_activities row — becomes TicketCustomizationOption when ticket is_customizable. */
export type LegacyTicketActivity = {
  id: number;
  ticket_id: number;
  activity_id: number;
  title: string;
  price: number;
  /** Duration minutes as string in legacy (e.g. "30"); "0"/null = none. */
  duration: string | null;
  description: string | null;
  /** duration | per_activity */
  activity_type: string;
  /** ACTIVE | INACTIVE */
  status: string;
};

export type LegacyOrganiserGroup = {
  id: number;
  event_id: number;
  /** DB column is misspelled `orgainser_name`. */
  name: string;
  is_main: number;
  org_share: number;
  third_share: number;
  is_cafe: number;
  collected_by: string | null;
  owner_name: string | null;
  owner_percentage_type: string | null;
};

export type LegacyStaffUser = {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  organizer_id: number | null;
};

export type LegacyBookingLine = {
  id: number;
  customer_id: number;
  organiser_id: number | null;
  event_id: number;
  ticket_id: number;
  /** Legacy playtime_packs.id when the line sold a pack variant; null for normal tickets. */
  playtime_pack_id: number | null;
  quantity: number;
  price: number;
  tax: number;
  net_price: number;
  status: number;
  booking_cancel: number;
  created_at: string;
  updated_at: string | null;
  event_title: string;
  event_start_date: string | null;
  event_end_date: string | null;
  event_start_time: string | null;
  event_end_time: string | null;
  ticket_title: string;
  ticket_price: number;
  order_number: string | null;
  transaction_id: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  /** From users.age_group — mapped to camp Group 1–4 (legacy getEventAgeGroupRevenueWiseChart). */
  customer_age_group: string | null;
  /** From users.geographic_region — powers getEventGeographicRegionBasedVisitorChart. */
  customer_geographic_region: string | null;
  currency: string | null;
  checked_in: number;
  payment_type: string;
  is_paid: number;
  promocode_id: number | null;
  promocode: string | null;
  /** Discount amount applied via promo (legacy column). */
  promocode_reward: number;
  /** Extra bulk-code discount when present. */
  bulk_discount: number;
  common_order: string;
  admits: number;
  payment_cash_card: string | null;
  addon_booking_no: string | null;
  addon_price: number;
  free_booking_type: string | null;
  booked_via: string | null;
  pos_id: number | null;
  is_pos_only: number;
  only_for_third_party: number;
  /** From joined tickets.org_group_id (0 = none). */
  ticket_org_group_id: number;
  /** From organiser_groups.is_cafe for the ticket's org group. */
  is_cafe: number;
};

export type LegacyAddonLine = {
  id: number;
  booking_no: string;
  common_order: string | null;
  addon_id: number | null;
  title: string;
  quantity: number;
  price: number;
  total: number;
  event_id: number | null;
};

/** Catalog row from legacy `addons` table. */
export type LegacyAddonCatalog = {
  id: number;
  event_id: number;
  title: string;
  title_ar: string | null;
  price: number;
  quantity: number;
  description: string | null;
  for_cafe_only: boolean;
  applicable_for: string | null;
};

/** Catalog row from legacy `time_extensions` table. */
export type LegacyTimeExtensionCatalog = {
  id: number;
  event_id: number;
  title_en: string;
  title_ar: string | null;
  duration: number;
  price: number;
};

export type LegacyTimeExtensionSnapshotItem = {
  time_extension_id: number | null;
  title_en: string | null;
  title_ar: string | null;
  duration: number;
  price: number;
};

/** Separate addons (addon_booking_no IS NULL) — not attached to a ticket order. */
export type LegacySeparateAddon = {
  id: number;
  event_id: number;
  addon_id: number | null;
  title: string;
  quantity: number;
  price: number;
  total: number;
  booking_type: string | null;
  payment_type: string | null;
  booked_by: number | null;
  customer_id: number | null;
  created_at: string;
  updated_at: string | null;
};

export type LegacyPosCafeClosing = {
  id: number;
  event_id: number;
  ticket_id: number | null;
  agent_id: number | null;
  closing_date: string;
  total_transactions: number;
  total_sales: number;
  total_cash: number;
  total_card: number;
  created_at: string | null;
};

export type LegacyE3Booking = {
  id: number;
  name: string | null;
  tickets: number;
  admit: number;
  total_paid: number;
  payment_srouce: string | null;
  activity: string | null;
  currency: string | null;
  common_event_id: string | null;
  org_group_id: number | null;
  organiser_id: number | null;
  created_at: string;
};

/** Standalone time-extension purchases (not bundled into ticket price). */
export type LegacyTimeExtensionPurchase = {
  id: number;
  booking_id: number | null;
  common_order: string | null;
  event_id: number;
  barcode: string | null;
  total_duration_minutes: number;
  total_amount: number;
  payment_method: string | null;
  currency: string | null;
  agent_id: number | null;
  extension_snapshot: LegacyTimeExtensionSnapshotItem[];
  created_at: string;
  updated_at: string | null;
};

export type LegacyMetrics = {
  booking_rows: number;
  orders: number;
  tickets: number;
  admits: number;
  revenue: number;
  /** Linked addons_booking totals (via bookings.addon_booking_no). */
  addon_revenue: number;
  /** First-row bookings.addon_price pattern (informational). */
  addon_revenue_first_row: number;
  separate_addon_revenue: number;
  cafe_sales: number;
  cafe_transactions: number;
  /** Cafe org-group booking qty/admits (excluded from parity tickets/admits). */
  cafe_tickets: number;
  cafe_admits: number;
  time_extension_revenue: number;
  time_extension_orders: number;
  e3_tickets: number;
  e3_admits: number;
  e3_revenue: number;
  /** Old-dashboard-equivalent totals for Match & migrate. */
  parity: {
    orders: number;
    tickets: number;
    admits: number;
    revenue: number;
  };
  by_ticket: Array<{
    ticket_id: number;
    ticket_title: string;
    tickets: number;
    admits: number;
    revenue: number;
  }>;
  by_payment: Array<{
    payment_type: string;
    payment_cash_card: string | null;
    orders: number;
    revenue: number;
  }>;
};

/** Resolve all event row ids that share the same common_event_id (dashboard scope). */
export async function resolveLegacyEventIds(selector: string | number): Promise<{
  primary: LegacyEventRow;
  eventIds: number[];
  commonEventId: string | null;
}> {
  const primary = await loadLegacyEvent(selector);
  if (!primary) {
    throw new Error(`Legacy event not found: ${selector}`);
  }
  let eventIds = [primary.id];
  if (primary.common_event_id) {
    const siblings = await mysqlQuery<RowDataPacket[]>(
      `SELECT id FROM events WHERE common_event_id = :cid`,
      { cid: primary.common_event_id },
    );
    eventIds = siblings.map((r) => Number(r.id));
  }
  return { primary, eventIds, commonEventId: primary.common_event_id };
}

type LegacyEventRow = {
  id: number;
  title: string;
  slug: string;
  common_event_id: string | null;
  user_id: number | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  publish: number | null;
  status: number | null;
  registration_only: number | null;
  summer_camp: number | null;
  featured: number | null;
  description: string | null;
};

export async function loadLegacyEvent(selector: string | number): Promise<LegacyEventRow | null> {
  const asNum = Number(selector);
  const rows = await mysqlQuery<RowDataPacket[]>(
    Number.isFinite(asNum) && String(asNum) === String(selector)
      ? `SELECT id, title, slug, common_event_id, user_id, start_date, end_date, start_time, end_time,
                publish, status, registration_only, summer_camp, featured, description
         FROM events WHERE id = :id LIMIT 1`
      : `SELECT id, title, slug, common_event_id, user_id, start_date, end_date, start_time, end_time,
                publish, status, registration_only, summer_camp, featured, description
         FROM events WHERE slug = :slug OR common_event_id = :slug LIMIT 1`,
    Number.isFinite(asNum) && String(asNum) === String(selector)
      ? { id: asNum }
      : { slug: String(selector) },
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: Number(r.id),
    title: String(r.title),
    slug: String(r.slug),
    common_event_id: r.common_event_id ? String(r.common_event_id) : null,
    user_id: r.user_id != null ? Number(r.user_id) : null,
    start_date: legacyDateOnlyQatar(r.start_date),
    end_date: legacyDateOnlyQatar(r.end_date),
    start_time: r.start_time ? String(r.start_time) : null,
    end_time: r.end_time ? String(r.end_time) : null,
    publish: r.publish != null ? Number(r.publish) : null,
    status: r.status != null ? Number(r.status) : null,
    registration_only: r.registration_only != null ? Number(r.registration_only) : null,
    summer_camp: r.summer_camp != null ? Number(r.summer_camp) : null,
    featured: r.featured != null ? Number(r.featured) : null,
    description: r.description != null ? String(r.description) : null,
  };
}

export async function listLegacyEvents(limit = 50): Promise<LegacyEventSummary[]> {
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      e.id,
      e.title,
      e.slug,
      e.common_event_id,
      e.user_id AS organiser_id,
      e.start_date,
      e.end_date,
      e.publish,
      COUNT(b.id) AS booking_rows,
      COUNT(DISTINCT b.common_order) AS orders,
      COALESCE(SUM(b.quantity), 0) AS tickets,
      COALESCE(SUM(b.admits), 0) AS admits,
      COALESCE(SUM(b.net_price), 0) AS revenue
    FROM events e
    LEFT JOIN bookings b ON b.event_id = e.id
    GROUP BY e.id
    HAVING booking_rows > 0 OR e.publish = 1
    ORDER BY revenue DESC, booking_rows DESC, e.id DESC
    LIMIT :limit
    `,
    { limit },
  );

  return rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    slug: String(r.slug),
    common_event_id: r.common_event_id ? String(r.common_event_id) : null,
    organiser_id: r.organiser_id != null ? Number(r.organiser_id) : null,
    start_date: legacyDateOnlyQatar(r.start_date),
    end_date: legacyDateOnlyQatar(r.end_date),
    publish: r.publish != null ? Number(r.publish) : null,
    booking_rows: Number(r.booking_rows),
    orders: Number(r.orders),
    tickets: Number(r.tickets),
    admits: Number(r.admits),
    revenue: Number(r.revenue),
    event_ids: [Number(r.id)],
  }));
}

export async function getLegacyMetrics(
  eventIds: number[],
  commonEventId?: string | null,
): Promise<LegacyMetrics> {
  const empty: LegacyMetrics = {
    booking_rows: 0,
    orders: 0,
    tickets: 0,
    admits: 0,
    revenue: 0,
    addon_revenue: 0,
    addon_revenue_first_row: 0,
    separate_addon_revenue: 0,
    cafe_sales: 0,
    cafe_transactions: 0,
    cafe_tickets: 0,
    cafe_admits: 0,
    time_extension_revenue: 0,
    time_extension_orders: 0,
    e3_tickets: 0,
    e3_admits: 0,
    e3_revenue: 0,
    parity: { orders: 0, tickets: 0, admits: 0, revenue: 0 },
    by_ticket: [],
    by_payment: [],
  };
  if (!eventIds.length) return empty;

  const placeholders = eventIds.map(() => '?').join(',');
  const totals = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      COUNT(id) AS booking_rows,
      COUNT(DISTINCT common_order) AS orders,
      COALESCE(SUM(quantity), 0) AS tickets,
      COALESCE(SUM(admits), 0) AS admits,
      COALESCE(SUM(net_price), 0) AS revenue
    FROM bookings
    WHERE event_id IN (${placeholders})
      AND IFNULL(booking_cancel, 0) = 0
    `,
    eventIds,
  );

  const byTicket = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      ticket_id,
      MAX(ticket_title) AS ticket_title,
      COALESCE(SUM(quantity), 0) AS tickets,
      COALESCE(SUM(admits), 0) AS admits,
      COALESCE(SUM(net_price), 0) AS revenue
    FROM bookings
    WHERE event_id IN (${placeholders})
      AND IFNULL(booking_cancel, 0) = 0
    GROUP BY ticket_id
    ORDER BY revenue DESC
    `,
    eventIds,
  );

  const byPayment = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      payment_type,
      payment_cash_card,
      COUNT(DISTINCT common_order) AS orders,
      COALESCE(SUM(net_price), 0) AS revenue
    FROM bookings
    WHERE event_id IN (${placeholders})
      AND IFNULL(booking_cancel, 0) = 0
    GROUP BY payment_type, payment_cash_card
    ORDER BY revenue DESC
    `,
    eventIds,
  );

  // First-row addon_price (informational / older pattern)
  const addonFirstRow = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT COALESCE(SUM(t.addon_price), 0) AS addon_revenue
    FROM (
      SELECT MIN(id) AS min_id
      FROM bookings
      WHERE event_id IN (${placeholders})
        AND IFNULL(booking_cancel, 0) = 0
      GROUP BY common_order
    ) first_row
    JOIN bookings t ON t.id = first_row.min_id
    `,
    eventIds,
  );

  // Linked addons_booking totals (matches old dashboard total_addon_amount linked part)
  const addonLinked = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT COALESCE(SUM(ab.total), 0) AS addon_revenue
    FROM addons_booking ab
    WHERE ab.addon_booking_no IN (
      SELECT DISTINCT b.addon_booking_no
      FROM bookings b
      WHERE b.event_id IN (${placeholders})
        AND b.addon_booking_no IS NOT NULL
        AND b.addon_booking_no <> ''
    )
    `,
    eventIds,
  );

  const addonSeparate = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT COALESCE(SUM(total), 0) AS addon_revenue
    FROM addons_booking
    WHERE addon_booking_no IS NULL
      AND event_id IN (${placeholders})
    `,
    eventIds,
  );

  const cafe = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      COALESCE(SUM(total_sales), 0) AS total_sales,
      COALESCE(SUM(total_transactions), 0) AS total_transactions
    FROM pos_cafe_closings
    WHERE event_id IN (${placeholders})
    `,
    eventIds,
  );

  // Cafe org-group booking lines — old dashboard excludes these from ticket/admit KPIs
  const cafeBookingQty = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      COALESCE(SUM(b.quantity), 0) AS cafe_tickets,
      COALESCE(SUM(b.admits), 0) AS cafe_admits
    FROM bookings b
    JOIN tickets t ON t.id = b.ticket_id
    JOIN organiser_groups og
      ON og.id = t.org_group_id
     AND og.event_id = b.event_id
    WHERE b.event_id IN (${placeholders})
      AND IFNULL(b.booking_cancel, 0) = 0
      AND IFNULL(og.is_cafe, 0) = 1
    `,
    eventIds,
  );

  const timeExt = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      COALESCE(SUM(total_amount), 0) AS time_extension_revenue,
      COUNT(*) AS time_extension_orders
    FROM time_extension_purchases
    WHERE event_id IN (${placeholders})
    `,
    eventIds,
  ).catch(() => [{ time_extension_revenue: 0, time_extension_orders: 0 }]);

  let e3Tickets = 0;
  let e3Admits = 0;
  let e3Revenue = 0;
  if (commonEventId) {
    const e3 = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        COALESCE(SUM(CAST(tickets AS DECIMAL(18,3))), 0) AS e3_tickets,
        COALESCE(SUM(admit), 0) AS e3_admits,
        COALESCE(SUM(total_paid), 0) AS e3_revenue
      FROM e3_bookings
      WHERE common_event_id = ?
      `,
      [commonEventId],
    );
    e3Tickets = Number(e3[0]?.e3_tickets ?? 0);
    e3Admits = Number(e3[0]?.e3_admits ?? 0);
    e3Revenue = Number(e3[0]?.e3_revenue ?? 0);
  }

  const t = totals[0];
  const bookingsTickets = Number(t?.tickets ?? 0);
  const bookingsAdmits = Number(t?.admits ?? 0);
  const bookingsRevenue = Number(t?.revenue ?? 0);
  const bookingsOrders = Number(t?.orders ?? 0);
  const linkedAddon = Number(addonLinked[0]?.addon_revenue ?? 0);
  const separateAddon = Number(addonSeparate[0]?.addon_revenue ?? 0);
  const cafeSales = Number(cafe[0]?.total_sales ?? 0);
  const cafeTrx = Number(cafe[0]?.total_transactions ?? 0);
  const cafeTickets = Number(cafeBookingQty[0]?.cafe_tickets ?? 0);
  const cafeAdmits = Number(cafeBookingQty[0]?.cafe_admits ?? 0);
  const timeExtensionRevenue = Number(timeExt[0]?.time_extension_revenue ?? 0);
  const timeExtensionOrders = Number(timeExt[0]?.time_extension_orders ?? 0);

  return {
    booking_rows: Number(t?.booking_rows ?? 0),
    orders: bookingsOrders,
    tickets: bookingsTickets,
    admits: bookingsAdmits,
    revenue: bookingsRevenue,
    addon_revenue: linkedAddon,
    addon_revenue_first_row: Number(addonFirstRow[0]?.addon_revenue ?? 0),
    separate_addon_revenue: separateAddon,
    cafe_sales: cafeSales,
    cafe_transactions: cafeTrx,
    cafe_tickets: cafeTickets,
    cafe_admits: cafeAdmits,
    time_extension_revenue: timeExtensionRevenue,
    time_extension_orders: timeExtensionOrders,
    e3_tickets: e3Tickets,
    e3_admits: e3Admits,
    e3_revenue: e3Revenue,
    parity: {
      orders: bookingsOrders,
      // Match old dashboard: exclude cafe org-group qty from ticket/admit totals
      tickets: Math.max(0, bookingsTickets - cafeTickets) + e3Tickets,
      admits: Math.max(0, bookingsAdmits - cafeAdmits) + e3Admits,
      revenue:
        bookingsRevenue +
        linkedAddon +
        separateAddon +
        cafeSales +
        e3Revenue +
        timeExtensionRevenue,
    },
    by_ticket: byTicket.map((r) => ({
      ticket_id: Number(r.ticket_id),
      ticket_title: String(r.ticket_title || ''),
      tickets: Number(r.tickets),
      admits: Number(r.admits),
      revenue: Number(r.revenue),
    })),
    by_payment: byPayment.map((r) => ({
      payment_type: String(r.payment_type || 'online'),
      payment_cash_card: r.payment_cash_card != null ? String(r.payment_cash_card) : null,
      orders: Number(r.orders),
      revenue: Number(r.revenue),
    })),
  };
}

export async function loadLegacyTickets(eventIds: number[]): Promise<LegacyTicket[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      t.id,
      t.event_id,
      t.title,
      COALESCE(t.ticket_type, 'normal') AS ticket_type,
      COALESCE(t.price, 0) AS price,
      COALESCE(t.admits, 1) AS admits,
      COALESCE(t.is_pos_only, 0) AS is_pos_only,
      COALESCE(t.only_for_third_party, 0) AS only_for_third_party,
      COALESCE(t.is_complementary, 0) AS is_complementary,
      COALESCE(t.is_customizable, 0) AS is_customizable,
      COALESCE(t.is_active, 1) AS is_active,
      COALESCE(t.org_group_id, 0) AS org_group_id,
      t.quantity,
      COUNT(b.id) AS booking_rows,
      COALESCE(SUM(b.quantity), 0) AS sold_qty,
      COALESCE(SUM(b.admits), 0) AS sold_admits,
      COALESCE(SUM(b.net_price), 0) AS sold_revenue
    FROM tickets t
    LEFT JOIN bookings b
      ON b.ticket_id = t.id
     AND IFNULL(b.booking_cancel, 0) = 0
    WHERE t.event_id IN (${placeholders})
    GROUP BY t.id
    ORDER BY sold_revenue DESC, t.id ASC
    `,
    eventIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    event_id: Number(r.event_id),
    title: String(r.title),
    ticket_type: String(r.ticket_type || 'normal'),
    price: Number(r.price),
    admits: Number(r.admits || 1),
    is_pos_only: Number(r.is_pos_only || 0),
    only_for_third_party: Number(r.only_for_third_party || 0),
    is_complementary: Number(r.is_complementary || 0),
    is_customizable: Number(r.is_customizable || 0),
    is_active: Number(r.is_active ?? 1),
    org_group_id: Number(r.org_group_id || 0),
    quantity: r.quantity != null ? Number(r.quantity) : null,
    booking_rows: Number(r.booking_rows),
    sold_qty: Number(r.sold_qty),
    sold_admits: Number(r.sold_admits),
    sold_revenue: Number(r.sold_revenue),
  }));
}

export async function loadLegacyPlaytimePacks(
  ticketIds: number[],
): Promise<LegacyPlaytimePack[]> {
  if (!ticketIds.length) return [];
  const placeholders = ticketIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      id,
      ticket_id,
      title,
      COALESCE(slot, '0') AS slot,
      COALESCE(price, 0) AS price,
      quantity,
      COALESCE(admits, 1) AS admits,
      COALESCE(max_per_ticket_qty, 0) AS max_per_ticket_qty,
      COALESCE(currency, 'QAR') AS currency,
      description
    FROM playtime_packs
    WHERE ticket_id IN (${placeholders})
    ORDER BY ticket_id ASC, id ASC
    `,
    ticketIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    ticket_id: Number(r.ticket_id),
    title: String(r.title || `Pack ${r.id}`),
    slot: String(r.slot ?? '0'),
    price: Number(r.price || 0),
    quantity: r.quantity != null ? Number(r.quantity) : null,
    admits: Number(r.admits || 1),
    max_per_ticket_qty: Number(r.max_per_ticket_qty || 0),
    currency: String(r.currency || 'QAR').slice(0, 5) || 'QAR',
    description: r.description != null ? String(r.description) : null,
  }));
}

export async function loadLegacyTicketActivities(
  ticketIds: number[],
): Promise<LegacyTicketActivity[]> {
  if (!ticketIds.length) return [];
  const placeholders = ticketIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      id,
      ticket_id,
      activity_id,
      title,
      COALESCE(price, 0) AS price,
      duration,
      description,
      COALESCE(activity_type, 'duration') AS activity_type,
      COALESCE(status, 'ACTIVE') AS status
    FROM ticket_activities
    WHERE ticket_id IN (${placeholders})
    ORDER BY ticket_id ASC, id ASC
    `,
    ticketIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    ticket_id: Number(r.ticket_id),
    activity_id: Number(r.activity_id),
    title: String(r.title || `Activity ${r.id}`),
    price: Number(r.price || 0),
    duration: r.duration != null ? String(r.duration) : null,
    description: r.description != null ? String(r.description) : null,
    activity_type: String(r.activity_type || 'duration'),
    status: String(r.status || 'ACTIVE').toUpperCase(),
  }));
}

export async function loadLegacyOrganiserGroups(
  eventIds: number[],
): Promise<LegacyOrganiserGroup[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      id,
      event_id,
      orgainser_name,
      COALESCE(is_main, 0) AS is_main,
      COALESCE(org_share, 0) AS org_share,
      COALESCE(third_share, 0) AS third_share,
      COALESCE(is_cafe, 0) AS is_cafe,
      collected_by,
      owner_name,
      owner_percentage_type
    FROM organiser_groups
    WHERE event_id IN (${placeholders})
    ORDER BY is_main DESC, id ASC
    `,
    eventIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    event_id: Number(r.event_id),
    name: String(r.orgainser_name || `Group ${r.id}`),
    is_main: Number(r.is_main || 0),
    org_share: Number(r.org_share || 0),
    third_share: Number(r.third_share || 0),
    is_cafe: Number(r.is_cafe || 0),
    collected_by: r.collected_by != null ? String(r.collected_by) : null,
    owner_name: r.owner_name != null ? String(r.owner_name) : null,
    owner_percentage_type:
      r.owner_percentage_type != null ? String(r.owner_percentage_type) : null,
  }));
}

export async function loadLegacyStaffUsers(userIds: number[]): Promise<LegacyStaffUser[]> {
  const ids = [...new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT id, email, name, phone, organizer_id
    FROM users
    WHERE id IN (${placeholders})
    `,
    ids,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    email: String(r.email || '').trim().toLowerCase(),
    name: String(r.name || `User ${r.id}`),
    phone: r.phone != null ? String(r.phone) : null,
    organizer_id: r.organizer_id != null ? Number(r.organizer_id) : null,
  }));
}

export async function loadLegacyBookings(eventIds: number[]): Promise<LegacyBookingLine[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      b.id,
      b.customer_id,
      b.organiser_id,
      b.event_id,
      b.ticket_id,
      b.playtime_pack_id,
      b.quantity,
      b.price,
      COALESCE(b.tax, 0) AS tax,
      COALESCE(b.net_price, 0) AS net_price,
      b.status,
      COALESCE(b.booking_cancel, 0) AS booking_cancel,
      b.created_at,
      b.updated_at,
      b.event_title,
      b.event_start_date,
      b.event_end_date,
      b.event_start_time,
      b.event_end_time,
      b.ticket_title,
      b.ticket_price,
      b.order_number,
      b.transaction_id,
      b.customer_name,
      b.customer_email,
      b.customer_phone,
      u.age_group AS customer_age_group,
      u.geographic_region AS customer_geographic_region,
      b.currency,
      COALESCE(b.checked_in, 0) AS checked_in,
      b.payment_type,
      COALESCE(b.is_paid, 1) AS is_paid,
      b.promocode_id,
      b.promocode,
      COALESCE(b.promocode_reward, 0) AS promocode_reward,
      COALESCE(b.bulk_discount, 0) AS bulk_discount,
      b.common_order,
      COALESCE(b.admits, b.quantity, 1) AS admits,
      b.payment_cash_card,
      b.addon_booking_no,
      COALESCE(b.addon_price, 0) AS addon_price,
      b.free_booking_type,
      b.booked_via,
      b.pos_id,
      COALESCE(t.is_pos_only, 0) AS is_pos_only,
      COALESCE(t.only_for_third_party, 0) AS only_for_third_party,
      COALESCE(t.org_group_id, 0) AS ticket_org_group_id,
      COALESCE(og.is_cafe, 0) AS is_cafe
    FROM bookings b
    LEFT JOIN users u ON u.id = b.customer_id
    LEFT JOIN tickets t ON t.id = b.ticket_id
    LEFT JOIN organiser_groups og
      ON og.id = t.org_group_id
     AND og.event_id = b.event_id
    WHERE b.event_id IN (${placeholders})
      AND IFNULL(b.booking_cancel, 0) = 0
    ORDER BY b.common_order ASC, b.id ASC
    `,
    eventIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    customer_id: Number(r.customer_id),
    organiser_id: r.organiser_id != null ? Number(r.organiser_id) : null,
    event_id: Number(r.event_id),
    ticket_id: Number(r.ticket_id),
    playtime_pack_id: (() => {
      const raw = r.playtime_pack_id;
      if (raw == null || raw === '' || raw === '0' || raw === 0) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    })(),
    quantity: Number(r.quantity || 1),
    price: Number(r.price || 0),
    tax: Number(r.tax || 0),
    net_price: Number(r.net_price || 0),
    status: Number(r.status || 0),
    booking_cancel: Number(r.booking_cancel || 0),
    created_at: String(r.created_at),
    updated_at: r.updated_at ? String(r.updated_at) : null,
    event_title: String(r.event_title || ''),
    event_start_date: legacyDateOnlyQatar(r.event_start_date),
    event_end_date: legacyDateOnlyQatar(r.event_end_date),
    event_start_time: r.event_start_time ? String(r.event_start_time) : null,
    event_end_time: r.event_end_time ? String(r.event_end_time) : null,
    ticket_title: String(r.ticket_title || ''),
    ticket_price: Number(r.ticket_price || 0),
    order_number: r.order_number != null ? String(r.order_number) : null,
    transaction_id: Number(r.transaction_id || 0),
    customer_name: String(r.customer_name || 'Guest'),
    customer_email: String(r.customer_email || ''),
    customer_phone: r.customer_phone != null ? String(r.customer_phone) : null,
    customer_age_group: (() => {
      const v = r.customer_age_group != null ? String(r.customer_age_group).trim() : '';
      // Match legacy chart: COALESCE(users.age_group, "25-40") then camp Group 1–4 buckets.
      return normalizeCustomerAgeGroup(v);
    })(),
    customer_geographic_region: (() => {
      const v =
        r.customer_geographic_region != null
          ? String(r.customer_geographic_region).trim()
          : '';
      // Match legacy chart COALESCE(users.geographic_region, "Qatari")
      return v || 'Qatari';
    })(),
    currency: r.currency != null ? String(r.currency) : 'QAR',
    checked_in: Number(r.checked_in || 0),
    payment_type: String(r.payment_type || 'online'),
    is_paid: Number(r.is_paid ?? 1),
    promocode_id: r.promocode_id != null ? Number(r.promocode_id) : null,
    promocode: r.promocode != null ? String(r.promocode) : null,
    promocode_reward: Number(r.promocode_reward || 0),
    bulk_discount: Number(r.bulk_discount || 0),
    common_order: String(r.common_order),
    admits: Number(r.admits || 1),
    payment_cash_card: r.payment_cash_card != null ? String(r.payment_cash_card) : null,
    addon_booking_no: r.addon_booking_no != null ? String(r.addon_booking_no) : null,
    addon_price: Number(r.addon_price || 0),
    free_booking_type: r.free_booking_type != null ? String(r.free_booking_type) : null,
    booked_via: r.booked_via != null ? String(r.booked_via) : 'BOOKINGQUBE',
    pos_id: r.pos_id != null ? Number(r.pos_id) : null,
    is_pos_only: Number(r.is_pos_only || 0),
    only_for_third_party: Number(r.only_for_third_party || 0),
    ticket_org_group_id: Number(r.ticket_org_group_id || 0),
    is_cafe: Number(r.is_cafe || 0),
  }));
}

export async function loadLegacyAddonCatalog(
  eventIds: number[],
): Promise<LegacyAddonCatalog[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  try {
    const rows = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        id,
        event_id,
        title,
        title_ar,
        COALESCE(price, 0) AS price,
        COALESCE(quantity, 0) AS quantity,
        description,
        COALESCE(for_cafe_only, 0) AS for_cafe_only,
        applicable_for
      FROM addons
      WHERE event_id IN (${placeholders})
      ORDER BY id ASC
      `,
      eventIds,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      event_id: Number(r.event_id),
      title: String(r.title || `Addon #${r.id}`),
      title_ar: r.title_ar != null ? String(r.title_ar) : null,
      price: Number(r.price || 0),
      quantity: Number(r.quantity || 0),
      description: r.description != null ? String(r.description) : null,
      for_cafe_only: Boolean(Number(r.for_cafe_only || 0)),
      applicable_for: r.applicable_for != null ? String(r.applicable_for) : null,
    }));
  } catch {
    // Older DBs may lack title_ar / for_cafe_only / applicable_for
    const rows = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        id,
        event_id,
        title,
        COALESCE(price, 0) AS price,
        COALESCE(quantity, 0) AS quantity,
        description
      FROM addons
      WHERE event_id IN (${placeholders})
      ORDER BY id ASC
      `,
      eventIds,
    ).catch(() => []);
    return rows.map((r) => ({
      id: Number(r.id),
      event_id: Number(r.event_id),
      title: String(r.title || `Addon #${r.id}`),
      title_ar: null,
      price: Number(r.price || 0),
      quantity: Number(r.quantity || 0),
      description: r.description != null ? String(r.description) : null,
      for_cafe_only: false,
      applicable_for: null,
    }));
  }
}

export async function loadLegacyTimeExtensionCatalog(
  eventIds: number[],
): Promise<LegacyTimeExtensionCatalog[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  try {
    const rows = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        id,
        event_id,
        COALESCE(title_en, CONCAT('Time Extension #', id)) AS title_en,
        title_ar,
        COALESCE(duration, 0) AS duration,
        COALESCE(price, 0) AS price
      FROM time_extensions
      WHERE event_id IN (${placeholders})
      ORDER BY id ASC
      `,
      eventIds,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      event_id: Number(r.event_id),
      title_en: String(r.title_en || `Time Extension #${r.id}`),
      title_ar: r.title_ar != null ? String(r.title_ar) : null,
      duration: Number(r.duration || 0),
      price: Number(r.price || 0),
    }));
  } catch {
    return [];
  }
}

export async function loadLegacyAddonsForOrders(
  eventIds: number[],
  _commonOrders: string[],
): Promise<LegacyAddonLine[]> {
  if (!eventIds.length) return [];
  // addons_booking links via addon_booking_no (= bookings.addon_booking_no)
  const bookingNos = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT DISTINCT addon_booking_no AS booking_no, common_order
    FROM bookings
    WHERE event_id IN (${eventIds.map(() => '?').join(',')})
      AND addon_booking_no IS NOT NULL
      AND addon_booking_no <> ''
    `,
    eventIds,
  );

  const nos = bookingNos.map((r) => String(r.booking_no)).filter(Boolean);
  if (!nos.length) return [];

  const chunkSize = 200;
  const out: LegacyAddonLine[] = [];
  for (let i = 0; i < nos.length; i += chunkSize) {
    const chunk = nos.slice(i, i + chunkSize);
    const rows = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        ab.id,
        ab.addon_booking_no AS booking_no,
        ab.addon_id,
        COALESCE(a.title, CONCAT('Addon #', ab.addon_id)) AS title,
        ab.quantity,
        ab.price,
        ab.total,
        ab.event_id
      FROM addons_booking ab
      LEFT JOIN addons a ON a.id = ab.addon_id
      WHERE ab.addon_booking_no IN (${chunk.map(() => '?').join(',')})
      `,
      chunk,
    );
    const orderByNo = new Map(
      bookingNos.map((r) => [String(r.booking_no), String(r.common_order)]),
    );
    for (const r of rows) {
      out.push({
        id: Number(r.id),
        booking_no: String(r.booking_no),
        common_order: orderByNo.get(String(r.booking_no)) ?? null,
        addon_id: r.addon_id != null ? Number(r.addon_id) : null,
        title: String(r.title || 'Addon'),
        quantity: Number(r.quantity || 1),
        price: Number(r.price || 0),
        total: Number(r.total ?? Number(r.price || 0) * Number(r.quantity || 1)),
        event_id: r.event_id != null ? Number(r.event_id) : null,
      });
    }
  }
  return out;
}

export async function loadSplitCommonOrders(commonOrders: string[]): Promise<Set<string>> {
  if (!commonOrders.length) return new Set();
  const chunkSize = 300;
  const found = new Set<string>();
  for (let i = 0; i < commonOrders.length; i += chunkSize) {
    const chunk = commonOrders.slice(i, i + chunkSize);
    try {
      const rows = await mysqlQuery<RowDataPacket[]>(
        `
        SELECT DISTINCT common_order_id AS common_order
        FROM split_payments
        WHERE common_order_id IN (${chunk.map(() => '?').join(',')})
        `,
        chunk,
      );
      for (const r of rows) found.add(String(r.common_order));
    } catch {
      // table may not exist in some DBs
      return found;
    }
  }
  return found;
}

export async function loadSeparateAddons(eventIds: number[]): Promise<LegacySeparateAddon[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      ab.id,
      ab.event_id,
      ab.addon_id,
      COALESCE(a.title, CONCAT('Addon #', ab.addon_id)) AS title,
      ab.quantity,
      ab.price,
      ab.total,
      ab.booking_type,
      ab.payment_type,
      ab.booked_by,
      ab.customer_id,
      ab.created_at,
      ab.updated_at
    FROM addons_booking ab
    LEFT JOIN addons a ON a.id = ab.addon_id
    WHERE ab.addon_booking_no IS NULL
      AND ab.event_id IN (${placeholders})
    ORDER BY ab.id ASC
    `,
    eventIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    event_id: Number(r.event_id),
    addon_id: r.addon_id != null ? Number(r.addon_id) : null,
    title: String(r.title || 'Addon'),
    quantity: Number(r.quantity || 1),
    price: Number(r.price || 0),
    total: Number(r.total ?? Number(r.price || 0) * Number(r.quantity || 1)),
    booking_type: r.booking_type != null ? String(r.booking_type) : null,
    payment_type: r.payment_type != null ? String(r.payment_type) : null,
    booked_by: r.booked_by != null ? Number(r.booked_by) : null,
    customer_id: r.customer_id != null ? Number(r.customer_id) : null,
    created_at: String(r.created_at),
    updated_at: r.updated_at ? String(r.updated_at) : null,
  }));
}

export async function loadPosCafeClosings(eventIds: number[]): Promise<LegacyPosCafeClosing[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      id,
      event_id,
      ticket_id,
      agent_id,
      closing_date,
      COALESCE(total_transactions, 0) AS total_transactions,
      COALESCE(total_sales, 0) AS total_sales,
      COALESCE(total_cash, 0) AS total_cash,
      COALESCE(total_card, 0) AS total_card,
      created_at
    FROM pos_cafe_closings
    WHERE event_id IN (${placeholders})
    ORDER BY id ASC
    `,
    eventIds,
  );

  return rows.map((r) => ({
    id: Number(r.id),
    event_id: Number(r.event_id),
    ticket_id: r.ticket_id != null ? Number(r.ticket_id) : null,
    agent_id: r.agent_id != null ? Number(r.agent_id) : null,
    closing_date: legacyDateOnlyQatar(r.closing_date) || String(r.closing_date).slice(0, 10),
    total_transactions: Number(r.total_transactions || 0),
    total_sales: Number(r.total_sales || 0),
    total_cash: Number(r.total_cash || 0),
    total_card: Number(r.total_card || 0),
    created_at: r.created_at ? String(r.created_at) : null,
  }));
}

export async function loadE3Bookings(commonEventId: string | null): Promise<LegacyE3Booking[]> {
  if (!commonEventId) return [];
  const rows = await mysqlQuery<RowDataPacket[]>(
    `
    SELECT
      id,
      name,
      COALESCE(CAST(tickets AS DECIMAL(18,3)), 0) AS tickets,
      COALESCE(admit, 0) AS admit,
      COALESCE(total_paid, 0) AS total_paid,
      payment_srouce,
      activity,
      currency,
      common_event_id,
      org_group_id,
      organiser_id,
      created_at
    FROM e3_bookings
    WHERE common_event_id = ?
    ORDER BY id ASC
    `,
    [commonEventId],
  );

  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name != null ? String(r.name) : null,
    tickets: Number(r.tickets || 0),
    admit: Number(r.admit || 0),
    total_paid: Number(r.total_paid || 0),
    payment_srouce: r.payment_srouce != null ? String(r.payment_srouce) : null,
    activity: r.activity != null ? String(r.activity) : null,
    currency: r.currency != null ? String(r.currency) : 'QAR',
    common_event_id: r.common_event_id != null ? String(r.common_event_id) : null,
    org_group_id: r.org_group_id != null ? Number(r.org_group_id) : null,
    organiser_id: r.organiser_id != null ? Number(r.organiser_id) : null,
    created_at: String(r.created_at),
  }));
}

export async function loadTimeExtensionPurchases(
  eventIds: number[],
): Promise<LegacyTimeExtensionPurchase[]> {
  if (!eventIds.length) return [];
  const placeholders = eventIds.map(() => '?').join(',');
  try {
    const rows = await mysqlQuery<RowDataPacket[]>(
      `
      SELECT
        id,
        booking_id,
        common_order,
        event_id,
        barcode,
        COALESCE(total_duration_minutes, 0) AS total_duration_minutes,
        COALESCE(total_amount, 0) AS total_amount,
        payment_method,
        currency,
        agent_id,
        extension_snapshot,
        created_at,
        updated_at
      FROM time_extension_purchases
      WHERE event_id IN (${placeholders})
      ORDER BY id ASC
      `,
      eventIds,
    );
    return rows.map((r) => ({
      id: Number(r.id),
      booking_id: r.booking_id != null ? Number(r.booking_id) : null,
      common_order: r.common_order != null ? String(r.common_order) : null,
      event_id: Number(r.event_id),
      barcode: r.barcode != null ? String(r.barcode) : null,
      total_duration_minutes: Number(r.total_duration_minutes || 0),
      total_amount: Number(r.total_amount || 0),
      payment_method: r.payment_method != null ? String(r.payment_method) : null,
      currency: r.currency != null ? String(r.currency) : 'QAR',
      agent_id: r.agent_id != null ? Number(r.agent_id) : null,
      extension_snapshot: parseExtensionSnapshot(r.extension_snapshot),
      created_at: String(r.created_at),
      updated_at: r.updated_at ? String(r.updated_at) : null,
    }));
  } catch {
    return [];
  }
}

function parseExtensionSnapshot(raw: unknown): LegacyTimeExtensionSnapshotItem[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const duration = Number(row.duration ?? row.minutes ?? 0);
    const price = Number(row.price ?? 0);
    return [
      {
        time_extension_id:
          row.time_extension_id != null ? Number(row.time_extension_id) : null,
        title_en:
          typeof row.title_en === 'string'
            ? row.title_en
            : typeof row.title === 'string'
              ? row.title
              : null,
        title_ar: typeof row.title_ar === 'string' ? row.title_ar : null,
        duration: Number.isFinite(duration) ? duration : 0,
        price: Number.isFinite(price) ? price : 0,
      },
    ];
  });
}
