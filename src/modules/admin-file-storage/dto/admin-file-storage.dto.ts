import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertFileStorageSettingDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  connection_string?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  container_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  public_base_url?: string;
}

export class TestFileStorageDto {
  @IsOptional()
  @IsString()
  connection_string?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  container_name?: string;
}
