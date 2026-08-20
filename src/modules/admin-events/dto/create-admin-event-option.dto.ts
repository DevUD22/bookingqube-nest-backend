import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

const slugOptions = {
  message: 'slug must contain lowercase letters, numbers, and single hyphens only',
};

export class CreateAdminEventCategoryDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 100)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @Length(2, 120)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, slugOptions)
  slug?: string;

  /** active = visible, inactive maps to hidden */
  @IsOptional()
  @IsIn(['active', 'inactive', 'hidden'])
  status?: 'active' | 'inactive' | 'hidden';

  /** parent = top-level, sub = child of parent_id */
  @IsOptional()
  @IsIn(['parent', 'sub'])
  kind?: 'parent' | 'sub';

  @IsOptional()
  @IsUUID()
  parent_id?: string;

  @IsOptional()
  @IsString()
  thumbnail_data_url?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  thumbnail_file_name?: string;
}

export class CreateAdminEventVenueDto {
  @IsString()
  @Length(2, 160)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, slugOptions)
  slug?: string;

  @IsOptional()
  @IsString()
  about?: string;

  @IsOptional()
  @IsString()
  about_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  address_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  zipcode?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{2}$/, { message: 'country must be a two-letter country code' })
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  country_ar?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-90)
  @Max(90)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 7 })
  @Min(-180)
  @Max(180)
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  google_map_url?: string;

  /** active → published, inactive → draft */
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  banner_data_url?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  banner_file_name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  gallery_data_urls?: string[];

  /** Existing gallery URLs to keep on update. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  gallery_urls?: string[];
}
