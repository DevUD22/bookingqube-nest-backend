import { IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateThirdPartyPlatformDto {
  @IsString() @Length(1, 160) name!: string;
  /** Optional credential for future partner API access (not POS/checkout). */
  @IsOptional() @IsString() @Length(0, 160) access_code?: string | null;
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'badge_color must be a 6-digit hex color.' })
  badge_color?: string;
}
