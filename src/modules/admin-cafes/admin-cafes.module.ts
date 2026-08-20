import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffModule } from '../admin-staff/admin-staff.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminCafesController } from './admin-cafes.controller';
import { AdminCafesService } from './admin-cafes.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, AdminStaffModule, MediaStorageModule],
  controllers: [AdminCafesController],
  providers: [AdminCafesService],
  exports: [AdminCafesService],
})
export class AdminCafesModule {}
