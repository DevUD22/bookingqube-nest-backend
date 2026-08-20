import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminDashboardQueryDto } from './dto/admin-dashboard-query.dto';

@ApiTags('admin-dashboard')
@ApiBearerAuth()
@Controller('admin/dashboard')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('dashboard.read')
export class AdminDashboardController {
  constructor(
    private readonly dashboard: AdminDashboardService,
    private readonly staff: AdminStaffService,
  ) {}

  @Get('overview')
  async overview(
    @Query() query: AdminDashboardQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const scopedEventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
    return this.dashboard.overview(
      query,
      undefined,
      scopedEventIds ?? undefined,
      admin.permissions,
    );
  }
}
