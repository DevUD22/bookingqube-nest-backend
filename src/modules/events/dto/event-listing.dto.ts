export interface EventListingCardDto {
  id: string;
  slug: string;
  title: string;
  date: string;
  location: string;
  image: string;
  price: string;
  category: string;
  category_id?: string | null;
  category_slug?: string;
  tags: string[];
  status: string;
  status_label: string;
  event_type?: 'registration_only' | 'summer_camp' | 'general';
  currentEventDate: string;
  rating_summary?: {
    average_rating: number;
    total_reviews: number;
  };
  is_favourite?: boolean;
}

export interface EventListingDto {
  AllEvents: EventListingCardDto[];
  featuredEvents: EventListingCardDto[];
}

export interface EventListingApiResponseDto {
  success: true;
  data: EventListingDto;
}

export interface EventSearchDto {
  query: string;
  events: EventListingCardDto[];
}

export interface EventSearchApiResponseDto {
  success: true;
  data: EventSearchDto;
  items: EventListingCardDto[];
  total: number;
}
