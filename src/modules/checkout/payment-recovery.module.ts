import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { PaymentRecoveryService } from './payment-recovery.service';

@Module({
  imports: [DatabaseModule],
  providers: [PaymentRecoveryService],
  exports: [PaymentRecoveryService],
})
export class PaymentRecoveryModule {}
