import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminEventsController } from './admin-events.controller';
import { AdminEventsService } from './admin-events.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, AdminStaffModule, MediaStorageModule],
  controllers: [AdminEventsController],
  providers: [AdminEventsService],
  exports: [AdminEventsService],
})
export class AdminEventsModule {}
