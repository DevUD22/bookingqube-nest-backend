import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CafePosLoginDto {
  /** Email or username of the cafe POS agent. */
  @IsString()
  @IsNotEmpty()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  /** Optional when the agent has multiple cafe assignments. */
  @IsOptional()
  @IsUUID()
  cafe_id?: string;
}

export class CafePosAgentQueryDto {
  /** Optional; when set must match the authenticated cafe POS agent. */
  @IsOptional()
  @IsUUID()
  agent_id?: string;
}

export class CafePosLineDto {
  @IsUUID() menu_item_id!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(99) quantity!: number;
}

export class BookCafeTableDto {
  @IsOptional() @IsUUID() agent_id?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) table_number!: number;
  @IsIn(['prepaid', 'postpaid']) payment_type!: 'prepaid' | 'postpaid';
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CafePosLineDto)
  items!: CafePosLineDto[];
  /** Optional order-level promocode (order_total or per-item from admin config). */
  @IsOptional() @IsString() @Length(1, 40) promo_code?: string;
  @IsOptional() @IsString() @Length(0, 160) customer_name?: string;
  @IsOptional() @IsEmail() customer_email?: string;
}

/** Preview / validate a cafe promocode against cart lines (does not settle). */
export class ApplyCafePromocodeDto {
  @IsString()
  @IsNotEmpty()
  @Length(1, 40)
  code!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CafePosLineDto)
  items!: CafePosLineDto[];

  /** When set, merge with the open table cart before calculating discount. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  table_number?: number;
}

export class ClearCafeTableDto {
  @IsOptional() @IsUUID() agent_id?: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) table_number!: number;
  @IsIn(['cash', 'card', 'split']) payment_mode!: 'cash' | 'card' | 'split';
  @IsOptional() @Type(() => Number) @Min(0) split_cash_amount?: number;
  @IsOptional() @Type(() => Number) @Min(0) split_card_amount?: number;
  @IsOptional() @IsString() @Length(0, 160) customer_name?: string;
  @IsOptional() @IsEmail() customer_email?: string;
}

/** Counter / walk-up sale: create lines and settle immediately (no open table cart). */
export class InstantCafeOrderDto {
  @IsOptional() @IsUUID() agent_id?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CafePosLineDto)
  items!: CafePosLineDto[];
  @IsIn(['cash', 'card', 'split']) payment_mode!: 'cash' | 'card' | 'split';
  @IsOptional() @Type(() => Number) @Min(0) split_cash_amount?: number;
  @IsOptional() @Type(() => Number) @Min(0) split_card_amount?: number;
  @IsOptional() @IsString() @Length(1, 40) promo_code?: string;
  /** Optional table tag; omit for counter/takeaway (stored as table 0). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  table_number?: number;
  @IsOptional() @IsUUID() customer_id?: string;
  @IsOptional() @IsString() @Length(0, 160) customer_name?: string;
  @IsOptional() @IsEmail() customer_email?: string;
  @IsOptional() @IsString() @Length(0, 32) customer_phone?: string;
}

export class CafeCustomerSearchQueryDto {
  @IsString()
  @MinLength(2)
  @Length(2, 120)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit = 10;
}

export class CreateCafePosCategoryDto {
  @IsString() @IsNotEmpty() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string;
  @IsOptional() is_kot?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
}

export class CreateCafePosSubcategoryDto {
  @IsUUID() category_id!: string;
  @IsString() @IsNotEmpty() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
}

export class CreateCafePosMenuItemDto {
  @IsUUID() category_id!: string;
  @IsOptional() @IsUUID() subcategory_id?: string;
  @IsString() @IsNotEmpty() @Length(1, 160) title_en!: string;
  @IsOptional() @IsString() @Length(0, 160) title_ar?: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) price!: number;
  @IsOptional() @IsString() @Length(0, 8) currency?: string;
  @IsOptional() is_kot?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) sort_order?: number;
}

export class CafePosReportDto {
  @IsString() @IsNotEmpty() date!: string;
  @IsOptional() @IsString() end_date?: string;
  @IsOptional() @IsUUID() category_id?: string;
  @IsOptional() @IsUUID() menu_item_id?: string;
}

export class CafePosDailyClosingQueryDto {
  @IsOptional() @IsString() closing_for_date?: string;
}

export class CreateCafePosDailyClosingDto {
  @IsString() @IsNotEmpty() closing_for_date!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  received_cash_amount!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  received_card_amount!: number;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

/** Aggregate sales reported by a cafe/external system rather than rung through BookingQube POS. */
export class SaveCafePosSalesEntryDto {
  @IsString() @IsNotEmpty() date!: string;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  cash_sales!: number;
  @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0)
  card_sales!: number;
  @Type(() => Number) @IsInt() @Min(0)
  total_transactions!: number;
  @IsOptional() @IsString() @Length(0, 2000) note?: string;
}

export class CafePosDailyClosingNoteDto {
  @IsString() @IsNotEmpty() @Length(1, 2000) note!: string;
}
