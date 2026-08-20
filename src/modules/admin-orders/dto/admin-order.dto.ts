import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'cancelled',
  'expired',
  'refunded',
  'partially_refunded',
] as const;

const PAYMENT_STATUSES = [
  'not_required',
  'pending',
  'paid',
  'failed',
  'refunded',
  'partially_refunded',
] as const;

export class AdminOrderListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...ORDER_STATUSES])
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @IsIn([...PAYMENT_STATUSES])
  payment_status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  event_id?: string;

  @IsOptional()
  @IsUUID()
  organization_id?: string;

  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsIn(['en', 'ar'])
  lang = 'en';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  per_page = 20;
}

export class UpdateAdminOrderDto {
  @IsOptional()
  @IsIn([...ORDER_STATUSES])
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(16)
  locale?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  customer_name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(40)
  customer_phone?: string | null;

  @IsOptional()
  @IsBoolean()
  waiver_accepted?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsString()
  @MaxLength(120)
  waiver_signed_by?: string | null;
}
