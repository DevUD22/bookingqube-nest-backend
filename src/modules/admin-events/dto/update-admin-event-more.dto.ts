import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class MoreFaqItemDto {
  @IsString() @Length(1, 240) question!: string;
  @IsString() @Length(1, 4000) answer!: string;
  @IsOptional() @IsString() @Length(0, 240) question_ar?: string;
  @IsOptional() @IsString() @Length(0, 4000) answer_ar?: string;
}

export class MoreFeedbackQuestionDto {
  @IsString() @Length(1, 512) label!: string;
  @IsOptional() @IsString() @Length(0, 512) label_ar?: string;
  @IsOptional()
  @IsIn([
    'text',
    'textarea',
    'checkbox',
    'radio',
    'dropdown',
    'multiple_textboxes',
    'numeric_rating',
    'star_rating',
    'smiley_rating',
    'rating',
    'yes_no',
  ])
  field_type?:
    | 'text'
    | 'textarea'
    | 'checkbox'
    | 'radio'
    | 'dropdown'
    | 'multiple_textboxes'
    | 'numeric_rating'
    | 'star_rating'
    | 'smiley_rating'
    | 'rating'
    | 'yes_no';
  /** @deprecated use field_type */
  @IsOptional()
  @IsIn(['text', 'rating', 'yes_no'])
  type?: 'text' | 'rating' | 'yes_no';
  @IsOptional() @IsBoolean() is_required?: boolean;
  @IsOptional() @IsBoolean() status?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(2) @Max(10) rating_count?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
}

/** @deprecated Prefer entry_access.code_pool — kept for older admin clients. */
export class MoreRfidItemDto {
  @IsString() @Length(1, 80) code!: string;
  @IsOptional() @IsString() @Length(0, 160) note?: string;
}

export class MoreEntryCodePoolItemDto {
  @IsOptional() @IsString() @Length(1, 80) id?: string;
  @IsString() @Length(1, 120) code!: string;
  @IsOptional() @IsUUID() ticket_type_id?: string | null;
  @IsOptional() @IsUUID() ticket_variant_id?: string | null;
  @IsOptional() @IsString() @Length(0, 32) wristband_color?: string;
  @IsOptional() @IsIn(['active', 'inactive']) status?: 'active' | 'inactive';
}

export class MoreEntryAccessDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsIn(['rfid', 'barcode', 'other'])
  pass_type?: 'rfid' | 'barcode' | 'other' | null;
  @IsOptional() @IsString() @Length(0, 120) other_label?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(4) @Max(64) scan_length?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreEntryCodePoolItemDto)
  code_pool?: MoreEntryCodePoolItemDto[];
}

export class MoreTimeExtensionDto {
  /** Stable pack id — generated on save when omitted; used for POS sell + named reports. */
  @IsOptional() @IsString() @Length(1, 80) id?: string;
  /** Legacy MySQL time_extensions.id when migrated. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) legacy_id?: number;
  @IsString() @Length(1, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 120) title_ar?: string;
  /** One ticket (legacy/default) or every regular ticket in the order. */
  @IsOptional() @IsIn(['ticket', 'order']) scope?: 'ticket' | 'order';
  @Type(() => Number) @IsInt() @Min(1) @Max(24 * 60) minutes!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  /** Ticket external keys allowed for ticket-scoped packs. Empty means any regular ticket. */
  @IsOptional() @IsArray() @IsString({ each: true }) ticket_ids?: string[];
}

export class MorePosPasswordsDto {
  @IsOptional() @IsString() @Length(0, 80) refund?: string;
  @IsOptional() @IsString() @Length(0, 80) edit?: string;
  @IsOptional() @IsString() @Length(0, 80) complimentary?: string;
}

export class MoreBulkPackDto {
  @IsString() @Length(1, 80) id!: string;
  @IsOptional() @IsString() @Length(0, 160) title?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) min_qty?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) max_qty?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discount?: number;
}

export class MoreBulkTicketDto {
  @IsString() @Length(1, 80) ticket_id!: string;
  @IsOptional() @IsString() @Length(0, 200) ticket_name?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) min_qty?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000) max_qty?: number | null;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) discount?: number;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreBulkPackDto)
  packs?: MoreBulkPackDto[];
}

export class MoreBulkBookingDto {
  /** Allow guests to self-checkout group bookings (shows discount fields). */
  @IsOptional() @IsBoolean() self_checkout?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreBulkTicketDto)
  tickets?: MoreBulkTicketDto[];
}

export class MoreFeedbackFormDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreFeedbackQuestionDto)
  questions?: MoreFeedbackQuestionDto[];
}

export class MoreTermsItemDto {
  @IsString() @Length(0, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 200) title_ar?: string;
  @IsString() @Length(0, 8_000) rule!: string;
  @IsOptional() @IsString() @Length(0, 8_000) rule_ar?: string;
}

export class MoreTitledItemDto {
  @IsString() @Length(0, 200) title!: string;
  @IsOptional() @IsString() @Length(0, 200) title_ar?: string;
}

export class UpdateAdminEventMoreDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreTermsItemDto)
  terms?: MoreTermsItemDto[];
  @IsOptional() @IsString() @Length(0, 20_000) waiver_content?: string;
  @IsOptional() @IsString() @Length(0, 20_000) waiver_content_ar?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MoreFaqItemDto) faqs?: MoreFaqItemDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreTitledItemDto)
  inclusions?: MoreTitledItemDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreTitledItemDto)
  exclusions?: MoreTitledItemDto[];
  @IsOptional() @IsString() @Length(0, 160) meta_title?: string;
  @IsOptional() @IsString() @Length(0, 160) meta_title_ar?: string;
  @IsOptional() @IsString() @Length(0, 320) meta_description?: string;
  @IsOptional() @IsString() @Length(0, 320) meta_description_ar?: string;
  @IsOptional() @IsString() @Length(0, 120) seats_io_event_key?: string;
  @IsOptional() @IsString() @Length(0, 120) seats_io_chart_key?: string;
  @IsOptional() @IsBoolean() requires_waiver?: boolean;
  @IsOptional() @IsBoolean() seat_selection_enabled?: boolean;

  @IsOptional() @ValidateNested() @Type(() => MorePosPasswordsDto) pos_passwords?: MorePosPasswordsDto;
  /** @deprecated Prefer entry_access */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MoreRfidItemDto) rfids?: MoreRfidItemDto[];
  @IsOptional() @ValidateNested() @Type(() => MoreEntryAccessDto) entry_access?: MoreEntryAccessDto;
  @IsOptional() @ValidateNested() @Type(() => MoreFeedbackFormDto) feedback_form?: MoreFeedbackFormDto;
  @IsOptional() @ValidateNested() @Type(() => MoreBulkBookingDto) bulk_booking?: MoreBulkBookingDto;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MoreTimeExtensionDto)
  time_extensions?: MoreTimeExtensionDto[];

  /** Ordered list of artist UUIDs linked to this event (many-to-many). */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  artist_ids?: string[];
}

export class CreateAdminAddonVariantDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(0, 240) description?: string;
  @IsOptional() @IsString() @Length(0, 120) name_ar?: string;
  @IsOptional() @IsString() @Length(0, 240) description_ar?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  @IsOptional() @IsString() @Length(0, 60) badge?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_order?: number;
}

export class CreateAdminAddonDto {
  @IsString() @Length(2, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 120) title_ar?: string;
  @IsOptional() @IsString() @Length(0, 180) subtitle?: string;
  @IsOptional() @IsString() @Length(0, 180) subtitle_ar?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateAdminAddonVariantDto) variants?: CreateAdminAddonVariantDto[];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) max_qty_per_order?: number;
  /** Cafe / POS merch flag */
  @IsOptional() @IsBoolean() for_cafe_only?: boolean;
  /** Show on: online website, offline POS, or both */
  @IsOptional() @IsIn(['online', 'offline', 'both']) visibility?: 'online' | 'offline' | 'both';
  /** Optional thumbnail (base64 data URL) */
  @IsOptional() @IsString() thumbnail_data_url?: string;
  @IsOptional() @IsString() @Length(1, 180) thumbnail_file_name?: string;
}

export class CreateAdminTaxDto {
  @IsString() @Length(2, 120) title!: string;
  @IsOptional() @IsString() @Length(0, 120) title_ar?: string;
  @IsIn(['percent', 'fixed']) rate_type!: 'percent' | 'fixed';
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) rate!: number;
  @IsIn(['net_price', 'net_price_with_addons']) applicable_on!: 'net_price' | 'net_price_with_addons';
  @IsIn(['exclusive', 'inclusive']) tax_type!: 'exclusive' | 'inclusive';
}

export class RegistrationFormFieldDto {
  @IsString() @Length(1, 80) field_key!: string;
  @IsString() @Length(1, 160) label!: string;
  @IsOptional() @IsString() @Length(0, 160) label_ar?: string;
  @IsIn(['text', 'email', 'phone', 'select', 'checkbox', 'file', 'textarea', 'number', 'date'])
  field_type!:
    | 'text'
    | 'email'
    | 'phone'
    | 'select'
    | 'checkbox'
    | 'file'
    | 'textarea'
    | 'number'
    | 'date';
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) options_ar?: string[];
}

export class UpsertAdminRegistrationFormDto {
  @IsOptional() @IsIn(['draft', 'review', 'published', 'archived'])
  status?: 'draft' | 'review' | 'published' | 'archived';
  @IsArray() @ValidateNested({ each: true }) @Type(() => RegistrationFormFieldDto) fields!: RegistrationFormFieldDto[];
}
