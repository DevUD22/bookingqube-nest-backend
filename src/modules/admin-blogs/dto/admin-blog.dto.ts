import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

export class AdminBlogsListQueryDto {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsIn(['all', 'draft', 'review', 'published', 'archived']) status?: string;
}

export class UpsertAdminBlogDto {
  @IsString()
  @Length(1, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;

  @IsIn(['draft', 'review', 'published', 'archived'])
  status!: 'draft' | 'review' | 'published' | 'archived';

  @IsOptional() @IsString() @MaxLength(180) author_name?: string | null;
  @IsOptional() @IsDateString() published_at?: string | null;
  @IsBoolean() show_on_homepage!: boolean;
  @IsOptional() @IsString() hero_image_data_url?: string | null;
  @IsOptional() @IsString() @MaxLength(240) hero_image_file_name?: string | null;
  @IsOptional() @Transform(({ value }) => Boolean(value)) @IsBoolean() remove_hero_image?: boolean;

  @IsString() @Length(1, 240) title_en!: string;
  @IsOptional() @IsString() @MaxLength(1000) excerpt_en?: string | null;
  @IsString() body_html_en!: string;
  @IsOptional() @IsString() @MaxLength(240) meta_title_en?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) meta_description_en?: string | null;
  @IsOptional() @IsString() @MaxLength(120) category_en?: string | null;
  @IsOptional() @IsString() @MaxLength(120) tag_en?: string | null;

  @IsOptional() @IsString() @MaxLength(240) title_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) excerpt_ar?: string | null;
  @IsOptional() @IsString() body_html_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(240) meta_title_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) meta_description_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(120) category_ar?: string | null;
  @IsOptional() @IsString() @MaxLength(120) tag_ar?: string | null;
}
