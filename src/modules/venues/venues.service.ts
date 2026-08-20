import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { EventListingCardDto } from '../events/dto/event-listing.dto';
import { VenueDetailDto, VenuePrimaryEventDetailDto } from './dto/venue-detail.dto';

const defaultImageUrl = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const venueDetailInclude = {
  translations: true,
  heroMedia: true,
  events: {
    where: {
      status: 'published',
      visibility: 'public',
    },
    include: {
      translations: true,
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
        },
        include: {
          variants: {
            where: {
              status: 'active',
            },
          },
        },
        orderBy: {
          sortOrder: 'asc',
        },
      },
    },
    orderBy: [{ startsAt: 'asc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
  },
} satisfies Prisma.VenueInclude;

type VenueDetailRecord = Prisma.VenueGetPayload<{
  include: typeof venueDetailInclude;
}>;

type VenueEventRecord = VenueDetailRecord['events'][number];

@Injectable()
export class VenuesService {
  constructor(private readonly prisma: PrismaService) {}

  async getVenueDetail(slug: string, lang: string): Promise<VenueDetailDto> {
    const locale = this.normalizeLocale(lang);
    const venue = await this.prisma.venue.findFirst({
      where: {
        slug,
        status: 'published',
      },
      include: venueDetailInclude,
    });

    if (!venue) {
      throw new NotFoundException('Venue not found');
    }

    return this.toVenueDetailDto(venue, locale);
  }

  private toVenueDetailDto(venue: VenueDetailRecord, locale: string): VenueDetailDto {
    const translation = this.pickTranslation(venue.translations, locale);
    const eventCards = venue.events.map((event) => this.toEventListingCardDto(event, locale));
    const now = new Date();
    const upcomingEvents = venue.events.filter((event) => this.getEventDate(event) >= now);
    const pastEvents = venue.events.filter((event) => this.getEventDate(event) < now);
    const primaryEvent = upcomingEvents[0] ?? venue.events[0] ?? null;
    const image =
      venue.heroMedia?.url ?? (primaryEvent ? this.getEventImage(primaryEvent) : defaultImageUrl);
    const about = translation?.description ?? '';
    const address = translation?.address ?? venue.address ?? venue.city ?? '';

    return {
      id: venue.id,
      name: translation?.name ?? venue.name,
      slug: venue.slug,
      image,
      banner: image,
      gallery: Array.from(
        new Set([image, ...venue.events.flatMap((event) => this.getEventImages(event))]),
      ),
      about,
      aboutLines: this.toAboutLines(about),
      location: {
        venue: translation?.name ?? venue.name,
        address,
        city: venue.city ?? '',
        state: '',
        country: venue.country,
        zipcode: '',
        latitude: venue.latitude?.toString() ?? '',
        longitude: venue.longitude?.toString() ?? '',
        googleMapUrl: this.getGoogleMapUrl(venue, address),
      },
      upcomingEventIds: upcomingEvents.map((event) => event.id),
      upcomingEvents: eventCards.filter((card) =>
        upcomingEvents.some((event) => event.id === card.id),
      ),
      pastEvents: eventCards.filter((card) => pastEvents.some((event) => event.id === card.id)),
      primaryEventSlug: primaryEvent?.slug ?? null,
      primaryEventDetail: primaryEvent ? this.toPrimaryEventDetailDto(primaryEvent, locale) : null,
      stats: {
        upcomingEventsCount: upcomingEvents.length,
        pastEventsCount: pastEvents.length,
        liveEventsCount: upcomingEvents.filter(
          (event) => this.getListingStatus(event) === 'available',
        ).length,
      },
    };
  }

  private toPrimaryEventDetailDto(
    event: VenueEventRecord,
    locale: string,
  ): VenuePrimaryEventDetailDto {
    const card = this.toEventListingCardDto(event, locale);
    const translation = this.pickTranslation(event.translations, locale);
    const priceFrom = this.getStartingPrice(event);

    return {
      id: event.id,
      slug: event.slug,
      title: card.title,
      date: card.date,
      location: card.location,
      image: card.image,
      price: card.price,
      priceFrom,
      currency: event.currency,
      category: card.category,
      tags: card.tags,
      status: card.status,
      status_label: card.status_label,
      openingHours: event.dates[0]?.sessions[0]?.displayTime,
      excerpt: translation?.subtitle ?? undefined,
      description: translation?.description ?? undefined,
    };
  }

  private toEventListingCardDto(event: VenueEventRecord, locale: string): EventListingCardDto {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const nextDate = this.getEventDate(event);
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';
    const status = this.getListingStatus(event);

    return {
      id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      date: this.formatDateLabel(nextDate, locale),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
      image: this.getEventImage(event),
      price: this.formatPrice(this.getStartingPrice(event), event.currency),
      category: categoryName,
      category_id: event.categoryId,
      category_slug: event.category?.slug,
      tags: [categoryName],
      status,
      status_label: status === 'available' ? 'Available' : 'Fully booked',
      event_type: event.eventType,
      currentEventDate: this.toDateKey(nextDate),
      rating_summary: {
        average_rating: 0,
        total_reviews: 0,
      },
      is_favourite: false,
    };
  }

  private getStartingPrice(event: VenueEventRecord) {
    const prices = event.ticketTypes
      .flatMap((ticketType) => [
        ticketType.basePrice?.toNumber(),
        ...ticketType.variants.map((variant) => variant.basePrice.toNumber()),
      ])
      .filter((price): price is number => typeof price === 'number');

    return prices.length > 0 ? Math.min(...prices) : 0;
  }

  private getListingStatus(event: VenueEventRecord) {
    const hasAvailableSession = event.dates.some((eventDate) =>
      eventDate.sessions.some((session) => {
        if (session.status !== 'active') {
          return false;
        }

        if (session.inventoryItems.length === 0) {
          return event.bookingMode === 'registration';
        }

        return session.inventoryItems.some((item) => {
          if (item.status !== 'active') {
            return false;
          }

          if (item.totalQuantity === null) {
            return true;
          }

          return item.totalQuantity - item.soldQuantity - item.heldQuantity > 0;
        });
      }),
    );

    return hasAvailableSession ? 'available' : 'sold_out';
  }

  private getEventDate(event: VenueEventRecord) {
    return event.dates[0]?.date ?? event.startsAt ?? event.publishedAt ?? event.createdAt;
  }

  private getEventImage(event: VenueEventRecord) {
    return event.primaryMedia?.url ?? event.media[0]?.mediaAsset.url ?? defaultImageUrl;
  }

  private getEventImages(event: VenueEventRecord) {
    const images = [
      event.primaryMedia?.url,
      ...event.media.map((item) => item.mediaAsset.url),
    ].filter((url): url is string => Boolean(url));

    return images.length > 0 ? images : [defaultImageUrl];
  }

  private getGoogleMapUrl(venue: VenueDetailRecord, address: string) {
    if (venue.latitude && venue.longitude) {
      return `https://maps.google.com/maps?q=${encodeURIComponent(
        `${venue.latitude.toString()},${venue.longitude.toString()}`,
      )}&z=15`;
    }

    const query = [address, venue.city, venue.country].filter(Boolean).join(', ');
    return query ? `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=15` : '';
  }

  private toAboutLines(value: string) {
    return value
      .split(/\n{2,}|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private formatPrice(amount: number, currency: string) {
    if (amount <= 0) {
      return 'Free';
    }

    return `${currency} ${amount.toLocaleString('en', {
      maximumFractionDigits: 2,
      minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    })}`;
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

  private formatDateLabel(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(date);
  }

  private toDateKey(date: Date) {
    return date.toISOString().slice(0, 10);
  }
}
