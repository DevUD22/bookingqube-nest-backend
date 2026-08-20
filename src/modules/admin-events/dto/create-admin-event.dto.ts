import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Physical entry medium used at the gate (replaces legacy scanner_type). */
export class EntryAccessDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['rfid', 'barcode', 'other'])
  pass_type?: 'rfid' | 'barcode' | 'other' | null;

  /** Free-text label when pass_type is `other`. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  other_label?: string;

  /** Characters expected from a scanner before auto-adding a code (legacy barcode_scan_length). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(4)
  @Max(64)
  scan_length?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryCodePoolItemDto)
  code_pool?: EntryCodePoolItemDto[];
}

/** Pre-registered wristband / barcode inventory (legacy Available RFIDs / open pool). */
export class EntryCodePoolItemDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  id?: string;

  @IsString()
  @Length(1, 120)
  code!: string;

  @IsOptional()
  @IsUUID()
  ticket_type_id?: string | null;

  /** When the ticket has variants, codes bind to a variant instead of the parent ticket. */
  @IsOptional()
  @IsUUID()
  ticket_variant_id?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  wristband_color?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
}

export class CreateAdminEventDto {
  @IsString()
  @Length(2, 160)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(2, 160)
  title_ar?: string;

  @IsOptional()
  @IsString()
  @Length(2, 180)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must contain lowercase letters, numbers, and single hyphens only',
  })
  slug?: string;

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

  @IsIn(['general', 'registration_only', 'summer_camp'])
  event_type!: 'general' | 'registration_only' | 'summer_camp';

  @IsIn(['ticketed', 'registration'])
  booking_mode!: 'ticketed' | 'registration';

  @IsIn(['public', 'private', 'unlisted'])
  visibility!: 'public' | 'private' | 'unlisted';

  @IsOptional()
  @IsBoolean()
  requires_waiver?: boolean;

  @IsOptional()
  @IsBoolean()
  is_featured?: boolean;

  @IsOptional()
  @IsBoolean()
  seat_selection_enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  arabic_content?: boolean;

  @IsOptional()
  @IsUUID()
  venue_id?: string;

  @IsOptional()
  @IsUUID()
  category_id?: string;

  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsUUID()
  organizer_user_id?: string | null;

  @IsOptional()
  @IsISO8601({ strict: true })
  starts_at?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  ends_at?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => EntryAccessDto)
  entry_access?: EntryAccessDto;
}
