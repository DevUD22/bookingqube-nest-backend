import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminLegacyMigrationController } from './admin-legacy-migration.controller';
import { AdminLegacyMigrationService } from './admin-legacy-migration.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminLegacyMigrationController],
  providers: [AdminLegacyMigrationService],
})
export class AdminLegacyMigrationModule {}
