import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminPaymentSettingsModule } from '../admin-payment-settings/admin-payment-settings.module';
import { PaymentRecoveryModule } from '../checkout/payment-recovery.module';
import { AdminMyFatoorahController } from './admin-myfatoorah.controller';
import { CustomerMyFatoorahController } from './customer-myfatoorah.controller';
import { MyFatoorahService } from './myfatoorah.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AdminAuthModule,
    AdminPaymentSettingsModule,
    PaymentRecoveryModule,
  ],
  controllers: [AdminMyFatoorahController, CustomerMyFatoorahController],
  providers: [MyFatoorahService],
  exports: [MyFatoorahService],
})
export class MyFatoorahModule {}
