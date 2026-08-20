import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpsertPaymentGatewayConfigDto {
  @IsIn(['sandbox', 'live'])
  environment!: 'sandbox' | 'live';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsObject()
  config!: Record<string, string>;
}

export class TestPaymentGatewayDto {
  @IsIn(['sandbox', 'live'])
  environment!: 'sandbox' | 'live';

  @IsOptional()
  @IsString()
  api_key?: string;

  @IsOptional()
  @IsString()
  country_iso?: string;

  @IsOptional()
  @IsString()
  api_base_url?: string;

  @IsOptional()
  @IsString()
  merchant_name?: string;

  @IsOptional()
  @IsString()
  username?: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  endpoint_url?: string;

  @IsOptional()
  @IsString()
  api_version?: string;
}
