export type BookingMode = 'ticketed' | 'registration';

export interface EventLocationDto {
  venue_name: string;
  city: string;
  display_address: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface EventRatingSummaryDto {
  average_rating: number;
  total_reviews: number;
}

export interface EventFaqDto {
  id: string;
  question: string;
  answer: string;
}

export interface EventTermAndConditionDto {
  title: string;
  rule: string;
}

export interface EventPaymentMethodDto {
  id: number;
  name: string;
}

export interface EventDetailDto {
  id: string;
  event_id: string;
  slug: string;
  title: string;
  short_description: string;
  description: string;
  banner_image_url: string;
  ticket_selection_image_url: string;
  starting_price: number;
  currency: string;
  event_type: 'experience' | 'event' | 'camp';
  is_registration_only: boolean;
  booking_mode: BookingMode;
  gallery_images: string[];
  location: EventLocationDto;
  rating_summary: EventRatingSummaryDto;
  inclusions: string[];
  exclusions: string[];
  terms_and_conditions: EventTermAndConditionDto[];
  faqs: EventFaqDto[];
  is_favourite: boolean;
  requires_password?: boolean;
  /** Enabled customer payment methods from admin Payment settings. */
  payment_methods: EventPaymentMethodDto[];
}

export interface EventDetailApiResponseDto {
  success: true;
  data: EventDetailDto;
}
