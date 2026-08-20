import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';

import { DatabaseModule } from '../../database/database.module';
import { AdminDashboardModule } from '../admin-dashboard/admin-dashboard.module';
import { AdminEventsModule } from '../admin-events/admin-events.module';
import { AuthModule } from '../auth/auth.module';
import { OrganizerAuthGuard } from './organizer-auth.guard';
import { OrganizerAuthService } from './organizer-auth.service';
import { OrganizerAuthController, OrganizerWorkspaceController } from './organizer.controller';
import { OrganizerJwtStrategy } from './organizer-jwt.strategy';

@Module({
  imports: [DatabaseModule, AuthModule, PassportModule, AdminDashboardModule, AdminEventsModule],
  controllers: [OrganizerAuthController, OrganizerWorkspaceController],
  providers: [OrganizerAuthService, OrganizerJwtStrategy, OrganizerAuthGuard],
})
export class OrganizerModule {}
