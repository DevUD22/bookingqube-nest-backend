import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminRolesController } from './admin-roles.controller';
import { AdminRolesService } from './admin-roles.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminRolesController],
  providers: [AdminRolesService],
  exports: [AdminRolesService],
})
export class AdminRolesModule {}
