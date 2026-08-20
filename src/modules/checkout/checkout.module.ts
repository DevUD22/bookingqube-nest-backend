import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminPaymentSettingsModule } from '../admin-payment-settings/admin-payment-settings.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { InventoryModule } from '../inventory/inventory.module';
import { MailModule } from '../mail/mail.module';
import { MyFatoorahModule } from '../myfatoorah/myfatoorah.module';
import { PosModule } from '../pos/pos.module';
import { PromocodesModule } from '../promocodes/promocodes.module';
import { QueuesModule } from '../queues/queues.module';
import { SmsModule } from '../sms/sms.module';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { HoldExpirationService } from './hold-expiration.service';
import { HostedPaymentsController } from './hosted-payments.controller';
import { MpgsCheckoutService } from './mpgs-checkout.service';
import { PaymentRecoveryModule } from './payment-recovery.module';
import { PosCheckoutController } from './pos-checkout.controller';
import { QpayCheckoutService } from './qpay-checkout.service';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    AdminPaymentSettingsModule,
    CatalogModule,
    InventoryModule,
    QueuesModule,
    PaymentRecoveryModule,
    MailModule,
    SmsModule,
    PosModule,
    PromocodesModule,
    MyFatoorahModule,
  ],
  controllers: [
    CheckoutController,
    PosCheckoutController,
    HostedPaymentsController,
  ],
  providers: [
    CheckoutService,
    HoldExpirationService,
    QpayCheckoutService,
    MpgsCheckoutService,
  ],
  exports: [
    CheckoutService,
    HoldExpirationService,
    PaymentRecoveryModule,
    QpayCheckoutService,
    MpgsCheckoutService,
  ],
})
export class CheckoutModule {}
