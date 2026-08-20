import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Ip,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { AdminAuthService } from './admin-auth.service';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { RequirePermissions } from './decorators/permissions.decorator';
import {
  AdminLoginDto,
  AdminLogoutDto,
  AdminMfaEnrollDto,
  AdminRefreshDto,
  UpdateAdminProfileDto,
  UploadAdminAvatarDto,
} from './dto/admin-auth.dto';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminPermissionsGuard } from './guards/admin-permissions.guard';
import { AuthenticatedAdmin } from './strategies/admin-jwt.strategy';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @Body() body: AdminLoginDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.adminAuth.login(body, { userAgent, ipAddress });
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  enrollMfa(
    @Body() body: AdminMfaEnrollDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.adminAuth.enrollMfa(body, { userAgent, ipAddress });
  }

  @Post('refresh')
  @HttpCode(200)
  refresh(
    @Body() body: AdminRefreshDto,
    @Headers('user-agent') userAgent?: string,
    @Ip() ipAddress?: string,
  ) {
    return this.adminAuth.refresh(body.refresh_token, { userAgent, ipAddress });
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Body() body: AdminLogoutDto) {
    return this.adminAuth.logout(body.refresh_token);
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('panel.access')
  me(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.adminAuth.me(admin);
  }

  @Put('profile')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('panel.access')
  updateProfile(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: UpdateAdminProfileDto,
  ) {
    return this.adminAuth.updateProfile(admin, body);
  }

  @Post('profile/avatar')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('panel.access')
  uploadAvatar(
    @CurrentAdmin() admin: AuthenticatedAdmin,
    @Body() body: UploadAdminAvatarDto,
  ) {
    return this.adminAuth.uploadAvatar(admin, body);
  }

  @Delete('profile/avatar')
  @ApiBearerAuth()
  @UseGuards(AdminAuthGuard, AdminPermissionsGuard)
  @RequirePermissions('panel.access')
  removeAvatar(@CurrentAdmin() admin: AuthenticatedAdmin) {
    return this.adminAuth.removeAvatar(admin);
  }
}
