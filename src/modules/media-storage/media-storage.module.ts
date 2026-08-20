import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '../../database/database.module';
import { MediaStorageService } from './media-storage.service';

@Module({
  imports: [DatabaseModule, ConfigModule],
  providers: [MediaStorageService],
  exports: [MediaStorageService],
})
export class MediaStorageModule {}
