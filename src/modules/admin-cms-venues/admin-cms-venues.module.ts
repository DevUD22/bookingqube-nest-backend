import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminEventsModule } from '../admin-events/admin-events.module';
import { AdminCmsVenuesController } from './admin-cms-venues.controller';

@Module({
  imports: [AdminAuthModule, AdminEventsModule],
  controllers: [AdminCmsVenuesController],
})
export class AdminCmsVenuesModule {}
