import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminStaffController } from './admin-staff.controller';
import { AdminStaffService } from './admin-staff.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminStaffController],
  providers: [AdminStaffService],
  exports: [AdminStaffService],
})
export class AdminStaffModule {}
