import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { RedisModule } from '../redis/redis.module';
import { AdminRedisSettingsController } from './admin-redis-settings.controller';
import { AdminRedisSettingsService } from './admin-redis-settings.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule, RedisModule],
  controllers: [AdminRedisSettingsController],
  providers: [AdminRedisSettingsService],
  exports: [AdminRedisSettingsService],
})
export class AdminRedisSettingsModule {}
