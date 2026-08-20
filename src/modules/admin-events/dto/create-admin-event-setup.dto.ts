import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class CreateAdminEventSessionDto {
  @IsISO8601({ strict: true }) starts_at!: string;
  @IsOptional() @IsISO8601({ strict: true }) ends_at?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) capacity?: number;
}

export class CreateAdminTicketVariantDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 240) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  @IsOptional() @IsString() @Length(1, 60) badge?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_order?: number;
  /** Play / visit length in minutes when the parent ticket has timing duration */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24 * 60) duration_minutes?: number;
}

export class UpdateAdminTicketVariantDto extends CreateAdminTicketVariantDto {
  /** Existing variant id — omit to create a new variant row */
  @IsOptional() @IsUUID() id?: string;
}

export class CreateAdminTicketCustomizationOptionDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 240) description?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  /** When true, this customization item has a timed duration */
  @IsOptional() @IsBoolean() has_duration?: boolean;
  /** Duration in minutes when has_duration is true */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24 * 60) duration_minutes?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_ticket?: number;
}

export class UpdateAdminTicketCustomizationOptionDto extends CreateAdminTicketCustomizationOptionDto {
  /** Existing customization option id — omit to create a new row */
  @IsOptional() @IsUUID() id?: string;
}

export class CreateAdminTicketTypeDto {
  /** simple = flat price; bands = early/standard/VIP style; variants = timed/pack SKUs — bands & variants both use ticket_variants */
  @IsIn(['normal', 'simple', 'variants', 'bands'])
  ticket_mode!: 'normal' | 'simple' | 'variants' | 'bands';
  @IsString() @Length(2, 120) title!: string;
  @IsOptional() @IsString() @Length(2, 180) subtitle?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) exclusions?: string[];
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateAdminTicketVariantDto) variants?: CreateAdminTicketVariantDto[];
  /** When true, guests pick priced customization items instead of (or in addition to) a flat ticket price */
  @IsOptional() @IsBoolean() is_customizable?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdminTicketCustomizationOptionDto)
  customization_options?: CreateAdminTicketCustomizationOptionDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_order?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) admit_count?: number;
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) session_ids?: string[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) inventory_quantity?: number;
  @IsOptional() @IsISO8601({ strict: true }) sales_start_at?: string;
  @IsOptional() @IsISO8601({ strict: true }) sales_end_at?: string;

  /** When true, this ticket (or each variant) has a timed visit length */
  @IsOptional() @IsBoolean() has_duration?: boolean;
  /** Duration in minutes for simple tickets (ignored when variants supply their own) */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(24 * 60) duration_minutes?: number;
  /** Hide from online / website checkout */
  @IsOptional() @IsBoolean() hide_from_online?: boolean;
  /** Hide from POS / box-office machines */
  @IsOptional() @IsBoolean() hide_from_pos?: boolean;
  /** Revenue-share / third-party vendor for this ticket */
  @IsOptional() @IsUUID() third_party_vendor_id?: string | null;
  /** Ticket created on behalf of an external booking platform */
  @IsOptional() @IsBoolean() is_third_party_platform_ticket?: boolean;
  @IsOptional() @IsUUID() third_party_platform_id?: string | null;
}

export class ImportAdminTicketTypesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdminTicketTypeDto)
  tickets!: CreateAdminTicketTypeDto[];
}

export class UpdateAdminTicketTypeDto {
  @IsIn(['normal', 'simple', 'variants', 'bands'])
  ticket_mode!: 'normal' | 'simple' | 'variants' | 'bands';
  @IsString() @Length(2, 120) title!: string;
  @IsOptional() @IsString() @Length(2, 180) subtitle?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) inclusions?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(200, { each: true }) exclusions?: string[];
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => UpdateAdminTicketVariantDto) variants?: UpdateAdminTicketVariantDto[];
  @IsOptional() @IsBoolean() is_customizable?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateAdminTicketCustomizationOptionDto)
  customization_options?: UpdateAdminTicketCustomizationOptionDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_order?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) admit_count?: number;
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsISO8601({ strict: true })
  sales_start_at?: string | null;
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsISO8601({ strict: true })
  sales_end_at?: string | null;
  @IsOptional() @IsBoolean() has_duration?: boolean;
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  duration_minutes?: number | null;
  @IsOptional() @IsBoolean() hide_from_online?: boolean;
  @IsOptional() @IsBoolean() hide_from_pos?: boolean;
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  third_party_vendor_id?: string | null;
  @IsOptional() @IsBoolean() is_third_party_platform_ticket?: boolean;
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsUUID()
  third_party_platform_id?: string | null;
  /** active keeps the product live; inactive maps to catalog `hidden` */
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}
