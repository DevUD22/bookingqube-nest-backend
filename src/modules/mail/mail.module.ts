import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { MailService } from './mail.service';

@Module({
  imports: [DatabaseModule],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
