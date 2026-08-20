import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { CustomerPaymentMethodsService } from '../admin-payment-settings/customer-payment-methods.service';
import { EventDetailDto, EventFaqDto } from './dto/event-detail.dto';
import {
  EventListingCardDto,
  EventListingDto,
  EventSearchDto,
} from './dto/event-listing.dto';
import { EventScheduleDto, ScheduleDateDto, ScheduleTimeSlotDto } from './dto/event-schedule.dto';
import {
  EventAddonDto,
  EventTicketDto,
  EventTicketsDto,
  TicketVariantDto,
} from './dto/event-tickets.dto';
import {
  decodePrivateEventPasswordHeader,
  isPrivateEventAccessTokenValid,
  issuePrivateEventAccessToken,
  passwordsMatch,
} from './private-event-access';

const eventDetailInclude = {
  translations: true,
  reviews: { where: { status: 'published' }, select: { rating: true } },
  venue: {
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

type EventDetailRecord = Prisma.EventGetPayload<{
  include: typeof eventDetailInclude;
}>;

const eventListingInclude = {
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

type EventListingRecord = Prisma.EventGetPayload<{
  include: typeof eventListingInclude;
}>;

const scheduleInclude = {
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
} satisfies Prisma.EventInclude;

type EventScheduleRecord = Prisma.EventGetPayload<{
  include: typeof scheduleInclude;
}>;

interface ScheduleQuery {
  month?: string;
  page?: string;
}

const ticketsCatalogInclude = {
  translations: true,
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
        orderBy: {
          sortOrder: 'asc',
        },
      },
      customizationOptions: {
        where: {
          status: 'active',
        },
        orderBy: {
          sortOrder: 'asc',
        },
      },
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
  addons: {
    where: {
      status: 'active',
      hideFromOnline: false,
    },
    include: {
      variants: {
        where: {
          status: 'active',
        },
        orderBy: {
          sortOrder: 'asc',
        },
      },
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.EventInclude;

const selectedSessionInclude = {
  inventoryItems: true,
} satisfies Prisma.EventSessionInclude;

type EventTicketsRecord = Prisma.EventGetPayload<{
  include: typeof ticketsCatalogInclude;
}>;

type SelectedSession = Prisma.EventSessionGetPayload<{
  include: typeof selectedSessionInclude;
}>;

interface TicketsQuery {
  date: string;
  time: string;
}

interface SearchQuery {
  lang?: string;
  limit?: string;
}

@Injectable()
export class EventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly paymentMethods: CustomerPaymentMethodsService,
  ) {}

  async getEventListing(lang: string): Promise<EventListingDto> {
    const locale = this.normalizeLocale(lang);
    const events = await this.findPublishedListingEvents();
    const cards = events.map((event) => this.toEventListingCardDto(event, locale));
    const featuredCards = events
      .filter((event) => event.isFeatured)
      .map((event) => this.toEventListingCardDto(event, locale))
      .slice(0, 8);

    return {
      AllEvents: cards,
      featuredEvents: featuredCards,
    };
  }

  async searchEvents(query: string, options: SearchQuery): Promise<EventSearchDto> {
    const normalizedQuery = query.trim();
    const locale = this.normalizeLocale(options.lang ?? 'en');
    const limit = this.parseSearchLimit(options.limit);

    if (normalizedQuery.length < 2) {
      return {
        query: normalizedQuery,
        events: [],
      };
    }

    const events = await this.findPublishedListingEvents(
      {
        OR: [
          {
            slug: {
              contains: normalizedQuery,
              mode: 'insensitive',
            },
          },
          {
            translations: {
              some: {
                OR: [
                  {
                    title: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    subtitle: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    description: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          },
          {
            venue: {
              is: {
                OR: [
                  {
                    name: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    city: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    translations: {
                      some: {
                        OR: [
                          {
                            name: {
                              contains: normalizedQuery,
                              mode: 'insensitive',
                            },
                          },
                          {
                            address: {
                              contains: normalizedQuery,
                              mode: 'insensitive',
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
          {
            category: {
              is: {
                OR: [
                  {
                    name: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    slug: {
                      contains: normalizedQuery,
                      mode: 'insensitive',
                    },
                  },
                  {
                    translations: {
                      some: {
                        name: {
                          contains: normalizedQuery,
                          mode: 'insensitive',
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        ],
      },
      50,
    );
    const rankedEvents = this.rankSearchResults(events, normalizedQuery, locale).slice(0, limit);

    return {
      query: normalizedQuery,
      events: rankedEvents.map((event) => this.toEventListingCardDto(event, locale)),
    };
  }

  private findPublishedListingEvents(where: Prisma.EventWhereInput = {}, take?: number) {
    return this.prisma.event.findMany({
      where: {
        ...where,
        status: 'published',
        visibility: 'public',
      },
      include: eventListingInclude,
      orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
      take,
    });
  }

  async getEventDetail(
    slug: string,
    lang: string,
    access?: { accessToken?: string | null; passwordHeader?: string | null },
  ): Promise<EventDetailDto> {
    const locale = this.normalizeLocale(lang);
    const [event, reviewSettings] = await Promise.all([
      this.findPublishedEventBySlug(slug, eventDetailInclude),
      this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    ]);

    if (!this.canViewPrivateEvent(event, access)) {
      return this.toLockedEventDetailDto(event, locale);
    }

    const showReviews =
      (event.reviewsEnabled ?? reviewSettings.reviewsEnabled) &&
      reviewSettings.showOnEventPages &&
      event.reviews.length >= reviewSettings.minimumReviewCount;
    const paymentMethods = await this.paymentMethods.listEnabledPaymentMethods();
    return this.toEventDetailDto(event, locale, showReviews, paymentMethods);
  }

  async verifyEventPassword(slug: string, eventPassword: string) {
    const password = (eventPassword || '').trim();
    if (!password) {
      throw new BadRequestException({
        success: false,
        message: 'Password is required.',
        errors: { event_password: ['Password is required.'] },
      });
    }

    const event = await this.prisma.event.findFirst({
      where: { slug, status: 'published' },
      select: { id: true, slug: true, gatePassword: true },
    });
    if (!event) {
      throw new NotFoundException({ message: 'Event not found' });
    }

    if (!(event.gatePassword || '').trim()) {
      return {
        success: true,
        data: {
          requires_password: false,
          access_token: null,
          expires_at: null,
        },
      };
    }

    if (!passwordsMatch(event.gatePassword, password)) {
      throw new BadRequestException({
        success: false,
        message: 'Invalid password.',
        errors: { event_password: ['Invalid password.'] },
      });
    }

    const issued = issuePrivateEventAccessToken(
      event.id,
      event.slug,
      this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    );

    return {
      success: true,
      data: {
        requires_password: false,
        access_token: issued.access_token,
        expires_at: issued.expires_at,
        event: { id: event.id, slug: event.slug },
      },
    };
  }

  async getEventSchedule(
    slug: string,
    query: ScheduleQuery,
    access?: { accessToken?: string | null; passwordHeader?: string | null },
  ): Promise<EventScheduleDto> {
    const { todayKey } = this.getQatarNow();
    const event = await this.findPublishedEventBySlug(slug, {
      dates: {
        where: {
          status: 'active',
          date: { gte: this.dateKeyToUtcDate(todayKey) },
        },
        include: scheduleInclude.dates.include,
        orderBy: scheduleInclude.dates.orderBy,
      },
    });
    this.assertCanViewPrivateEvent(event, access);
    return this.toEventScheduleDto(event, query);
  }

  async getEventTickets(
    slug: string,
    query: TicketsQuery,
    access?: { accessToken?: string | null; passwordHeader?: string | null },
  ): Promise<EventTicketsDto> {
    const selectedDate = this.parseDateQuery(query.date);
    const event = await this.findPublishedEventBySlug(slug, ticketsCatalogInclude);
    this.assertCanViewPrivateEvent(event, access);

    const { todayKey, now } = this.getQatarNow();
    if (selectedDate < todayKey) {
      throw new BadRequestException('Selected date is in the past.');
    }

    const eventDate = await this.prisma.eventDate.findFirst({
      where: {
        eventId: event.id,
        status: 'active',
        date: this.dateKeyToUtcDate(selectedDate),
      },
      include: {
        sessions: {
          where: {
            displayTime: query.time,
            status: { not: 'hidden' },
          },
          include: selectedSessionInclude,
        },
      },
    });
    const session = eventDate?.sessions[0];

    if (!eventDate || !session) {
      throw new NotFoundException('Selected event session not found');
    }

    if (session.startsAt < now) {
      throw new BadRequestException('Selected time slot is in the past.');
    }

    return this.toEventTicketsDto(event, eventDate.date, session);
  }

  private async findPublishedEventBySlug<TInclude extends Prisma.EventInclude>(
    slug: string,
    include: TInclude,
  ) {
    const event = await this.prisma.event.findFirst({
      where: {
        slug,
        status: 'published',
      },
      include,
    });
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  private canViewPrivateEvent(
    event: { id: string; slug: string; gatePassword: string | null },
    access?: { accessToken?: string | null; passwordHeader?: string | null },
  ) {
    const gate = (event.gatePassword || '').trim();
    if (!gate) return true;

    const secret = this.config.getOrThrow<string>('JWT_ACCESS_SECRET');
    if (
      isPrivateEventAccessTokenValid(
        access?.accessToken,
        event.id,
        event.slug,
        secret,
      )
    ) {
      return true;
    }

    const password = decodePrivateEventPasswordHeader(access?.passwordHeader);
    return Boolean(password && passwordsMatch(gate, password));
  }

  private assertCanViewPrivateEvent(
    event: { id: string; slug: string; gatePassword: string | null },
    access?: { accessToken?: string | null; passwordHeader?: string | null },
  ) {
    if (!this.canViewPrivateEvent(event, access)) {
      throw new BadRequestException({
        success: false,
        message: 'This event requires a password.',
        data: { requires_password: true },
      });
    }
  }

  private toEventListingCardDto(event: EventListingRecord, locale: string): EventListingCardDto {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const nextDate = event.dates[0]?.date ?? event.startsAt ?? event.publishedAt ?? event.createdAt;
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';
    const image =
      event.primaryMedia?.url ??
      event.media[0]?.mediaAsset.url ??
      'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';
    const status = this.getListingStatus(event);

    return {
      id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      date: this.formatListingDateLabel(nextDate, locale),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
      image,
      price: this.formatListingPrice(this.getListingStartingPrice(event), event.currency),
      category: categoryName,
      category_id: event.categoryId,
      category_slug: event.category?.slug,
      tags: [categoryName],
      status,
      status_label: status === 'available' ? 'Available' : 'Fully booked',
      event_type: event.eventType,
      currentEventDate: this.toDateKey(nextDate),
      rating_summary: {
        average_rating: this.reviewAverage(event.reviews),
        total_reviews: event.reviews.length,
      },
      is_favourite: false,
    };
  }

  private toEventDetailDto(
    event: EventDetailRecord,
    locale: string,
    showReviews: boolean,
    paymentMethods: EventDetailDto['payment_methods'],
  ): EventDetailDto {
    const translation = this.pickTranslation(event.translations, locale);
    const contentSource = event.translations.find((item) => item.locale === 'en') ?? translation;
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const galleryImages = event.media
      .filter((item) => item.mediaRole === 'gallery')
      .map((item) => item.mediaAsset.url);
    const ticketSelectionImageUrl = event.media.find((item) => item.mediaRole === 'ticket_side')
      ?.mediaAsset.url;
    const bannerImageUrl =
      event.primaryMedia?.url ??
      galleryImages[0] ??
      'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

    return {
      id: event.id,
      event_id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      short_description: translation?.subtitle ?? translation?.description ?? '',
      description: translation?.description ?? translation?.subtitle ?? '',
      banner_image_url: bannerImageUrl,
      ticket_selection_image_url: ticketSelectionImageUrl ?? bannerImageUrl,
      starting_price: this.getStartingPrice(event),
      currency: event.currency,
      event_type: this.toFrontendEventType(event.eventType),
      is_registration_only: event.bookingMode === 'registration',
      booking_mode: event.bookingMode,
      gallery_images: galleryImages.length > 0 ? galleryImages : [bannerImageUrl],
      location: {
        venue_name: venueTranslation?.name ?? event.venue?.name ?? 'Venue to be announced',
        city: event.venue?.city ?? '',
        display_address:
          venueTranslation?.address ?? event.venue?.address ?? event.venue?.city ?? '',
        coordinates:
          event.venue?.latitude && event.venue.longitude
            ? {
                lat: event.venue.latitude.toNumber(),
                lng: event.venue.longitude.toNumber(),
              }
            : undefined,
      },
      rating_summary: {
        average_rating: showReviews ? this.reviewAverage(event.reviews) : 0,
        total_reviews: showReviews ? event.reviews.length : 0,
      },
      inclusions: this.toTitledList(contentSource?.inclusionsJson, locale),
      exclusions: this.toTitledList(contentSource?.exclusionsJson, locale),
      terms_and_conditions: this.toTerms(contentSource?.termsContent, locale),
      faqs: this.toFaqs(translation?.faqJson),
      is_favourite: false,
      requires_password: false,
      payment_methods: paymentMethods,
    };
  }

  private toLockedEventDetailDto(event: EventDetailRecord, locale: string): EventDetailDto {
    const translation = this.pickTranslation(event.translations, locale);
    const bannerImageUrl =
      event.primaryMedia?.url ??
      'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

    return {
      id: event.id,
      event_id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      short_description: '',
      description: '',
      banner_image_url: bannerImageUrl,
      ticket_selection_image_url: bannerImageUrl,
      starting_price: 0,
      currency: event.currency,
      event_type: this.toFrontendEventType(event.eventType),
      is_registration_only: event.bookingMode === 'registration',
      booking_mode: event.bookingMode,
      gallery_images: [],
      location: {
        venue_name: 'Locked',
        city: '',
        display_address: '',
      },
      rating_summary: {
        average_rating: 0,
        total_reviews: 0,
      },
      inclusions: [],
      exclusions: [],
      terms_and_conditions: [],
      faqs: [],
      is_favourite: false,
      requires_password: true,
      payment_methods: [],
    };
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private reviewAverage(reviews: Array<{ rating: number }>) {
    return reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  }

  private pickTranslation<T extends { locale: string }>(translations: T[], locale: string) {
    return (
      translations.find((translation) => translation.locale === locale) ??
      translations.find((translation) => translation.locale === 'en') ??
      translations[0] ??
      null
    );
  }

  /**
   * Lowest public ticket/variant price.
   * Ignore 0/null; if any price > 0 exists return the min of those; else 0.
   */
  private getStartingPrice(
    event: Pick<EventDetailRecord | EventListingRecord, 'ticketTypes'>,
  ) {
    const positivePrices: number[] = [];

    for (const ticketType of event.ticketTypes) {
      if (ticketType.thirdPartyVendor?.isCafe) {
        continue;
      }

      const ticketPrice = this.toPositivePrice(ticketType.basePrice);
      if (ticketPrice !== null) {
        positivePrices.push(ticketPrice);
      }

      const variants =
        'variants' in ticketType && Array.isArray(ticketType.variants)
          ? ticketType.variants
          : [];
      for (const variant of variants) {
        const variantPrice = this.toPositivePrice(variant.basePrice);
        if (variantPrice !== null) {
          positivePrices.push(variantPrice);
        }
      }
    }

    return positivePrices.length > 0 ? Math.min(...positivePrices) : 0;
  }

  private getListingStartingPrice(event: EventListingRecord) {
    return this.getStartingPrice(event);
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

  private formatListingPrice(amount: number, currency: string) {
    if (amount <= 0) {
      return 'Free';
    }

    return `${currency} ${amount.toLocaleString('en', {
      maximumFractionDigits: 2,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    })}`;
  }

  private getListingStatus(event: EventListingRecord) {
    const hasAvailableSession = event.dates.some((eventDate) =>
      eventDate.sessions.some((session) => {
        if (session.status !== 'active') {
          return false;
        }

        // No inventory rows = unlimited / inventory tracking off.
        return this.hasAvailableInventory(session.inventoryItems);
      }),
    );

    return hasAvailableSession ? 'available' : 'sold_out';
  }

  private parseSearchLimit(value?: string) {
    const parsed = value ? Number.parseInt(value, 10) : 10;
    if (!Number.isInteger(parsed)) {
      return 10;
    }

    return Math.min(Math.max(parsed, 1), 25);
  }

  private rankSearchResults(events: EventListingRecord[], query: string, locale: string) {
    const normalizedQuery = query.toLowerCase();

    return [...events].sort((left, right) => {
      const leftScore = this.getSearchScore(left, normalizedQuery, locale);
      const rightScore = this.getSearchScore(right, normalizedQuery, locale);

      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }

      return this.getSortTime(left) - this.getSortTime(right);
    });
  }

  private getSearchScore(event: EventListingRecord, query: string, locale: string) {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const title = translation?.title.toLowerCase() ?? '';

    let score = 0;

    if (title === query) {
      score += 100;
    } else if (title.startsWith(query)) {
      score += 60;
    } else if (title.includes(query)) {
      score += 40;
    }

    const otherFields = [
      event.slug,
      translation?.subtitle,
      translation?.description,
      event.venue?.name,
      venueTranslation?.name,
      venueTranslation?.address,
      event.category?.name,
      event.category?.slug,
      categoryTranslation?.name,
    ];

    for (const field of otherFields) {
      if (field?.toLowerCase().includes(query)) {
        score += 10;
      }
    }

    return score;
  }

  private getSortTime(event: EventListingRecord) {
    return (event.startsAt ?? event.publishedAt ?? event.createdAt).getTime();
  }

  private toFrontendEventType(eventType: EventDetailRecord['eventType']) {
    if (eventType === 'summer_camp') {
      return 'camp';
    }

    if (eventType === 'registration_only') {
      return 'event';
    }

    return 'experience';
  }

  private toTerms(termsContent?: string | null, locale = 'en') {
    if (!termsContent?.trim()) return [];

    try {
      const parsed = JSON.parse(termsContent) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as Record<string, unknown>;
          const titleEn = typeof row.title === 'string' ? row.title.trim() : '';
          const titleAr = typeof row.title_ar === 'string' ? row.title_ar.trim() : '';
          const ruleEn = typeof row.rule === 'string' ? row.rule.trim() : '';
          const ruleAr = typeof row.rule_ar === 'string' ? row.rule_ar.trim() : '';
          const title = locale === 'ar' ? titleAr || titleEn : titleEn || titleAr;
          const rule = locale === 'ar' ? ruleAr || ruleEn : ruleEn || ruleAr;
          if (!title && !rule) return [];
          return [{ title: title || 'Terms and conditions', rule }];
        });
      }
    } catch {
      // legacy plain text
    }

    return [{ title: 'Terms and conditions', rule: termsContent }];
  }

  private toTitledList(value: Prisma.JsonValue | null | undefined, locale = 'en'): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (typeof item === 'string' && item.trim()) return [item.trim()];
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      const titleEn = typeof row.title === 'string' ? row.title.trim() : '';
      const titleAr = typeof row.title_ar === 'string' ? row.title_ar.trim() : '';
      const title = locale === 'ar' ? titleAr || titleEn : titleEn || titleAr;
      return title ? [title] : [];
    });
  }

  private toFaqs(faqJson: Prisma.JsonValue | null | undefined): EventFaqDto[] {
    if (!Array.isArray(faqJson)) {
      return [];
    }

    return faqJson.flatMap((item, index) => {
      if (!this.isFaqItem(item)) {
        return [];
      }

      return [
        {
          id: item.id ?? `faq-${index + 1}`,
          question: item.question,
          answer: item.answer,
        },
      ];
    });
  }

  private asStringList(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  private toWaiverBody(event: EventTicketsRecord): string[] {
    const translation =
      event.translations.find((item) => item.locale === 'en') ?? event.translations[0];
    const content = translation?.waiverContent?.trim();
    return content ? [content] : [];
  }

  private isFaqItem(
    item: Prisma.JsonValue,
  ): item is { id?: string; question: string; answer: string } {
    return (
      typeof item === 'object' &&
      item !== null &&
      !Array.isArray(item) &&
      typeof item.question === 'string' &&
      typeof item.answer === 'string' &&
      (item.id === undefined || typeof item.id === 'string')
    );
  }

  private toEventScheduleDto(event: EventScheduleRecord, query: ScheduleQuery): EventScheduleDto {
    const monthsPerPage = 1;
    const currentPage = this.parsePositiveInteger(query.page) ?? 1;
    const timingMode = this.readTimingMode(event.timingConfig);
    const requiresTimeSelection = this.timingRequiresTimeSelection(timingMode);
    const preferredWindow = this.readPreferredWindow(event.timingConfig);
    const { todayKey, now } = this.getQatarNow();
    const activeDates = event.dates.filter((eventDate) => {
      if (this.toDateKey(eventDate.date) < todayKey) {
        return false;
      }
      return query.month ? this.toMonthKey(eventDate.date) === query.month : true;
    });
    const schedule = activeDates
      .map((eventDate) =>
        this.toScheduleDateDto(eventDate, requiresTimeSelection, preferredWindow, now, todayKey),
      )
      .filter((entry) => entry.time_slots.length > 0);
    const totalDates = schedule.length;

    return {
      timing_mode: timingMode,
      requires_time_selection: requiresTimeSelection,
      schedule,
      pagination: {
        current_page: currentPage,
        last_page: totalDates > 0 ? currentPage : 1,
        months_per_page: monthsPerPage,
        from_date: schedule[0]?.date ?? '',
        to_date: schedule[schedule.length - 1]?.date ?? '',
        total_dates: totalDates,
        has_more: false,
      },
    };
  }

  private toScheduleDateDto(
    eventDate: EventScheduleRecord['dates'][number],
    requiresTimeSelection: boolean,
    preferredWindow: { startDate: string; startTime: string } | null,
    now: Date,
    todayKey: string,
  ): ScheduleDateDto {
    const dateKey = this.toDateKey(eventDate.date);
    let sessions = eventDate.sessions.filter((session) => session.status !== 'hidden');

    // Preferred / single window: only the configured start date is bookable.
    // Leftover slotted sessions (e.g. from a prior daily schedule with orders) stay
    // in DB for history but must not appear as customer time slots.
    if (!requiresTimeSelection && preferredWindow) {
      if (dateKey !== preferredWindow.startDate) {
        sessions = [];
      } else if (sessions.length > 1) {
        const windowSession = sessions.find(
          (session) =>
            session.endsAt != null &&
            this.toDateKey(session.endsAt) !== dateKey,
        );
        sessions = windowSession ? [windowSession] : sessions.slice(0, 1);
      }
    }

    // Past calendar days are excluded upstream; for today, drop elapsed slots.
    sessions = sessions.filter((session) => {
      if (dateKey > todayKey) {
        return true;
      }
      return session.startsAt >= now;
    });

    let timeSlots = sessions.map((session) => this.toScheduleTimeSlotDto(session));

    // Single booking window: never expose multiple selectable slots.
    if (!requiresTimeSelection && timeSlots.length > 1) {
      const preferred =
        timeSlots.find((slot) => slot.status === 'available') ?? timeSlots[0];
      timeSlots = preferred ? [preferred] : [];
    }

    const hasAvailableSlot = timeSlots.some((slot) => slot.status === 'available');

    return {
      date: dateKey,
      day_label: this.formatDayLabel(eventDate.date),
      month_label: this.formatMonthLabel(eventDate.date),
      status: hasAvailableSlot ? 'available' : 'fully_booked',
      time_slots: timeSlots,
    };
  }

  private readTimingMode(value: Prisma.JsonValue | null | undefined): string | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const mode = (value as { mode?: unknown }).mode;
    return typeof mode === 'string' ? mode.toLowerCase() : null;
  }

  private timingRequiresTimeSelection(mode: string | null): boolean {
    // preferred = single booking window — customer picks date only (time is fixed).
    // daily / custom / monthly = stepped bookable times — show the slot picker.
    if (!mode) {
      // Legacy events without timing_config: show slots when multiple exist.
      return true;
    }
    return mode !== 'preferred';
  }

  private readPreferredWindow(
    value: Prisma.JsonValue | null | undefined,
  ): { startDate: string; startTime: string } | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const config = value as {
      mode?: unknown;
      start_date?: unknown;
      start_time?: unknown;
    };
    if (typeof config.mode === 'string' && config.mode.toLowerCase() !== 'preferred') {
      return null;
    }
    if (typeof config.start_date !== 'string' || !config.start_date) {
      return null;
    }
    const startTime =
      typeof config.start_time === 'string' && config.start_time
        ? config.start_time.slice(0, 5)
        : '00:00';
    return { startDate: config.start_date, startTime };
  }

  private toScheduleTimeSlotDto(
    session: EventScheduleRecord['dates'][number]['sessions'][number],
  ): ScheduleTimeSlotDto {
    return {
      time: session.displayTime,
      status:
        session.status === 'active' && this.hasAvailableInventory(session.inventoryItems)
          ? 'available'
          : 'booked',
    };
  }

  private toEventTicketsDto(
    event: EventTicketsRecord,
    selectedDate: Date,
    session: SelectedSession,
  ): EventTicketsDto {
    return {
      is_registration_only: event.bookingMode === 'registration',
      booking_mode: event.bookingMode,
      selected_context: {
        date_display: this.formatSelectedDateLabel(selectedDate),
        time_display: session.displayTime,
      },
      tickets: event.ticketTypes
        .filter((ticketType) => this.isTicketOnSale(ticketType))
        .map((ticketType) =>
          ticketType.hasVariants
            ? {
                ticket_id: ticketType.externalKey,
                title: ticketType.title,
                subtitle: ticketType.subtitle ?? '',
                icon_type: ticketType.iconType ?? 'ticket',
                admits: ticketType.admitCount,
                inclusions: ticketType.inclusions,
                exclusions: ticketType.exclusions,
                is_customizable: ticketType.isCustomizable,
                customization_options: this.toCustomizationOptions(ticketType),
                has_variants: true,
                variants: ticketType.variants.map((variant) =>
                  this.toVariantDto({
                    id: variant.id,
                    externalKey: variant.externalKey,
                    name: variant.name,
                    description: variant.description,
                    price: variant.basePrice,
                    currency: variant.currency,
                    badge: variant.badge,
                    maxQtyPerOrder: variant.maxQtyPerOrder,
                    itemType: 'ticket_variant',
                    inventoryItems: session.inventoryItems,
                  }),
                ),
              }
            : this.toFlatTicketDto(ticketType, session),
        ),
      addons: event.addons
        .filter((addon) => !addon.hideFromOnline && !addon.forCafeOnly)
        .map((addon) =>
          addon.hasVariants
            ? {
                addon_id: addon.externalKey,
                title: addon.title,
                subtitle: addon.subtitle ?? '',
                icon_type: addon.iconType ?? 'addon',
                for_cafe_only: addon.forCafeOnly,
                thumbnail_url: addon.thumbnailUrl,
                applicable_for: addon.hideFromPos ? 'Online' : 'Both',
                visibility: addon.hideFromPos ? 'online' : 'both',
                has_variants: true as const,
                variants: addon.variants.map((variant) =>
                  this.toVariantDto({
                    id: variant.id,
                    externalKey: variant.externalKey,
                    name: variant.name,
                    description: variant.description,
                    price: variant.basePrice,
                    currency: variant.currency,
                    badge: variant.badge,
                    maxQtyPerOrder: variant.maxQtyPerOrder,
                    itemType: 'addon_variant',
                    inventoryItems: session.inventoryItems,
                  }),
                ),
              }
            : this.toFlatAddonDto(addon, session),
        ),
      legal_requirements: {
        requires_waiver: event.requiresWaiver,
        body_content: this.toWaiverBody(event),
      },
    };
  }

  private toFlatTicketDto(
    ticketType: EventTicketsRecord['ticketTypes'][number],
    session: SelectedSession,
  ): EventTicketDto {
    return {
      ticket_id: ticketType.externalKey,
      title: ticketType.title,
      subtitle: ticketType.subtitle ?? '',
      icon_type: ticketType.iconType ?? 'ticket',
      admits: ticketType.admitCount,
      inclusions: ticketType.inclusions,
      exclusions: ticketType.exclusions,
      is_customizable: ticketType.isCustomizable,
      customization_options: this.toCustomizationOptions(ticketType),
      has_variants: false,
      price: ticketType.basePrice?.toNumber() ?? 0,
      currency: ticketType.currency,
      badge: null,
      max_qty: this.getMaxQuantity({
        itemId: ticketType.id,
        itemType: 'ticket_type',
        maxQtyPerOrder: ticketType.maxQtyPerOrder,
        inventoryItems: session.inventoryItems,
      }),
    };
  }

  private isTicketOnSale(ticketType: { salesStartAt: Date | null; salesEndAt: Date | null }) {
    const now = new Date();
    return (
      (!ticketType.salesStartAt || ticketType.salesStartAt <= now) &&
      (!ticketType.salesEndAt || ticketType.salesEndAt >= now)
    );
  }

  private toFlatAddonDto(
    addon: EventTicketsRecord['addons'][number],
    session: SelectedSession,
  ): EventAddonDto {
    return {
      addon_id: addon.externalKey,
      title: addon.title,
      subtitle: addon.subtitle ?? '',
      icon_type: addon.iconType ?? 'addon',
      for_cafe_only: addon.forCafeOnly,
      thumbnail_url: addon.thumbnailUrl,
      applicable_for: addon.hideFromPos ? 'Online' : 'Both',
      visibility: addon.hideFromPos ? 'online' : addon.hideFromOnline ? 'offline' : 'both',
      has_variants: false,
      price: addon.basePrice?.toNumber() ?? 0,
      currency: addon.currency,
      badge: null,
      max_qty: this.getMaxQuantity({
        itemId: addon.id,
        itemType: 'addon',
        maxQtyPerOrder: addon.maxQtyPerOrder,
        inventoryItems: session.inventoryItems,
      }),
    };
  }

  private toVariantDto(input: {
    id: string;
    externalKey: string;
    name: string;
    description: string | null;
    price: Prisma.Decimal;
    currency: string;
    badge: string | null;
    maxQtyPerOrder: number | null;
    itemType: 'ticket_variant' | 'addon_variant';
    inventoryItems: SelectedSession['inventoryItems'];
  }): TicketVariantDto {
    return {
      variant_id: input.externalKey,
      name: input.name,
      description: input.description ?? '',
      price: input.price.toNumber(),
      currency: input.currency,
      badge: input.badge,
      max_qty: this.getMaxQuantity({
        itemId: input.id,
        itemType: input.itemType,
        maxQtyPerOrder: input.maxQtyPerOrder,
        inventoryItems: input.inventoryItems,
      }),
    };
  }

  private toCustomizationOptions(ticketType: EventTicketsRecord['ticketTypes'][number]) {
    return ticketType.customizationOptions.map((option) => ({
      option_id: option.externalKey,
      name: option.name,
      description: option.description ?? undefined,
      price: option.price.toNumber(),
      currency: option.currency,
      max_qty: option.maxQtyPerTicket ?? 99,
      has_duration: option.hasDuration,
      duration_minutes: option.durationMinutes,
    }));
  }

  private hasAvailableInventory(
    inventoryItems: EventScheduleRecord['dates'][number]['sessions'][number]['inventoryItems'],
  ) {
    // Empty inventory means capacity was never capped (track inventory off) — treat as open.
    if (inventoryItems.length === 0) {
      return true;
    }

    return inventoryItems.some((item) => {
      if (item.status !== 'active') {
        return false;
      }

      if (item.totalQuantity === null) {
        return true;
      }

      return item.totalQuantity - item.soldQuantity - item.heldQuantity > 0;
    });
  }

  private getMaxQuantity(input: {
    itemId: string;
    itemType: 'ticket_type' | 'ticket_variant' | 'addon' | 'addon_variant';
    maxQtyPerOrder: number | null;
    inventoryItems: SelectedSession['inventoryItems'];
  }) {
    const orderLimit = input.maxQtyPerOrder ?? 99;
    const inventoryItem = input.inventoryItems.find(
      (item) => item.itemId === input.itemId && item.itemType === input.itemType,
    );

    // Missing row or unlimited quantity both mean "no session cap".
    if (!inventoryItem) {
      return orderLimit;
    }

    if (inventoryItem.status !== 'active') {
      return 0;
    }

    if (inventoryItem.totalQuantity === null) {
      return orderLimit;
    }

    const available =
      inventoryItem.totalQuantity - inventoryItem.soldQuantity - inventoryItem.heldQuantity;
    return Math.max(0, Math.min(orderLimit, available));
  }

  private parseDateQuery(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Date must use YYYY-MM-DD format.');
    }

    return value;
  }

  private parsePositiveInteger(value?: string) {
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  /**
   * Calendar "now" in Asia/Qatar (BookingQube market timezone).
   * Past dates/slots are evaluated against this clock, not the server TZ.
   */
  private getQatarNow() {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const todayKey = formatter.format(new Date());
    return { todayKey, now: new Date() };
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private dateKeyToUtcDate(dateKey: string) {
    return new Date(`${dateKey}T00:00:00.000Z`);
  }

  private toMonthKey(date: Date) {
    return date.toISOString().slice(0, 7);
  }

  private formatDayLabel(date: Date) {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
    }).format(date);
  }

  private formatMonthLabel(date: Date) {
    return new Intl.DateTimeFormat('en', {
      month: 'short',
    }).format(date);
  }

  private formatSelectedDateLabel(date: Date) {
    return new Intl.DateTimeFormat('en', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  private formatListingDateLabel(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }
}
