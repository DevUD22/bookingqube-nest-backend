import {
  ArrayUnique,
  Allow,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MYFATOORAH_EMBEDDED_METHODS = [
  'google_pay',
  'apple_pay',
  'myfatoorah_card',
] as const;

export type MyFatoorahEmbeddedMethod = (typeof MYFATOORAH_EMBEDDED_METHODS)[number];

export class InitiateEmbeddedSessionsDto {
  @ValidateIf((o: InitiateEmbeddedSessionsDto) => !o.idempotency_key)
  @IsString()
  temp_order_id?: string;

  @ValidateIf((o: InitiateEmbeddedSessionsDto) => !o.temp_order_id)
  @IsString()
  idempotency_key?: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn([...MYFATOORAH_EMBEDDED_METHODS], { each: true })
  embedded_methods?: MyFatoorahEmbeddedMethod[];

  /** Cart draft so payment recovery can rebuild if book-ticket never runs. */
  @IsOptional()
  @Allow()
  checkout_snapshot?: Record<string, unknown>;
}

export class ConfirmMyFatoorahPaymentDto {
  @ValidateIf((o: ConfirmMyFatoorahPaymentDto) => !o.sessionId)
  @IsString()
  session_id?: string;

  @ValidateIf((o: ConfirmMyFatoorahPaymentDto) => !o.session_id)
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  payment_data?: string;

  @IsOptional()
  @IsString()
  paymentData?: string;

  @IsOptional()
  @IsString()
  payment_id?: string;

  @IsOptional()
  @IsString()
  paymentId?: string;
}
