import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminFileStorageController } from './admin-file-storage.controller';
import { AdminFileStorageService } from './admin-file-storage.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, MediaStorageModule],
  controllers: [AdminFileStorageController],
  providers: [AdminFileStorageService],
  exports: [AdminFileStorageService],
})
export class AdminFileStorageModule {}
