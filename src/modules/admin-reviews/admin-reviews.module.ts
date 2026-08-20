import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { AdminReviewsController } from './admin-reviews.controller';
import { AdminReviewsService } from './admin-reviews.service';

@Module({ imports: [DatabaseModule, AdminAuthModule], controllers: [AdminReviewsController], providers: [AdminReviewsService] })
export class AdminReviewsModule {}
