import { Module } from '@nestjs/common';

import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminEventsModule } from '../admin-events/admin-events.module';
import { AdminCmsArtistsController } from './admin-cms-artists.controller';

@Module({
  imports: [AdminAuthModule, AdminEventsModule],
  controllers: [AdminCmsArtistsController],
})
export class AdminCmsArtistsModule {}
