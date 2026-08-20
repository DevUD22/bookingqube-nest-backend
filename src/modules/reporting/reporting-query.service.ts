import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdvancePaymentStatus,
  OrderItemType,
  OrderStatus,
  Prisma,
  ReportBasis,
  ReportPaymentMode,
  VisitorType,
} from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { normalizePaymentMethodLabel } from '../admin-payment-settings/payment-method-labels';
import {
  mergeAgeGroupsIntoCampBuckets,
  normalizeCustomerAgeGroup,
} from './camp-age-groups';
import { buildNamedExtraBuckets, mergeNamedExtraDailyRows } from './named-extra-breakdown';
import { ReportTimezoneService } from './report-timezone.service';
import { calendarDay, zonedPresetRange } from './report-timezone.util';

export type ReportQueryFilters = {
  organizationId?: string;
  eventId?: string;
  /** When set (non-admin staff), restrict snapshot reads to these event IDs. */
  eventIds?: string[];
  from: Date;
  to: Date;
  /** Resolved reporting timezone (regional or UTC). */
  reportTimeZone?: string;
  /** Inclusive report_day bounds in reporting TZ (UTC-midnight date keys). */
  reportDayFrom?: Date;
  reportDayTo?: Date;
  filterBasedOn?: 'created_at' | 'event_date';
  paymentMode?: ReportPaymentMode;
  /** Optional UI filter (single vendor). */
  thirdPartyVendorId?: string;
  /** Forced staff scope (shareholder / event manager). */
  thirdPartyVendorIds?: string[];
  bookedByAgentId?: string;
  search?: string;
  page?: number;
  perPage?: number;
};

type VendorScopedViews = {
  payment_mix: Array<{ label: string; revenue: number; orders: number; admits: number }>;
  visitor_breakdown: Array<{
    visitor_type: VisitorType;
    admits: number;
    tickets: number;
    revenue: number;
  }>;
  demographics_age: Array<{
    label: string;
    admits: number;
    orders: number;
    revenue: number;
  }>;
  demographics_region: Array<{
    label: string;
    admits: number;
    orders: number;
    revenue: number;
  }>;
  tickets: Array<{
    ticket_item_id: string;
    ticket_label: string;
    item_type: string;
    /** Parent ticket type id (variants nest under this). */
    ticket_type_id?: string;
    /** Parsed from externalKey legacy-ticket-{id} when present. */
    legacy_ticket_id?: number | null;
    tickets: number;
    admits: number;
    revenue: number;
    orders: number;
    status: 'active' | 'inactive';
  }>;
  cafe: { cafe_net: number; orders: number; items_sold: number };
  online_offline: Array<{ mode: string; revenue: number; orders: number; admits: number }>;
  payment_modes: Array<{
    payment_mode: string;
    revenue: number;
    orders: number;
    admits: number;
    tickets: number;
  }>;
  agents: Array<{
    agent_id: string;
    orders: number;
    admits: number;
    revenue: number;
    cash: number;
    card: number;
  }>;
  ticket_net: number;
  cafe_net: number;
  other_net: number;
  checked_in: number;
  checked_out: number;
};

/** Vendors & POS product row — mirrors legacy Tickets Info columns. */
type VendorProductBreakdownRow = {
  product_id: string;
  name: string;
  kind: 'ticket' | 'separate_addon' | 'time_extension';
  status?: 'active' | 'inactive';
  /** Parent ticket type id (variants nest under this). */
  ticket_type_id?: string;
  /** Parsed from externalKey legacy-ticket-{id} when present. */
  legacy_ticket_id?: number | null;
  tickets: number;
  admits: number;
  orders: number;
  addon_amount: number;
  time_extension_amount: number;
  ticket_revenue: number;
  discount: number;
  gross_revenue: number;
  net_revenue: number;
  /** Alias of net_revenue for existing consumers. */
  net_sales: number;
};

function emptyVendorScopedViews(): VendorScopedViews {
  return {
    payment_mix: [],
    visitor_breakdown: [],
    demographics_age: [],
    demographics_region: [],
    tickets: [],
    cafe: { cafe_net: 0, orders: 0, items_sold: 0 },
    online_offline: [],
    payment_modes: [],
    agents: [],
    ticket_net: 0,
    cafe_net: 0,
    other_net: 0,
    checked_in: 0,
    checked_out: 0,
  };
}

@Injectable()
export class ReportingQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reportTz: ReportTimezoneService,
  ) {}

  /** Attach regional (or UTC) report_day bounds used by all rollup reads. */
  async withReportDays(filters: ReportQueryFilters): Promise<ReportQueryFilters> {
    const reportTimeZone = await this.reportTz.getTimeZone();
    return {
      ...filters,
      reportTimeZone,
      reportDayFrom: calendarDay(filters.from, reportTimeZone),
      reportDayTo: calendarDay(filters.to, reportTimeZone),
    };
  }

  private dayBounds(filters: ReportQueryFilters): { gte: Date; lte: Date } {
    const tz = filters.reportTimeZone ?? 'UTC';
    return {
      gte: filters.reportDayFrom ?? calendarDay(filters.from, tz),
      lte: filters.reportDayTo ?? calendarDay(filters.to, tz),
    };
  }

  private reportBasis(filters: ReportQueryFilters): ReportBasis {
    return filters.filterBasedOn === 'event_date' ? ReportBasis.event : ReportBasis.trx;
  }

  /** Effective vendor IDs after combining UI filter + forced staff scope. */
  private effectiveVendorIds(filters: ReportQueryFilters): string[] | undefined {
    const scoped = filters.thirdPartyVendorIds;
    if (scoped) {
      if (filters.thirdPartyVendorId) {
        return scoped.includes(filters.thirdPartyVendorId)
          ? [filters.thirdPartyVendorId]
          : [];
      }
      return scoped;
    }
    if (filters.thirdPartyVendorId) return [filters.thirdPartyVendorId];
    return undefined;
  }

  private vendorWhere(
    filters: ReportQueryFilters,
  ): { thirdPartyVendorId?: string | { in: string[] } } {
    const ids = this.effectiveVendorIds(filters);
    if (!ids) return {};
    if (ids.length === 1) return { thirdPartyVendorId: ids[0] };
    return { thirdPartyVendorId: { in: ids } };
  }

  /** Shared FROM/WHERE for vendor-scoped SQL aggregates (no full line materialization). */
  private vendorScopedFromWhere(filters: ReportQueryFilters, vendorIds: string[]) {
    const dateCol =
      filters.filterBasedOn === 'event_date'
        ? Prisma.sql`o.event_start_date`
        : Prisma.sql`o.created_at`;
    const vendorSql =
      vendorIds.length === 1
        ? Prisma.sql`oi.third_party_vendor_id = ${vendorIds[0]}::uuid`
        : Prisma.sql`oi.third_party_vendor_id IN (${Prisma.join(
            vendorIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`;
    const eventSql = filters.eventId
      ? Prisma.sql`AND oi.event_id = ${filters.eventId}::uuid`
      : filters.eventIds?.length
        ? Prisma.sql`AND oi.event_id IN (${Prisma.join(
            filters.eventIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`
        : Prisma.empty;
    const orgSql = filters.organizationId
      ? Prisma.sql`AND o.organization_id = ${filters.organizationId}::uuid`
      : Prisma.empty;
    const modeSql = filters.paymentMode
      ? Prisma.sql`AND o.payment_mode = ${filters.paymentMode}::"ReportPaymentMode"`
      : Prisma.empty;
    const agentSql = filters.bookedByAgentId
      ? Prisma.sql`AND COALESCE(oi.booked_by_agent_id, o.booked_by_agent_id) = ${filters.bookedByAgentId}::uuid`
      : Prisma.empty;

    return Prisma.sql`
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE ${vendorSql}
        ${eventSql}
        ${orgSql}
        ${modeSql}
        ${agentSql}
        AND o.status <> 'expired'::"OrderStatus"
        AND ${dateCol} >= ${filters.from}
        AND ${dateCol} <= ${filters.to}
    `;
  }

  /**
   * Product breakdown for Vendors & POS — reads pre-aggregated daily rollups
   * (same speed profile as ticket/share tabs). Populated on paid/refund sync.
   */
  private async vendorProductBreakdown(
    filters: ReportQueryFilters,
    vendorIds: string[],
  ): Promise<Map<string, VendorProductBreakdownRow[]>> {
    const result = new Map<string, VendorProductBreakdownRow[]>();
    if (!vendorIds.length) return result;

    const rows = await this.prisma.bookingReportVendorProductDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        thirdPartyVendorId:
          vendorIds.length === 1 ? vendorIds[0] : { in: vendorIds },
        ...this.eventScope(filters),
      },
    });

    const byProduct = new Map<
      string,
      VendorProductBreakdownRow & { vendorId: string }
    >();
    for (const row of rows) {
      const kind =
        row.productKind === 'separate_addon'
          ? 'separate_addon'
          : row.productKind === 'time_extension'
            ? 'time_extension'
            : 'ticket';
      const key = `${row.thirdPartyVendorId}:${kind}:${row.productId}`;
      const current = byProduct.get(key) ?? {
        vendorId: row.thirdPartyVendorId,
        product_id:
          kind === 'separate_addon'
            ? `separate-addons:${row.thirdPartyVendorId}`
            : kind === 'time_extension'
              ? `time-extension:${row.thirdPartyVendorId}`
              : row.productId,
        name: row.productLabel,
        kind,
        tickets: 0,
        admits: 0,
        orders: 0,
        addon_amount: 0,
        time_extension_amount: 0,
        ticket_revenue: 0,
        discount: 0,
        gross_revenue: 0,
        net_revenue: 0,
        net_sales: 0,
      };
      current.tickets += row.ticketQty;
      current.admits += row.admitCount;
      current.orders += row.orderCount;
      current.addon_amount = money(
        current.addon_amount + row.addonAmount.toNumber(),
      );
      current.time_extension_amount = money(
        current.time_extension_amount + row.timeExtensionAmount.toNumber(),
      );
      current.ticket_revenue = money(
        current.ticket_revenue + row.ticketRevenue.toNumber(),
      );
      current.discount = money(
        current.discount + row.discountAmount.toNumber(),
      );
      current.net_revenue = money(
        current.net_revenue + row.netRevenue.toNumber(),
      );
      current.name = row.productLabel;
      byProduct.set(key, current);
    }

    for (const row of byProduct.values()) {
      row.gross_revenue = money(row.net_revenue + row.discount);
      row.net_sales = row.net_revenue;
      if (
        row.net_revenue <= 0 &&
        row.tickets <= 0 &&
        row.addon_amount <= 0 &&
        row.time_extension_amount <= 0
      ) {
        continue;
      }
      const { vendorId, ...product } = row;
      const list = result.get(vendorId) ?? [];
      list.push(product);
      result.set(vendorId, list);
    }

    const ticketProductIds = [
      ...new Set(
        [...result.values()]
          .flat()
          .filter((p) => p.kind === 'ticket')
          .map((p) => p.product_id),
      ),
    ];
    if (ticketProductIds.length) {
      const [types, variants] = await Promise.all([
        this.prisma.ticketType.findMany({
          where: { id: { in: ticketProductIds } },
          select: { id: true, status: true, externalKey: true, title: true },
        }),
        this.prisma.ticketVariant.findMany({
          where: { id: { in: ticketProductIds } },
          select: {
            id: true,
            status: true,
            name: true,
            ticketTypeId: true,
            ticketType: {
              select: { status: true, externalKey: true, title: true },
            },
          },
        }),
      ]);
      const statusById = new Map<string, 'active' | 'inactive'>();
      const parentByProductId = new Map<
        string,
        { ticketTypeId: string; legacyTicketId: number | null; title: string }
      >();
      const parseLegacyId = (externalKey: string | null | undefined) => {
        const m = /^legacy-ticket-(\d+)$/.exec(externalKey ?? '');
        return m ? Number(m[1]) : null;
      };
      for (const t of types) {
        statusById.set(t.id, t.status === 'active' ? 'active' : 'inactive');
        parentByProductId.set(t.id, {
          ticketTypeId: t.id,
          legacyTicketId: parseLegacyId(t.externalKey),
          title: t.title,
        });
      }
      for (const v of variants) {
        statusById.set(
          v.id,
          v.status === 'active' && v.ticketType.status === 'active'
            ? 'active'
            : 'inactive',
        );
        parentByProductId.set(v.id, {
          ticketTypeId: v.ticketTypeId,
          legacyTicketId: parseLegacyId(v.ticketType.externalKey),
          title: v.ticketType.title,
        });
      }
      for (const products of result.values()) {
        for (const product of products) {
          if (product.kind !== 'ticket') continue;
          product.status = statusById.get(product.product_id) ?? 'active';
          const parent = parentByProductId.get(product.product_id);
          if (parent) {
            product.ticket_type_id = parent.ticketTypeId;
            product.legacy_ticket_id = parent.legacyTicketId;
          } else {
            product.ticket_type_id = product.product_id;
            product.legacy_ticket_id = null;
          }
        }
      }
    }

    for (const [vendorId, products] of result) {
      result.set(
        vendorId,
        products.sort((a, b) => {
          const kindRank = (kind: VendorProductBreakdownRow['kind']) =>
            kind === 'ticket' ? 0 : kind === 'separate_addon' ? 1 : 2;
          const byKind = kindRank(a.kind) - kindRank(b.kind);
          if (byKind !== 0) return byKind;
          return b.net_revenue - a.net_revenue;
        }),
      );
    }

    return result;
  }

  /**
   * Vendor / shareholder report slices via SQL GROUP BY.
   * Keeps Event Insights fast — never pulls tens of thousands of order_items into Node.
   */
  private async vendorScopedViews(
    filters: ReportQueryFilters,
  ): Promise<VendorScopedViews | null> {
    const vendorIds = this.effectiveVendorIds(filters);
    if (!vendorIds) return null;
    if (vendorIds.length === 0) return emptyVendorScopedViews();

    const fromWhere = this.vendorScopedFromWhere(filters, vendorIds);
    type Num = number | string;

    const [
      totals,
      paymentMixRows,
      visitorRows,
      ageRows,
      regionRows,
      ticketRows,
      modeRows,
      paymentModeRows,
      agentRows,
    ] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          ticket_net: Num;
          cafe_net: Num;
          other_net: Num;
          cafe_items: Num;
          cafe_orders: Num;
          checked_in: Num;
          checked_out: Num;
        }>
      >`
        SELECT
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false THEN oi.total_amount
            ELSE 0 END), 0) AS ticket_net,
          COALESCE(SUM(CASE
            WHEN oi.item_type = 'cafe_item'::"OrderItemType" OR oi.ticket_is_cafe = true
              THEN oi.total_amount ELSE 0 END), 0) AS cafe_net,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('addon'::"OrderItemType", 'addon_variant'::"OrderItemType")
              THEN oi.total_amount ELSE 0 END), 0) AS other_net,
          COALESCE(SUM(CASE
            WHEN oi.item_type = 'cafe_item'::"OrderItemType" OR oi.ticket_is_cafe = true
              THEN oi.quantity ELSE 0 END), 0) AS cafe_items,
          COUNT(DISTINCT CASE
            WHEN oi.item_type = 'cafe_item'::"OrderItemType" OR oi.ticket_is_cafe = true
              THEN oi.order_id END)::int AS cafe_orders,
          COALESCE(SUM(CASE
            WHEN oi.attendance_status = 'checked_in'::"AttendanceStatus"
              AND oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS checked_in,
          COALESCE(SUM(CASE
            WHEN oi.attendance_status = 'checked_out'::"AttendanceStatus"
              AND oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS checked_out
        ${fromWhere}
      `,
      this.prisma.$queryRaw<
        Array<{ label: string; revenue: Num; orders: Num; admits: Num }>
      >`
        SELECT
          COALESCE(NULLIF(TRIM(o.payment_method_label), ''), 'Online') AS label,
          COALESCE(SUM(oi.total_amount), 0) AS revenue,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits
        ${fromWhere}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<
        Array<{ visitor_type: VisitorType; admits: Num; tickets: Num; revenue: Num }>
      >`
        SELECT
          oi.visitor_type,
          COALESCE(SUM(CASE WHEN oi.ticket_is_cafe = false THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COALESCE(SUM(CASE WHEN oi.ticket_is_cafe = false THEN oi.quantity ELSE 0 END), 0)::int AS tickets,
          COALESCE(SUM(oi.total_amount), 0) AS revenue
        ${fromWhere}
          AND oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
        GROUP BY oi.visitor_type
      `,
      this.prisma.$queryRaw<
        Array<{ label: string; admits: Num; orders: Num; revenue: Num }>
      >`
        SELECT
          COALESCE(NULLIF(TRIM(o.customer_age_group), ''), 'Unknown') AS label,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(oi.total_amount), 0) AS revenue
        ${fromWhere}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<
        Array<{ label: string; admits: Num; orders: Num; revenue: Num }>
      >`
        SELECT
          COALESCE(NULLIF(TRIM(o.customer_geographic_region), ''), 'Unknown') AS label,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(oi.total_amount), 0) AS revenue
        ${fromWhere}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<
        Array<{
          ticket_item_id: string;
          ticket_label: string;
          item_type: string;
          tickets: Num;
          admits: Num;
          revenue: Num;
          orders: Num;
        }>
      >`
        SELECT
          oi.item_id AS ticket_item_id,
          MAX(oi.display_name) AS ticket_label,
          oi.item_type::text AS item_type,
          COALESCE(SUM(CASE WHEN oi.ticket_is_cafe = false THEN oi.quantity ELSE 0 END), 0)::int AS tickets,
          COALESCE(SUM(CASE WHEN oi.ticket_is_cafe = false THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COALESCE(SUM(oi.total_amount), 0) AS revenue,
          COUNT(DISTINCT oi.order_id)::int AS orders
        ${fromWhere}
          AND oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
        GROUP BY oi.item_id, oi.item_type
      `,
      this.prisma.$queryRaw<
        Array<{ mode: string; revenue: Num; orders: Num; admits: Num }>
      >`
        SELECT
          CASE
            WHEN o.payment_mode::text LIKE 'offline%' OR o.payment_mode::text IN ('split', 'advance')
              THEN 'offline'
            WHEN o.payment_mode::text = 'online' THEN 'online'
            ELSE o.payment_mode::text
          END AS mode,
          COALESCE(SUM(oi.total_amount), 0) AS revenue,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits
        ${fromWhere}
        GROUP BY 1
      `,
      this.prisma.$queryRaw<
        Array<{
          payment_mode: string;
          revenue: Num;
          orders: Num;
          admits: Num;
          tickets: Num;
        }>
      >`
        SELECT
          o.payment_mode::text AS payment_mode,
          COALESCE(SUM(oi.total_amount), 0) AS revenue,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.quantity ELSE 0 END), 0)::int AS tickets
        ${fromWhere}
        GROUP BY o.payment_mode
      `,
      this.prisma.$queryRaw<
        Array<{
          agent_id: string;
          orders: Num;
          admits: Num;
          revenue: Num;
          cash: Num;
          card: Num;
        }>
      >`
        SELECT
          COALESCE(oi.booked_by_agent_id, o.booked_by_agent_id)::text AS agent_id,
          COUNT(DISTINCT oi.order_id)::int AS orders,
          COALESCE(SUM(CASE
            WHEN oi.item_type IN ('ticket_type'::"OrderItemType", 'ticket_variant'::"OrderItemType")
              AND oi.ticket_is_cafe = false
              THEN oi.admit_count * oi.quantity ELSE 0 END), 0)::int AS admits,
          COALESCE(SUM(oi.total_amount), 0) AS revenue,
          COALESCE(SUM(
            CASE WHEN o.total_amount > 0
              THEN oi.total_amount / o.total_amount * o.cash_amount
              ELSE 0 END
          ), 0) AS cash,
          COALESCE(SUM(
            CASE WHEN o.total_amount > 0
              THEN oi.total_amount / o.total_amount * o.card_amount
              ELSE 0 END
          ), 0) AS card
        ${fromWhere}
          AND COALESCE(oi.booked_by_agent_id, o.booked_by_agent_id) IS NOT NULL
        GROUP BY 1
      `,
    ]);

    const t = totals[0] ?? {
      ticket_net: 0,
      cafe_net: 0,
      other_net: 0,
      cafe_items: 0,
      cafe_orders: 0,
      checked_in: 0,
      checked_out: 0,
    };
    const n = (v: Num) => Number(v || 0);

    const payMerged = new Map<
      string,
      { label: string; revenue: number; orders: number; admits: number }
    >();
    for (const row of paymentMixRows) {
      const label = normalizePaymentMethodLabel(row.label || 'Online');
      const cur = payMerged.get(label) ?? { label, revenue: 0, orders: 0, admits: 0 };
      cur.revenue = money(cur.revenue + n(row.revenue));
      cur.orders += n(row.orders);
      cur.admits += n(row.admits);
      payMerged.set(label, cur);
    }

    const cafeNet = money(n(t.cafe_net));
    return {
      payment_mix: [...payMerged.values()],
      visitor_breakdown: visitorRows.map((row) => ({
        visitor_type: row.visitor_type,
        admits: n(row.admits),
        tickets: n(row.tickets),
        revenue: money(n(row.revenue)),
      })),
      demographics_age: mergeAgeGroupsIntoCampBuckets(
        ageRows.map((row) => ({
          label: normalizeCustomerAgeGroup(row.label),
          admits: n(row.admits),
          orders: n(row.orders),
          revenue: money(n(row.revenue)),
        })),
      ),
      demographics_region: regionRows
        .map((row) => ({
          label: row.label,
          admits: n(row.admits),
          orders: n(row.orders),
          revenue: money(n(row.revenue)),
        }))
        .sort((a, b) => b.admits - a.admits),
      tickets: ticketRows
        .map((row) => ({
          ticket_item_id: row.ticket_item_id,
          ticket_label: row.ticket_label,
          item_type: row.item_type,
          tickets: n(row.tickets),
          admits: n(row.admits),
          revenue: money(n(row.revenue)),
          orders: n(row.orders),
          status: 'active' as const,
        }))
        .sort((a, b) => b.revenue - a.revenue),
      cafe: {
        cafe_net: cafeNet,
        orders: n(t.cafe_orders),
        items_sold: n(t.cafe_items),
      },
      online_offline: modeRows.map((row) => ({
        mode: row.mode,
        revenue: money(n(row.revenue)),
        orders: n(row.orders),
        admits: n(row.admits),
      })),
      payment_modes: paymentModeRows
        .map((row) => ({
          payment_mode: row.payment_mode,
          revenue: money(n(row.revenue)),
          orders: n(row.orders),
          admits: n(row.admits),
          tickets: n(row.tickets),
        }))
        .sort((a, b) => b.revenue - a.revenue),
      agents: agentRows.map((row) => ({
        agent_id: row.agent_id,
        orders: n(row.orders),
        admits: n(row.admits),
        revenue: money(n(row.revenue)),
        cash: money(n(row.cash)),
        card: money(n(row.card)),
      })),
      ticket_net: money(n(t.ticket_net)),
      cafe_net: cafeNet,
      other_net: money(n(t.other_net)),
      checked_in: n(t.checked_in),
      checked_out: n(t.checked_out),
    };
  }

  /** Simple event scope for snapshot tables — prefer eventId, else eventIds list. */
  private eventScope(filters: ReportQueryFilters): {
    eventId?: string | { in: string[] };
    event?: { organizationId: string };
  } {
    if (filters.eventId) {
      if (filters.eventIds && !filters.eventIds.includes(filters.eventId)) {
        throw new BadRequestException('You do not have access to this event.');
      }
      return { eventId: filters.eventId };
    }
    if (filters.eventIds) {
      return { eventId: { in: filters.eventIds } };
    }
    if (filters.organizationId) {
      return { event: { organizationId: filters.organizationId } };
    }
    return {};
  }

  private dailyWhere(filters: ReportQueryFilters): Prisma.BookingReportDailyWhereInput {
    return {
      reportDay: this.dayBounds(filters),
      reportBasis: this.reportBasis(filters),
      ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
      ...this.eventScope(filters),
    };
  }

  async overview(filters: ReportQueryFilters) {
    const vendorIds = this.effectiveVendorIds(filters);
    const useVendorRollups = Boolean(vendorIds);

    const [daily, counters, recent] = await Promise.all([
      useVendorRollups
        ? this.prisma.bookingReportThirdPartyVendorDaily.findMany({
            where: {
              reportDay: this.dayBounds(filters),
              reportBasis: this.reportBasis(filters),
              ...this.vendorWhere(filters),
              ...this.eventScope(filters),
            },
          })
        : this.prisma.bookingReportDaily.findMany({ where: this.dailyWhere(filters) }),
      filters.eventId
        ? this.prisma.eventSalesCounter.findMany({
            where: {
              eventId: filters.eventId,
              eventSessionId: null,
              inventoryItemId: null,
            },
          })
        : filters.eventIds
          ? this.prisma.eventSalesCounter.findMany({
              where: {
                eventId: { in: filters.eventIds },
                eventSessionId: null,
                inventoryItemId: null,
              },
            })
          : filters.organizationId
            ? this.prisma.eventSalesCounter.findMany({
                where: {
                  event: { organizationId: filters.organizationId },
                  eventSessionId: null,
                  inventoryItemId: null,
                },
              })
            : this.prisma.eventSalesCounter.findMany({
                where: { eventSessionId: null, inventoryItemId: null },
                take: 500,
              }),
      this.prisma.order.findMany({
        where: this.orderWhere(filters),
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          commonOrder: true,
          customerName: true,
          customerEmail: true,
          eventTitle: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
        },
      }),
    ]);

    const grossSales = sum(daily.map((d) => d.revenueTotal.toNumber()));
    const ticketsSold = sum(daily.map((d) => d.ticketQty));
    const admits = sum(daily.map((d) => d.admitCount));
    const orderCount = sum(daily.map((d) => d.orderCount));
    const addonsNet = useVendorRollups
      ? 0
      : sum(
          (daily as Array<{ addonsNet?: { toNumber: () => number } }>).map((d) =>
            d.addonsNet ? d.addonsNet.toNumber() : 0,
          ),
        );

    const trendMap = new Map<
      string,
      { date: string; gross_sales: number; tickets_sold: number; orders: number }
    >();
    for (const row of daily) {
      const date = row.reportDay.toISOString().slice(0, 10);
      const point = trendMap.get(date) ?? {
        date,
        gross_sales: 0,
        tickets_sold: 0,
        orders: 0,
      };
      point.gross_sales = money(point.gross_sales + row.revenueTotal.toNumber());
      point.tickets_sold += row.ticketQty;
      point.orders += row.orderCount;
      trendMap.set(date, point);
    }

    const byEvent = new Map<
      string,
      { event_id: string; gross_sales: number; tickets_sold: number; orders: number }
    >();
    for (const row of daily) {
      const cur = byEvent.get(row.eventId) ?? {
        event_id: row.eventId,
        gross_sales: 0,
        tickets_sold: 0,
        orders: 0,
      };
      cur.gross_sales = money(cur.gross_sales + row.revenueTotal.toNumber());
      cur.tickets_sold += row.ticketQty;
      cur.orders += row.orderCount;
      byEvent.set(row.eventId, cur);
    }

    return {
      success: true,
      data: {
        meta: {
          source: 'rollups',
          report_basis: this.reportBasis(filters),
          rollup_incomplete: daily.length === 0,
        },
        metrics: {
          gross_sales: grossSales,
          tickets_sold: ticketsSold,
          total_admits: admits,
          total_orders: orderCount,
          addons_net: addonsNet,
          held_qty: sum(counters.map((c) => c.heldQty)),
          sold_qty: sum(counters.map((c) => c.soldQty)),
        },
        sales_trend: [...trendMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
        sales_by_event: [...byEvent.values()]
          .sort((a, b) => b.gross_sales - a.gross_sales)
          .slice(0, 8),
        recent_orders: recent.map((order) => ({
          id: order.id,
          common_order: order.commonOrder,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          event_title: order.eventTitle,
          status: order.status,
          total: order.totalAmount.toNumber(),
          currency: order.currency,
          created_at: order.createdAt.toISOString(),
        })),
      },
    };
  }

  async paymentMix(filters: ReportQueryFilters) {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      return {
        success: true,
        data: vendorViews.payment_mix,
      };
    }

    const rows = await this.prisma.bookingReportPaymentDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...this.eventScope(filters),
      },
    });
    const byLabel = new Map<
      string,
      { label: string; revenue: number; orders: number; admits: number }
    >();
    for (const row of rows) {
      const label = normalizePaymentMethodLabel(row.paymentMethodLabel);
      const cur = byLabel.get(label) ?? {
        label,
        revenue: 0,
        orders: 0,
        admits: 0,
      };
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.orders += row.orderCount;
      cur.admits += row.admitCount;
      byLabel.set(label, cur);
    }
    return { success: true, data: [...byLabel.values()] };
  }

  async visitorTypeBreakdown(filters: ReportQueryFilters) {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      return {
        success: true,
        data: vendorViews.visitor_breakdown,
      };
    }

    const rows = await this.prisma.bookingReportVisitorDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...this.eventScope(filters),
      },
    });
    const buckets: Record<
      string,
      { visitor_type: VisitorType; admits: number; tickets: number; revenue: number }
    > = {};
    for (const row of rows) {
      const cur = buckets[row.visitorType] ?? {
        visitor_type: row.visitorType,
        admits: 0,
        tickets: 0,
        revenue: 0,
      };
      cur.admits += row.admitCount;
      cur.tickets += row.ticketQty;
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      buckets[row.visitorType] = cur;
    }
    return { success: true, data: Object.values(buckets) };
  }

  async demographics(filters: ReportQueryFilters, dimension: 'age' | 'region') {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      const views = vendorViews;
      return {
        success: true,
        data:
          dimension === 'age' ? views.demographics_age : views.demographics_region,
      };
    }

    const rows = await this.prisma.bookingReportDemoDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...this.eventScope(filters),
      },
    });
    const byLabel = new Map<
      string,
      { label: string; admits: number; orders: number; revenue: number }
    >();
    for (const row of rows) {
      const label = dimension === 'age' ? row.ageGroup : row.region;
      const cur = byLabel.get(label) ?? {
        label,
        admits: 0,
        orders: 0,
        revenue: 0,
      };
      cur.admits += row.admitCount;
      cur.orders += row.orderCount;
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      byLabel.set(label, cur);
    }
    if (dimension === 'age') {
      // Always Group 1–4 (legacy mergeAgeGroupsIntoCampBuckets).
      return {
        success: true,
        data: mergeAgeGroupsIntoCampBuckets([...byLabel.values()]),
      };
    }
    return {
      success: true,
      data: [...byLabel.values()].sort((a, b) => b.admits - a.admits),
    };
  }

  async listOrders(filters: ReportQueryFilters) {
    const page = Math.max(1, filters.page ?? 1);
    const perPage = Math.min(50, Math.max(1, filters.perPage ?? 20));
    const where = this.orderWhere(filters);
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
    ]);
    return {
      success: true,
      data: {
        orders: orders.map((order) => ({
          id: order.id,
          common_order: order.commonOrder,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          customer_phone: order.customerPhone,
          customer_age_group: order.customerAgeGroup,
          customer_geographic_region: order.customerGeographicRegion,
          event_title: order.eventTitle,
          event_slug: order.eventSlug,
          event_start_date: order.eventStartDate?.toISOString().slice(0, 10) ?? null,
          payment_mode: order.paymentMode,
          payment_method_label: normalizePaymentMethodLabel(
            order.paymentMethodLabel,
          ),
          tickets_net: order.ticketsNet.toNumber(),
          addons_net: order.addonsNet.toNumber(),
          total_amount: order.totalAmount.toNumber(),
          total_quantity: order.totalQuantity,
          total_admits: order.totalAdmits,
          status: order.status,
          created_at: order.createdAt.toISOString(),
        })),
        pagination: {
          total,
          page,
          per_page: perPage,
          last_page: Math.max(1, Math.ceil(total / perPage)),
        },
      },
    };
  }

  async eventSummary(eventId: string) {
    const [counters, refunds, attendance] = await Promise.all([
      this.prisma.eventSalesCounter.findMany({
        where: { eventId, eventSessionId: null, inventoryItemId: null },
      }),
      this.prisma.refund.aggregate({
        where: { order: { eventId }, status: 'succeeded' },
        _sum: { amount: true },
      }),
      this.prisma.eventAttendanceCounter.findUnique({ where: { eventId } }),
    ]);
    const counter = counters[0];
    return {
      success: true,
      data: {
        sold_qty: counter?.soldQty ?? 0,
        held_qty: counter?.heldQty ?? 0,
        order_count: counter?.orderCount ?? 0,
        revenue_paid: counter?.revenuePaid.toNumber() ?? 0,
        refunded_amount: refunds._sum.amount?.toNumber() ?? 0,
        checked_in: attendance?.checkedInCount ?? 0,
        checked_out: attendance?.checkedOutCount ?? 0,
      },
    };
  }

  async listEventsHub(filters: ReportQueryFilters & { search?: string }) {
    const eventWhere: Prisma.EventWhereInput = {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.eventIds ? { id: { in: filters.eventIds } } : {}),
      ...(filters.search
        ? {
            OR: [
              { slug: { contains: filters.search, mode: 'insensitive' } },
              {
                translations: {
                  some: {
                    title: { contains: filters.search, mode: 'insensitive' },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const events = await this.prisma.event.findMany({
      where: eventWhere,
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: {
        translations: { where: { locale: 'en' }, take: 1 },
        organization: { select: { id: true, name: true } },
        salesCounters: {
          where: { eventSessionId: null, inventoryItemId: null },
          take: 1,
        },
      },
    });

    const eventIds = events.map((e) => e.id);
    const daily =
      eventIds.length === 0
        ? []
        : await this.prisma.bookingReportDaily.findMany({
            where: {
              eventId: { in: eventIds },
              reportDay: this.dayBounds(filters),
              reportBasis: this.reportBasis(filters),
            },
          });

    const byEvent = new Map<
      string,
      { revenue: number; tickets: number; admits: number; orders: number }
    >();
    for (const row of daily) {
      const cur = byEvent.get(row.eventId) ?? {
        revenue: 0,
        tickets: 0,
        admits: 0,
        orders: 0,
      };
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.tickets += row.ticketQty;
      cur.admits += row.admitCount;
      cur.orders += row.orderCount;
      byEvent.set(row.eventId, cur);
    }

    return {
      success: true,
      data: {
        events: events.map((event) => {
          const period = byEvent.get(event.id) ?? {
            revenue: 0,
            tickets: 0,
            admits: 0,
            orders: 0,
          };
          const counter = event.salesCounters[0];
          return {
            id: event.id,
            title: event.translations[0]?.title ?? event.slug,
            slug: event.slug,
            status: event.status,
            currency: event.currency,
            organization: event.organization,
            starts_at: event.startsAt?.toISOString() ?? null,
            period,
            lifetime: {
              sold_qty: counter?.soldQty ?? 0,
              held_qty: counter?.heldQty ?? 0,
              order_count: counter?.orderCount ?? 0,
              revenue_paid: counter?.revenuePaid.toNumber() ?? 0,
            },
          };
        }),
        meta: { report_basis: this.reportBasis(filters), source: 'rollups' },
      },
    };
  }

  async eventReportOverview(filters: ReportQueryFilters & { eventId: string }) {
    const eventId = filters.eventId;
    const vendorIds = this.effectiveVendorIds(filters);
    const vendorViewsPromise = vendorIds
      ? this.vendorScopedViews(filters)
      : Promise.resolve(null);

    const [
      overview,
      paymentMix,
      visitorBreakdown,
      demographicsAge,
      demographicsRegion,
      ticketRows,
      summary,
      incompleteAdvances,
      firstPaid,
      cafeSales,
      vendorViews,
    ] = await Promise.all([
      this.overview(filters),
      vendorIds
        ? Promise.resolve({ success: true as const, data: [] as Array<{
            label: string;
            revenue: number;
            orders: number;
            admits: number;
          }> })
        : this.paymentMix(filters),
      vendorIds
        ? Promise.resolve({ success: true as const, data: [] as Array<{
            visitor_type: VisitorType;
            admits: number;
            tickets: number;
            revenue: number;
          }> })
        : this.visitorTypeBreakdown(filters),
      vendorIds
        ? Promise.resolve({ success: true as const, data: [] as Array<{
            label: string;
            admits: number;
            orders: number;
            revenue: number;
          }> })
        : this.demographics(filters, 'age'),
      vendorIds
        ? Promise.resolve({ success: true as const, data: [] as Array<{
            label: string;
            admits: number;
            orders: number;
            revenue: number;
          }> })
        : this.demographics(filters, 'region'),
      vendorIds
        ? Promise.resolve({ success: true as const, data: [] as Array<{
            ticket_item_id: string;
            ticket_label: string;
            item_type: string;
            tickets: number;
            admits: number;
            revenue: number;
            orders: number;
            status: 'active' | 'inactive';
          }> })
        : this.ticketBreakdown(filters),
      this.eventSummary(eventId),
      vendorIds
        ? Promise.resolve({
            _sum: { remainingAmount: null as null },
            _count: { _all: 0 },
          })
        : this.prisma.advancePayment.aggregate({
            where: {
              eventId,
              status: AdvancePaymentStatus.PENDING,
            },
            _sum: { remainingAmount: true },
            _count: { _all: true },
          }),
      this.prisma.order.findFirst({
        where: { eventId, status: 'paid' },
        orderBy: { paidAt: 'asc' },
        select: { paidAt: true, createdAt: true },
      }),
      vendorIds
        ? Promise.resolve({
            cafe_net: 0,
            orders: 0,
            items_sold: 0,
            cafes: [] as Array<{
              cafe_id: string;
              name: string;
              revenue: number;
              orders: number;
              items_sold: number;
            }>,
            meta: { source: 'vendor_sql' as const, report_basis: this.reportBasis(filters) },
          })
        : this.cafeSalesBreakdown(filters),
      vendorViewsPromise,
    ]);

    const liveSinceDate = firstPaid?.paidAt ?? firstPaid?.createdAt ?? null;
    const liveSinceDays = liveSinceDate
      ? Math.max(
          0,
          Math.floor((Date.now() - liveSinceDate.getTime()) / 86_400_000),
        )
      : null;

    if (vendorViews) {
      const views = vendorViews;
      const cafeSalesScoped = {
        cafe_net: views.cafe_net,
        orders: views.cafe.orders,
        items_sold: views.cafe.items_sold,
        cafes: [] as Array<{
          cafe_id: string;
          name: string;
          revenue: number;
          orders: number;
          items_sold: number;
        }>,
        meta: { source: 'vendor_sql' as const, report_basis: this.reportBasis(filters) },
      };
      const grossSales = overview.data.metrics.gross_sales;
      const breakdown = alignRevenueBreakdown({
        tickets: views.ticket_net,
        cafe: views.cafe_net,
        other: views.other_net,
        gross: grossSales,
      });
      const ticketNet = breakdown.tickets;
      const cafeNet = breakdown.cafe;
      const otherNet = breakdown.other;

      return {
        success: true,
        data: {
          metrics: {
            ...overview.data.metrics,
            refunded_amount: 0,
            checked_in: views.checked_in,
            checked_out: views.checked_out,
            incomplete_advance_count: 0,
            incomplete_advance_amount: 0,
            live_since_days: liveSinceDays,
            live_since_date: liveSinceDate?.toISOString() ?? null,
            ticket_net: ticketNet,
            cafe_net: cafeNet,
            other_net: otherNet,
            revenue_breakdown: breakdown,
          },
          sales_trend: overview.data.sales_trend,
          payment_mix: views.payment_mix,
          visitor_breakdown: views.visitor_breakdown,
          demographics_age: views.demographics_age,
          demographics_region: views.demographics_region,
          ticket_breakdown: views.tickets,
          cafe_sales: cafeSalesScoped,
          online_offline: views.online_offline,
          meta: {
            ...overview.data.meta,
            source: 'vendor_rollups+sql',
          },
        },
      };
    }

    const byMode = new Map<string, { mode: string; revenue: number; orders: number; admits: number }>();
    const daily = await this.prisma.bookingReportDaily.findMany({
      where: this.dailyWhere(filters),
    });
    let ticketsNetRollup = 0;
    for (const row of daily) {
      ticketsNetRollup += row.ticketsNet.toNumber();
      const mode = row.paymentMode.startsWith('offline') || row.paymentMode === 'split' || row.paymentMode === 'advance'
        ? 'offline'
        : row.paymentMode === 'online'
          ? 'online'
          : row.paymentMode;
      const cur = byMode.get(mode) ?? { mode, revenue: 0, orders: 0, admits: 0 };
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.orders += row.orderCount;
      cur.admits += row.admitCount;
      byMode.set(mode, cur);
    }

    const cafeNet = cafeSales.cafe_net;
    const addonsNet = overview.data.metrics.addons_net;
    // ticketsNet rollup is ticket lines only; cafe_net comes from cafe rollups.
    const ticketNetRaw = money(Math.max(0, ticketsNetRollup));
    const otherNetRaw = money(addonsNet);
    const grossSales = overview.data.metrics.gross_sales;
    const breakdown = alignRevenueBreakdown({
      tickets: ticketNetRaw,
      cafe: cafeNet,
      other: otherNetRaw,
      gross: grossSales,
    });
    const ticketNet = breakdown.tickets;
    const otherNet = breakdown.other;

    return {
      success: true,
      data: {
        metrics: {
          ...overview.data.metrics,
          refunded_amount: summary.data.refunded_amount,
          checked_in: summary.data.checked_in,
          checked_out: summary.data.checked_out,
          incomplete_advance_count: incompleteAdvances._count._all,
          incomplete_advance_amount:
            incompleteAdvances._sum.remainingAmount?.toNumber() ?? 0,
          live_since_days: liveSinceDays,
          live_since_date: liveSinceDate?.toISOString() ?? null,
          ticket_net: ticketNet,
          cafe_net: cafeNet,
          other_net: otherNet,
          revenue_breakdown: breakdown,
        },
        sales_trend: overview.data.sales_trend,
        payment_mix: paymentMix.data,
        visitor_breakdown: visitorBreakdown.data,
        demographics_age: demographicsAge.data,
        demographics_region: demographicsRegion.data,
        ticket_breakdown: ticketRows.data,
        cafe_sales: cafeSales,
        online_offline: [...byMode.values()],
        meta: overview.data.meta,
      },
    };
  }

  /**
   * Cafe revenue for an event (or scoped events): cafe_item + ticketIsCafe lines,
   * grouped by cafe for insight links.
   */
  async cafeSalesBreakdown(filters: ReportQueryFilters) {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      const views = vendorViews;
      return {
        cafe_net: views.cafe_net,
        orders: views.cafe.orders,
        items_sold: views.cafe.items_sold,
        // Don't emit cafe insight links — vendor IDs are not Cafe entity IDs.
        cafes: [],
        meta: { source: 'vendor_sql' as const, report_basis: this.reportBasis(filters) },
      };
    }

    const reportBasis = this.reportBasis(filters);
    const eventScope = this.eventScope(filters);
    const eventIdFilter =
      typeof eventScope.eventId === 'string'
        ? eventScope.eventId
        : eventScope.eventId && 'in' in eventScope.eventId
          ? { in: eventScope.eventId.in }
          : undefined;

    const cafes = await this.prisma.cafe.findMany({
      where: {
        ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
        ...(eventIdFilter
          ? {
              OR: [
                { activeEventId: eventIdFilter },
                {
                  assignments: {
                    some: { eventId: eventIdFilter, unassignedAt: null },
                  },
                },
              ],
            }
          : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });

    const rows = await this.prisma.bookingReportCafeDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis,
        ...(eventIdFilter ? { eventId: eventIdFilter } : {}),
        ...(filters.organizationId
          ? { cafe: { organizationId: filters.organizationId } }
          : {}),
      },
      select: {
        cafeId: true,
        orderCount: true,
        itemQty: true,
        revenueTotal: true,
      },
    });

    const cafeName = new Map(cafes.map((c) => [c.id, c.name]));
    const byCafe = new Map<
      string,
      { cafe_id: string; name: string; revenue: number; orders: number; items: number }
    >();
    for (const cafe of cafes) {
      byCafe.set(cafe.id, {
        cafe_id: cafe.id,
        name: cafe.name,
        revenue: 0,
        orders: 0,
        items: 0,
      });
    }

    let cafeNet = 0;
    let cafeItems = 0;
    let cafeOrders = 0;
    for (const row of rows) {
      const amount = row.revenueTotal.toNumber();
      cafeNet += amount;
      cafeItems += row.itemQty;
      cafeOrders += row.orderCount;
      const cur = byCafe.get(row.cafeId) ?? {
        cafe_id: row.cafeId,
        name: cafeName.get(row.cafeId) ?? 'Cafe',
        revenue: 0,
        orders: 0,
        items: 0,
      };
      cur.revenue += amount;
      cur.orders += row.orderCount;
      cur.items += row.itemQty;
      byCafe.set(row.cafeId, cur);
    }

    const orphanIds = [...byCafe.values()]
      .filter((row) => row.name === 'Cafe')
      .map((row) => row.cafe_id);
    if (orphanIds.length) {
      const orphanCafes = await this.prisma.cafe.findMany({
        where: { id: { in: orphanIds } },
        select: { id: true, name: true },
      });
      for (const cafe of orphanCafes) {
        const row = byCafe.get(cafe.id);
        if (row) row.name = cafe.name;
      }
    }

    return {
      cafe_net: money(cafeNet),
      orders: cafeOrders,
      items_sold: cafeItems,
      cafes: [...byCafe.values()]
        .map((row) => ({
          cafe_id: row.cafe_id,
          name: row.name,
          revenue: money(row.revenue),
          orders: row.orders,
          items_sold: row.items,
        }))
        .filter((row) => row.revenue > 0 || cafes.some((c) => c.id === row.cafe_id))
        .sort((a, b) => b.revenue - a.revenue),
      meta: { source: 'rollups' as const, report_basis: reportBasis },
    };
  }

  private async enrichTicketBreakdownRows(
    tickets: Array<{
      ticket_item_id: string;
      ticket_label: string;
      item_type: string;
      kind?: 'ticket' | 'separate_addon' | 'time_extension';
      ticket_type_id?: string;
      legacy_ticket_id?: number | null;
      tickets: number;
      admits: number;
      revenue: number;
      orders: number;
      addon_amount?: number;
      time_extension_amount?: number;
      ticket_revenue?: number;
      discount?: number;
      gross_revenue?: number;
      net_revenue?: number;
      status: 'active' | 'inactive';
    }>,
  ) {
    const ticketRows = tickets.filter(
      (t) => (t.kind ?? 'ticket') === 'ticket',
    );
    const ids = ticketRows.map((t) => t.ticket_item_id);
    if (!ids.length) return tickets;

    const [types, variants] = await Promise.all([
      this.prisma.ticketType.findMany({
        where: { id: { in: ids } },
        select: { id: true, status: true, externalKey: true },
      }),
      this.prisma.ticketVariant.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          status: true,
          ticketTypeId: true,
          ticketType: { select: { status: true, externalKey: true } },
        },
      }),
    ]);

    const parseLegacyId = (externalKey: string | null | undefined) => {
      const m = /^legacy-ticket-(\d+)$/.exec(externalKey ?? '');
      return m ? Number(m[1]) : null;
    };

    const byId = new Map(ticketRows.map((t) => [t.ticket_item_id, t]));
    for (const t of types) {
      const row = byId.get(t.id);
      if (!row) continue;
      row.status = t.status === 'active' ? 'active' : 'inactive';
      row.ticket_type_id = t.id;
      row.legacy_ticket_id = parseLegacyId(t.externalKey);
    }
    for (const v of variants) {
      const row = byId.get(v.id);
      if (!row) continue;
      row.status =
        v.status === 'active' && v.ticketType.status === 'active'
          ? 'active'
          : 'inactive';
      row.ticket_type_id = v.ticketTypeId;
      row.legacy_ticket_id = parseLegacyId(v.ticketType.externalKey);
    }
    for (const row of ticketRows) {
      if (!row.ticket_type_id) {
        row.ticket_type_id = row.ticket_item_id;
        row.legacy_ticket_id = row.legacy_ticket_id ?? null;
      }
    }
    return tickets;
  }

  /**
   * Tickets by type — same full sales columns as Vendors & POS product
   * breakdown (addon / time extension / ticket / discount / gross / net),
   * aggregated across vendors for the event (or scoped vendor list).
   */
  async ticketBreakdown(filters: ReportQueryFilters) {
    const scopedVendorIds = this.effectiveVendorIds(filters);
    const rows = await this.prisma.bookingReportVendorProductDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...this.eventScope(filters),
        ...(scopedVendorIds
          ? scopedVendorIds.length === 1
            ? { thirdPartyVendorId: scopedVendorIds[0] }
            : scopedVendorIds.length
              ? { thirdPartyVendorId: { in: scopedVendorIds } }
              : { thirdPartyVendorId: { in: [] } }
          : {}),
      },
    });

    if (rows.length) {
      const byProduct = new Map<
        string,
        {
          ticket_item_id: string;
          ticket_label: string;
          item_type: string;
          kind: 'ticket' | 'separate_addon' | 'time_extension';
          ticket_type_id?: string;
          legacy_ticket_id?: number | null;
          tickets: number;
          admits: number;
          orders: number;
          addon_amount: number;
          time_extension_amount: number;
          ticket_revenue: number;
          discount: number;
          gross_revenue: number;
          net_revenue: number;
          revenue: number;
          status: 'active' | 'inactive';
        }
      >();

      for (const row of rows) {
        const kind =
          row.productKind === 'separate_addon'
            ? 'separate_addon'
            : row.productKind === 'time_extension'
              ? 'time_extension'
              : 'ticket';
        const productId =
          kind === 'separate_addon'
            ? 'separate-addons'
            : kind === 'time_extension'
              ? 'time-extension'
              : row.productId;
        const key = `${kind}:${productId}`;
        const current = byProduct.get(key) ?? {
          ticket_item_id: productId,
          ticket_label: row.productLabel,
          item_type:
            kind === 'ticket'
              ? 'ticket_variant'
              : kind === 'separate_addon'
                ? 'addon'
                : 'customization',
          kind,
          tickets: 0,
          admits: 0,
          orders: 0,
          addon_amount: 0,
          time_extension_amount: 0,
          ticket_revenue: 0,
          discount: 0,
          gross_revenue: 0,
          net_revenue: 0,
          revenue: 0,
          status: 'active' as const,
        };
        current.tickets += row.ticketQty;
        current.admits += row.admitCount;
        current.orders += row.orderCount;
        current.addon_amount = money(
          current.addon_amount + row.addonAmount.toNumber(),
        );
        current.time_extension_amount = money(
          current.time_extension_amount + row.timeExtensionAmount.toNumber(),
        );
        current.ticket_revenue = money(
          current.ticket_revenue + row.ticketRevenue.toNumber(),
        );
        current.discount = money(
          current.discount + row.discountAmount.toNumber(),
        );
        current.net_revenue = money(
          current.net_revenue + row.netRevenue.toNumber(),
        );
        current.ticket_label = row.productLabel;
        byProduct.set(key, current);
      }

      // Event-owner tickets (null thirdPartyVendorId) never land in vendor-product
      // rollups. When any separate_addon/TE row exists, we used to skip ticketDaily
      // entirely — hide Adult/Child/VIP even though those rollups are correct.
      if (!scopedVendorIds) {
        const ticketDailyRows =
          await this.prisma.bookingReportTicketDaily.findMany({
            where: {
              reportDay: this.dayBounds(filters),
              reportBasis: this.reportBasis(filters),
              ...this.eventScope(filters),
            },
          });
        for (const row of ticketDailyRows) {
          const key = `ticket:${row.ticketItemId}`;
          if (byProduct.has(key)) continue;
          const revenue = money(row.revenueTotal.toNumber());
          byProduct.set(key, {
            ticket_item_id: row.ticketItemId,
            ticket_label: row.ticketLabel,
            item_type: row.itemType,
            kind: 'ticket',
            tickets: row.ticketQty,
            admits: row.admitCount,
            orders: row.orderCount,
            addon_amount: 0,
            time_extension_amount: 0,
            ticket_revenue: revenue,
            discount: 0,
            gross_revenue: revenue,
            net_revenue: revenue,
            revenue,
            status: 'active',
          });
        }
      }

      const tickets = [...byProduct.values()]
        .map((row) => {
          row.gross_revenue = money(row.net_revenue + row.discount);
          row.revenue = row.net_revenue;
          if (row.kind === 'separate_addon') {
            row.ticket_label = 'Separate Addons';
          } else if (row.kind === 'time_extension') {
            row.ticket_label = 'Time Extension Purchase';
          }
          return row;
        })
        .filter(
          (row) =>
            row.net_revenue > 0 ||
            row.tickets > 0 ||
            row.addon_amount > 0 ||
            row.time_extension_amount > 0,
        );

      const enriched = await this.enrichTicketBreakdownRows(tickets);
      return {
        success: true,
        data: enriched.sort((a, b) => {
          const kindRank = (kind?: string) =>
            kind === 'ticket' || !kind ? 0 : kind === 'separate_addon' ? 1 : 2;
          const byKind = kindRank(a.kind) - kindRank(b.kind);
          if (byKind !== 0) return byKind;
          return b.revenue - a.revenue;
        }),
      };
    }

    // Fallback when vendor-product rollups are not populated yet.
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      const tickets = await this.enrichTicketBreakdownRows(
        vendorViews.tickets.map((t) => ({
          ...t,
          kind: 'ticket' as const,
          addon_amount: 0,
          time_extension_amount: 0,
          ticket_revenue: t.revenue,
          discount: 0,
          gross_revenue: t.revenue,
          net_revenue: t.revenue,
        })),
      );
      return { success: true, data: tickets };
    }

    const ticketRows = await this.prisma.bookingReportTicketDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...this.eventScope(filters),
      },
    });
    const byTicket = new Map<
      string,
      {
        ticket_item_id: string;
        ticket_label: string;
        item_type: string;
        kind: 'ticket';
        ticket_type_id?: string;
        legacy_ticket_id?: number | null;
        tickets: number;
        admits: number;
        revenue: number;
        orders: number;
        addon_amount: number;
        time_extension_amount: number;
        ticket_revenue: number;
        discount: number;
        gross_revenue: number;
        net_revenue: number;
        status: 'active' | 'inactive';
      }
    >();
    for (const row of ticketRows) {
      const cur = byTicket.get(row.ticketItemId) ?? {
        ticket_item_id: row.ticketItemId,
        ticket_label: row.ticketLabel,
        item_type: row.itemType,
        kind: 'ticket' as const,
        tickets: 0,
        admits: 0,
        revenue: 0,
        orders: 0,
        addon_amount: 0,
        time_extension_amount: 0,
        ticket_revenue: 0,
        discount: 0,
        gross_revenue: 0,
        net_revenue: 0,
        status: 'active' as const,
      };
      cur.tickets += row.ticketQty;
      cur.admits += row.admitCount;
      const revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.revenue = revenue;
      cur.ticket_revenue = revenue;
      cur.net_revenue = revenue;
      cur.gross_revenue = revenue;
      cur.orders += row.orderCount;
      cur.ticket_label = row.ticketLabel;
      byTicket.set(row.ticketItemId, cur);
    }

    const tickets = await this.enrichTicketBreakdownRows([
      ...byTicket.values(),
    ]);

    return {
      success: true,
      data: tickets.sort((a, b) => b.revenue - a.revenue),
    };
  }

  async eventReportTickets(filters: ReportQueryFilters) {
    const [tickets, pos, namedExtras] = await Promise.all([
      this.ticketBreakdown(filters),
      this.posBreakdown(filters),
      this.namedExtrasBreakdown(filters),
    ]);
    return {
      success: true,
      data: {
        tickets: tickets.data,
        agents: pos.data,
        // Additive detail only — does not alter tickets / vendor-product totals.
        named_extras: namedExtras,
        meta: {
          report_basis: this.reportBasis(filters),
          source: 'rollups',
        },
      },
    };
  }

  /**
   * Per-name addon / time-extension units sold from daily rollups.
   * Falls back to a bounded order_items scan only when rollups are empty
   * (e.g. before backfill) so existing money tables stay untouched.
   */
  async namedExtrasBreakdown(filters: ReportQueryFilters) {
    const vendorIds = this.effectiveVendorIds(filters);
    const reportBasis = this.reportBasis(filters);
    const rows = await this.prisma.bookingReportNamedExtraDaily.findMany({
      where: {
        ...this.eventScope(filters),
        reportBasis,
        reportDay: this.dayBounds(filters),
        ...(vendorIds
          ? {
              thirdPartyVendorId:
                vendorIds.length === 1 ? vendorIds[0] : { in: vendorIds },
            }
          : {}),
      },
      select: {
        productKind: true,
        productId: true,
        productLabel: true,
        orderCount: true,
        itemQty: true,
        withTicketQty: true,
        standaloneQty: true,
        revenueTotal: true,
      },
    });

    if (rows.length > 0) {
      const buckets = mergeNamedExtraDailyRows(
        rows.map((row) => ({
          productKind: row.productKind,
          productId: row.productId,
          productLabel: row.productLabel,
          orderCount: row.orderCount,
          itemQty: row.itemQty,
          withTicketQty: row.withTicketQty,
          standaloneQty: row.standaloneQty,
          revenueTotal: row.revenueTotal.toNumber(),
        })),
      );
      return {
        addons: buckets.filter((row) => row.kind === 'addon'),
        time_extensions: buckets.filter((row) => row.kind === 'time_extension'),
        meta: { source: 'rollups' as const },
      };
    }

    // Cold start / pre-backfill only — avoid this path after sync-perf rebuild.
    const lines = await this.prisma.orderItem.findMany({
      where: {
        itemType: {
          in: [
            OrderItemType.addon,
            OrderItemType.addon_variant,
            OrderItemType.customization,
          ],
        },
        ...(vendorIds
          ? {
              thirdPartyVendorId:
                vendorIds.length === 1 ? vendorIds[0] : { in: vendorIds },
            }
          : {}),
        order: {
          ...this.orderWhere(filters),
          status: OrderStatus.paid,
        },
      },
      select: {
        itemId: true,
        itemType: true,
        displayName: true,
        quantity: true,
        totalAmount: true,
        parentOrderItemId: true,
        orderId: true,
        thirdPartyVendorId: true,
      },
      take: 20_000,
    });

    const buckets = buildNamedExtraBuckets(
      lines.map((line) => ({
        itemId: line.itemId,
        itemType: line.itemType,
        displayName: line.displayName,
        quantity: line.quantity,
        totalAmount: line.totalAmount.toNumber(),
        parentOrderItemId: line.parentOrderItemId,
        orderId: line.orderId,
        thirdPartyVendorId: line.thirdPartyVendorId,
      })),
    );

    return {
      addons: buckets.filter((row) => row.kind === 'addon'),
      time_extensions: buckets.filter((row) => row.kind === 'time_extension'),
      meta: { source: 'order_items_fallback' as const },
    };
  }

  async eventReportVisitors(filters: ReportQueryFilters) {
    const [orders, demographicsAge, demographicsRegion, visitorBreakdown] =
      await Promise.all([
        this.listOrders({ ...filters, perPage: filters.perPage ?? 25 }),
        this.demographics(filters, 'age'),
        this.demographics(filters, 'region'),
        this.visitorTypeBreakdown(filters),
      ]);
    return {
      success: true,
      data: {
        visitors: orders.data.orders,
        pagination: orders.data.pagination,
        demographics_age: demographicsAge.data,
        demographics_region: demographicsRegion.data,
        visitor_breakdown: visitorBreakdown.data,
        meta: { report_basis: this.reportBasis(filters), source: 'snapshots+rollups' },
      },
    };
  }

  async eventReportPayments(filters: ReportQueryFilters) {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      const views = vendorViews;
      const overview = await this.overview(filters);
      return {
        success: true,
        data: {
          payment_mix: views.payment_mix,
          payment_modes: views.payment_modes,
          sales_trend: overview.data.sales_trend,
          meta: {
            report_basis: this.reportBasis(filters),
            source: 'vendor_sql',
          },
        },
      };
    }

    const [paymentMix, overview] = await Promise.all([
      this.paymentMix(filters),
      this.overview(filters),
    ]);
    const daily = await this.prisma.bookingReportDaily.findMany({
      where: this.dailyWhere(filters),
    });
    const byMode = new Map<
      string,
      { payment_mode: string; revenue: number; orders: number; admits: number; tickets: number }
    >();
    for (const row of daily) {
      const cur = byMode.get(row.paymentMode) ?? {
        payment_mode: row.paymentMode,
        revenue: 0,
        orders: 0,
        admits: 0,
        tickets: 0,
      };
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.orders += row.orderCount;
      cur.admits += row.admitCount;
      cur.tickets += row.ticketQty;
      byMode.set(row.paymentMode, cur);
    }
    return {
      success: true,
      data: {
        payment_mix: paymentMix.data,
        payment_modes: [...byMode.values()].sort((a, b) => b.revenue - a.revenue),
        sales_trend: overview.data.sales_trend,
        meta: { report_basis: this.reportBasis(filters), source: 'rollups' },
      },
    };
  }

  async shareBreakdown(filters: ReportQueryFilters) {
    const vendorIds = this.effectiveVendorIds(filters);
    const vendorFilter = this.vendorWhere(filters);
    const configuredShares = filters.eventId
      ? await this.prisma.thirdPartyVendor.findMany({
          where: {
            eventId: filters.eventId,
            ...(vendorIds
              ? vendorIds.length === 1
                ? { id: vendorIds[0] }
                : { id: { in: vendorIds } }
              : {}),
          },
          select: {
            id: true,
            name: true,
            organiserShare: true,
            vendorSharePct: true,
            isCafe: true,
            collectedBy: true,
            ownerName: true,
            ownerPercentageType: true,
            sortOrder: true,
            event: { select: { currency: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
      : [];
    const rows = await this.prisma.bookingReportThirdPartyVendorDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...vendorFilter,
        ...this.eventScope(filters),
      },
      include: {
        thirdPartyVendor: {
          select: {
            id: true,
            name: true,
            organiserShare: true,
            vendorSharePct: true,
            isCafe: true,
            collectedBy: true,
            ownerName: true,
            ownerPercentageType: true,
            sortOrder: true,
          },
        },
      },
    });
    const byShare = new Map<
      string,
      {
        third_party_vendor_id: string;
        name: string;
        organiser_share: number;
        vendor_share_pct: number;
        tickets: number;
        admits: number;
        net_sales: number;
        orders: number;
        is_cafe: boolean;
        payment_reference: string | null;
        revenue_rule: string;
        currency: string;
        products: VendorProductBreakdownRow[];
        trend: Array<{ date: string; net_sales: number }>;
      }
    >();

    for (const share of configuredShares) {
      byShare.set(share.id, {
        third_party_vendor_id: share.id,
        name: share.name,
        organiser_share: share.organiserShare.toNumber(),
        vendor_share_pct: share.vendorSharePct.toNumber(),
        tickets: 0,
        admits: 0,
        net_sales: 0,
        orders: 0,
        is_cafe: share.isCafe,
        payment_reference: share.ownerName ?? share.collectedBy,
        revenue_rule: share.ownerPercentageType ?? 'normal',
        currency: share.event.currency,
        products: [],
        trend: [],
      });
    }

    const trendByShare = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const cur = byShare.get(row.thirdPartyVendorId) ?? {
        third_party_vendor_id: row.thirdPartyVendorId,
        name: row.thirdPartyVendor.name,
        organiser_share: row.thirdPartyVendor.organiserShare.toNumber(),
        vendor_share_pct: row.thirdPartyVendor.vendorSharePct.toNumber(),
        tickets: 0,
        admits: 0,
        net_sales: 0,
        orders: 0,
        is_cafe: row.thirdPartyVendor.isCafe,
        payment_reference: row.thirdPartyVendor.ownerName ?? row.thirdPartyVendor.collectedBy,
        revenue_rule: row.thirdPartyVendor.ownerPercentageType ?? 'normal',
        currency: row.currency,
        products: [],
        trend: [],
      };
      cur.tickets += row.ticketQty;
      cur.admits += row.admitCount;
      cur.net_sales = money(cur.net_sales + row.revenueTotal.toNumber());
      cur.orders += row.orderCount;
      byShare.set(row.thirdPartyVendorId, cur);

      const date = row.reportDay.toISOString().slice(0, 10);
      const shareTrend = trendByShare.get(row.thirdPartyVendorId) ?? new Map<string, number>();
      shareTrend.set(date, money((shareTrend.get(date) ?? 0) + row.revenueTotal.toNumber()));
      trendByShare.set(row.thirdPartyVendorId, shareTrend);
    }

    const productVendorIds = [...byShare.keys()];
    const productsByVendor =
      productVendorIds.length > 0
        ? await this.vendorProductBreakdown(filters, productVendorIds)
        : new Map<string, VendorProductBreakdownRow[]>();
    for (const [vendorId, products] of productsByVendor) {
      const share = byShare.get(vendorId);
      if (!share) continue;
      share.products = products;
    }

    const data = [...byShare.values()].map((share) => {
      const ownerRevenue = money(share.net_sales * (share.organiser_share / 100));
      const vendorRevenue = money(share.net_sales - ownerRevenue);
      return {
        ...share,
        revenue: share.net_sales,
        event_owner_revenue: ownerRevenue,
        vendor_revenue: vendorRevenue,
        average_order_value: share.orders ? money(share.net_sales / share.orders) : 0,
        products: share.products,
        trend: [...(trendByShare.get(share.third_party_vendor_id) ?? new Map()).entries()]
          .map(([date, netSales]) => ({ date, net_sales: netSales }))
          .sort((a, b) => a.date.localeCompare(b.date)),
      };
    });
    return {
      success: true,
      data,
    };
  }

  async posBreakdown(filters: ReportQueryFilters) {
    const vendorViews = await this.vendorScopedViews(filters);
    if (vendorViews) {
      const views = vendorViews;
      const agentIds = views.agents.map((a) => a.agent_id);
      const agents =
        agentIds.length === 0
          ? []
          : await this.prisma.user.findMany({
              where: { id: { in: agentIds } },
              select: { id: true, name: true, email: true },
            });
      const agentMap = new Map(agents.map((a) => [a.id, a]));
      const vendorIdsByAgent = await this.agentVendorIdsForPos(filters, agentIds);
      const scopedVendorIds = this.effectiveVendorIds(filters);
      return {
        success: true,
        data: views.agents
          .map((row) => {
            const agent = agentMap.get(row.agent_id);
            const vendorIds = [
              ...(vendorIdsByAgent.get(row.agent_id) ?? []),
            ].sort();
            return {
              agent_id: row.agent_id,
              agent_name: agent?.name ?? 'Unknown agent',
              agent_email: agent?.email ?? null,
              orders: row.orders,
              admits: row.admits,
              revenue: row.revenue,
              cash: row.cash,
              card: row.card,
              third_party_vendor_ids: vendorIds,
            };
          })
          .filter((row) => {
            if (!scopedVendorIds?.length) return true;
            return row.third_party_vendor_ids.some((id) =>
              scopedVendorIds.includes(id),
            );
          })
          .sort((a, b) => b.revenue - a.revenue),
      };
    }

    const rows = await this.prisma.bookingReportPosDaily.findMany({
      where: {
        reportDay: this.dayBounds(filters),
        reportBasis: this.reportBasis(filters),
        ...(filters.bookedByAgentId
          ? { bookedByAgentId: filters.bookedByAgentId }
          : {}),
        ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
        ...this.eventScope(filters),
      },
    });
    const agentIds = [...new Set(rows.map((r) => r.bookedByAgentId))];
    const agents =
      agentIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true, email: true },
          });
    const agentMap = new Map(agents.map((a) => [a.id, a]));

    const byAgent = new Map<
      string,
      {
        agent_id: string;
        agent_name: string;
        agent_email: string | null;
        orders: number;
        admits: number;
        revenue: number;
        cash: number;
        card: number;
        third_party_vendor_ids: string[];
      }
    >();
    for (const row of rows) {
      const agent = agentMap.get(row.bookedByAgentId);
      const cur = byAgent.get(row.bookedByAgentId) ?? {
        agent_id: row.bookedByAgentId,
        agent_name: agent?.name ?? 'Unknown agent',
        agent_email: agent?.email ?? null,
        orders: 0,
        admits: 0,
        revenue: 0,
        cash: 0,
        card: 0,
        third_party_vendor_ids: [],
      };
      cur.orders += row.orderCount;
      cur.admits += row.admitCount;
      cur.revenue = money(cur.revenue + row.revenueTotal.toNumber());
      cur.cash = money(cur.cash + row.cashAmount.toNumber());
      cur.card = money(cur.card + row.cardAmount.toNumber());
      byAgent.set(row.bookedByAgentId, cur);
    }

    const vendorIdsByAgent = await this.agentVendorIdsForPos(
      filters,
      [...byAgent.keys()],
    );
    const scopedVendorIds = this.effectiveVendorIds(filters);
    const agentsOut = [...byAgent.values()]
      .map((row) => {
        const vendorIds = [...(vendorIdsByAgent.get(row.agent_id) ?? [])].sort();
        return { ...row, third_party_vendor_ids: vendorIds };
      })
      .filter((row) => {
        if (!scopedVendorIds?.length) return true;
        return row.third_party_vendor_ids.some((id) =>
          scopedVendorIds.includes(id),
        );
      })
      .sort((a, b) => b.revenue - a.revenue);

    return {
      success: true,
      data: agentsOut,
    };
  }

  /**
   * Vendors each POS agent is relevant to: staff assignment scope ∪ vendors
   * they sold for in the reporting window.
   */
  private async agentVendorIdsForPos(
    filters: ReportQueryFilters,
    agentIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const byAgent = new Map<string, Set<string>>();
    if (!agentIds.length) return byAgent;

    const ensure = (agentId: string) => {
      const current = byAgent.get(agentId) ?? new Set<string>();
      byAgent.set(agentId, current);
      return current;
    };

    if (filters.eventId) {
      const assignments = await this.prisma.staffAssignment.findMany({
        where: {
          eventId: filters.eventId,
          userId: { in: agentIds },
          status: 'active',
        },
        select: {
          userId: true,
          thirdPartyVendorId: true,
          thirdPartyVendorIds: true,
        },
      });
      for (const row of assignments) {
        const set = ensure(row.userId);
        if (row.thirdPartyVendorId) set.add(row.thirdPartyVendorId);
        for (const id of row.thirdPartyVendorIds) {
          if (id) set.add(id);
        }
      }
    }

    const dateCol =
      filters.filterBasedOn === 'event_date'
        ? Prisma.sql`o.event_start_date`
        : Prisma.sql`o.created_at`;
    const eventSql = filters.eventId
      ? Prisma.sql`AND oi.event_id = ${filters.eventId}::uuid`
      : filters.eventIds?.length
        ? Prisma.sql`AND oi.event_id IN (${Prisma.join(
            filters.eventIds.map((id) => Prisma.sql`${id}::uuid`),
          )})`
        : Prisma.empty;
    const agentSql = Prisma.join(
      agentIds.map((id) => Prisma.sql`${id}::uuid`),
    );

    const sold = await this.prisma.$queryRaw<
      Array<{ agent_id: string; vendor_id: string }>
    >`
      SELECT DISTINCT
        COALESCE(oi.booked_by_agent_id, o.booked_by_agent_id)::text AS agent_id,
        oi.third_party_vendor_id::text AS vendor_id
      FROM order_items oi
      INNER JOIN orders o ON o.id = oi.order_id
      WHERE oi.third_party_vendor_id IS NOT NULL
        AND COALESCE(oi.booked_by_agent_id, o.booked_by_agent_id) IN (${agentSql})
        ${eventSql}
        AND o.status <> 'expired'::"OrderStatus"
        AND ${dateCol} >= ${filters.from}
        AND ${dateCol} <= ${filters.to}
    `;

    for (const row of sold) {
      if (!row.agent_id || !row.vendor_id) continue;
      ensure(row.agent_id).add(row.vendor_id);
    }

    return byAgent;
  }

  async eventReportShare(filters: ReportQueryFilters) {
    const [share, pos] = await Promise.all([
      this.shareBreakdown(filters),
      this.posBreakdown(filters),
    ]);
    return {
      success: true,
      data: {
        third_party_vendors: share.data,
        pos_agents: pos.data,
        totals: {
          net_sales: money(sum(share.data.map((row) => row.net_sales))),
          event_owner_revenue: money(
            sum(share.data.map((row) => row.event_owner_revenue)),
          ),
          vendor_revenue: money(
            sum(share.data.map((row) => row.vendor_revenue)),
          ),
          tickets: sum(share.data.map((row) => row.tickets)),
          admits: sum(share.data.map((row) => row.admits)),
          vendor_orders: sum(share.data.map((row) => row.orders)),
        },
        meta: { report_basis: this.reportBasis(filters), source: 'rollups' },
      },
    };
  }

  async eventInsights(eventId: string, range: '7d' | '30d' | '90d' | 'all') {
    if (!['7d', '30d', '90d', 'all'].includes(range)) {
      throw new BadRequestException('Invalid insights range.');
    }
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        translations: true,
        organization: { select: { id: true, name: true } },
        venue: { select: { id: true, name: true } },
        sessions: { select: { capacity: true } },
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const to = new Date();
    let from: Date;
    const timeZone = await this.reportTz.getTimeZone();
    if (range === 'all') {
      // Include historical migrated orders — do NOT use event.createdAt (migration day).
      const earliest = await this.prisma.order.aggregate({
        where: {
          eventId,
          status: { in: ['paid', 'refunded', 'partially_refunded'] },
        },
        _min: { paidAt: true, createdAt: true },
      });
      from =
        earliest._min.paidAt ??
        earliest._min.createdAt ??
        event.startsAt ??
        new Date(to.getTime() - 10 * 365.25 * 86_400_000);
    } else {
      const preset = zonedPresetRange(
        range as '7d' | '30d' | '90d',
        timeZone,
        to,
      );
      from = preset.from;
    }

    const filters: ReportQueryFilters = await this.withReportDays({
      eventId,
      from,
      to,
    });
    const [overview, paymentMix, visitorBreakdown, summary, recent] =
      await Promise.all([
        this.overview(filters),
        this.paymentMix(filters),
        this.visitorTypeBreakdown(filters),
        this.eventSummary(eventId),
        this.prisma.order.findMany({
          where: {
            eventId,
            createdAt: { gte: from, lte: to },
            status: { in: ['paid', 'refunded', 'partially_refunded'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            refunds: { where: { status: 'succeeded' }, select: { amount: true } },
          },
        }),
      ]);

    const grossSales = overview.data.metrics.gross_sales;
    const refundedAmount = summary.data.refunded_amount;
    const netRevenue = money(grossSales - refundedAmount);
    const uniqueCustomers = new Set(recent.map((order) => order.customerEmail)).size;
    // Prefer rollup order count for period metrics
    const orderCount = overview.data.metrics.total_orders;
    const translation =
      event.translations.find((item) => item.locale === 'en') ?? event.translations[0];
    const totalCapacity = sum(event.sessions.map((session) => session.capacity ?? 0));
    const admits = overview.data.metrics.total_admits;

    return {
      success: true,
      data: {
        event: {
          id: event.id,
          title: translation?.title ?? event.slug,
          slug: event.slug,
          status: event.status,
          currency: event.currency,
          starts_at: event.startsAt?.toISOString() ?? null,
          ends_at: event.endsAt?.toISOString() ?? null,
          organization: event.organization,
          venue: event.venue,
        },
        range,
        from: from.toISOString(),
        to: to.toISOString(),
        metrics: {
          gross_sales: money(grossSales),
          refunded_amount: money(refundedAmount),
          net_revenue: netRevenue,
          total_orders: orderCount,
          unique_customers: uniqueCustomers,
          average_order_value: orderCount ? money(netRevenue / orderCount) : 0,
          average_customer_spend: uniqueCustomers
            ? money(netRevenue / uniqueCustomers)
            : 0,
          tickets_sold: overview.data.metrics.tickets_sold,
          total_admits: admits,
          addons_net: overview.data.metrics.addons_net,
          capacity_utilization: totalCapacity
            ? money((admits / totalCapacity) * 100)
            : 0,
          checked_in: summary.data.checked_in,
          checked_out: summary.data.checked_out,
        },
        sales_trend: overview.data.sales_trend,
        payment_mix: paymentMix.data,
        visitor_breakdown: visitorBreakdown.data,
        recent_orders: recent.map((order) => ({
          id: order.id,
          number: order.commonOrder,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          status: order.status,
          total: order.totalAmount.toNumber(),
          refunded: money(
            sum(order.refunds.map((refund) => refund.amount.toNumber())),
          ),
          currency: order.currency,
          created_at: order.createdAt.toISOString(),
        })),
        meta: {
          sales_source: overview.data.meta.source,
          rollup_incomplete: overview.data.meta.rollup_incomplete,
          average_customer_spend_definition:
            'Net recognized order revenue divided by distinct purchasing customers in the selected period.',
          rollup_payment_mix: paymentMix.data,
        },
      },
    };
  }

  /**
   * Cafe-scoped sales insights: metrics, daily trend, by agent, by menu item.
   * Sourced from OrderItem cafe_item lines (+ ticketIsCafe lines tagged with metadata.cafe_id).
   */
  async cafeInsights(cafeId: string, range: '7d' | '30d' | '90d' | 'all') {
    if (!['7d', '30d', '90d', 'all'].includes(range)) {
      throw new BadRequestException('Invalid insights range.');
    }

    const cafe = await this.prisma.cafe.findUnique({
      where: { id: cafeId },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        activeEvent: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              select: { title: true },
              take: 1,
            },
          },
        },
        agents: {
          include: {
            user: { select: { id: true, name: true, email: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!cafe) throw new NotFoundException('Cafe was not found.');

    const to = new Date();
    let from: Date;
    const timeZone = await this.reportTz.getTimeZone();
    if (range === 'all') {
      const earliest = await this.prisma.bookingReportCafeDaily.findFirst({
        where: { cafeId },
        orderBy: { reportDay: 'asc' },
        select: { reportDay: true },
      });
      from = earliest?.reportDay ?? new Date('2000-01-01T00:00:00.000Z');
    } else {
      const preset = zonedPresetRange(
        range as '7d' | '30d' | '90d',
        timeZone,
        to,
      );
      from = preset.from;
    }

    const dayFrom = calendarDay(from, timeZone);
    const dayTo = calendarDay(to, timeZone);
    const reportBasis = ReportBasis.trx;

    const menuItems = await this.prisma.cafeMenuItem.findMany({
      where: { subcategory: { category: { cafeId } } },
      select: { id: true },
    });
    const menuItemIds = menuItems.map((row) => row.id);

    const [dailyRows, agentRows, itemRows, recentOrders] = await Promise.all([
      this.prisma.bookingReportCafeDaily.findMany({
        where: {
          cafeId,
          reportBasis,
          reportDay: { gte: dayFrom, lte: dayTo },
        },
      }),
      this.prisma.bookingReportCafeAgentDaily.findMany({
        where: {
          cafeId,
          reportBasis,
          reportDay: { gte: dayFrom, lte: dayTo },
        },
      }),
      this.prisma.bookingReportCafeItemDaily.findMany({
        where: {
          cafeId,
          reportBasis,
          reportDay: { gte: dayFrom, lte: dayTo },
        },
      }),
      this.prisma.order.findMany({
        where: {
          status: { notIn: ['expired', 'cancelled'] as OrderStatus[] },
          createdAt: { gte: from, lte: to },
          OR: [
            { metadata: { path: ['cafe_id'], equals: cafeId } },
            ...(menuItemIds.length
              ? [
                  {
                    items: {
                      some: {
                        itemType: 'cafe_item' as const,
                        itemId: { in: menuItemIds },
                      },
                    },
                  },
                ]
              : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          commonOrder: true,
          customerName: true,
          customerEmail: true,
          status: true,
          currency: true,
          eventTitle: true,
          createdAt: true,
          totalAmount: true,
          ticketsNet: true,
          metadata: true,
          bookedByAgent: { select: { name: true } },
          items: {
            where: {
              OR: [
                { ticketIsCafe: true },
                { itemType: 'cafe_item' },
                ...(menuItemIds.length ? [{ itemId: { in: menuItemIds } }] : []),
              ],
            },
            select: { totalAmount: true, itemId: true },
          },
        },
      }),
    ]);

    let revenue = 0;
    let itemsSold = 0;
    let orders = 0;
    let cash = 0;
    let card = 0;
    let online = 0;
    const trendMap = new Map<
      string,
      { date: string; revenue: number; orders: number; items: number }
    >();

    for (const row of dailyRows) {
      const amount = row.revenueTotal.toNumber();
      revenue += amount;
      itemsSold += row.itemQty;
      orders += row.orderCount;
      cash += row.cashAmount.toNumber();
      card += row.cardAmount.toNumber();
      online += row.onlineAmount.toNumber();
      const key = calendarDay(row.reportDay, 'UTC').toISOString().slice(0, 10);
      const trend = trendMap.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
        items: 0,
      };
      trend.revenue += amount;
      trend.orders += row.orderCount;
      trend.items += row.itemQty;
      trendMap.set(key, trend);
    }

    if (range !== 'all') {
      const cursor = new Date(dayFrom);
      while (cursor <= dayTo) {
        const key = calendarDay(cursor, 'UTC').toISOString().slice(0, 10);
        if (!trendMap.has(key)) {
          trendMap.set(key, { date: key, revenue: 0, orders: 0, items: 0 });
        }
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
    }

    const agentMap = new Map<
      string,
      { agent_id: string; orders: number; items: number; revenue: number }
    >();
    for (const row of agentRows) {
      const cur = agentMap.get(row.bookedByAgentId) ?? {
        agent_id: row.bookedByAgentId,
        orders: 0,
        items: 0,
        revenue: 0,
      };
      cur.orders += row.orderCount;
      cur.items += row.itemQty;
      cur.revenue += row.revenueTotal.toNumber();
      agentMap.set(row.bookedByAgentId, cur);
    }
    const agentIds = [...agentMap.keys()];
    const agents =
      agentIds.length === 0
        ? []
        : await this.prisma.user.findMany({
            where: { id: { in: agentIds } },
            select: { id: true, name: true, email: true },
          });
    const agentNameMap = new Map(agents.map((a) => [a.id, a]));

    const itemMap = new Map<
      string,
      { item_id: string; title: string; quantity: number; revenue: number; orders: number }
    >();
    for (const row of itemRows) {
      const cur = itemMap.get(row.menuItemId) ?? {
        item_id: row.menuItemId,
        title: row.itemLabel,
        quantity: 0,
        revenue: 0,
        orders: 0,
      };
      cur.quantity += row.itemQty;
      cur.revenue += row.revenueTotal.toNumber();
      cur.orders += row.orderCount;
      cur.title = row.itemLabel || cur.title;
      itemMap.set(row.menuItemId, cur);
    }

    const tenderTotal = cash + card + online;
    const paymentMix = [
      {
        mode: 'cash',
        label: 'Cash',
        amount: money(cash),
        share: tenderTotal ? money((cash / tenderTotal) * 100) : 0,
      },
      {
        mode: 'card',
        label: 'Card',
        amount: money(card),
        share: tenderTotal ? money((card / tenderTotal) * 100) : 0,
      },
      {
        mode: 'online',
        label: 'Online',
        amount: money(online),
        share: tenderTotal ? money((online / tenderTotal) * 100) : 0,
      },
    ].filter((row) => row.amount > 0);

    const menuIdSet = new Set(menuItemIds);
    const recent = recentOrders
      .map((order) => {
        const meta = order.metadata as { cafe_id?: string } | null;
        const cafeLineGross = order.items
          .filter((item) => {
            if (meta?.cafe_id === cafeId) return true;
            return menuIdSet.has(item.itemId);
          })
          .reduce((s, item) => s + item.totalAmount.toNumber(), 0);
        if (cafeLineGross <= 0 && meta?.cafe_id !== cafeId) return null;
        // Cafe POS: paid totalAmount is post-promo; line totals stay pre-promo.
        const cafeLineTotal =
          meta?.cafe_id === cafeId
            ? order.totalAmount.toNumber()
            : cafeLineGross;
        return {
          id: order.id,
          number: order.commonOrder,
          customer_name: order.customerName,
          customer_email: order.customerEmail,
          status: order.status,
          total: money(cafeLineTotal || order.ticketsNet.toNumber()),
          currency: order.currency,
          event_title: order.eventTitle,
          created_at: order.createdAt.toISOString(),
          agent_name: order.bookedByAgent?.name ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => !!row)
      .slice(0, 12);

    return {
      success: true,
      data: {
        cafe: {
          id: cafe.id,
          name: cafe.name,
          status: cafe.status,
          table_count: cafe.tableCount,
          organization: cafe.organization,
          active_event: cafe.activeEvent
            ? {
                id: cafe.activeEvent.id,
                slug: cafe.activeEvent.slug,
                title:
                  cafe.activeEvent.translations[0]?.title ?? cafe.activeEvent.slug,
              }
            : null,
          agents: cafe.agents.map((agent) => ({
            id: agent.id,
            status: agent.status,
            user: agent.user,
          })),
        },
        range,
        from: from.toISOString(),
        to: to.toISOString(),
        metrics: {
          revenue: money(revenue),
          orders,
          items_sold: itemsSold,
          average_order_value: orders ? money(revenue / orders) : 0,
          agents_active: agentMap.size,
          menu_items_sold: itemMap.size,
        },
        sales_trend: [...trendMap.values()]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((row) => ({
            date: row.date,
            revenue: money(row.revenue),
            orders: row.orders,
            items: row.items,
          })),
        payment_mix: paymentMix,
        agents: [...agentMap.values()]
          .map((row) => {
            const user = agentNameMap.get(row.agent_id);
            return {
              agent_id: row.agent_id,
              agent_name: user?.name ?? 'Unknown agent',
              agent_email: user?.email ?? null,
              orders: row.orders,
              items: row.items,
              revenue: money(row.revenue),
            };
          })
          .sort((a, b) => b.revenue - a.revenue),
        items: [...itemMap.values()]
          .map((row) => ({
            item_id: row.item_id,
            title: row.title,
            quantity: row.quantity,
            orders: row.orders,
            revenue: money(row.revenue),
          }))
          .sort((a, b) => b.revenue - a.revenue),
        recent_orders: recent,
        currency: dailyRows[0]?.currency ?? 'QAR',
        meta: { source: 'rollups' as const, report_basis: reportBasis },
      },
    };
  }

  private orderWhere(filters: ReportQueryFilters): Prisma.OrderWhereInput {
    const dateField =
      filters.filterBasedOn === 'event_date' ? 'eventStartDate' : 'createdAt';
    if (filters.eventId && filters.eventIds && !filters.eventIds.includes(filters.eventId)) {
      throw new BadRequestException('You do not have access to this event.');
    }
    const search = filters.search?.trim();
    const vendorIds = this.effectiveVendorIds(filters);
    return {
      ...(filters.organizationId ? { organizationId: filters.organizationId } : {}),
      ...(filters.eventId
        ? { eventId: filters.eventId }
        : filters.eventIds
          ? { eventId: { in: filters.eventIds } }
          : {}),
      ...(filters.paymentMode ? { paymentMode: filters.paymentMode } : {}),
      ...(filters.bookedByAgentId ? { bookedByAgentId: filters.bookedByAgentId } : {}),
      ...(vendorIds
        ? {
            items: {
              some: {
                thirdPartyVendorId:
                  vendorIds.length === 1 ? vendorIds[0] : { in: vendorIds },
              },
            },
          }
        : {}),
      [dateField]: { gte: filters.from, lte: filters.to },
      status: {
        notIn: ['expired'] as OrderStatus[],
      },
      ...(search
        ? {
            OR: [
              { customerName: { contains: search, mode: 'insensitive' } },
              { customerEmail: { contains: search, mode: 'insensitive' } },
              { customerPhone: { contains: search, mode: 'insensitive' } },
              { commonOrder: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }
}

function sum(values: number[]) {
  return values.reduce((a, b) => a + b, 0);
}

function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Overview gross_sales uses paid order.totalAmount (post-promo). Tickets and cafe
 * rollups now net order promo on write; any residual pre/post gap (legacy rows,
 * mixed edge cases) is attributed to tickets so chips still sum to Gross.
 */
function alignRevenueBreakdown(parts: {
  tickets: number;
  cafe: number;
  other: number;
  gross: number;
}) {
  const pre = money(parts.tickets + parts.cafe + parts.other);
  const gap = money(Math.max(0, pre - parts.gross));
  return {
    gross: money(parts.gross),
    tickets: money(Math.max(0, parts.tickets - gap)),
    cafe: money(parts.cafe),
    other: money(parts.other),
  };
}
