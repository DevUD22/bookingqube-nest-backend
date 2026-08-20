import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class AdminEventListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['draft', 'review', 'published', 'archived'])
  status?: 'draft' | 'review' | 'published' | 'archived';

  @IsOptional()
  @IsIn(['public', 'private', 'unlisted'])
  visibility?: 'public' | 'private' | 'unlisted';

  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsIn(['en', 'ar'])
  lang = 'en';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page = 20;
}
