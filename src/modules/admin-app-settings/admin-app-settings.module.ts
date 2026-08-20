import { Module, forwardRef } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { ReportingModule } from '../reporting/reporting.module';
import { AdminAppSettingsController } from './admin-app-settings.controller';
import { AdminAppSettingsService } from './admin-app-settings.service';

@Module({
  imports: [
    DatabaseModule,
    AdminAuthModule,
    MediaStorageModule,
    forwardRef(() => ReportingModule),
  ],
  controllers: [AdminAppSettingsController],
  providers: [AdminAppSettingsService],
  exports: [AdminAppSettingsService],
})
export class AdminAppSettingsModule {}
