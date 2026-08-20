import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin-auth/admin-auth.module';
import { MediaStorageModule } from '../media-storage/media-storage.module';
import { AdminBlogsController } from './admin-blogs.controller';
import { AdminBlogsService } from './admin-blogs.service';

@Module({ imports: [AdminAuthModule, MediaStorageModule], controllers: [AdminBlogsController], providers: [AdminBlogsService] })
export class AdminBlogsModule {}
