import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import {
  CreateMyFatoorahSessionDto,
  MyFatoorahPaymentStatusDto,
} from './dto/myfatoorah.dto';
import { MyFatoorahService } from './myfatoorah.service';

@ApiTags('admin-myfatoorah')
@ApiBearerAuth()
@Controller('admin/payments/myfatoorah')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('admin.access')
export class AdminMyFatoorahController {
  constructor(private readonly myFatoorah: MyFatoorahService) {}

  @Post('sessions')
  createSession(@Body() body: CreateMyFatoorahSessionDto) {
    return this.myFatoorah.createEmbeddedSession(body);
  }

  @Post('payment-status')
  paymentStatus(@Body() body: MyFatoorahPaymentStatusDto) {
    return this.myFatoorah.resolvePaymentStatus(body);
  }
}
