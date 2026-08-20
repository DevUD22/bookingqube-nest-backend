import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { ArtistDetailDto, ArtistEventCardDto } from './dto/artist-detail.dto';

const defaultImageUrl = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const artistEventInclude = {
  event: {
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
  },
} satisfies Prisma.EventArtistInclude;

const artistDetailInclude = {
  translations: true,
  profileMedia: true,
  bannerMedia: true,
  events: {
    include: artistEventInclude,
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.ArtistInclude;

type ArtistDetailRecord = Prisma.ArtistGetPayload<{
  include: typeof artistDetailInclude;
}>;

type ArtistEventRecord = ArtistDetailRecord['events'][number]['event'];

@Injectable()
export class ArtistsService {
  constructor(private readonly prisma: PrismaService) {}

  async getArtistDetail(slug: string, lang: string): Promise<ArtistDetailDto> {
    const locale = this.normalizeLocale(lang);
    const artist = await this.prisma.artist.findFirst({
      where: {
        slug,
        status: 'published',
      },
      include: artistDetailInclude,
    });

    if (!artist) {
      throw new NotFoundException('Artist not found');
    }

    return this.toArtistDetailDto(artist, locale);
  }

  private toArtistDetailDto(artist: ArtistDetailRecord, locale: string): ArtistDetailDto {
    const translation = this.pickTranslation(artist.translations, locale);
    const events = artist.events
      .map((entry) => entry.event)
      .filter((event) => event.status === 'published' && event.visibility === 'public');
    const now = new Date();
    const upcomingEvents = events.filter((event) => this.getEventDate(event) >= now);
    const pastEvents = events.filter((event) => this.getEventDate(event) < now);
    const storedGenres = this.splitCsv(artist.genres);
    const eventGenres = this.getGenres(events, translation?.subtitle);
    const genres = Array.from(new Set([...storedGenres, ...eventGenres]));
    const image = artist.profileMedia?.url ?? this.getFirstEventImage(events);
    const banner = artist.bannerMedia?.url ?? null;
    const bio = translation?.bio ?? '';
    const parents = this.asParents(artist.parents);

    return {
      id: artist.id,
      name: translation?.name ?? artist.name,
      slug: artist.slug,
      image,
      banner,
      genre: genres[0] ?? '',
      genres,
      tagline: translation?.subtitle ?? artist.stageName ?? genres[0] ?? '',
      about: this.toAboutLines(bio),
      biography: bio,
      profile: {
        dateOfBirth: artist.dateOfBirth
          ? artist.dateOfBirth.toISOString().slice(0, 10)
          : null,
        age: artist.age,
        origin: artist.origin ?? '',
        heightCm: artist.heightCm,
        ethnicity: artist.ethnicity ?? '',
        nationality: artist.nationality ?? '',
        religion: artist.religion ?? '',
        occupation: artist.occupation ?? translation?.subtitle ?? '',
        instruments: this.splitCsv(artist.instruments),
        netWorth: artist.netWorth?.toNumber() ?? null,
        netWorthCurrency: artist.netWorthCurrency || 'USD',
        maritalStatus: artist.maritalStatus ?? '',
        spouseName: artist.spouseName ?? '',
        children: this.asStringList(artist.children),
        parents: [parents.father, parents.mother].filter(Boolean),
        profileUpdatedDate: artist.profileUpdatedDate
          ? artist.profileUpdatedDate.toISOString().slice(0, 10)
          : artist.updatedAt.toISOString().slice(0, 10),
      },
      upcomingEventIds: upcomingEvents.map((event) => event.id),
      upcomingEvents: upcomingEvents.map((event) => this.toEventCardDto(event, locale)),
      pastEvents: pastEvents.map((event) => this.toEventCardDto(event, locale)),
      similarArtistIds: [],
      similarArtists: [],
    };
  }

  private toEventCardDto(event: ArtistEventRecord, locale: string): ArtistEventCardDto {
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';
    const nextDate = this.getEventDate(event);
    const status = this.getEventStatus(event);

    return {
      id: event.id,
      title: translation?.title ?? event.slug,
      image_url: this.getEventImage(event),
      price_from: this.getStartingPrice(event),
      currency: event.currency,
      event_type: event.eventType,
      is_registration_only: event.bookingMode === 'registration',
      booking_mode: event.bookingMode,
      schedule_type: this.formatDateLabel(nextDate, locale),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
      tags: [categoryName],
      slug: event.slug,
      is_favourite: false,
      status,
      status_label: status === 'available' ? 'Available' : 'Fully booked',
      category: categoryName,
      category_id: event.categoryId,
      category_slug: event.category?.slug,
      rating_summary: {
        average_rating: 0,
        total_reviews: 0,
      },
    };
  }

  private getGenres(events: ArtistEventRecord[], subtitle?: string | null) {
    const genres = events
      .map((event) => event.category?.translations[0]?.name ?? event.category?.name)
      .filter((genre): genre is string => Boolean(genre));

    if (subtitle) {
      genres.unshift(subtitle);
    }

    return Array.from(new Set(genres));
  }

  private getFirstEventImage(events: ArtistEventRecord[]) {
    return events[0] ? this.getEventImage(events[0]) : defaultImageUrl;
  }

  private getStartingPrice(event: ArtistEventRecord) {
    const prices = event.ticketTypes
      .flatMap((ticketType) => [
        ticketType.basePrice?.toNumber(),
        ...ticketType.variants.map((variant) => variant.basePrice.toNumber()),
      ])
      .filter((price): price is number => typeof price === 'number');

    return prices.length > 0 ? Math.min(...prices) : 0;
  }

  private getEventStatus(event: ArtistEventRecord) {
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

  private getEventDate(event: ArtistEventRecord) {
    return event.dates[0]?.date ?? event.startsAt ?? event.publishedAt ?? event.createdAt;
  }

  private getEventImage(event: ArtistEventRecord) {
    return event.primaryMedia?.url ?? event.media[0]?.mediaAsset.url ?? defaultImageUrl;
  }

  private toAboutLines(value: string) {
    return value
      .split(/\n{2,}|\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  private splitCsv(value: string | null | undefined) {
    if (!value?.trim()) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private asStringList(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  private asParents(value: Prisma.JsonValue | null | undefined) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { father: '', mother: '' };
    }
    const record = value as Record<string, unknown>;
    return {
      father: typeof record.father === 'string' ? record.father : '',
      mother: typeof record.mother === 'string' ? record.mother : '',
    };
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
}
