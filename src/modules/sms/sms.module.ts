import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { SmsService } from './sms.service';

@Module({
  imports: [DatabaseModule],
  providers: [SmsService],
  exports: [SmsService],
})
export class SmsModule {}
