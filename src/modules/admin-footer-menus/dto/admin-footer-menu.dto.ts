import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const PUBLISH_STATUSES = ['draft', 'review', 'published', 'archived'] as const;

export class UpsertFooterMenuItemDto {
  @IsString()
  @Length(1, 180)
  title_en!: string;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  title_ar?: string | null;

  @IsOptional()
  @IsString()
  description_en?: string | null;

  @IsOptional()
  @IsString()
  description_ar?: string | null;

  @IsOptional()
  @IsString()
  body_html_en?: string | null;

  @IsOptional()
  @IsString()
  body_html_ar?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @Length(1, 160)
  slug?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  url?: string | null;

  @IsOptional()
  @IsIn(['_self', '_blank'])
  target?: '_self' | '_blank';

  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsUUID()
  parent_id?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sort_order?: number;

  @IsOptional()
  @IsIn(PUBLISH_STATUSES)
  status?: (typeof PUBLISH_STATUSES)[number];
}

export class FooterMenuReorderNodeDto {
  @IsUUID()
  id!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FooterMenuReorderNodeDto)
  children?: FooterMenuReorderNodeDto[];
}

export class ReorderFooterMenusDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FooterMenuReorderNodeDto)
  items!: FooterMenuReorderNodeDto[];
}
