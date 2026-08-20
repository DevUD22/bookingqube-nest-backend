import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './guards/admin-auth.guard';
import { AdminPermissionsGuard } from './guards/admin-permissions.guard';
import { OptionalAdminJwtAuthGuard } from './guards/optional-admin-jwt-auth.guard';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';

@Module({
  imports: [DatabaseModule, AuthModule, PassportModule, MediaStorageModule],
  controllers: [AdminAuthController],
  providers: [
    AdminAuthService,
    AdminJwtStrategy,
    AdminAuthGuard,
    AdminPermissionsGuard,
    OptionalAdminJwtAuthGuard,
  ],
  exports: [AdminAuthGuard, AdminPermissionsGuard, OptionalAdminJwtAuthGuard],
})
export class AdminAuthModule {}
