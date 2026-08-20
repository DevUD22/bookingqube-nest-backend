import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminOrganizationsController } from './admin-organizations.controller';
import { AdminOrganizationsService } from './admin-organizations.service';
@Module({ imports: [DatabaseModule, AdminAuthModule], controllers: [AdminOrganizationsController], providers: [AdminOrganizationsService] })
export class AdminOrganizationsModule {}
