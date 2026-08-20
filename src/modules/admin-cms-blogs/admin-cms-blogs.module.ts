import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminCmsBlogsController } from './admin-cms-blogs.controller';
import { AdminCmsBlogsService } from './admin-cms-blogs.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, MediaStorageModule],
  controllers: [AdminCmsBlogsController],
  providers: [AdminCmsBlogsService],
  exports: [AdminCmsBlogsService],
})
export class AdminCmsBlogsModule {}
