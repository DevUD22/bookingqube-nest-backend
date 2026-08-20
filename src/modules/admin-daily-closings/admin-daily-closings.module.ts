import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import {
  AdminDailyClosingsController,
  AdminSettlementsController,
} from './admin-daily-closings.controller';
import { AdminDailyClosingsService } from './admin-daily-closings.service';
import { AdminSettlementsService } from './admin-settlements.service';
import { DailyClosingTotalsService } from './daily-closing-totals.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, AdminStaffModule, MediaStorageModule],
  controllers: [AdminDailyClosingsController, AdminSettlementsController],
  providers: [
    DailyClosingTotalsService,
    AdminDailyClosingsService,
    AdminSettlementsService,
  ],
  exports: [DailyClosingTotalsService],
})
export class AdminDailyClosingsModule {}
