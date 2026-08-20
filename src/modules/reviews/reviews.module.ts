import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({ imports: [DatabaseModule, AuthModule], controllers: [ReviewsController], providers: [ReviewsService] })
export class ReviewsModule {}
