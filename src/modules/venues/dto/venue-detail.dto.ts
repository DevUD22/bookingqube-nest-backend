import { EventListingCardDto } from '../../events/dto/event-listing.dto';

export interface VenueLocationDto {
  venue: string;
  address: string;
  city: string;
  state: string;
  country: string;
  zipcode: string;
  latitude: string;
  longitude: string;
  googleMapUrl: string;
}

export interface VenueStatsDto {
  upcomingEventsCount: number;
  pastEventsCount: number;
  liveEventsCount: number;
}

export interface VenuePrimaryEventDetailDto {
  id: string;
  slug: string;
  title: string;
  date: string;
  location: string;
  image: string;
  price: string;
  priceFrom: number;
  currency: string;
  category: string;
  tags: string[];
  status: string;
  status_label: string;
  openingHours?: string;
  excerpt?: string;
  description?: string;
}

export interface VenueDetailDto {
  id: string;
  name: string;
  slug: string;
  image: string;
  banner: string;
  gallery: string[];
  about: string;
  aboutLines: string[];
  location: VenueLocationDto;
  upcomingEventIds: string[];
  upcomingEvents: EventListingCardDto[];
  pastEvents: EventListingCardDto[];
  primaryEventSlug: string | null;
  primaryEventDetail: VenuePrimaryEventDetailDto | null;
  stats: VenueStatsDto;
}

export interface VenueDetailApiResponseDto {
  success: true;
  data: VenueDetailDto;
}
