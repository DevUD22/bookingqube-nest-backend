import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ReportPaymentMode } from '@prisma/client';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { ReportTimezoneService } from './report-timezone.service';
import { ReportingQueryService } from './reporting-query.service';
import { ReportingService } from './reporting.service';
import { zonedPresetRange } from './report-timezone.util';

function can(permissions: string[], key: string) {
  return permissions.includes(key);
}

@ApiTags('admin-reports')
@ApiBearerAuth()
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@Controller('admin/reports')
export class ReportingController {
  constructor(
    private readonly queries: ReportingQueryService,
    private readonly reporting: ReportingService,
    private readonly staff: AdminStaffService,
    private readonly reportTz: ReportTimezoneService,
  ) {}

  private async scopedFilters(
    admin: AuthenticatedAdmin,
    base: {
      from: string;
      to: string;
      eventId?: string;
      organizationId?: string;
      filterBasedOn?: 'created_at' | 'event_date';
      paymentMode?: ReportPaymentMode;
      thirdPartyVendorId?: string;
      bookedByAgentId?: string;
      search?: string;
      page?: number;
      perPage?: number;
    },
    options?: {
      requireDateRange?: boolean;
      requireBasis?: boolean;
      requireVisitorSearch?: boolean;
      requireVendorSelect?: boolean;
    },
  ) {
    const permissions = admin.permissions;
    const canDateRange = can(permissions, 'reports.filter.date_range');
    const canBasis = can(permissions, 'reports.filter.basis');
    const canVisitorSearch = can(permissions, 'reports.filter.visitor_search');
    const canVendorSelect = can(permissions, 'reports.filter.vendor_select');

    if (options?.requireDateRange && !canDateRange) {
      // Still allow default range; custom from/to already resolved by caller.
    }
    if (base.filterBasedOn && base.filterBasedOn !== 'created_at' && !canBasis) {
      throw new ForbiddenException('You do not have permission to change reporting basis.');
    }
    if (base.search?.trim() && !canVisitorSearch) {
      throw new ForbiddenException('You do not have permission to search visitors.');
    }
    if (base.thirdPartyVendorId && !canVendorSelect) {
      throw new ForbiddenException('You do not have permission to filter by vendor.');
    }

    let from = base.from;
    let to = base.to;
    if (!canDateRange) {
      const range = await this.defaultRange(7);
      from = range.from;
      to = range.to;
    }

    const [eventIds, vendorIds] = await Promise.all([
      this.staff.resolveReportEventIds(admin.id, admin.role),
      this.staff.resolveReportVendorIds(admin.id, admin.role, base.eventId),
    ]);

    let thirdPartyVendorId = canVendorSelect ? base.thirdPartyVendorId : undefined;
    if (vendorIds && thirdPartyVendorId && !vendorIds.includes(thirdPartyVendorId)) {
      throw new ForbiddenException('You do not have access to this vendor.');
    }
    // Shareholder / EM staff without vendor_select still get forced vendor scope.
    if (vendorIds && !canVendorSelect) {
      thirdPartyVendorId = vendorIds.length === 1 ? vendorIds[0] : undefined;
    }

    return this.queries.withReportDays({
      from: new Date(from),
      to: new Date(to),
      eventId: base.eventId,
      organizationId: base.organizationId,
      eventIds: eventIds ?? undefined,
      filterBasedOn: canBasis ? base.filterBasedOn : 'created_at',
      paymentMode: base.paymentMode,
      thirdPartyVendorId,
      thirdPartyVendorIds: vendorIds ?? undefined,
      bookedByAgentId: base.bookedByAgentId,
      search: canVisitorSearch ? base.search : undefined,
      page: canVisitorSearch || !base.search ? base.page : 1,
      perPage: base.perPage,
    });
  }

  private async assertEventAccess(admin: AuthenticatedAdmin, eventId: string) {
    const eventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
    if (eventIds && !eventIds.includes(eventId)) {
      throw new ForbiddenException('You do not have access to this event.');
    }
  }

  private async defaultRange(days = 29) {
    const range = zonedPresetRange(days, await this.reportTz.getTimeZone());
    return { from: range.from.toISOString(), to: range.to.toISOString() };
  }

  private stripOverviewSections(
    payload: { success: boolean; data: Record<string, unknown> },
    permissions: string[],
  ) {
    const data = { ...payload.data };
    if (!can(permissions, 'reports.overview.revenue')) {
      data.metrics = undefined;
      data.sales_trend = [];
      data.cafe_sales = null;
      data.online_offline = [];
    }
    if (!can(permissions, 'reports.overview.payment_mix')) {
      data.payment_mix = [];
    }
    if (!can(permissions, 'reports.overview.demographics')) {
      data.visitor_breakdown = [];
      data.demographics_age = [];
      data.demographics_region = [];
    }
    return { ...payload, data };
  }

  @Get('timezone')
  @RequirePermissions('panel.access')
  async reportingTimezone() {
    const timeZone = await this.reportTz.getTimeZone();
    return {
      success: true,
      data: {
        time_zone: timeZone,
        source: timeZone === 'UTC' ? 'utc' : 'regional',
      },
    };
  }

  @Get('overview')
  @RequirePermissions('reports.read')
  async overview(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('event_id') eventId?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
  ) {
    return this.queries.overview(
      await this.scopedFilters(admin, {
        from,
        to,
        eventId,
        organizationId,
        filterBasedOn,
      }),
    );
  }

  @Get('events')
  @RequirePermissions('reports.read')
  async listEvents(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('search') search?: string,
  ) {
    const range = await this.defaultRange();
    return this.queries.listEventsHub(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        organizationId,
        filterBasedOn,
        search,
      }),
    );
  }

  @Get('payment-mix')
  @RequirePermissions('reports.read', 'reports.overview.payment_mix')
  async paymentMix(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('event_id') eventId?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
  ) {
    return this.queries.paymentMix(
      await this.scopedFilters(admin, {
        from,
        to,
        eventId,
        organizationId,
        filterBasedOn,
      }),
    );
  }

  @Get('visitor-type-breakdown')
  @RequirePermissions('reports.read', 'reports.overview.demographics')
  async visitorTypeBreakdown(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('event_id') eventId?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
  ) {
    return this.queries.visitorTypeBreakdown(
      await this.scopedFilters(admin, {
        from,
        to,
        eventId,
        organizationId,
        filterBasedOn,
      }),
    );
  }

  @Get('demographics')
  @RequirePermissions('reports.read', 'reports.overview.demographics')
  async demographics(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('dimension') dimension: 'age' | 'region' = 'age',
    @Query('event_id') eventId?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
  ) {
    return this.queries.demographics(
      await this.scopedFilters(admin, {
        from,
        to,
        eventId,
        organizationId,
        filterBasedOn,
      }),
      dimension === 'region' ? 'region' : 'age',
    );
  }

  @Get('orders')
  @RequirePermissions('reports.read', 'reports.tab.visitors')
  async listOrders(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('event_id') eventId?: string,
    @Query('organization_id') organizationId?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('payment_mode') paymentMode?: ReportPaymentMode,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    return this.queries.listOrders(
      await this.scopedFilters(admin, {
        from,
        to,
        eventId,
        organizationId,
        filterBasedOn,
        paymentMode,
        search,
        page: page ? Number(page) : 1,
        perPage: perPage ? Number(perPage) : 20,
      }),
    );
  }

  @Get('events/:eventId/summary')
  @RequirePermissions('reports.read')
  async eventSummary(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
  ) {
    await this.assertEventAccess(admin, eventId);
    return this.queries.eventSummary(eventId);
  }

  @Get('events/:eventId/insights')
  @RequirePermissions('reports.read')
  async eventInsights(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('range') range: '7d' | '30d' | '90d' | 'all' = 'all',
  ) {
    await this.assertEventAccess(admin, eventId);
    return this.queries.eventInsights(eventId, range);
  }

  @Get('cafes/:cafeId/insights')
  @RequirePermissions('reports.read')
  async cafeInsights(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('cafeId') cafeId: string,
    @Query('range') range: '7d' | '30d' | '90d' | 'all' = '30d',
  ) {
    const eventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
    if (eventIds !== null) {
      const cafeIds = await this.staff.resolveAccessibleCafeIds(eventIds);
      if (!cafeIds?.includes(cafeId)) {
        throw new ForbiddenException('You do not have access to this cafe.');
      }
    }
    return this.queries.cafeInsights(cafeId, range);
  }

  @Get('events/:eventId/reports/overview')
  @RequirePermissions('reports.read', 'reports.tab.overview')
  async eventReportOverview(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('payment_mode') paymentMode?: ReportPaymentMode,
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    const payload = await this.queries.eventReportOverview({
      ...(await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
        paymentMode,
      })),
      eventId,
    });
    return this.stripOverviewSections(payload, admin.permissions);
  }

  @Get('events/:eventId/reports/tickets')
  @RequirePermissions('reports.read', 'reports.tab.tickets')
  async eventReportTickets(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('payment_mode') paymentMode?: ReportPaymentMode,
    @Query('booked_by_agent_id') bookedByAgentId?: string,
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    return this.queries.eventReportTickets(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
        paymentMode,
        bookedByAgentId,
      }),
    );
  }

  @Get('events/:eventId/reports/visitors')
  @RequirePermissions('reports.read', 'reports.tab.visitors')
  async eventReportVisitors(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('payment_mode') paymentMode?: ReportPaymentMode,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('per_page') perPage?: string,
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    return this.queries.eventReportVisitors(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
        paymentMode,
        search,
        page: page ? Number(page) : 1,
        perPage: perPage ? Number(perPage) : 25,
      }),
    );
  }

  @Get('events/:eventId/reports/payments')
  @RequirePermissions('reports.read', 'reports.tab.payments')
  async eventReportPayments(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    return this.queries.eventReportPayments(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
      }),
    );
  }

  @Get('events/:eventId/reports/share')
  @RequirePermissions('reports.read', 'reports.tab.vendors_pos')
  async eventReportShare(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('third_party_vendor_id') thirdPartyVendorId?: string,
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    return this.queries.eventReportShare(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
        thirdPartyVendorId,
      }),
    );
  }

  @Get('events/:eventId/reports/pos')
  @RequirePermissions('reports.read', 'reports.tab.vendors_pos')
  async eventReportPos(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('filter_based_on') filterBasedOn?: 'created_at' | 'event_date',
    @Query('booked_by_agent_id') bookedByAgentId?: string,
    @Query('payment_mode') paymentMode?: ReportPaymentMode,
  ) {
    await this.assertEventAccess(admin, eventId);
    const range = await this.defaultRange();
    return this.queries.posBreakdown(
      await this.scopedFilters(admin, {
        from: from ?? range.from,
        to: to ?? range.to,
        eventId,
        filterBasedOn,
        bookedByAgentId,
        paymentMode,
      }),
    );
  }

  @Get('reconcile/:eventId')
  @RequirePermissions('reports.read', 'admin.access')
  async reconcile(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Param('eventId') eventId: string,
    @Query('day') day: string,
  ) {
    await this.assertEventAccess(admin, eventId);
    const result = await this.reporting.reconcileEventDay(eventId, new Date(day));
    return { success: true, data: result };
  }
}
