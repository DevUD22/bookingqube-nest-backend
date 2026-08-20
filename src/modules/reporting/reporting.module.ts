import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { OrderReportingEnricher } from './order-reporting.enricher';
import { ReportTimezoneService } from './report-timezone.service';
import { ReportingController } from './reporting.controller';
import { ReportingQueryService } from './reporting-query.service';
import { ReportingService } from './reporting.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, AdminStaffModule],
  controllers: [ReportingController],
  providers: [
    ReportTimezoneService,
    ReportingService,
    ReportingQueryService,
    { provide: OrderReportingEnricher, useValue: new OrderReportingEnricher() },
  ],
  exports: [
    ReportTimezoneService,
    ReportingService,
    ReportingQueryService,
    OrderReportingEnricher,
  ],
})
export class ReportingModule {}
