import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator';

export class CreateAdminEventMediaDto {
  @IsIn([
    'homepage_banner',
    'homepage_banner_mobile',
    'event_poster',
    'gallery',
    'ticket_side',
  ])
  role!:
    | 'homepage_banner'
    | 'homepage_banner_mobile'
    | 'event_poster'
    | 'gallery'
    | 'ticket_side';

  @IsString() @MaxLength(15_000_000)
  data_url!: string;

  @IsString() @Length(1, 180)
  file_name!: string;

  @IsOptional() @IsString() @MaxLength(240)
  alt_text?: string;

  @Type(() => Number) @IsInt() @Min(1) @Max(20_000)
  width!: number;

  @Type(() => Number) @IsInt() @Min(1) @Max(20_000)
  height!: number;
}
