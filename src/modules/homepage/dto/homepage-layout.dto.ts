export interface HomepageHeroBannerDto {
  id: string;
  title: string;
  description: string;
  media_type: 'video' | 'image';
  media_url: string;
  mobile_media_url?: string;
  fallback_image_url: string;
  cta_link: string;
  slug?: string;
  event_type?: 'registration_only' | 'summer_camp' | 'general';
  is_registration_only?: boolean;
  booking_mode?: 'ticketed' | 'registration';
  tags?: string[];
}

export interface HomepageCategoryDto {
  id: string;
  slug: string;
  name: string;
  icon_url: string;
}

export interface HomepageHeroAndCategoryDto {
  hero_banners: HomepageHeroBannerDto[];
  categories: HomepageCategoryDto[];
}

export interface HomepageHeroAndCategoryApiResponseDto {
  success: true;
  data: HomepageHeroAndCategoryDto;
}

export interface HomepageEventCardDto {
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

/** Venue card shape inside unified `/homepage/sections` (uses `image_url`, not `image`). */
export interface HomepageSectionVenueItemDto {
  id: string;
  name: string;
  image_url: string;
  location: string;
  slug: string;
}

export interface HomepageSectionDto {
  section_id: string;
  section_title: string;
  view_all_link: string;
  items: Array<HomepageEventCardDto | HomepageSectionVenueItemDto>;
}

export interface HomepageSectionsDto {
  sections: HomepageSectionDto[];
}

export interface HomepageSectionsApiResponseDto {
  success: true;
  data: HomepageSectionsDto;
}

export interface HomepageVenueDto {
  id: string;
  slug?: string;
  name: string;
  location?: string;
  image?: string;
}

export interface HomepageVenuesApiResponseDto {
  success: true;
  data: HomepageVenueDto[];
}

export interface HomepagePromotionDto {
  id: string;
  title: string;
  subtitle: string;
  image_url: string;
  cta_url: string;
}

export interface HomepageBlogPostDto {
  id: string;
  title: string;
  published_date: string;
  thumbnail_url: string;
  author: string;
  slug: string;
}

export interface HomepageFaqDto {
  id: string;
  question: string;
  answer: string;
}

export interface HomepageFeedsDto {
  promotions: HomepagePromotionDto[];
  blog_posts: HomepageBlogPostDto[];
  faqs: HomepageFaqDto[];
}

export interface HomepageFeedsApiResponseDto {
  success: true;
  data: HomepageFeedsDto;
}

export interface HomepageFooterImageLinkDto {
  type: string;
  image_url: string;
  url?: string;
}

export interface HomepageFooterNavigationSectionDto {
  id: string;
  title: string;
  description: string;
  links: Array<{
    id: string;
    title: string;
    url: string;
    target: string;
  }>;
}

export interface HomepageFooterDto {
  navigation: HomepageFooterNavigationSectionDto[];
  why_book: {
    title: string;
    items: Array<{
      title: string;
      description: string;
      icon_url: string;
    }>;
  };
  payment_methods: {
    title: string;
    items: HomepageFooterImageLinkDto[];
  };
  brand: {
    logo_url: string;
    logo_link: string;
    tagline: string;
  };
  contact: {
    queries_heading: string;
    contact_heading: string;
    phone: string;
    email: string;
    address: string;
    hotline: {
      label: string;
      phone: string;
      hours: string;
    };
    whatsapp: {
      url: string;
      number: string;
      image_url: string;
    };
    chat_online_enabled: boolean;
    chat_online_label: string;
  };
  we_accept: {
    title: string;
    items: HomepageFooterImageLinkDto[];
  };
  app_downloads: {
    title: string;
    items: HomepageFooterImageLinkDto[];
  };
  social: Array<{
    platform: string;
    url: string;
    icon: string;
  }>;
  support_center: {
    text: string;
    button: string;
    url: string;
  };
}

export interface HomepageFooterApiResponseDto {
  success: true;
  data: HomepageFooterDto;
}

export interface HomepageQuickBookCategoryDto {
  name: string;
  slug: string;
  has_any_event: boolean;
}

export interface HomepageQuickBookEventDto {
  id: number;
  title: string;
  slug: string;
  event_slug: string;
  category_slug: string;
  genre: string[];
  tags: string[];
  poster: string;
  location: string;
}

export interface HomepageQuickBookDto {
  AllcategoryList: HomepageQuickBookCategoryDto[];
  AllcategoryEventsMovies: HomepageQuickBookEventDto[];
}

export interface HomepageQuickBookApiResponseDto {
  success: true;
  data: HomepageQuickBookDto;
}

export interface OfferScopedEventDto {
  id: string;
  slug: string;
  name: string;
  image: string;
}

export interface OfferDetailDto {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  image: string;
  banner: string;
  category: string;
  isFeatured: boolean;
  tags: string[];
  tag: string;
  validTill: string;
  events: OfferScopedEventDto[];
}

export interface OfferDetailApiResponseDto {
  success: true;
  data: OfferDetailDto;
}
