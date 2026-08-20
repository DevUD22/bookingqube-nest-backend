import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentAdmin } from '../admin-auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../admin-auth/decorators/permissions.decorator';
import { AdminAuthGuard } from '../admin-auth/guards/admin-auth.guard';
import { AdminPermissionsGuard } from '../admin-auth/guards/admin-permissions.guard';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminAppSettingsService } from './admin-app-settings.service';
import {
  TestAppSettingDto,
  UploadAppSettingAssetDto,
  UpsertAppSettingDto,
} from './dto/admin-app-settings.dto';

@ApiTags('admin-app-settings')
@ApiBearerAuth()
@Controller('admin/settings/general')
@UseGuards(AdminAuthGuard, AdminPermissionsGuard)
@RequirePermissions('settings.general.manage')
export class AdminAppSettingsController {
  constructor(private readonly settings: AdminAppSettingsService) {}

  @Get()
  list() {
    return this.settings.list();
  }

  @Get(':group')
  get(@Param('group') group: string) {
    return this.settings.get(group);
  }

  @Put(':group')
  upsert(
    @Param('group') group: string,
    @Body() body: UpsertAppSettingDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.settings.upsert(group, body, admin.id);
  }

  @Post(':group/test')
  test(@Param('group') group: string, @Body() body: TestAppSettingDto) {
    return this.settings.testConnection(group, body);
  }

  @Post(':group/reset-mfa')
  resetMfa(@Param('group') group: string) {
    return this.settings.resetAdminMfa(group);
  }

  @Post(':group/upload')
  upload(
    @Param('group') group: string,
    @Body() body: UploadAppSettingAssetDto,
    @CurrentAdmin() admin: AuthenticatedAdmin,
  ) {
    return this.settings.uploadAsset(group, body, admin.id);
  }
}
