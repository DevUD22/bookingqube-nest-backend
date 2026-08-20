import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminFileStorageService } from './admin-file-storage.service';
import {
  TestFileStorageDto,
  UpsertFileStorageSettingDto,
} from './dto/admin-file-storage.dto';

@ApiTags('admin-file-storage')
@ApiBearerAuth()
@Controller('admin/settings/storage')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('settings.storage.manage')
export class AdminFileStorageController {
  constructor(private readonly storage: AdminFileStorageService) {}

  @Get()
  get() {
    return this.storage.get();
  }

  @Put()
  upsert(
    @Body() body: UpsertFileStorageSettingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.storage.upsert(body, admin.id);
  }

  @Post('test')
  test(@Body() body: TestFileStorageDto) {
    return this.storage.testConnection(body);
  }
}
