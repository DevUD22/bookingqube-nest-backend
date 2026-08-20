import { Module } from '@nestjs/common';

import { AdminPaymentSettingsModule } from '../admin-payment-settings/admin-payment-settings.module';
import { EventListingController, EventsController } from './events.controller';
import { EventsService } from './events.service';

@Module({
  imports: [AdminPaymentSettingsModule],
  controllers: [EventsController, EventListingController],
  providers: [EventsService],
  exports: [EventsService],
})
export class EventsModule {}
