import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class BookTicketCustomizationOptionDto {
  @IsString()
  id!: string;

  @Type(() => Number)
  @IsNumber()
  qty!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unit_price?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsString()
  name?: string;
}

export class BookTicketLineItemDto {
  @IsString()
  ticket_id!: string;

  @IsOptional()
  @Allow()
  variant_id?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  /** One RFID per purchased ticket unit for events configured with Open RFIDs. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  rfids?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unit_price?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTicketCustomizationOptionDto)
  customization_options?: BookTicketCustomizationOptionDto[];
}

export class BookAddonLineItemDto {
  @IsString()
  addon_id!: string;

  @IsOptional()
  @Allow()
  variant_id?: string | null;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unit_price?: number;
}

/** Event more-ops time extension packs (POS). */
export class BookTimeExtensionLineItemDto {
  @IsString()
  id!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  /** Ticket external key receiving a ticket-scoped extension. Omit for order scope. */
  @IsOptional()
  @Allow()
  ticket_id?: string | null;

  /** Exact ticket wristband receiving a ticket-scoped extension on Open RFID events. */
  @IsOptional()
  @Allow()
  rfid?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  unit_price?: number;
}

export class CheckoutCustomerDto {
  /** Ignored on guest checkout. Authenticated bookings use the JWT subject. */
  @IsOptional()
  @Allow()
  user_id?: string | number | null;

  @IsOptional()
  @Allow()
  name?: string | null;

  @IsOptional()
  @Allow()
  email?: string | null;

  @IsOptional()
  @Allow()
  phone?: string | null;
}

export class CheckoutWaiverDto {
  @IsOptional()
  @Allow()
  accepted?: boolean;

  @IsOptional()
  @Allow()
  signed_by?: string | null;

  @IsOptional()
  @Allow()
  accepted_at?: string | null;
}

export class CheckoutAgreementsDto {
  @IsOptional()
  @Allow()
  termsAccepted?: boolean;
}

export class CheckoutTotalsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  discount_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  total?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class CheckoutPromoCodeDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @Allow()
  ticket_id?: string | null;

  @IsOptional()
  @Allow()
  variant_id?: string | null;
}

export class CheckoutScheduleDto {
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  time?: string;
}

export class CheckoutMetadataDto {
  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  locale?: string;
}

export type OfflinePaymentMode = 'cash' | 'card' | 'split' | 'advance' | 'comp';

export class OfflinePaymentDto {
  @IsIn(['cash', 'card', 'split', 'advance', 'comp'])
  mode!: OfflinePaymentMode;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  split_cash_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  split_card_amount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  advance_amount?: number;

  @IsOptional()
  @IsIn(['cash', 'card'])
  advance_type?: 'cash' | 'card';

  /** Preferred POS agent user id → Order.bookedByAgentId / OrderItem.bookedByAgentId */
  @IsOptional()
  @IsString()
  agent_id?: string;

  @IsOptional()
  @IsString()
  booked_by_agent_id?: string;

  /** @deprecated use agent_id */
  @IsOptional()
  @IsString()
  sold_by_user_id?: string;
}

export class PaymentDetailPayloadDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Allow()
  providerResponse?: {
    invoiceId?: string;
    paymentId?: string;
    sessionId?: string;
  };
}

/**
 * Nested cart blob sent by older clients. Allowed as-is so extra keys do not
 * 400 the request; settlement still ignores client paid flags.
 */
export class OrderDetailPayloadDto {
  @IsOptional()
  @IsString()
  eventSlug?: string;

  @IsOptional()
  @Allow()
  customer?: {
    id?: number | string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };

  @IsOptional()
  @Allow()
  schedule?: {
    bookingDate?: {
      start_date?: string;
      end_date?: string;
    };
    timingSlot?: string | null;
  };

  @IsOptional()
  @Allow()
  tickets?: BookTicketLineItemDto[];

  @IsOptional()
  @Allow()
  addons?: BookAddonLineItemDto[];

  @IsOptional()
  @Allow()
  promocode?: CheckoutPromoCodeDto | null;

  @IsOptional()
  @Allow()
  totals?: CheckoutTotalsDto;

  @IsOptional()
  @Allow()
  waiver?: CheckoutWaiverDto;

  @IsOptional()
  @Allow()
  agreements?: CheckoutAgreementsDto;

  @IsOptional()
  @Allow()
  eventTaxes?: Array<{ id?: number; selected?: boolean }>;

  @IsOptional()
  @Allow()
  metadata?: CheckoutMetadataDto;
}

export class BookTicketRequestDto {
  /** Optional for POS JWT — filled from the agent's assigned event. */
  @IsOptional()
  @IsString()
  event_slug?: string;

  /**
   * Optional for POS (`offline_payment` / source=pos): omit to auto-pick today's
   * current or next active session (Asia/Qatar). Online checkout must still send both.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutScheduleDto)
  schedule?: CheckoutScheduleDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTicketLineItemDto)
  tickets?: BookTicketLineItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookAddonLineItemDto)
  addons?: BookAddonLineItemDto[];

  /** POS more-ops time extension packs. Order-scoped packs apply to every regular ticket. */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookTimeExtensionLineItemDto)
  time_extensions?: BookTimeExtensionLineItemDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutPromoCodeDto)
  promo_code?: CheckoutPromoCodeDto | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  payment_method?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutTotalsDto)
  totals?: CheckoutTotalsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutWaiverDto)
  waiver?: CheckoutWaiverDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutCustomerDto)
  customer?: CheckoutCustomerDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CheckoutMetadataDto)
  metadata?: CheckoutMetadataDto;

  /**
   * POS / offline tender. Ignored on the public customer checkout path.
   * Still accepted here so extra-field 400s do not leak the control change.
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => OfflinePaymentDto)
  offline_payment?: OfflinePaymentDto;

  @IsOptional()
  @IsString()
  success_url?: string;

  @IsOptional()
  @IsString()
  failed_url?: string;

  @IsOptional()
  @IsString()
  base_domain?: string;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  /** Optional hold secret for idempotency replay (guest checkout ownership). */
  @IsOptional()
  @IsString()
  release_token?: string;

  /**
   * Nested cart blob from checkout. Extra keys (agreements, eventTaxes, …)
   * must not 400 — settlement still ignores client paid flags.
   */
  @IsOptional()
  @Allow()
  orderDetailPayload?: OrderDetailPayloadDto;

  @IsOptional()
  @Allow()
  eventTaxes?: Array<{ id?: number; selected?: boolean }>;

  /** Client payment status is never treated as settlement (see CheckoutService). */
  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDetailPayloadDto)
  paymentDetailPayload?: PaymentDetailPayloadDto;
}

export class PosBookTicketRequestDto extends BookTicketRequestDto {
  /**
   * Ignored for POS JWT — the logged-in agent is always the seller.
   * Rejected when it does not match the authenticated agent.
   */
  @IsOptional()
  @IsString()
  agent_id?: string;
}

export class ReleaseHoldDto {
  @IsOptional()
  @IsString()
  release_token?: string;
}

export class ConfirmPaymentDto {
  @IsOptional()
  @IsString()
  common_order?: string;

  @IsOptional()
  @IsString()
  idempotency_key?: string;

  @IsOptional()
  @IsString()
  provider?: string;

  /** Ignored — settlement amount always comes from the order row. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  amount?: number;

  /** Ignored — settlement currency always comes from the order row. */
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @Allow()
  providerResponse?: {
    invoiceId?: string;
    paymentId?: string;
    sessionId?: string;
    resultIndicator?: string;
    gateway?: string;
  };
}
