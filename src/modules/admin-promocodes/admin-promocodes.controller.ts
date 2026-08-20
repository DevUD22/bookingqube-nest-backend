import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminPromocodesService } from './admin-promocodes.service';
import {
  AdminPromocodeListQueryDto,
  AdminPromocodeInsightsQueryDto,
  BulkGenerateAdminPromocodesDto,
  BulkImportAdminPromocodesDto,
  AdminPromocodeOptionsQueryDto,
  UpdateAdminPromocodeStatusDto,
  UpsertAdminPromocodeDto,
} from './dto/admin-promocode.dto';

@ApiTags('admin-promocodes')
@ApiBearerAuth()
@Controller('admin/promocodes')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('promocodes.read')
export class AdminPromocodesController {
  constructor(private readonly promocodes: AdminPromocodesService) {}

  @Get() list(@Query() query: AdminPromocodeListQueryDto) { return this.promocodes.list(query); }
  @Get('options') options(@Query() query: AdminPromocodeOptionsQueryDto) { return this.promocodes.options(query.organization_id); }
  @Get(':id/insights') insights(@Param('id', ParseUUIDPipe) id: string, @Query() query: AdminPromocodeInsightsQueryDto) {
    return this.promocodes.insights(id, query);
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.promocodes.get(id); }

  @Post('bulk-generate')
  @RequirePermissions('promocodes.write')
  bulkGenerate(@Body() body: BulkGenerateAdminPromocodesDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promocodes.bulkGenerate(body, admin.id);
  }

  @Post('bulk-import')
  @RequirePermissions('promocodes.write')
  bulkImport(@Body() body: BulkImportAdminPromocodesDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promocodes.bulkImport(body, admin.id);
  }

  @Post()
  @RequirePermissions('promocodes.write')
  create(@Body() body: UpsertAdminPromocodeDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promocodes.create(body, admin.id);
  }

  @Put(':id')
  @RequirePermissions('promocodes.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertAdminPromocodeDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promocodes.update(id, body, admin.id);
  }

  @Post(':id/status')
  @RequirePermissions('promocodes.write')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateAdminPromocodeStatusDto, @CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.promocodes.setStatus(id, body.status, admin.id);
  }
}
