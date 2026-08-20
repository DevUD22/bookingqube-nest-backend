import { Type } from 'class-transformer';
import {
  ArrayUnique,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AdminPromocodeListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsIn(['draft', 'active', 'paused', 'expired', 'scheduled']) status?: string;
  @IsOptional() @IsUUID() organization_id?: string;
  @IsOptional() @IsUUID() event_id?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page = 25;
}

export class AdminPromocodeOptionsQueryDto {
  @IsUUID() organization_id!: string;
}

export class AdminPromocodeInsightsQueryDto {
  @IsOptional() @IsIn(['7d', '30d', '90d', 'all']) range: '7d' | '30d' | '90d' | 'all' = '30d';
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) per_page = 25;
}

export class UpsertAdminPromocodeDto {
  @IsUUID() organization_id!: string;

  @IsString()
  @Length(2, 40)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, {
    message: 'code may only contain letters, numbers, underscores, and hyphens',
  })
  code!: string;

  @IsOptional() @IsString() @Length(0, 120) name?: string;
  @IsOptional() @IsString() @Length(0, 300) description?: string;
  @IsOptional() @IsBoolean() show_in_pos?: boolean;

  @IsIn(['percent', 'fixed']) discount_type!: 'percent' | 'fixed';
  @IsOptional() @IsIn(['per_ticket', 'order_total']) application_mode: 'per_ticket' | 'order_total' = 'per_ticket';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) discount_value!: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;

  @IsIn(['all', 'event', 'ticket_type', 'ticket_variant', 'cafe', 'cafe_menu_item'])
  target_type!: 'all' | 'event' | 'ticket_type' | 'ticket_variant' | 'cafe' | 'cafe_menu_item';

  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  target_ids!: string[];

  @IsOptional() @IsISO8601({ strict: true }) starts_at?: string;
  @IsOptional() @IsISO8601({ strict: true }) ends_at?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_redemptions?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_redemptions_per_customer?: number;
  @IsIn(['draft', 'active', 'paused']) status!: 'draft' | 'active' | 'paused';
}

export class BulkPromocodeConfigDto {
  @IsUUID() organization_id!: string;
  @IsIn(['percent', 'fixed']) discount_type!: 'percent' | 'fixed';
  @IsOptional() @IsIn(['per_ticket', 'order_total']) application_mode: 'per_ticket' | 'order_total' = 'per_ticket';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0.001) discount_value!: number;
  @IsOptional() @IsString() @Length(3, 3) currency?: string;
  @IsIn(['all', 'event', 'ticket_type', 'ticket_variant', 'cafe', 'cafe_menu_item']) target_type!: 'all' | 'event' | 'ticket_type' | 'ticket_variant' | 'cafe' | 'cafe_menu_item';
  @IsArray() @ArrayUnique() @IsUUID('4', { each: true }) target_ids!: string[];
  @IsOptional() @IsISO8601({ strict: true }) starts_at?: string;
  @IsOptional() @IsISO8601({ strict: true }) ends_at?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_redemptions?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) max_redemptions_per_customer?: number;
  @IsIn(['draft', 'active', 'paused']) status!: 'draft' | 'active' | 'paused';
}

export class BulkGenerateAdminPromocodesDto {
  @Type(() => BulkPromocodeConfigDto) @ValidateNested() config!: BulkPromocodeConfigDto;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) quantity!: number;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]*$/) @Length(0, 20) prefix?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(6) @Max(16) code_length = 10;
}

export class BulkImportAdminPromocodesDto {
  @Type(() => BulkPromocodeConfigDto) @ValidateNested() config!: BulkPromocodeConfigDto;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(500) @ArrayUnique()
  @IsString({ each: true }) @Length(2, 40, { each: true })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, { each: true })
  codes!: string[];
}

export class UpdateAdminPromocodeStatusDto {
  @IsIn(['active', 'paused']) status!: 'active' | 'paused';
}
