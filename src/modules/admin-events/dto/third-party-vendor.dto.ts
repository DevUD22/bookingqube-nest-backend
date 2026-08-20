import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ThirdPartyVendorItemDto {
  @IsOptional() @IsUUID() id?: string;
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsBoolean() is_main?: boolean;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) organiser_share!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) vendor_share!: number;
  @IsOptional() @IsBoolean() is_cafe?: boolean;
  @IsOptional() @IsString() @Length(0, 160) collected_by?: string | null;
  @IsOptional() @IsString() @Length(0, 160) owner_name?: string | null;
  @IsOptional() @IsIn(['normal', 'fixed']) owner_percentage_type?: 'normal' | 'fixed' | null;
}

export class ReplaceThirdPartyVendorsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ThirdPartyVendorItemDto)
  shares!: ThirdPartyVendorItemDto[];
}

export class CreateThirdPartyVendorDto {
  @IsString() @Length(1, 160) name!: string;
  @IsOptional() @IsBoolean() is_main?: boolean;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) organiser_share!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) vendor_share!: number;
  @IsOptional() @IsBoolean() is_cafe?: boolean;
  @IsOptional() @IsString() @Length(0, 160) collected_by?: string | null;
  @IsOptional() @IsString() @Length(0, 160) owner_name?: string | null;
  @IsOptional() @IsIn(['normal', 'fixed']) owner_percentage_type?: 'normal' | 'fixed' | null;
}
