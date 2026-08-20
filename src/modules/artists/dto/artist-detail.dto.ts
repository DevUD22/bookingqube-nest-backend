export interface ArtistProfileDto {
  dateOfBirth: string | null;
  age: number | null;
  origin: string;
  heightCm: number | null;
  ethnicity: string;
  nationality: string;
  religion: string;
  occupation: string;
  instruments: string[];
  netWorth: number | null;
  netWorthCurrency: string;
  maritalStatus: string;
  spouseName: string;
  children: unknown[];
  parents: unknown[];
  profileUpdatedDate: string | null;
}

export interface ArtistSummaryDto {
  id: string;
  name: string;
  slug: string;
  image: string;
  genre: string;
  genres: string[];
}

export interface ArtistEventCardDto {
  id: string;
  title: string;
  image_url: string;
  price_from: number;
  currency: string;
  event_type?: 'registration_only' | 'summer_camp' | 'general';
  is_registration_only?: boolean;
  booking_mode?: 'ticketed' | 'registration';
  schedule_type: string;
  location: string;
  tags: string[];
  slug?: string;
  is_favourite?: boolean;
  status?: string;
  status_label?: string;
  category?: string;
  category_id?: string | null;
  category_slug?: string;
  rating_summary?: {
    average_rating: number;
    total_reviews: number;
  };
}

export interface ArtistDetailDto {
  id: string;
  name: string;
  slug: string;
  image: string;
  /** Wide hero banner for the artist detail page (optional). */
  banner: string | null;
  genre: string;
  genres: string[];
  tagline: string;
  about: string[];
  biography: string;
  profile: ArtistProfileDto;
  upcomingEventIds: string[];
  upcomingEvents: ArtistEventCardDto[];
  pastEvents: ArtistEventCardDto[];
  similarArtistIds: string[];
  similarArtists: ArtistSummaryDto[];
}

export interface ArtistDetailApiResponseDto {
  success: true;
  data: ArtistDetailDto;
}
