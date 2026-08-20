import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminPaymentSettingsController } from './admin-payment-settings.controller';
import { AdminPaymentSettingsService } from './admin-payment-settings.service';
import { CustomerPaymentMethodsService } from './customer-payment-methods.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminPaymentSettingsController],
  providers: [AdminPaymentSettingsService, CustomerPaymentMethodsService],
  exports: [AdminPaymentSettingsService, CustomerPaymentMethodsService],
})
export class AdminPaymentSettingsModule {}
