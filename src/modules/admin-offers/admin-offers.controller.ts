import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminOffersService } from './admin-offers.service';
import { AdminOffersListQueryDto, UpsertAdminOfferDto } from './dto/admin-offer.dto';

@ApiTags('admin-cms-offers') @ApiBearerAuth() @Controller('admin/cms/offers')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard) @RequirePermissions('cms.offers.read')
export class AdminOffersController {
  constructor(private readonly offers: AdminOffersService) {}
  @Get() list(@Query() query: AdminOffersListQueryDto) { return this.offers.list(query); }
  @Get('event-options') events() { return this.offers.eventOptions(); }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) { return this.offers.get(id); }
  @Post() @RequirePermissions('cms.offers.write') create(@Body() body: UpsertAdminOfferDto, @CurrentAdmin() admin: AuthenticatedAdmin) { return this.offers.create(body, admin.id); }
  @Put(':id') @RequirePermissions('cms.offers.write') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpsertAdminOfferDto, @CurrentAdmin() admin: AuthenticatedAdmin) { return this.offers.update(id, body, admin.id); }
  @Delete(':id') @RequirePermissions('cms.offers.write') archive(@Param('id', ParseUUIDPipe) id: string) { return this.offers.archive(id); }
}
