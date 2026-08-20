import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { CheckoutModule } from '../checkout/checkout.module';
import { MyFatoorahModule } from '../myfatoorah/myfatoorah.module';
import { AdminPaymentRecoveriesController } from './admin-payment-recoveries.controller';
import { AdminPaymentRecoveriesService } from './admin-payment-recoveries.service';

@Module({
  imports: [
    DatabaseModule,
    AdminAuthModule,
    AdminStaffModule,
    CheckoutModule,
    MyFatoorahModule,
  ],
  controllers: [AdminPaymentRecoveriesController],
  providers: [AdminPaymentRecoveriesService],
})
export class AdminPaymentRecoveriesModule {}
