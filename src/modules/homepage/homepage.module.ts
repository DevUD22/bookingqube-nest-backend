import { Module } from '@nestjs/common';

import { FooterController, HomepageController } from './homepage.controller';
import { HomepageService } from './homepage.service';

@Module({
  controllers: [FooterController, HomepageController],
  providers: [HomepageService],
})
export class HomepageModule {}
