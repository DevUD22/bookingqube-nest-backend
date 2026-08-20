import { IsBoolean, IsIn, IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertAppSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  config!: Record<string, string>;
}

export class TestAppSettingDto {
  @IsOptional()
  @IsObject()
  config?: Record<string, string>;
}

export const WEBSITE_ASSET_FIELDS = [
  'logo',
  'small_logo',
  'site_favicon',
] as const;

export type WebsiteAssetField = (typeof WEBSITE_ASSET_FIELDS)[number];

export class UploadAppSettingAssetDto {
  @IsString()
  @IsIn([...WEBSITE_ASSET_FIELDS])
  field!: WebsiteAssetField;

  @IsString()
  data_url!: string;

  @IsOptional()
  @IsString()
  file_name?: string;
}
