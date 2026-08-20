import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { AdminOrdersService } from './admin-orders.service';
import {
  AdminOrderListQueryDto,
  UpdateAdminOrderDto,
} from './dto/admin-order.dto';

@ApiTags('admin-orders')
@ApiBearerAuth()
@Controller('admin/orders')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('orders.read')
export class AdminOrdersController {
  constructor(
    private readonly orders: AdminOrdersService,
    private readonly staff: AdminStaffService,
  ) {}

  private scopedEventIds(admin: AuthenticatedAdmin) {
    return this.staff.resolveReportEventIds(admin.id, admin.role);
  }

  private scopedVendorIds(admin: AuthenticatedAdmin, eventId?: string) {
    return this.staff.resolveReportVendorIds(admin.id, admin.role, eventId);
  }

  private async assertOrderAccess(admin: AuthenticatedAdmin, orderId: string) {
    const [eventIds, orderMeta] = await Promise.all([
      this.scopedEventIds(admin),
      this.orders.getAccessMeta(orderId),
    ]);
    if (!orderMeta) {
      throw new ForbiddenException('You do not have access to this booking.');
    }
    if (eventIds !== null && !eventIds.includes(orderMeta.eventId)) {
      throw new ForbiddenException('You do not have access to this booking.');
    }

    const vendorIds = await this.scopedVendorIds(admin, orderMeta.eventId);
    if (vendorIds !== null) {
      if (!vendorIds.length) {
        throw new ForbiddenException('You do not have access to this booking.');
      }
      const allowed = orderMeta.vendorIds.some((id) => vendorIds.includes(id));
      if (!allowed) {
        throw new ForbiddenException('You do not have access to this booking.');
      }
    }

    return { orderMeta, vendorIds };
  }

  @Get()
  async list(
    @Query() query: AdminOrderListQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const [eventIds, vendorIds] = await Promise.all([
      this.scopedEventIds(admin),
      this.scopedVendorIds(admin, query.event_id),
    ]);
    return this.orders.list(query, eventIds, vendorIds);
  }

  @Get(':id')
  async get(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('lang') lang = 'en',
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const { vendorIds } = await this.assertOrderAccess(admin, id);
    return this.orders.get(id, lang, vendorIds);
  }

  @Put(':id')
  @RequirePermissions('orders.write')
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateAdminOrderDto,
    @Query('lang') lang = 'en',
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const { vendorIds } = await this.assertOrderAccess(admin, id);
    return this.orders.update(id, body, lang, vendorIds);
  }

  @Delete(':id')
  @RequirePermissions('orders.write')
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    await this.assertOrderAccess(admin, id);
    return this.orders.remove(id);
  }
}
