export interface PromoSelectedTicketDto {
  ticket_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
}

export interface PromoApplyRequestDto {
  code?: string;
  event_slug?: string;
  selected_tickets?: PromoSelectedTicketDto[];
  /** POS compatibility alias; normalized by the POS checkout controller. */
  tickets?: PromoSelectedTicketDto[];
}

export interface PromoApplyResponseDto {
  valid: boolean;
  code: string;
  discount_type: 'ticket_specific' | 'total_order';
  summary_label: string;
  total_discount_text: string;
  total_discount_amount: number;
  currency: string;
  applied_breakdown: Array<{
    target_type: string;
    target_id: string;
    discount_applied_per_unit: number;
    total_item_discount: number;
  }>;
  message?: string;
}

export interface PromoApplyFailureDto {
  valid: false;
  code?: string;
  message: string;
}
