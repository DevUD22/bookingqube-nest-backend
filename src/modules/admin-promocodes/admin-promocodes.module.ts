import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminPromocodesController } from './admin-promocodes.controller';
import { AdminPromocodesService } from './admin-promocodes.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminPromocodesController],
  providers: [AdminPromocodesService],
})
export class AdminPromocodesModule {}
