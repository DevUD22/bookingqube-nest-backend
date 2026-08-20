import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PaymentGateway } from '@prisma/client';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AdminPaymentSettingsService } from './admin-payment-settings.service';
import {
  TestPaymentGatewayDto,
  UpsertPaymentGatewayConfigDto,
} from './dto/admin-payment-settings.dto';

@ApiTags('admin-payment-settings')
@ApiBearerAuth()
@Controller('admin/settings/payments')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('settings.payments.manage')
export class AdminPaymentSettingsController {
  constructor(private readonly payments: AdminPaymentSettingsService) {}

  @Get()
  list() {
    return this.payments.list();
  }

  @Get(':gateway')
  get(@Param('gateway') gateway: PaymentGateway) {
    return this.payments.get(gateway);
  }

  @Put(':gateway')
  upsert(
    @Param('gateway') gateway: PaymentGateway,
    @Body() body: UpsertPaymentGatewayConfigDto,
  ) {
    return this.payments.upsert(gateway, body);
  }

  @Post(':gateway/test')
  test(
    @Param('gateway') gateway: PaymentGateway,
    @Body() body: TestPaymentGatewayDto,
  ) {
    return this.payments.testConnection(gateway, body);
  }
}
