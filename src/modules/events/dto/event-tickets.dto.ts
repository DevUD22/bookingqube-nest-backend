export interface CustomizationOptionDto {
  option_id: string;
  name: string;
  description?: string;
  price: number;
  currency: string;
  max_qty: number;
  has_duration?: boolean;
  duration_minutes?: number | null;
}

export interface TicketVariantDto {
  variant_id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  badge?: string | null;
  max_qty: number;
}

interface TicketBaseDto {
  ticket_id: string;
  title: string;
  subtitle: string;
  icon_type: string;
  admits?: number;
  inclusions?: string[];
  exclusions?: string[];
  is_customizable?: boolean;
  customization_options?: CustomizationOptionDto[];
}

export interface FlatTicketDto extends TicketBaseDto {
  has_variants: false;
  price: number;
  currency: string;
  badge: string | null;
  max_qty: number;
}

export interface TicketWithVariantsDto extends TicketBaseDto {
  has_variants: true;
  variants: TicketVariantDto[];
}

export type EventTicketDto = FlatTicketDto | TicketWithVariantsDto;

interface AddonBaseDto {
  addon_id: string;
  title: string;
  subtitle: string;
  icon_type: string;
  for_cafe_only?: boolean;
  thumbnail_url?: string | null;
  applicable_for?: string;
  visibility?: 'online' | 'offline' | 'both';
}

export interface FlatAddonDto extends AddonBaseDto {
  has_variants: false;
  price: number;
  currency: string;
  badge: string | null;
  max_qty: number;
}

export interface AddonWithVariantsDto extends AddonBaseDto {
  has_variants: true;
  variants: TicketVariantDto[];
}

export type EventAddonDto = FlatAddonDto | AddonWithVariantsDto;

export interface TicketsSelectedContextDto {
  date_display: string;
  time_display: string;
}

export interface EventLegalRequirementsDto {
  requires_waiver: boolean;
  body_content: string[];
}

export interface EventTicketsDto {
  is_registration_only?: boolean;
  booking_mode?: 'ticketed' | 'registration';
  selected_context: TicketsSelectedContextDto;
  tickets: EventTicketDto[];
  addons: EventAddonDto[];
  legal_requirements?: EventLegalRequirementsDto | null;
}

export interface EventTicketsApiResponseDto {
  success: true;
  data: EventTicketsDto;
}
