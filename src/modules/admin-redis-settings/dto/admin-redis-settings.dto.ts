import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertRedisSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}

export class TestRedisSettingDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;
}
