import { IsISO8601, IsOptional, IsString, Length, MaxLength } from 'class-validator';

export class UpdateOrganizerEventDto {
  @IsOptional()
  @IsString()
  @Length(2, 160)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  title_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  subtitle_ar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description_ar?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  starts_at?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  ends_at?: string;
}
