import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  HomepageBlogPostDto,
  HomepageCategoryDto,
  HomepageEventCardDto,
  HomepageFeedsDto,
  HomepageFooterDto,
  HomepageHeroAndCategoryDto,
  HomepageHeroBannerDto,
  HomepagePromotionDto,
  HomepageQuickBookDto,
  HomepageQuickBookEventDto,
  HomepageSectionDto,
  HomepageSectionVenueItemDto,
  HomepageSectionsDto,
  HomepageVenueDto,
  OfferDetailDto,
  OfferScopedEventDto,
} from './dto/homepage-layout.dto';

const defaultImageUrl = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const homepageEventInclude = {
  translations: true,
  reviews: { where: { status: 'published' }, select: { rating: true } },
  venue: {
    include: {
      translations: true,
    },
  },
  category: {
    include: {
      translations: true,
    },
  },
  primaryMedia: true,
  media: {
    include: {
      mediaAsset: true,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
  dates: {
    where: {
      status: 'active',
    },
    include: {
      sessions: {
        include: {
          inventoryItems: true,
        },
        orderBy: {
          startsAt: 'asc',
        },
      },
    },
    orderBy: {
      date: 'asc',
    },
  },
  ticketTypes: {
    where: {
      status: 'active',
      hideFromOnline: false,
    },
    include: {
      variants: {
        where: {
          status: 'active',
        },
      },
      thirdPartyVendor: true,
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.EventInclude;

type HomepageEventRecord = Prisma.EventGetPayload<{
  include: typeof homepageEventInclude;
}>;

const homepageCategoryInclude = {
  translations: true,
  events: {
    where: {
      status: 'published',
      visibility: 'public',
    },
    include: {
      primaryMedia: true,
      media: {
        include: {
          mediaAsset: true,
        },
        orderBy: {
          sortOrder: 'asc',
        },
        take: 1,
      },
    },
    orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.EventCategoryInclude;

type HomepageCategoryRecord = Prisma.EventCategoryGetPayload<{
  include: typeof homepageCategoryInclude;
}>;

const homepageVenueInclude = {
  translations: true,
  heroMedia: true,
  events: {
    where: {
      status: 'published',
      visibility: 'public',
    },
    include: {
      primaryMedia: true,
      media: {
        include: {
          mediaAsset: true,
        },
        orderBy: {
          sortOrder: 'asc',
        },
        take: 1,
      },
    },
    orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
    take: 1,
  },
} satisfies Prisma.VenueInclude;

type HomepageVenueRecord = Prisma.VenueGetPayload<{
  include: typeof homepageVenueInclude;
}>;

const homepageBlogInclude = {
  author: true,
  heroMedia: true,
  translations: true,
} satisfies Prisma.BlogInclude;

type HomepageBlogRecord = Prisma.BlogGetPayload<{
  include: typeof homepageBlogInclude;
}>;

const homepageOfferInclude = {
  heroMedia: true,
  translations: true,
  events: {
    include: {
      event: {
        include: homepageEventInclude,
      },
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.OfferInclude;

type HomepageOfferRecord = Prisma.OfferGetPayload<{
  include: typeof homepageOfferInclude;
}>;

@Injectable()
export class HomepageService {
  constructor(private readonly prisma: PrismaService) {}

  async getHeroAndCategorySection(lang: string): Promise<HomepageHeroAndCategoryDto> {
    const locale = this.normalizeLocale(lang);
    const [events, categories] = await Promise.all([
      this.prisma.event.findMany({
        where: {
          status: 'published',
          visibility: 'public',
        },
        include: homepageEventInclude,
        // Featured events first for homepage hero carousel.
        orderBy: [
          { isFeatured: 'desc' },
          { startsAt: 'asc' },
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        take: 5,
      }),
      this.prisma.eventCategory.findMany({
        where: {
          status: 'active',
        },
        include: homepageCategoryInclude,
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    ]);

    return {
      hero_banners: events.map((event) => this.toHeroBannerDto(event, locale)),
      categories: categories.map((category) => this.toCategoryDto(category, locale)),
    };
  }

  async getSections(lang: string): Promise<HomepageSectionsDto> {
    const locale = this.normalizeLocale(lang);
    const { startOfToday, endOfToday, todayDate } = this.getTodayBounds();

    const [featuredEvents, eventsToday, categoryEvents, categories, venues, reviewSettings] =
      await Promise.all([
        this.prisma.event.findMany({
          where: {
            status: 'published',
            visibility: 'public',
            isFeatured: true,
          },
          include: homepageEventInclude,
          orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
          take: 12,
        }),
        this.prisma.event.findMany({
          where: {
            status: 'published',
            visibility: 'public',
            OR: [
              {
                AND: [
                  { startsAt: { lte: endOfToday } },
                  { OR: [{ endsAt: null }, { endsAt: { gte: startOfToday } }] },
                ],
              },
              {
                dates: {
                  some: {
                    status: 'active',
                    date: todayDate,
                  },
                },
              },
            ],
          },
          include: homepageEventInclude,
          orderBy: [{ isFeatured: 'desc' }, { startsAt: 'asc' }, { publishedAt: 'desc' }],
          take: 12,
        }),
        this.prisma.event.findMany({
          where: {
            status: 'published',
            visibility: 'public',
          },
          include: homepageEventInclude,
          orderBy: [{ isFeatured: 'desc' }, { updatedAt: 'desc' }, { startsAt: 'asc' }],
          take: 200,
        }),
        this.prisma.eventCategory.findMany({
          where: {
            status: 'active',
          },
          include: {
            translations: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        }),
        this.prisma.venue.findMany({
          where: {
            status: 'published',
          },
          include: homepageVenueInclude,
          orderBy: [{ publishedAt: 'desc' }, { name: 'asc' }],
          take: 24,
        }),
        this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
      ]);

    const showReviewsOnCards = reviewSettings.showOnHomepageCards;
    const sections: HomepageSectionDto[] = [];

    // Top Events = published public events marked is_featured in admin.
    if (featuredEvents.length > 0) {
      sections.push({
        section_id: 'top-events',
        section_title: locale === 'ar' ? 'أفضل الفعاليات' : 'Top Events',
        view_all_link: '/events?sort=top',
        items: featuredEvents.map((event) => this.toEventCardDto(event, locale, showReviewsOnCards)),
      });
    }

    const venueItems = venues.map((venue) => this.toSectionVenueItemDto(venue, locale));
    if (venueItems.length > 0) {
      sections.push({
        section_id: 'venues',
        section_title: locale === 'ar' ? 'الأماكن' : 'Venues',
        view_all_link: '/venues',
        items: venueItems,
      });
    }

    if (eventsToday.length > 0) {
      sections.push({
        section_id: 'events-today',
        section_title: locale === 'ar' ? 'فعاليات اليوم' : 'Events Today',
        view_all_link: '/event-listing-by-slug/events_today',
        items: eventsToday.map((event) => this.toEventCardDto(event, locale, showReviewsOnCards)),
      });
    }

    for (const category of categories) {
      const categoryCards = categoryEvents
        .filter((event) => event.categoryId === category.id)
        .slice(0, 12)
        .map((event) => this.toEventCardDto(event, locale, showReviewsOnCards));
      if (categoryCards.length === 0) {
        continue;
      }

      const translation = this.pickTranslation(category.translations, locale);
      sections.push({
        section_id: `category-${category.slug}`,
        section_title: translation?.name ?? category.name,
        view_all_link: `/event-listing-by-slug/${encodeURIComponent(category.slug)}`,
        items: categoryCards,
      });
    }

    return { sections };
  }

  async getVenuesSection(lang: string): Promise<HomepageVenueDto[]> {
    const locale = this.normalizeLocale(lang);
    const venues = await this.prisma.venue.findMany({
      where: {
        status: 'published',
      },
      include: homepageVenueInclude,
      orderBy: [{ publishedAt: 'desc' }, { name: 'asc' }],
    });

    return venues.map((venue) => this.toVenueDto(venue, locale));
  }

  async getFeeds(lang: string): Promise<HomepageFeedsDto> {
    const locale = this.normalizeLocale(lang);
    const [blogs, offers, faqs] = await Promise.all([
      this.prisma.blog.findMany({
        where: {
          status: 'published',
          showOnHomepage: true,
        },
        include: homepageBlogInclude,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      this.prisma.offer.findMany({
        where: {
          status: 'published',
          showOnHomepage: true,
        },
        include: homepageOfferInclude,
        orderBy: [{ sortOrder: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        take: 8,
      }),
      this.prisma.homepageFaq.findMany({
        where: {
          locale,
          status: 'published',
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    return {
      promotions: offers.map((offer) => this.toPromotionDto(offer, locale)),
      blog_posts: blogs.map((blog) => this.toBlogPostDto(blog, locale)),
      faqs:
        faqs.length > 0
          ? faqs.map((faq) => ({
              id: faq.id,
              question: faq.question,
              answer: faq.answer,
            }))
          : this.getFallbackFaqs(locale),
    };
  }

  async getQuickBookSection(lang: string): Promise<HomepageQuickBookDto> {
    const locale = this.normalizeLocale(lang);
    const [categories, events] = await Promise.all([
      this.prisma.eventCategory.findMany({
        where: {
          status: 'active',
        },
        include: {
          translations: true,
        },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.findPublishedHomepageEvents(),
    ]);

    const eventCountsByCategory = new Map<string, number>();
    for (const event of events) {
      if (!event.category?.slug) {
        continue;
      }
      eventCountsByCategory.set(
        event.category.slug,
        (eventCountsByCategory.get(event.category.slug) ?? 0) + 1,
      );
    }

    return {
      AllcategoryList: categories.map((category) => {
        const translation = this.pickTranslation(category.translations, locale);

        return {
          name: translation?.name ?? category.name,
          slug: category.slug,
          has_any_event: (eventCountsByCategory.get(category.slug) ?? 0) > 0,
        };
      }),
      AllcategoryEventsMovies: events.map((event) => this.toQuickBookEventDto(event, locale)),
    };
  }

  async getFooter(lang: string): Promise<HomepageFooterDto> {
    const locale = this.normalizeLocale(lang);
    const [content, menuSections] = await Promise.all([
      this.prisma.footerContent.findFirst({
        where: {
          locale,
          status: 'published',
        },
      }),
      this.prisma.footerMenuItem.findMany({
        where: {
          parentId: null,
          status: 'published',
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        include: {
          children: {
            where: { status: 'published' },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          },
        },
      }),
    ]);

    const navigation = menuSections.map((section) => ({
      id: section.id,
      title:
        locale === 'ar'
          ? section.titleAr?.trim() || section.titleEn
          : section.titleEn.trim() || section.titleAr || '',
      description:
        locale === 'ar'
          ? section.descriptionAr?.trim() || section.descriptionEn?.trim() || ''
          : section.descriptionEn?.trim() || section.descriptionAr?.trim() || '',
      links: section.children.map((link) => ({
        id: link.id,
        title:
          locale === 'ar'
            ? link.titleAr?.trim() || link.titleEn
            : link.titleEn.trim() || link.titleAr || '',
        url: link.url?.trim() || (link.slug ? `/${link.slug}` : '#'),
        target: link.target || '_self',
      })),
    }));

    if (content && this.isFooterDto(content.contentJson)) {
      return {
        ...(content.contentJson as unknown as Omit<HomepageFooterDto, 'navigation'>),
        navigation,
      };
    }

    return {
      ...this.getFallbackFooter(locale),
      navigation,
    };
  }

  async getOfferDetail(slug: string, lang: string): Promise<OfferDetailDto> {
    const locale = this.normalizeLocale(lang);
    const offer = await this.prisma.offer.findFirst({
      where: {
        slug,
        status: 'published',
      },
      include: homepageOfferInclude,
    });

    if (!offer) {
      throw new NotFoundException('Offer not found');
    }

    return this.toOfferDetailDto(offer, locale);
  }

  private getFallbackFooter(locale: string): HomepageFooterDto {
    const assetBaseUrl =
      'https://bookingqube-staging-deb2ecbxcrd5cmbq.eastus-01.azurewebsites.net/images';

    return {
      navigation: [],
      why_book: {
        title: locale === 'ar' ? 'لماذا تحجز مع BookingQube؟' : 'Why book with BookingQube?',
        items:
          locale === 'ar'
            ? [
                {
                  title: 'دفع موثوق',
                  description: 'دفع سريع وآمن',
                  icon_url: `${assetBaseUrl}/trusted_icons.svg`,
                },
                {
                  title: 'تأكيد فوري',
                  description: 'ضمان حجز بدون تعقيد',
                  icon_url: `${assetBaseUrl}/immediate_confirmation.svg`,
                },
                {
                  title: 'بائع تذاكر موثوق',
                  description: 'منصة موثوقة للفعاليات',
                  icon_url: `${assetBaseUrl}/trusted_tickets.svg`,
                },
                {
                  title: 'دعم متاح عند الحاجة',
                  description: 'مساعدة مستمرة بعد الحجز',
                  icon_url: `${assetBaseUrl}/support.svg`,
                },
              ]
            : [
                {
                  title: 'Trusted Checkout',
                  description: 'Fast and trusted payment',
                  icon_url: `${assetBaseUrl}/trusted_icons.svg`,
                },
                {
                  title: 'Immediate confirmation',
                  description: 'Risk-free guarantee',
                  icon_url: `${assetBaseUrl}/immediate_confirmation.svg`,
                },
                {
                  title: 'Trusted Ticket Seller',
                  description: 'Trusted event ticketing',
                  icon_url: `${assetBaseUrl}/trusted_tickets.svg`,
                },
                {
                  title: 'Support at Your Fingertips',
                  description: 'Consistent after-sales help',
                  icon_url: `${assetBaseUrl}/support.svg`,
                },
              ],
      },
      payment_methods: {
        title: locale === 'ar' ? 'اختر طريقة الدفع' : 'Choose Your Way to Pay',
        items: [
          { type: 'visa', image_url: `${assetBaseUrl}/visa-logo.svg` },
          { type: 'mastercard', image_url: `${assetBaseUrl}/mastercard-logo.svg` },
          { type: 'amex', image_url: `${assetBaseUrl}/american-express.svg` },
        ],
      },
      brand: {
        logo_url: 'https://bookingqube.blob.core.windows.net/bqcontainer/static/eeeqa-logo.png',
        logo_link: 'https://eeeqa.com',
        tagline: locale === 'ar' ? 'احجز كل تجارب الترفيه' : 'Book Everything Entertainment',
      },
      contact: {
        queries_heading:
          locale === 'ar' ? 'لديك أسئلة؟ لدينا الإجابات' : "Got Queries? We've Got Answers!",
        contact_heading: locale === 'ar' ? 'تواصل معنا' : 'Please contact us',
        phone: '+974 5113 8418',
        email: 'info@bookingqube.com',
        address:
          locale === 'ar'
            ? 'Floor 36, Office 3602,\nPalm tower B, Majlis Al Taawon Street,\nWest Bay, P.O Box 38221, Doha'
            : 'Floor 36, Office 3602,\nPalm tower B, Majlis Al Taawon Street,\nWest Bay, P.O Box 38221, Doha',
        hotline: {
          label: locale === 'ar' ? 'خط معلومات التذاكر' : 'Ticket Info hotline',
          phone: '+974 5113 8418',
          hours: locale === 'ar' ? 'يوميا 09:00 AM - 12:00 PM' : 'Everyday 09:00 AM - 12:00 PM',
        },
        whatsapp: {
          url: 'https://wa.me/97451138418?text=Welcome%20to%20BookingQube%20Support%20Center%21%20How%20may%20we%20assist%20you%20today%3F',
          number: '97451138418',
          image_url: `${assetBaseUrl}/whatsapp-modern-round.svg`,
        },
        chat_online_enabled: false,
        chat_online_label: locale === 'ar' ? 'دردشة مباشرة' : 'Chat Online',
      },
      we_accept: {
        title: locale === 'ar' ? 'نقبل' : 'We accept',
        items: [
          { type: 'apple_pay', image_url: `${assetBaseUrl}/apple-pay.svg` },
          { type: 'google_pay', image_url: `${assetBaseUrl}/google-pay.png` },
          { type: 'visa', image_url: `${assetBaseUrl}/visa-logo.svg` },
          { type: 'mastercard', image_url: `${assetBaseUrl}/mastercard-logo.svg` },
        ],
      },
      app_downloads: {
        title: locale === 'ar' ? 'حمل التطبيق' : 'Download the app',
        items: [
          {
            type: 'google_play',
            url: 'https://play.google.com/store/apps/details?id=com.bookingqube.bookingqubeapp',
            image_url: `${assetBaseUrl}/google-play-black-en.svg`,
          },
          {
            type: 'app_store',
            url: 'https://apps.apple.com/qa/app/bookingqube/id6444101297',
            image_url: `${assetBaseUrl}/app-store-black-en.svg`,
          },
        ],
      },
      social: [
        {
          platform: 'facebook',
          url: 'https://www.facebook.com/bookingqube',
          icon: 'fab fa-facebook-f',
        },
        {
          platform: 'instagram',
          url: 'https://www.instagram.com/bookingqube/',
          icon: 'fab fa-instagram',
        },
        {
          platform: 'linkedin',
          url: 'https://www.linkedin.com/company/bookingqube/',
          icon: 'fab fa-linkedin',
        },
      ],
      support_center: {
        text: locale === 'ar' ? 'هل لديك أسئلة؟ زر' : 'Do you have any questions? Visit our',
        button: locale === 'ar' ? 'مركز الدعم' : 'Support center',
        url: '/pages/faqs',
      },
    };
  }

  private findPublishedHomepageEvents() {
    return this.prisma.event.findMany({
      where: {
        status: 'published',
        visibility: 'public',
      },
      include: homepageEventInclude,
      orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take: 24,
    });
  }

  private toHeroBannerDto(event: HomepageEventRecord, locale: string): HomepageHeroBannerDto {
    const translation = this.pickTranslation(event.translations, locale);
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const imageUrl = this.getEventImageUrl(event, 'homepage_banner');
    const mobileImageUrl = this.getEventImageUrlByRole(event, 'homepage_banner_mobile');
    const categoryName = categoryTranslation?.name ?? event.category?.name;
    const isRegistration = event.bookingMode === 'registration';

    return {
      id: event.id,
      title: translation?.title ?? event.slug,
      description: translation?.subtitle ?? translation?.description ?? '',
      media_type: 'image',
      media_url: imageUrl,
      mobile_media_url: mobileImageUrl ?? imageUrl,
      fallback_image_url: imageUrl,
      cta_link: isRegistration ? `/register/${event.slug}` : `/events/${event.slug}`,
      slug: event.slug,
      event_type: isRegistration ? 'registration_only' : 'general',
      is_registration_only: isRegistration,
      booking_mode: isRegistration ? 'registration' : 'ticketed',
      tags: categoryName ? [categoryName] : [],
    };
  }

  private toCategoryDto(category: HomepageCategoryRecord, locale: string): HomepageCategoryDto {
    const translation = this.pickTranslation(category.translations, locale);
    const firstEvent = category.events[0];

    return {
      id: category.id,
      slug: category.slug,
      name: translation?.name ?? category.name,
      icon_url: category.thumbnailUrl || (firstEvent ? this.getEventImageUrl(firstEvent) : defaultImageUrl),
    };
  }

  private toEventCardDto(event: HomepageEventRecord, locale: string, showReviews = false): HomepageEventCardDto {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';
    const status = this.getEventCardStatus(event);

    return {
      id: event.id,
      title: translation?.title ?? event.slug,
      image_url: this.getEventImageUrl(event),
      price_from: this.getStartingPrice(event),
      currency: event.currency,
      event_type: event.eventType,
      is_registration_only: event.bookingMode === 'registration',
      booking_mode: event.bookingMode,
      schedule_type: this.scheduleTypeForEvent(event, locale),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
      tags: [categoryName],
      slug: event.slug,
      is_favourite: false,
      status,
      status_label: this.statusLabelFor(status, locale),
      category: categoryName,
      category_id: event.categoryId,
      category_slug: event.category?.slug,
      rating_summary: {
        average_rating: showReviews && event.reviews.length ? event.reviews.reduce((sum, review) => sum + review.rating, 0) / event.reviews.length : 0,
        total_reviews: showReviews ? event.reviews.length : 0,
      },
    };
  }

  private toSectionVenueItemDto(
    venue: HomepageVenueRecord,
    locale: string,
  ): HomepageSectionVenueItemDto {
    const translation = this.pickTranslation(venue.translations, locale);
    const firstEvent = venue.events[0];

    return {
      id: venue.id,
      name: translation?.name ?? venue.name,
      image_url:
        venue.heroMedia?.url ?? (firstEvent ? this.getEventImageUrl(firstEvent) : defaultImageUrl),
      location: translation?.city ?? venue.city ?? translation?.address ?? venue.address ?? '',
      slug: venue.slug,
    };
  }

  private toVenueDto(venue: HomepageVenueRecord, locale: string): HomepageVenueDto {
    const translation = this.pickTranslation(venue.translations, locale);
    const firstEvent = venue.events[0];

    return {
      id: venue.id,
      slug: venue.slug,
      name: translation?.name ?? venue.name,
      location: translation?.address ?? venue.address ?? venue.city ?? 'Qatar',
      image:
        venue.heroMedia?.url ?? (firstEvent ? this.getEventImageUrl(firstEvent) : defaultImageUrl),
    };
  }

  private toBlogPostDto(blog: HomepageBlogRecord, locale: string): HomepageBlogPostDto {
    const translation = this.pickTranslation(blog.translations, locale);

    return {
      id: blog.id,
      slug: blog.slug,
      title: translation?.title ?? blog.slug,
      published_date: this.toDateKey(blog.publishedAt ?? blog.createdAt),
      thumbnail_url: blog.heroMedia?.url ?? defaultImageUrl,
      author: blog.authorName?.trim() || blog.author?.name || 'BookingQube',
    };
  }

  private toPromotionDto(offer: HomepageOfferRecord, locale: string): HomepagePromotionDto {
    const translation = this.pickTranslation(offer.translations, locale);

    return {
      id: offer.id,
      title: translation?.title ?? offer.slug,
      subtitle: translation?.subtitle ?? translation?.description ?? '',
      image_url: this.getOfferImageUrl(offer),
      cta_url: `/promos/${offer.slug}`,
    };
  }

  private toOfferDetailDto(offer: HomepageOfferRecord, locale: string): OfferDetailDto {
    const translation = this.pickTranslation(offer.translations, locale);
    const image = this.getOfferImageUrl(offer);
    const tags = this.toStringArray(translation?.tagsJson);
    const category = translation?.category ?? 'Offers';
    const tag = translation?.tag ?? tags[0] ?? category;
    const scopedEvents = offer.events
      .map((entry) => entry.event)
      .filter((event) => event.status === 'published' && event.visibility === 'public')
      .map((event) => this.toOfferScopedEventDto(event, locale));

    return {
      id: offer.id,
      slug: offer.slug,
      title: translation?.title ?? offer.slug,
      subtitle: translation?.subtitle ?? '',
      description: translation?.description ?? translation?.subtitle ?? '',
      seoTitle: translation?.metaTitle ?? translation?.title ?? offer.slug,
      seoDescription:
        translation?.metaDescription ?? translation?.description ?? translation?.subtitle ?? '',
      image,
      banner: image,
      category,
      isFeatured: offer.isFeatured,
      tags,
      tag,
      validTill: offer.validUntil ? this.toDateKey(offer.validUntil) : '',
      events: scopedEvents,
    };
  }

  private toOfferScopedEventDto(
    event: HomepageEventRecord,
    locale: string,
  ): OfferScopedEventDto {
    const translation = this.pickTranslation(event.translations, locale);

    return {
      id: event.id,
      slug: event.slug,
      name: translation?.title ?? event.slug,
      image: this.getEventImageUrl(event),
    };
  }

  private toQuickBookEventDto(
    event: HomepageEventRecord,
    locale: string,
  ): HomepageQuickBookEventDto {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';

    return {
      id: this.toNumericId(event.id),
      title: translation?.title ?? event.slug,
      slug: event.slug,
      event_slug: event.slug,
      category_slug: event.category?.slug ?? 'events',
      genre: [categoryName],
      tags: [categoryName],
      poster: this.getEventImageUrl(event),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
    };
  }

  /**
   * Lowest public ticket/variant price for homepage cards.
   * - Collect every ticket type + variant price
   * - Ignore null/zero prices
   * - If any price > 0 exists, return the minimum of those
   * - If every ticket/variant is 0 (or missing), return 0
   */
  private getStartingPrice(event: HomepageEventRecord) {
    const positivePrices: number[] = [];

    for (const ticketType of event.ticketTypes) {
      // Cafe / POS-only vendor tickets are not part of the public list price.
      if (ticketType.thirdPartyVendor?.isCafe) {
        continue;
      }

      const ticketPrice = this.toPositivePrice(ticketType.basePrice);
      if (ticketPrice !== null) {
        positivePrices.push(ticketPrice);
      }

      for (const variant of ticketType.variants) {
        const variantPrice = this.toPositivePrice(variant.basePrice);
        if (variantPrice !== null) {
          positivePrices.push(variantPrice);
        }
      }
    }

    if (positivePrices.length === 0) {
      return 0;
    }

    return Math.min(...positivePrices);
  }

  /** Parse Prisma Decimal / number / string; return value only when > 0. */
  private toPositivePrice(value: unknown): number | null {
    if (value == null) {
      return null;
    }

    let amount: number;
    if (typeof value === 'number') {
      amount = value;
    } else if (typeof value === 'string') {
      amount = Number(value);
    } else if (
      typeof value === 'object' &&
      'toNumber' in value &&
      typeof (value as { toNumber: () => number }).toNumber === 'function'
    ) {
      amount = (value as { toNumber: () => number }).toNumber();
    } else {
      amount = Number(value);
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      return null;
    }

    return Math.round(amount * 100) / 100;
  }

  /**
   * Marketing card badge — mirrors legacy EventStatusForV2 priority:
   * limited_slots → fast_selling → best_seller → new → normal.
   */
  private getEventCardStatus(event: HomepageEventRecord) {
    const stats = this.getEventSalesStats(event);

    if (stats.hasLimitedSlots) {
      return 'limited_slots';
    }

    if (stats.soldPercentage >= 60) {
      return 'fast_selling';
    }

    if (event.isFeatured) {
      return 'best_seller';
    }

    if (this.isNewEvent(event)) {
      return 'new';
    }

    return 'normal';
  }

  private statusLabelFor(statusKey: string, locale: string) {
    if (statusKey === '' || statusKey === 'normal') {
      return '';
    }

    const labels: Record<string, { en: string; ar: string }> = {
      limited_slots: { en: 'Limited Slots', ar: 'أماكن محدودة' },
      fast_selling: { en: 'Fast Selling', ar: 'بيع سريع' },
      best_seller: { en: 'Best Seller', ar: 'الأكثر مبيعاً' },
      new: { en: 'New', ar: 'جديد' },
    };

    const entry = labels[statusKey];
    if (!entry) {
      return locale === 'en'
        ? statusKey.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
        : '';
    }

    return locale === 'ar' ? entry.ar : entry.en;
  }

  private getEventSalesStats(event: HomepageEventRecord) {
    let capacity = 0;
    let booked = 0;
    let hasLimitedSlots = false;

    for (const eventDate of event.dates) {
      for (const session of eventDate.sessions) {
        if (session.status !== 'active') {
          continue;
        }

        for (const item of session.inventoryItems) {
          if (item.status !== 'active' || item.totalQuantity === null || item.totalQuantity <= 0) {
            continue;
          }

          const total = item.totalQuantity;
          const sold = item.soldQuantity;
          const remaining = Math.max(0, total - sold - item.heldQuantity);

          if (remaining > 0 && remaining <= 10) {
            hasLimitedSlots = true;
          }

          capacity += total;
          booked += Math.min(sold, total);
        }
      }
    }

    return {
      hasLimitedSlots,
      soldPercentage: capacity > 0 ? (booked / capacity) * 100 : 0,
    };
  }

  private isNewEvent(event: HomepageEventRecord) {
    const created = event.createdAt;
    if (!created) {
      return false;
    }

    const createdDay = new Date(created);
    createdDay.setHours(0, 0, 0, 0);
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - 7);

    return createdDay.getTime() >= cutoff.getTime();
  }

  private getEventImageUrlByRole(
    event: Pick<HomepageEventRecord, 'media'>,
    role: 'homepage_banner' | 'homepage_banner_mobile',
  ) {
    return event.media.find((item) => item.mediaRole === role)?.mediaAsset.url ?? null;
  }

  private getEventImageUrl(
    event: Pick<HomepageEventRecord, 'primaryMedia' | 'media'>,
    preferredRole?: 'homepage_banner',
  ) {
    return (
      (preferredRole ? this.getEventImageUrlByRole(event, preferredRole) : null) ??
      event.primaryMedia?.url ??
      event.media.find(
        (item) => item.mediaRole === 'event_poster' || item.mediaRole === 'thumbnail',
      )?.mediaAsset.url ??
      event.media[0]?.mediaAsset.url ??
      defaultImageUrl
    );
  }

  private getOfferImageUrl(offer: HomepageOfferRecord) {
    const firstEvent = offer.events[0]?.event;
    return offer.heroMedia?.url ?? (firstEvent ? this.getEventImageUrl(firstEvent) : defaultImageUrl);
  }

  private getFallbackFaqs(locale: string) {
    if (locale === 'ar') {
      return [
        {
          id: 'faq-booking',
          question: 'كيف أحجز فعالية؟',
          answer: 'اختر الفعالية والتاريخ والتذاكر، ثم أكمل خطوات الدفع أو التسجيل.',
        },
        {
          id: 'faq-tickets',
          question: 'أين أجد تذاكري؟',
          answer: 'بعد إتمام الحجز، يمكنك مراجعة التذاكر من صفحة تذاكري في حسابك.',
        },
        {
          id: 'faq-support',
          question: 'كيف أتواصل مع الدعم؟',
          answer: 'يمكنك التواصل مع فريق BookingQube من خلال بيانات التواصل في أسفل الصفحة.',
        },
      ];
    }

    return [
      {
        id: 'faq-booking',
        question: 'How do I book an event?',
        answer:
          'Choose an event, select your date and tickets, then complete payment or registration.',
      },
      {
        id: 'faq-tickets',
        question: 'Where can I find my tickets?',
        answer:
          'After checkout, you can review your tickets from the My Tickets page in your account.',
      },
      {
        id: 'faq-support',
        question: 'How do I contact support?',
        answer: 'You can reach BookingQube support through the contact details in the footer.',
      },
    ];
  }

  private scheduleTypeForEvent(event: HomepageEventRecord, locale: string) {
    const timing = this.readTimingMode(event.timingConfig);
    if (timing === 'preferred' || timing === 'daily') {
      return locale === 'ar' ? 'مفتوح يومياً' : 'Open Daily';
    }

    return locale === 'ar' ? 'جدول مخصص' : 'Custom schedule';
  }

  private readTimingMode(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const mode = (value as { mode?: unknown }).mode;
    return typeof mode === 'string' ? mode.toLowerCase() : null;
  }

  /**
   * Calendar day bounds in Asia/Qatar (BookingQube market timezone).
   */
  private getTodayBounds() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKey = formatter.format(new Date()); // YYYY-MM-DD
    const [year, month, day] = todayKey.split('-').map(Number);
    // Date-only value for EventDate @db.Date comparisons.
    const todayDate = new Date(Date.UTC(year, month - 1, day));
    // Inclusive window covering the Qatar calendar day in UTC storage.
    const startOfToday = new Date(`${todayKey}T00:00:00+03:00`);
    const endOfToday = new Date(`${todayKey}T23:59:59.999+03:00`);

    return { startOfToday, endOfToday, todayDate };
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private pickTranslation<T extends { locale: string }>(translations: T[], locale: string) {
    return (
      translations.find((translation) => translation.locale === locale) ??
      translations.find((translation) => translation.locale === 'en') ??
      translations[0] ??
      null
    );
  }

  private toStringArray(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
  }

  private isFooterDto(value: Prisma.JsonValue) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }

    const input = value as Partial<HomepageFooterDto>;

    return Boolean(
      input.why_book &&
        input.payment_methods &&
        input.brand &&
        input.contact &&
        input.we_accept &&
        input.app_downloads &&
        Array.isArray(input.social) &&
        input.support_center,
    );
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private toNumericId(id: string) {
    return Number.parseInt(id.replace(/-/g, '').slice(0, 8), 16);
  }
}
