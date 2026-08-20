import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const slugOptions = {
  message: 'slug must contain lowercase letters, numbers, and single hyphens only',
};

export class ArtistParentsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  father?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  mother?: string;
}

/** Quick-create / full artist payload from event Other config. Only `name` is required. */
export class CreateAdminArtistDto {
  @IsString()
  @Length(1, 255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  stage_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  stage_name_ar?: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, slugOptions)
  slug?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date_of_birth must be YYYY-MM-DD' })
  date_of_birth?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(150)
  age?: number;

  @IsOptional()
  @IsBoolean()
  age_is_manual?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  origin?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(400)
  height_cm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  ethnicity?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nationality?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  religion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  occupation?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  genres?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  instruments?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  net_worth?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3)
  net_worth_currency?: string;

  @IsOptional()
  @IsIn(['Single', 'Married', 'Engaged', 'Divorced', ''])
  marital_status?: 'Single' | 'Married' | 'Engaged' | 'Divorced' | '';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  spouse_name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  children?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ArtistParentsDto)
  parents?: ArtistParentsDto;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  biography?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  biography_ar?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'profile_updated_date must be YYYY-MM-DD' })
  profile_updated_date?: string;

  @IsOptional()
  @IsString()
  artist_image_data_url?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  artist_image_file_name?: string;

  @IsOptional()
  @IsString()
  banner_image_data_url?: string;

  @IsOptional()
  @IsString()
  @Length(1, 180)
  banner_image_file_name?: string;

  /** Defaults to published so the artist is usable on public pages. */
  @IsOptional()
  @IsIn(['draft', 'review', 'published', 'archived'])
  status?: 'draft' | 'review' | 'published' | 'archived';
}
