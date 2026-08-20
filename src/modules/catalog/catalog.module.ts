import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../database/database.module';
import { CatalogCacheService } from './catalog-cache.service';

@Module({
  imports: [DatabaseModule],
  providers: [CatalogCacheService],
  exports: [CatalogCacheService],
})
export class CatalogModule {}
