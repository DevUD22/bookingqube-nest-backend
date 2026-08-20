import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminOffersController } from './admin-offers.controller';
import { AdminOffersService } from './admin-offers.service';

@Module({ imports: [AdminAuthModule, MediaStorageModule], controllers: [AdminOffersController], providers: [AdminOffersService] })
export class AdminOffersModule {}
