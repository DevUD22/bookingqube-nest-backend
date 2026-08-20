import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

const PUBLISH_STATUSES = ['draft', 'review', 'published', 'archived'] as const;

export class UpsertAdminCmsBlogDto {
  /** Display name — stored as BlogTranslation.title */
  @IsString()
  @Length(1, 220)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 220)
  name_ar?: string | null;

  /** Page / SEO title — stored as BlogTranslation.metaTitle */
  @IsOptional()
  @IsString()
  @Length(0, 220)
  title?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 220)
  title_ar?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 180)
  slug?: string | null;

  @IsOptional()
  @IsIn(PUBLISH_STATUSES)
  status?: (typeof PUBLISH_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  excerpt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  excerpt_ar?: string | null;

  @IsOptional()
  @IsString()
  body_html?: string | null;

  @IsOptional()
  @IsString()
  body_html_ar?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  category?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  category_ar?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta_description?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  meta_description_ar?: string | null;

  @IsOptional()
  @IsString()
  hero_image_data_url?: string | null;

  @IsOptional()
  @IsString()
  @Length(0, 255)
  hero_image_file_name?: string | null;
}
