import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/** Accept YYYY-MM-DD (date-only closing / settlement dates). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class DailyClosingListQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY)
  date?: string;

  @IsOptional()
  @IsUUID()
  agent_id?: string;

  @IsOptional()
  @IsUUID()
  event_id?: string;
}

export class DailyClosingExpectedQueryDto {
  @Matches(DATE_ONLY)
  date!: string;

  @IsOptional()
  @IsUUID()
  agent_id?: string;

  @IsOptional()
  @IsUUID()
  event_id?: string;
}

export class CreateDailyClosingDto {
  @Matches(DATE_ONLY)
  closing_for_date!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  received_cash_amount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  received_card_amount!: number;

  /** PNG/JPEG data URL from signature pad */
  @IsString()
  @Length(32, 2_000_000)
  signature_data_url!: string;

  @IsOptional()
  @IsUUID()
  agent_id?: string;

  /** Event this closing belongs to (required for multi-event POS). */
  @IsOptional()
  @IsUUID()
  event_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class UpdateDailyClosingDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  received_cash_amount!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  received_card_amount!: number;

  @IsOptional()
  @IsString()
  @Length(32, 2_000_000)
  signature_data_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}

export class AddDailyClosingNoteDto {
  @IsString()
  @Length(1, 2000)
  note!: string;
}

export class ApproveDailyClosingDto {
  @IsIn(['approved', 'rejected'])
  status!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reject_reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  /** Authorized signature data URL (generates signed PDF) */
  @IsOptional()
  @IsString()
  @Length(32, 2_000_000)
  authorized_signature_data_url?: string;
}

export class SettlementListQueryDto {
  @IsOptional()
  @Matches(DATE_ONLY)
  date?: string;
}

export class CreateSettlementDto {
  @Matches(DATE_ONLY)
  settlement_for_date!: string;

  @IsString()
  @Length(32, 2_000_000)
  signature_data_url!: string;

  @IsOptional()
  @IsIn(['generated', 'approved', 'rejected'])
  status?: 'generated' | 'approved' | 'rejected';
}
