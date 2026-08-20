import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminRedisSettingsService } from './admin-redis-settings.service';
import {
  TestRedisSettingDto,
  UpsertRedisSettingDto,
} from './dto/admin-redis-settings.dto';

@ApiTags('admin-redis-settings')
@ApiBearerAuth()
@Controller('admin/settings/redis')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('settings.redis.manage')
export class AdminRedisSettingsController {
  constructor(private readonly redisSettings: AdminRedisSettingsService) {}

  @Get()
  get() {
    return this.redisSettings.get();
  }

  @Put()
  upsert(
    @Body() body: UpsertRedisSettingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.redisSettings.upsert(body, admin.id);
  }

  @Post('test')
  test(@Body() body: TestRedisSettingDto) {
    return this.redisSettings.testConnection(body);
  }
}
