import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

const RECOVERY_STATUSES = ['open', 'resolved', 'abandoned'] as const;
const RECOVERY_REASONS = [
  'awaiting_confirm',
  'payment_ok_booking_failed',
  'inventory_unavailable',
  'confirm_never_called',
] as const;
const GATEWAYS = ['myfatoorah', 'mastercard', 'qpay'] as const;

export class AdminPaymentRecoveryListQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn([...RECOVERY_STATUSES])
  status?: (typeof RECOVERY_STATUSES)[number];

  @IsOptional()
  @IsIn([...RECOVERY_REASONS])
  reason?: (typeof RECOVERY_REASONS)[number];

  @IsOptional()
  @IsIn([...GATEWAYS])
  gateway?: (typeof GATEWAYS)[number];

  @IsOptional()
  @IsUUID()
  event_id?: string;

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
