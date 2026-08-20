import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ReportTimezoneService } from '../reporting/report-timezone.service';
import { ReportingQueryService } from '../reporting/reporting-query.service';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';

function can(permissions: string[], key: string) {
  return permissions.includes(key);
}

@Injectable()
export class AdminDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportingQueryService,
    private readonly reportTz: ReportTimezoneService,
  ) {}

  async overview(
    query: AdminDashboardQueryDto,
    organizationId?: string,
    scopedEventIds?: string[],
    permissions: string[] = [],
  ) {
    const canEventFilter = can(permissions, 'dashboard.filter.event');
    const canDateFilter = can(permissions, 'dashboard.filter.date_range');
    const eventId = canEventFilter ? query.event_id : undefined;
    const { from, to } = await this.parseRange(query, canDateFilter);
    const periodMs = to.getTime() - from.getTime();
    const previousFrom = new Date(from.getTime() - periodMs);

    const needsRevenue =
      can(permissions, 'dashboard.widget.gross_sales') ||
      can(permissions, 'dashboard.widget.net_revenue') ||
      can(permissions, 'dashboard.widget.revenue_mix') ||
      can(permissions, 'dashboard.widget.revenue_analytics') ||
      can(permissions, 'dashboard.widget.secondary_kpis') ||
      can(permissions, 'dashboard.widget.event_reports');
    const needsTickets = can(permissions, 'dashboard.widget.tickets_sold');
    const needsOrders =
      can(permissions, 'dashboard.widget.total_orders') ||
      can(permissions, 'dashboard.widget.order_status') ||
      can(permissions, 'dashboard.widget.secondary_kpis') ||
      can(permissions, 'dashboard.widget.recent_orders') ||
      can(permissions, 'dashboard.widget.event_reports');
    const needsOverview = needsRevenue || needsTickets || needsOrders;
    const needsCafeMix = can(permissions, 'dashboard.widget.revenue_mix');
    const needsEventReports = can(permissions, 'dashboard.widget.event_reports');
    const needsSecondary = can(permissions, 'dashboard.widget.secondary_kpis');
    const needsOrderStatus = can(permissions, 'dashboard.widget.order_status');
    const needsEventOptions = canEventFilter || needsEventReports;

    const emptyOverview = {
      data: {
        metrics: {
          gross_sales: 0,
          tickets_sold: 0,
          total_orders: 0,
        },
        sales_trend: [] as Array<{ date: string; gross_sales: number }>,
        sales_by_event: [] as Array<{
          event_id: string;
          gross_sales: number;
          tickets_sold: number;
          orders: number;
        }>,
        recent_orders: [] as Array<{
          id: string;
          common_order: string;
          created_at: string;
          customer_name: string;
          event_title: string;
          status: string;
          total: number;
        }>,
        meta: { rollup_incomplete: false },
      },
    };

    const baseFilters = {
      from,
      to,
      eventId,
      eventIds: scopedEventIds,
      organizationId,
    };
    const previousBaseFilters = {
      from: previousFrom,
      to: from,
      eventId,
      eventIds: scopedEventIds,
      organizationId,
    };
    const [currentFilters, previousFilters] = await Promise.all([
      this.reports.withReportDays(baseFilters),
      this.reports.withReportDays(previousBaseFilters),
    ]);

    const [current, previous, activeEvents, inventory, eventOptions, statusGroups, cafeSales] =
      await Promise.all([
        needsOverview
          ? this.reports.overview(currentFilters)
          : Promise.resolve(emptyOverview),
        needsOverview &&
        (can(permissions, 'dashboard.widget.gross_sales') ||
          can(permissions, 'dashboard.widget.net_revenue') ||
          needsTickets ||
          can(permissions, 'dashboard.widget.total_orders') ||
          needsSecondary)
          ? this.reports.overview(previousFilters)
          : Promise.resolve(emptyOverview),
        needsEventReports || needsSecondary
          ? this.prisma.event.findMany({
              where: {
                status: 'published',
                organizationId,
                ...(eventId
                  ? { id: eventId }
                  : scopedEventIds
                    ? { id: { in: scopedEventIds } }
                    : {}),
                OR: [{ endsAt: null }, { endsAt: { gte: new Date() } }],
              },
              select: {
                id: true,
                slug: true,
                translations: true,
                startsAt: true,
                endsAt: true,
              },
              orderBy: [{ startsAt: 'asc' }, { updatedAt: 'desc' }],
              take: 8,
            })
          : Promise.resolve([]),
        needsSecondary
          ? this.prisma.inventoryItem.findMany({
              where: {
                ...(eventId
                  ? { eventId }
                  : scopedEventIds
                    ? { eventId: { in: scopedEventIds } }
                    : {}),
                ...(organizationId ? { event: { organizationId } } : {}),
              },
              select: {
                eventId: true,
                totalQuantity: true,
                soldQuantity: true,
                heldQuantity: true,
              },
            })
          : Promise.resolve([]),
        needsEventOptions
          ? this.prisma.event.findMany({
              where: {
                status: { not: 'archived' },
                organizationId,
                ...(scopedEventIds ? { id: { in: scopedEventIds } } : {}),
              },
              select: { id: true, slug: true, translations: true },
              orderBy: { updatedAt: 'desc' },
            })
          : Promise.resolve([]),
        needsOrderStatus || needsSecondary
          ? this.prisma.order.groupBy({
              by: ['status'],
              where: {
                createdAt: { gte: from, lte: to },
                ...(eventId
                  ? { eventId }
                  : scopedEventIds
                    ? { eventId: { in: scopedEventIds } }
                    : {}),
                ...(organizationId ? { organizationId } : {}),
              },
              _count: { _all: true },
            })
          : Promise.resolve([]),
        needsCafeMix
          ? this.reports.cafeSalesBreakdown(currentFilters)
          : Promise.resolve({ cafe_net: 0, orders: 0, cafes: [] }),
      ]);

    const grossSales = current.data.metrics.gross_sales;
    const previousGross = previous.data.metrics.gross_sales;
    const ticketsSold = current.data.metrics.tickets_sold;
    const previousTickets = previous.data.metrics.tickets_sold;

    let refunds = 0;
    let previousRefunds = 0;
    if (
      can(permissions, 'dashboard.widget.net_revenue') ||
      can(permissions, 'dashboard.widget.secondary_kpis')
    ) {
      const refundsAgg = await this.prisma.refund.aggregate({
        where: {
          status: 'succeeded',
          createdAt: { gte: from, lte: to },
          order: {
            ...(eventId
              ? { eventId }
              : scopedEventIds
                ? { eventId: { in: scopedEventIds } }
                : {}),
            ...(organizationId ? { organizationId } : {}),
          },
        },
        _sum: { amount: true },
      });
      refunds = this.money(refundsAgg._sum.amount?.toNumber() ?? 0);
      const previousRefundsAgg = await this.prisma.refund.aggregate({
        where: {
          status: 'succeeded',
          createdAt: { gte: previousFrom, lt: from },
          order: {
            ...(eventId
              ? { eventId }
              : scopedEventIds
                ? { eventId: { in: scopedEventIds } }
                : {}),
            ...(organizationId ? { organizationId } : {}),
          },
        },
        _sum: { amount: true },
      });
      previousRefunds = this.money(previousRefundsAgg._sum.amount?.toNumber() ?? 0);
    }

    const netRevenue = this.money(grossSales - refunds);
    const previousNet = this.money(previousGross - previousRefunds);

    const finiteInventory = inventory.filter((item) => item.totalQuantity !== null);
    const totalCapacity = finiteInventory.reduce((sum, item) => sum + (item.totalQuantity ?? 0), 0);
    const soldCapacity = finiteInventory.reduce((sum, item) => sum + item.soldQuantity, 0);
    const capacityUtilization = totalCapacity > 0 ? (soldCapacity / totalCapacity) * 100 : 0;

    const eventIds = needsEventReports
      ? current.data.sales_by_event.map((e) => e.event_id)
      : [];
    const eventMeta = eventIds.length
      ? await this.prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, slug: true, translations: true },
        })
      : [];
    const metaById = new Map(eventMeta.map((e) => [e.id, e]));

    const statusMix = needsOrderStatus
      ? Object.values(OrderStatus).map((status) => ({
          status,
          count: statusGroups.find((g) => g.status === status)?._count._all ?? 0,
        }))
      : [];

    const pendingCount =
      statusGroups.find((g) => g.status === 'pending_payment')?._count._all ?? 0;

    const metrics: Record<string, unknown> = {};
    if (can(permissions, 'dashboard.widget.gross_sales')) {
      metrics.gross_sales = this.metric(grossSales, previousGross);
    }
    if (can(permissions, 'dashboard.widget.net_revenue')) {
      metrics.net_revenue = this.metric(netRevenue, previousNet);
    }
    if (can(permissions, 'dashboard.widget.tickets_sold')) {
      metrics.tickets_sold = this.metric(ticketsSold, previousTickets);
    }
    if (can(permissions, 'dashboard.widget.total_orders')) {
      metrics.total_orders = this.metric(
        current.data.metrics.total_orders,
        previous.data.metrics.total_orders,
      );
    }
    if (needsSecondary) {
      metrics.average_order_value = this.metric(
        current.data.metrics.total_orders
          ? this.money(grossSales / current.data.metrics.total_orders)
          : 0,
        previous.data.metrics.total_orders
          ? this.money(previousGross / previous.data.metrics.total_orders)
          : 0,
      );
      metrics.refunds = { value: refunds };
      metrics.pending_orders = { value: pendingCount };
      metrics.capacity_utilization = { value: this.money(capacityUtilization) };
    }
    if (needsEventReports || needsSecondary) {
      metrics.active_events = { value: activeEvents.length };
    }
    if (needsCafeMix) {
      metrics.cafe_sales = { value: cafeSales.cafe_net };
    }

    return {
      success: true,
      data: {
        period: {
          from: from.toISOString(),
          to: to.toISOString(),
          previous_from: previousFrom.toISOString(),
          currency: 'QAR',
        },
        metrics,
        cafe_sales: needsCafeMix ? cafeSales : null,
        sales_trend: can(permissions, 'dashboard.widget.revenue_analytics')
          ? current.data.sales_trend
          : [],
        sales_by_event: needsEventReports
          ? current.data.sales_by_event.map((row) => {
              const event = metaById.get(row.event_id);
              return {
                event_id: row.event_id,
                slug: event?.slug ?? row.event_id,
                title: event ? this.eventTitle(event) : row.event_id,
                gross_sales: row.gross_sales,
                tickets_sold: row.tickets_sold,
                orders: row.orders,
              };
            })
          : [],
        active_events: needsEventReports
          ? activeEvents.map((event) => {
              const sales = current.data.sales_by_event.find((row) => row.event_id === event.id);
              const eventInventory = inventory.filter((item) => item.eventId === event.id);
              const finiteEventInventory = eventInventory.filter(
                (item) => item.totalQuantity !== null,
              );
              const capacityTotal = finiteEventInventory.reduce(
                (sum, item) => sum + (item.totalQuantity ?? 0),
                0,
              );
              const capacitySold = finiteEventInventory.reduce(
                (sum, item) => sum + item.soldQuantity,
                0,
              );
              return {
                event_id: event.id,
                slug: event.slug,
                title: this.eventTitle(event),
                state: event.startsAt && event.startsAt > new Date() ? 'upcoming' : 'live',
                starts_at: event.startsAt?.toISOString() ?? null,
                ends_at: event.endsAt?.toISOString() ?? null,
                gross_sales: sales?.gross_sales ?? 0,
                tickets_sold: sales?.tickets_sold ?? 0,
                orders: sales?.orders ?? 0,
                capacity_total: capacityTotal,
                capacity_sold: capacitySold,
                capacity_percent:
                  capacityTotal > 0 ? this.money((capacitySold / capacityTotal) * 100) : null,
              };
            })
          : [],
        order_status_mix: statusMix,
        recent_orders: can(permissions, 'dashboard.widget.recent_orders')
          ? current.data.recent_orders
          : [],
        event_options: canEventFilter
          ? eventOptions.map((event) => ({
              id: event.id,
              slug: event.slug,
              title: this.eventTitle(event),
            }))
          : [],
        data_quality: {
          revenue_verification: current.data.meta.rollup_incomplete
            ? 'rollup_incomplete'
            : 'rollup',
          message: current.data.meta.rollup_incomplete
            ? 'No rollup rows for this range yet — KPIs may be zero until orders sync. Snapshots are written at checkout.'
            : 'Revenue from booking_report_daily rollups (Reporting v2).',
        },
        allowed: {
          widgets: {
            gross_sales: can(permissions, 'dashboard.widget.gross_sales'),
            net_revenue: can(permissions, 'dashboard.widget.net_revenue'),
            tickets_sold: can(permissions, 'dashboard.widget.tickets_sold'),
            total_orders: can(permissions, 'dashboard.widget.total_orders'),
            revenue_mix: needsCafeMix,
            revenue_analytics: can(permissions, 'dashboard.widget.revenue_analytics'),
            order_status: needsOrderStatus,
            secondary_kpis: needsSecondary,
            event_reports: needsEventReports,
            recent_orders: can(permissions, 'dashboard.widget.recent_orders'),
          },
          filters: {
            event: canEventFilter,
            date_range: canDateFilter,
          },
        },
      },
    };
  }

  private async parseRange(query: AdminDashboardQueryDto, canDateFilter: boolean) {
    if (!canDateFilter) {
      return this.reportTz.presetRange(7);
    }
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from
      ? new Date(query.from)
      : (await this.reportTz.presetRange(30)).from;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
      throw new BadRequestException('Invalid dashboard date range.');
    }
    if (to.getTime() - from.getTime() > 366 * 86_400_000) {
      throw new BadRequestException('Dashboard range cannot exceed 366 days.');
    }
    return { from, to };
  }

  private eventTitle(event: {
    slug: string;
    translations: Array<{ locale: string; title: string }>;
  }) {
    return (
      event.translations.find((item) => item.locale === 'en')?.title ??
      event.translations[0]?.title ??
      event.slug
    );
  }

  private metric(value: number, previous: number) {
    return {
      value,
      previous,
      change_percent: previous === 0 ? null : this.money(((value - previous) / previous) * 100),
    };
  }

  private money(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
