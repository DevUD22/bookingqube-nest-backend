import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminHomepageFaqsController } from './admin-homepage-faqs.controller';
import { AdminHomepageFaqsService } from './admin-homepage-faqs.service';

@Module({
  imports: [DatabaseModule, AdminAuthModule],
  controllers: [AdminHomepageFaqsController],
  providers: [AdminHomepageFaqsService],
})
export class AdminHomepageFaqsModule {}
