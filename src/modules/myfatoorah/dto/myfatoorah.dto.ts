import { IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateMyFatoorahSessionDto {
  @IsOptional()
  @IsIn(['sandbox', 'live'])
  environment?: 'sandbox' | 'live';

  @Type(() => Number)
  @IsNumber()
  @Min(0.001)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsString()
  external_identifier?: string;

  @IsOptional()
  @IsString()
  customer_name?: string;

  @IsOptional()
  @IsString()
  customer_email?: string;
}

export class MyFatoorahPaymentStatusDto {
  @IsOptional()
  @IsIn(['sandbox', 'live'])
  environment?: 'sandbox' | 'live';

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsString()
  payment_id?: string;

  @IsOptional()
  @IsString()
  invoice_id?: string;

  @IsOptional()
  @IsString()
  payment_data?: string;

  /** Alias used by some callers */
  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  paymentData?: string;
}
