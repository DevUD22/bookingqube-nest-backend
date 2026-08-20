import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminFooterMenusController } from './admin-footer-menus.controller';
import { AdminFooterMenusService } from './admin-footer-menus.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminFooterMenusController],
  providers: [AdminFooterMenusService],
  exports: [AdminFooterMenusService],
})
export class AdminFooterMenusModule {}
