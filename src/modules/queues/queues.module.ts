import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { InventoryModule } from '../inventory/inventory.module';
import { ReportingModule } from '../reporting/reporting.module';
import { BookingJobsService } from './booking-jobs.service';

@Module({
  imports: [DatabaseModule, InventoryModule, ReportingModule],
  providers: [BookingJobsService],
  exports: [BookingJobsService],
})
export class QueuesModule {}
