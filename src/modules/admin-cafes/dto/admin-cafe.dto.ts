import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class AdminCafeListQueryDto {
  @IsOptional() @IsUUID() organization_id?: string;
  @IsOptional() @IsIn(['draft', 'review', 'published', 'archived']) status?: string;
  @IsOptional() @IsString() @Length(1, 160) q?: string;
}

export class CreateAdminCafeDto {
  @IsUUID() organization_id!: string;
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsString() @Length(0, 5000) details?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) table_count!: number;
  @IsOptional() @IsUUID() manager_user_id?: string | null;
}

export class UpdateAdminCafeDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() @Length(0, 5000) details?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) table_count?: number;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  manager_user_id?: string | null;
}

export class UpdateAdminCafeStatusDto {
  @IsIn(['draft', 'published', 'archived']) status!: 'draft' | 'published' | 'archived';
}

export class AssignCafeEventDto {
  @IsUUID() event_id!: string;
}

export class UpsertCafeMenuCategoryDto {
  @IsString() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
  @IsOptional() @IsIn(['active', 'hidden', 'archived']) status?: 'active' | 'hidden' | 'archived';
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  image_media_id?: string | null;
  @IsOptional() @IsString() thumbnail_data_url?: string;
  @IsOptional() @IsString() @Length(0, 260) thumbnail_file_name?: string;
}

export class UpsertCafeMenuSubcategoryDto {
  @IsString() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
  @IsOptional() @IsIn(['active', 'hidden', 'archived']) status?: 'active' | 'hidden' | 'archived';
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  image_media_id?: string | null;
  @IsOptional() @IsString() thumbnail_data_url?: string;
  @IsOptional() @IsString() @Length(0, 260) thumbnail_file_name?: string;
}

export class CafeMenuItemVariantDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string | null;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
  @IsOptional() @IsIn(['active', 'hidden', 'archived']) status?: 'active' | 'hidden' | 'archived';
}

export class UpsertCafeMenuItemDto {
  @IsString() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string | null;
  @IsOptional() @IsString() @Length(0, 5000) description?: string | null;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  @IsOptional() @IsString() @Length(1, 8) currency?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  image_media_id?: string | null;
  @IsOptional() @IsString() thumbnail_data_url?: string;
  @IsOptional() @IsString() @Length(0, 260) thumbnail_file_name?: string;
  @IsOptional() @IsBoolean() is_kot?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
  @IsOptional() @IsIn(['active', 'hidden', 'archived']) status?: 'active' | 'hidden' | 'archived';
  /** When set (including empty), replaces all variants for the item. Omit to leave unchanged on update. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => CafeMenuItemVariantDto)
  variants?: CafeMenuItemVariantDto[];
}

export class CreateCafePosAgentDto {
  /** Attach an existing user. Omit when creating a new Cafe POS agent. */
  @IsOptional() @IsUUID() user_id?: string;

  @ValidateIf((body: CreateCafePosAgentDto) => !body.user_id)
  @IsString()
  @Length(2, 160)
  name?: string;

  @ValidateIf((body: CreateCafePosAgentDto) => !body.user_id)
  @IsEmail()
  email?: string;

  @ValidateIf((body: CreateCafePosAgentDto) => !body.user_id)
  @IsString()
  @MinLength(8)
  password?: string;

  @ValidateIf((body: CreateCafePosAgentDto) => !body.user_id)
  @IsString()
  @Length(3, 60)
  @Matches(/^[a-zA-Z0-9._-]+$/, {
    message: 'username may only contain letters, numbers, dots, underscores, and hyphens',
  })
  username?: string;
}

export class UpdateCafePosAgentStatusDto {
  @IsIn(['active', 'suspended']) status!: 'active' | 'suspended';
}
