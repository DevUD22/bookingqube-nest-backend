import { Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional,
  IsString, IsUUID, Length, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class AdminOffersListQueryDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['all', 'draft', 'review', 'published', 'archived']) status?: string;
}

export class UpsertAdminOfferDto {
  @IsString() @Length(1, 180) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) slug!: string;
  @IsIn(['draft', 'review', 'published', 'archived']) status!: 'draft' | 'review' | 'published' | 'archived';
  @IsBoolean() is_featured!: boolean;
  @IsBoolean() show_on_homepage!: boolean;
  @Type(() => Number) @IsInt() @Min(0) @Max(10000) sort_order!: number;
  @IsOptional() @IsDateString() valid_until?: string | null;
  @IsOptional() @IsDateString() published_at?: string | null;
  @IsOptional() @IsString() hero_image_data_url?: string | null;
  @IsOptional() @IsString() @MaxLength(240) hero_image_file_name?: string | null;
  @IsOptional() @IsBoolean() remove_hero_image?: boolean;
  @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) event_ids!: string[];

  @IsString() @Length(1, 240) title_en!: string;
  @IsOptional() @IsString() @MaxLength(500) subtitle_en?: string | null;
  @IsOptional() @IsString() description_en?: string | null;
  @IsOptional() @IsString() @MaxLength(120) category_en?: string | null;
  @IsOptional() @IsString() @MaxLength(120) tag_en?: string | null;
  @IsArray() @ArrayUnique() @IsString({ each: true }) tags_en!: string[];
  @IsOptional() @IsString() @MaxLength(240) meta_title_en?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) meta_description_en?: string | null;

  @IsOptional() @IsString() @MaxLength(240) title_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(500) subtitle_ar?: string | null;
  @IsOptional() @IsString() description_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(120) category_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(120) tag_ar?: string | null;
  @IsArray() @ArrayUnique() @IsString({ each: true }) tags_ar!: string[];
  @IsOptional() @IsString() @MaxLength(240) meta_title_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) meta_description_ar?: string | null;
}
