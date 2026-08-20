import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  Allow,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { AdminPaymentRecoveriesService } from './admin-payment-recoveries.service';
import { AdminPaymentRecoveryListQueryDto } from './dto/admin-payment-recovery.dto';

class ConfirmRecoveryBodyDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsString()
  event_slug?: string;

  @IsOptional()
  @Allow()
  schedule?: { date?: string; time?: string };

  @IsOptional()
  @Allow()
  tickets?: Array<Record<string, unknown>>;

  @IsOptional()
  @Allow()
  addons?: Array<Record<string, unknown>>;

  @IsOptional()
  @Allow()
  payment_method?: number;

  @IsOptional()
  @Allow()
  customer?: {
    user_id?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
}

class AbandonRecoveryBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

@ApiTags('admin-payment-recoveries')
@ApiBearerAuth()
@Controller('admin/payment-recoveries')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
export class AdminPaymentRecoveriesController {
  constructor(
    private readonly recoveries: AdminPaymentRecoveriesService,
    private readonly staff: AdminStaffService,
  ) {}

  private scopedEventIds(admin: AuthenticatedAdmin) {
    return this.staff.resolveReportEventIds(admin.id, admin.role);
  }

  @Get()
  @RequirePermissions('orders.read')
  async list(
    @Query() query: AdminPaymentRecoveryListQueryDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    return this.recoveries.list(query, eventIds);
  }

  @Get(':id')
  @RequirePermissions('orders.read')
  async getOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    return this.recoveries.getById(id, eventIds);
  }

  @Post(':id/verify')
  @RequirePermissions('orders.read')
  async verify(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    return this.recoveries.verify(id, eventIds);
  }

  @Post(':id/confirm')
  @RequirePermissions('orders.write')
  async confirm(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: ConfirmRecoveryBodyDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    const rebuildCart =
      body?.event_slug || body?.tickets?.length
        ? {
            event_slug: body.event_slug,
            schedule: body.schedule,
            tickets: body.tickets,
            addons: body.addons,
            payment_method: body.payment_method,
            customer: body.customer,
          }
        : undefined;
    return this.recoveries.confirm(
      id,
      eventIds,
      Boolean(body?.force),
      rebuildCart,
    );
  }

  @Post(':id/abandon')
  @RequirePermissions('orders.write')
  async abandon(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: AbandonRecoveryBodyDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    const eventIds = await this.scopedEventIds(admin);
    return this.recoveries.abandon(id, eventIds, body?.note);
  }
}
