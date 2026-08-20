import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import sharp, { type OutputInfo } from 'sharp';

import { sanitizeCmsHtmlOrNull } from '../../common/html/sanitize-cms-html';
import { PrismaService } from '../../database/prisma.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { UpdateOrganizerEventDto } from '../organizer/dto/update-organizer-event.dto';
import { AdminEventListQueryDto } from './dto/admin-event-list-query.dto';
import { CreateAdminEventDto, EntryAccessDto } from './dto/create-admin-event.dto';
import { CreateAdminEventMediaDto } from './dto/create-admin-event-media.dto';
import { CreateAdminEventSessionDto, CreateAdminTicketTypeDto, ImportAdminTicketTypesDto, UpdateAdminTicketTypeDto } from './dto/create-admin-event-setup.dto';
import { CreateAdminArtistDto } from './dto/create-admin-artist.dto';
import {
  CreateAdminEventCategoryDto,
  CreateAdminEventVenueDto,
} from './dto/create-admin-event-option.dto';
import { ApplyAdminEventTimingDto } from './dto/apply-admin-event-timing.dto';
import {
  CreateAdminAddonDto,
  CreateAdminTaxDto,
  UpdateAdminEventMoreDto,
  UpsertAdminRegistrationFormDto,
} from './dto/update-admin-event-more.dto';
import {
  CreateThirdPartyVendorDto,
  ReplaceThirdPartyVendorsDto,
  ThirdPartyVendorItemDto,
} from './dto/third-party-vendor.dto';
import { CreateThirdPartyPlatformDto } from './dto/third-party-platform.dto';
import {
  formatDisplayTimeQatar,
  planSessionsFromTiming,
  qatarDateTime,
  timingSlotsProvideCapacity,
} from './timing-planner';

const eventInclude = {
  translations: true,
  organization: true,
  primaryOrganizer: { select: { id: true, name: true, email: true, status: true } },
  venue: { include: { translations: true } },
  category: { include: { translations: true } },
  primaryMedia: true,
  _count: { select: { sessions: true, ticketTypes: true, orders: true } },
} satisfies Prisma.EventInclude;

type AdminEventRecord = Prisma.EventGetPayload<{ include: typeof eventInclude }>;

const mediaTargetDimensions: Record<
  CreateAdminEventMediaDto['role'],
  { width: number; height: number }
> = {
  homepage_banner: { width: 2560, height: 725 },
  homepage_banner_mobile: { width: 1200, height: 1500 },
  event_poster: { width: 1600, height: 900 },
  gallery: { width: 1600, height: 1200 },
  ticket_side: { width: 1200, height: 1500 },
};

@Injectable()
export class AdminEventsService {
  private readonly logger = new Logger(AdminEventsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async listArtists(q?: string) {
    const query = q?.trim();
    const artists = await this.prisma.artist.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { slug: { contains: query, mode: 'insensitive' } },
              { stageName: { contains: query, mode: 'insensitive' } },
              { translations: { some: { name: { contains: query, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      include: { translations: true, profileMedia: true },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: {
        artists: artists.map((artist) => ({
          ...this.mapArtistOption(artist),
          created_at: artist.createdAt.toISOString(),
          updated_at: artist.updatedAt.toISOString(),
        })),
      },
    };
  }

  async listVenues(q?: string) {
    const query = q?.trim();
    const venues = await this.prisma.venue.findMany({
      where: query
        ? {
            OR: [
              { name: { contains: query, mode: 'insensitive' } },
              { slug: { contains: query, mode: 'insensitive' } },
              { city: { contains: query, mode: 'insensitive' } },
              { country: { contains: query, mode: 'insensitive' } },
              { translations: { some: { name: { contains: query, mode: 'insensitive' } } } },
            ],
          }
        : undefined,
      include: { translations: true },
      orderBy: { name: 'asc' },
    });

    return {
      success: true,
      data: {
        venues: venues.map((venue) => {
          const en = venue.translations.find((item) => item.locale === 'en');
          const ar = venue.translations.find((item) => item.locale === 'ar');
          return {
            id: venue.id,
            name: en?.name ?? venue.name,
            name_ar: ar?.name ?? null,
            slug: venue.slug,
            status: venue.status,
            city: venue.city,
            country: venue.country,
            address: venue.address,
            banner_url: venue.bannerUrl,
            created_at: venue.createdAt.toISOString(),
            updated_at: venue.updatedAt.toISOString(),
          };
        }),
      },
    };
  }

  async getArtist(id: string) {
    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: { translations: true, profileMedia: true, bannerMedia: true },
    });
    if (!artist) throw new NotFoundException('Artist was not found.');
    return { success: true, data: { artist: this.mapArtistDetail(artist) } };
  }

  async updateArtist(id: string, input: CreateAdminArtistDto, adminUserId: string) {
    const existing = await this.prisma.artist.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!existing) throw new NotFoundException('Artist was not found.');

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Artist name is required.');

    const nameAr = input.name_ar?.trim() || null;
    const stageName = input.stage_name?.trim() || null;
    const stageNameAr = input.stage_name_ar?.trim() || null;
    const biography = sanitizeCmsHtmlOrNull(input.biography);
    const biographyAr = sanitizeCmsHtmlOrNull(input.biography_ar);
    const status = input.status ?? existing.status;
    let slug = input.slug?.trim() || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid artist name.');

    if (slug !== existing.slug) {
      const clash = await this.prisma.artist.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException('An artist with this URL slug already exists.');
      }
    }

    const ageIsManual = Boolean(input.age_is_manual);
    let age: number | null = null;
    if (ageIsManual) {
      age = typeof input.age === 'number' ? input.age : null;
    } else if (input.date_of_birth) {
      age = this.ageFromBirthDate(input.date_of_birth);
    }

    const genres = this.csvFromTags(input.genres);
    const instruments = this.csvFromTags(input.instruments);
    const children = (input.children ?? []).map((item) => item.trim()).filter(Boolean);
    const parents = {
      father: input.parents?.father?.trim() || '',
      mother: input.parents?.mother?.trim() || '',
    };
    const maritalStatus = input.marital_status?.trim() || null;
    const currency = (input.net_worth_currency?.trim() || 'USD').toUpperCase();

    let profileMediaId = existing.profileMediaId;
    if (input.artist_image_data_url) {
      const media = await this.saveArtistImage(
        input.artist_image_data_url,
        input.artist_image_file_name,
        adminUserId,
        'profile',
      );
      profileMediaId = media.id;
    }

    let bannerMediaId = existing.bannerMediaId;
    if (input.banner_image_data_url) {
      const media = await this.saveArtistImage(
        input.banner_image_data_url,
        input.banner_image_file_name,
        adminUserId,
        'banner',
      );
      bannerMediaId = media.id;
    }

    try {
      const artist = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.artist.update({
          where: { id },
          data: {
            name,
            slug,
            status,
            stageName,
            dateOfBirth: input.date_of_birth
              ? new Date(`${input.date_of_birth}T00:00:00.000Z`)
              : null,
            age,
            ageIsManual,
            origin: input.origin?.trim() || null,
            heightCm: typeof input.height_cm === 'number' ? input.height_cm : null,
            ethnicity: input.ethnicity?.trim() || null,
            nationality: input.nationality?.trim() || null,
            religion: input.religion?.trim() || null,
            occupation: input.occupation?.trim() || null,
            genres,
            instruments,
            netWorth:
              typeof input.net_worth === 'number' ? new Prisma.Decimal(input.net_worth) : null,
            netWorthCurrency: currency,
            maritalStatus,
            spouseName: input.spouse_name?.trim() || null,
            children: children.length ? (children as Prisma.InputJsonValue) : Prisma.JsonNull,
            parents: (parents.father || parents.mother
              ? parents
              : { father: '', mother: '' }) as Prisma.InputJsonValue,
            profileUpdatedDate: input.profile_updated_date
              ? new Date(`${input.profile_updated_date}T00:00:00.000Z`)
              : null,
            profileMediaId,
            bannerMediaId,
            publishedAt:
              status === 'published'
                ? existing.publishedAt ?? new Date()
                : existing.publishedAt,
            updatedByUserId: adminUserId,
          },
        });

        await tx.artistTranslation.upsert({
          where: { artistId_locale: { artistId: id, locale: 'en' } },
          update: { name, subtitle: stageName, bio: biography },
          create: { artistId: id, locale: 'en', name, subtitle: stageName, bio: biography },
        });

        if (nameAr || stageNameAr || biographyAr) {
          await tx.artistTranslation.upsert({
            where: { artistId_locale: { artistId: id, locale: 'ar' } },
            update: {
              name: nameAr || name,
              subtitle: stageNameAr,
              bio: biographyAr,
            },
            create: {
              artistId: id,
              locale: 'ar',
              name: nameAr || name,
              subtitle: stageNameAr,
              bio: biographyAr,
            },
          });
        }

        return tx.artist.findUniqueOrThrow({
          where: { id: updated.id },
          include: { translations: true, profileMedia: true, bannerMedia: true },
        });
      });

      return { success: true, data: { artist: this.mapArtistDetail(artist) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An artist with this URL slug already exists.');
      }
      throw error;
    }
  }

  async getVenue(id: string) {
    const venue = await this.prisma.venue.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!venue) throw new NotFoundException('Venue was not found.');
    return { success: true, data: { venue: this.mapVenueDetail(venue) } };
  }

  async updateVenue(id: string, input: CreateAdminEventVenueDto, adminUserId: string) {
    const existing = await this.prisma.venue.findUnique({
      where: { id },
      include: { translations: true },
    });
    if (!existing) throw new NotFoundException('Venue was not found.');

    const name = input.name.trim();
    const nameAr = input.name_ar?.trim() || null;
    const slug = input.slug?.trim() || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid venue name.');

    if (slug !== existing.slug) {
      const clash = await this.prisma.venue.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (clash && clash.id !== id) {
        throw new ConflictException('A venue with this URL slug already exists.');
      }
    }

    const address = input.address?.trim() || null;
    const addressAr = input.address_ar?.trim() || null;
    const city = input.city?.trim() || null;
    const cityAr = input.city_ar?.trim() || null;
    const state = input.state?.trim() || null;
    const stateAr = input.state_ar?.trim() || null;
    const zipcode = input.zipcode?.trim() || null;
    const country = (input.country?.trim() || existing.country || 'QA').toUpperCase();
    const countryAr = input.country_ar?.trim() || null;
    const about = sanitizeCmsHtmlOrNull(input.about);
    const aboutAr = sanitizeCmsHtmlOrNull(input.about_ar);
    const status = input.status === 'inactive' ? 'draft' : 'published';
    const latitude = input.latitude ?? null;
    const longitude = input.longitude ?? null;

    let googleMapUrl = input.google_map_url?.trim() || null;
    if (!googleMapUrl && latitude != null && longitude != null) {
      const query = encodeURIComponent(
        [address, city, state, country].filter(Boolean).join(', ') || `${latitude},${longitude}`,
      );
      googleMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}&query=${query}`;
    }

    let bannerUrl = existing.bannerUrl;
    if (input.banner_data_url) {
      bannerUrl = await this.saveVenueImage(
        input.banner_data_url,
        input.banner_file_name,
        'banner',
      );
    }

    const existingGallery = Array.isArray(existing.galleryUrls)
      ? (existing.galleryUrls as string[])
      : [];
    const keptGallery =
      input.gallery_urls !== undefined
        ? (input.gallery_urls ?? []).filter(Boolean)
        : existingGallery;
    const galleryUrls = [...keptGallery];
    for (const [index, dataUrl] of (input.gallery_data_urls ?? []).entries()) {
      if (!dataUrl?.trim()) continue;
      galleryUrls.push(await this.saveVenueImage(dataUrl, `gallery-${index + 1}.jpg`, 'gallery'));
    }

    try {
      const venue = await this.prisma.$transaction(async (tx) => {
        const updated = await tx.venue.update({
          where: { id },
          data: {
            name,
            slug,
            status,
            address,
            city,
            state,
            zipcode,
            country,
            latitude,
            longitude,
            googleMapUrl,
            bannerUrl,
            galleryUrls: galleryUrls.length ? galleryUrls : Prisma.JsonNull,
            publishedAt:
              status === 'published'
                ? existing.publishedAt ?? new Date()
                : existing.publishedAt,
            updatedByUserId: adminUserId,
          },
        });

        await tx.venueTranslation.upsert({
          where: { venueId_locale: { venueId: id, locale: 'en' } },
          update: {
            name,
            description: about,
            address,
            city,
            state,
            country: null,
          },
          create: {
            venueId: id,
            locale: 'en',
            name,
            description: about,
            address,
            city,
            state,
            country: null,
          },
        });

        if (nameAr || aboutAr || addressAr || cityAr || stateAr || countryAr) {
          await tx.venueTranslation.upsert({
            where: { venueId_locale: { venueId: id, locale: 'ar' } },
            update: {
              name: nameAr || name,
              description: aboutAr,
              address: addressAr,
              city: cityAr,
              state: stateAr,
              country: countryAr,
            },
            create: {
              venueId: id,
              locale: 'ar',
              name: nameAr || name,
              description: aboutAr,
              address: addressAr,
              city: cityAr,
              state: stateAr,
              country: countryAr,
            },
          });
        }

        return tx.venue.findUniqueOrThrow({
          where: { id: updated.id },
          include: { translations: true },
        });
      });

      return { success: true, data: { venue: this.mapVenueDetail(venue) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A venue with this URL slug already exists.');
      }
      throw error;
    }
  }

  async formOptions() {
    const [venues, categories, organizers, artists] = await Promise.all([
      this.prisma.venue.findMany({
        where: { status: { not: 'archived' } },
        include: { translations: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.eventCategory.findMany({
        where: { status: { not: 'archived' } },
        include: { translations: true, parent: { include: { translations: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.organizationMember.findMany({
        where: {
          status: 'active',
          user: { status: 'active' },
          organization: { status: 'active' },
        },
        select: {
          user: { select: { id: true, name: true, email: true } },
          role: true,
        },
        distinct: ['userId'],
        orderBy: { user: { name: 'asc' } },
      }),
      this.prisma.artist.findMany({
        where: { status: { not: 'archived' } },
        include: { translations: true, profileMedia: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      success: true,
      data: {
        venues: venues.map((venue) => ({
          id: venue.id,
          name: venue.translations.find((item) => item.locale === 'en')?.name ?? venue.name,
          status: venue.status === 'published' ? 'active' : venue.status === 'draft' ? 'inactive' : venue.status,
          city: venue.city,
          country: venue.country,
        })),
        categories: categories.map((category) => {
          const en =
            category.translations.find((item) => item.locale === 'en')?.name ?? category.name;
          const ar = category.translations.find((item) => item.locale === 'ar')?.name ?? null;
          const parentEn = category.parent
            ? category.parent.translations.find((item) => item.locale === 'en')?.name ??
              category.parent.name
            : null;
          return {
            id: category.id,
            name: parentEn ? `${parentEn} › ${en}` : en,
            name_en: en,
            name_ar: ar,
            slug: category.slug,
            status: category.status === 'hidden' ? 'inactive' : category.status,
            parent_id: category.parentId,
            thumbnail_url: category.thumbnailUrl,
            is_parent: category.parentId == null,
          };
        }),
        organizers: organizers.map((membership) => ({
          id: membership.user.id,
          name: membership.user.name,
          email: membership.user.email,
          member_role: membership.role,
        })),
        artists: artists.map((artist) => this.mapArtistOption(artist)),
      },
    };
  }

  async createArtist(input: CreateAdminArtistDto, adminUserId: string) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('Artist name is required.');

    const nameAr = input.name_ar?.trim() || null;
    const stageName = input.stage_name?.trim() || null;
    const stageNameAr = input.stage_name_ar?.trim() || null;
    const biography = sanitizeCmsHtmlOrNull(input.biography);
    const biographyAr = sanitizeCmsHtmlOrNull(input.biography_ar);
    const status = input.status ?? 'published';
    let slug = input.slug?.trim() || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid artist name.');

    if (!input.slug?.trim()) {
      const existing = await this.prisma.artist.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (existing) {
        slug = `${slug}-${Date.now().toString(36).slice(-6)}`;
      }
    }

    const ageIsManual = Boolean(input.age_is_manual);
    let age: number | null = null;
    if (ageIsManual) {
      age = typeof input.age === 'number' ? input.age : null;
    } else if (input.date_of_birth) {
      age = this.ageFromBirthDate(input.date_of_birth);
    }

    const genres = this.csvFromTags(input.genres);
    const instruments = this.csvFromTags(input.instruments);
    const children = (input.children ?? [])
      .map((item) => item.trim())
      .filter(Boolean);
    const parents = {
      father: input.parents?.father?.trim() || '',
      mother: input.parents?.mother?.trim() || '',
    };
    const maritalStatus = input.marital_status?.trim() || null;
    const currency = (input.net_worth_currency?.trim() || 'USD').toUpperCase();

    let profileMediaId: string | null = null;
    if (input.artist_image_data_url) {
      const media = await this.saveArtistImage(
        input.artist_image_data_url,
        input.artist_image_file_name,
        adminUserId,
        'profile',
      );
      profileMediaId = media.id;
    }

    let bannerMediaId: string | null = null;
    if (input.banner_image_data_url) {
      const media = await this.saveArtistImage(
        input.banner_image_data_url,
        input.banner_image_file_name,
        adminUserId,
        'banner',
      );
      bannerMediaId = media.id;
    }

    const arNeeded = Boolean(nameAr || stageNameAr || biographyAr);

    try {
      const artist = await this.prisma.artist.create({
        data: {
          name,
          slug,
          status,
          stageName,
          dateOfBirth: input.date_of_birth ? new Date(`${input.date_of_birth}T00:00:00.000Z`) : null,
          age,
          ageIsManual,
          origin: input.origin?.trim() || null,
          heightCm: typeof input.height_cm === 'number' ? input.height_cm : null,
          ethnicity: input.ethnicity?.trim() || null,
          nationality: input.nationality?.trim() || null,
          religion: input.religion?.trim() || null,
          occupation: input.occupation?.trim() || null,
          genres,
          instruments,
          netWorth:
            typeof input.net_worth === 'number' ? new Prisma.Decimal(input.net_worth) : null,
          netWorthCurrency: currency,
          maritalStatus,
          spouseName: input.spouse_name?.trim() || null,
          children: children.length ? (children as Prisma.InputJsonValue) : Prisma.JsonNull,
          parents: (parents.father || parents.mother
            ? parents
            : { father: '', mother: '' }) as Prisma.InputJsonValue,
          profileUpdatedDate: input.profile_updated_date
            ? new Date(`${input.profile_updated_date}T00:00:00.000Z`)
            : null,
          profileMediaId,
          bannerMediaId,
          publishedAt: status === 'published' ? new Date() : null,
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
          translations: {
            create: [
              {
                locale: 'en',
                name,
                subtitle: stageName,
                bio: biography,
              },
              ...(arNeeded
                ? [
                    {
                      locale: 'ar',
                      name: nameAr || name,
                      subtitle: stageNameAr,
                      bio: biographyAr,
                    },
                  ]
                : []),
            ],
          },
        },
        include: { translations: true, profileMedia: true },
      });

      return {
        success: true,
        data: { artist: this.mapArtistOption(artist) },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An artist with this URL slug already exists.');
      }
      throw error;
    }
  }

  async createCategory(input: CreateAdminEventCategoryDto) {
    const name = input.name.trim();
    const nameAr = input.name_ar?.trim() || null;
    const slug = input.slug?.trim() || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid category name.');

    const kind = input.kind ?? (input.parent_id ? 'sub' : 'parent');
    if (kind === 'sub' && !input.parent_id) {
      throw new BadRequestException('Select a parent category for a subcategory.');
    }
    if (kind === 'parent' && input.parent_id) {
      throw new BadRequestException('Parent categories cannot have a parent.');
    }

    let parentId: string | null = null;
    if (kind === 'sub' && input.parent_id) {
      const parent = await this.prisma.eventCategory.findUnique({
        where: { id: input.parent_id },
        select: { id: true, parentId: true, status: true },
      });
      if (!parent || parent.status === 'archived') {
        throw new NotFoundException('Parent category was not found.');
      }
      if (parent.parentId) {
        throw new BadRequestException('Choose a top-level category as the parent.');
      }
      parentId = parent.id;
    }

    const status =
      input.status === 'inactive' || input.status === 'hidden' ? 'hidden' : 'active';

    let thumbnailUrl: string | null = null;
    if (input.thumbnail_data_url) {
      thumbnailUrl = await this.saveCategoryThumbnail(
        input.thumbnail_data_url,
        input.thumbnail_file_name,
      );
    }

    try {
      const category = await this.prisma.eventCategory.create({
        data: {
          name,
          slug,
          status,
          parentId,
          thumbnailUrl,
          translations: {
            create: [
              { locale: 'en', name },
              ...(nameAr ? [{ locale: 'ar', name: nameAr }] : []),
            ],
          },
        },
        include: { translations: true, parent: { include: { translations: true } } },
      });

      const en =
        category.translations.find((item) => item.locale === 'en')?.name ?? category.name;
      const ar = category.translations.find((item) => item.locale === 'ar')?.name ?? null;
      const parentEn = category.parent
        ? category.parent.translations.find((item) => item.locale === 'en')?.name ??
          category.parent.name
        : null;

      return {
        success: true,
        data: {
          category: {
            id: category.id,
            name: parentEn ? `${parentEn} › ${en}` : en,
            name_en: en,
            name_ar: ar,
            slug: category.slug,
            status: category.status === 'hidden' ? 'inactive' : category.status,
            parent_id: category.parentId,
            thumbnail_url: category.thumbnailUrl,
            is_parent: category.parentId == null,
          },
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A category with this URL slug already exists.');
      }
      throw error;
    }
  }

  async createVenue(input: CreateAdminEventVenueDto, adminUserId: string) {
    const name = input.name.trim();
    const nameAr = input.name_ar?.trim() || null;
    const slug = input.slug?.trim() || this.slugify(name);
    if (!slug) throw new BadRequestException('Enter a valid venue name.');

    const address = input.address?.trim() || null;
    const addressAr = input.address_ar?.trim() || null;
    const city = input.city?.trim() || null;
    const cityAr = input.city_ar?.trim() || null;
    const state = input.state?.trim() || null;
    const stateAr = input.state_ar?.trim() || null;
    const zipcode = input.zipcode?.trim() || null;
    const country = (input.country?.trim() || 'QA').toUpperCase();
    const countryAr = input.country_ar?.trim() || null;
    const about = sanitizeCmsHtmlOrNull(input.about);
    const aboutAr = sanitizeCmsHtmlOrNull(input.about_ar);
    const status = input.status === 'inactive' ? 'draft' : 'published';
    const latitude = input.latitude ?? null;
    const longitude = input.longitude ?? null;

    let googleMapUrl = input.google_map_url?.trim() || null;
    if (!googleMapUrl && latitude != null && longitude != null) {
      const query = encodeURIComponent(
        [address, city, state, country].filter(Boolean).join(', ') || `${latitude},${longitude}`,
      );
      googleMapUrl = `https://www.google.com/maps?q=${latitude},${longitude}&query=${query}`;
    }

    let bannerUrl: string | null = null;
    if (input.banner_data_url) {
      bannerUrl = await this.saveVenueImage(
        input.banner_data_url,
        input.banner_file_name,
        'banner',
      );
    }

    const galleryUrls: string[] = [];
    for (const [index, dataUrl] of (input.gallery_data_urls ?? []).entries()) {
      if (!dataUrl?.trim()) continue;
      galleryUrls.push(await this.saveVenueImage(dataUrl, `gallery-${index + 1}.jpg`, 'gallery'));
    }

    try {
      const venue = await this.prisma.venue.create({
        data: {
          name,
          slug,
          status,
          address,
          city,
          state,
          zipcode,
          country,
          latitude,
          longitude,
          googleMapUrl,
          bannerUrl,
          galleryUrls: galleryUrls.length ? galleryUrls : undefined,
          publishedAt: status === 'published' ? new Date() : null,
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
          translations: {
            create: [
              {
                locale: 'en',
                name,
                description: about,
                address,
                city,
                state,
                country: null,
              },
              ...(nameAr || aboutAr || addressAr || cityAr || stateAr || countryAr
                ? [
                    {
                      locale: 'ar',
                      name: nameAr || name,
                      description: aboutAr,
                      address: addressAr,
                      city: cityAr,
                      state: stateAr,
                      country: countryAr,
                    },
                  ]
                : []),
            ],
          },
        },
      });
      return {
        success: true,
        data: {
          venue: {
            id: venue.id,
            name: venue.name,
            status: venue.status === 'published' ? 'active' : 'inactive',
            city: venue.city,
            country: venue.country,
          },
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A venue with this URL slug already exists.');
      }
      throw error;
    }
  }

  async create(input: CreateAdminEventDto, adminUserId: string) {
    const title = input.title.trim();
    const slug = input.slug?.trim() || this.slugify(title);
    if (!slug) throw new BadRequestException('Enter a title that can be used as an event URL.');
    if (input.event_type === 'general' && input.booking_mode !== 'ticketed') {
      throw new BadRequestException('General events must use ticketed booking.');
    }
    if (input.arabic_content && !input.title_ar?.trim()) {
      throw new BadRequestException('Arabic title is required when Arabic content is enabled.');
    }

    const startsAt = input.starts_at ? new Date(input.starts_at) : null;
    const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('End date must be after the start date.');
    }

    const [venue, category, organization] = await Promise.all([
      input.venue_id
        ? this.prisma.venue.findUnique({ where: { id: input.venue_id }, select: { id: true } })
        : null,
      input.category_id
        ? this.prisma.eventCategory.findUnique({
            where: { id: input.category_id },
            select: { id: true },
          })
        : null,
      input.organization_id
        ? this.prisma.organization.findFirst({
            where: { id: input.organization_id, status: 'active' },
            select: { id: true },
          })
        : this.prisma.organization.findUnique({
            where: { slug: 'bookingqube' },
            select: { id: true },
          }),
    ]);
    if (input.venue_id && !venue) throw new NotFoundException('Selected venue was not found.');
    if (input.category_id && !category) {
      throw new NotFoundException('Selected category was not found.');
    }
    if (!organization) throw new NotFoundException('Selected organization was not found.');
    const organizer = input.organizer_user_id
      ? await this.resolveOrganizer(input.organizer_user_id)
      : null;

    const translations: Prisma.EventTranslationCreateWithoutEventInput[] = [
      {
        locale: 'en',
        title,
        subtitle: input.subtitle?.trim() || null,
        description: sanitizeCmsHtmlOrNull(input.description),
      },
    ];
    const titleAr = input.title_ar?.trim();
    if (titleAr) {
      translations.push({
        locale: 'ar',
        title: titleAr,
        subtitle: input.subtitle_ar?.trim() || null,
        description: sanitizeCmsHtmlOrNull(input.description_ar),
      });
    }

    try {
      const moreOpsConfig = input.entry_access
        ? (this.mergeEntryAccess(this.defaultMoreOps(), input.entry_access) as Prisma.InputJsonValue)
        : undefined;
      const event = await this.prisma.event.create({
        data: {
          organizationId: organization.id,
          slug,
          eventType: input.event_type,
          bookingMode: input.booking_mode,
          visibility: input.visibility,
          status: 'draft',
          requiresWaiver: input.requires_waiver ?? false,
          isFeatured: input.is_featured ?? false,
          seatSelectionEnabled: input.seat_selection_enabled ?? false,
          venueId: input.venue_id || null,
          categoryId: input.category_id || null,
          startsAt,
          endsAt,
          moreOpsConfig,
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
          primaryOrganizerId: organizer?.id ?? null,
          organizerAssignedByUserId: organizer ? adminUserId : null,
          organizerAssignedAt: organizer ? new Date() : null,
          translations: { create: translations },
        },
        include: eventInclude,
      });

      return { success: true, data: { event: this.toDto(event, 'en') } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An event with this URL slug already exists.');
      }
      throw error;
    }
  }

  async update(eventId: string, input: CreateAdminEventDto, adminUserId: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        moreOpsConfig: true,
        organizationId: true,
        primaryOrganizerId: true,
      },
    });
    if (!existing) throw new NotFoundException('Event was not found.');
    const title = input.title.trim();
    const slug = input.slug?.trim() || this.slugify(title);
    if (!slug) throw new BadRequestException('Enter a title that can be used as an event URL.');
    if (input.event_type === 'general' && input.booking_mode !== 'ticketed') throw new BadRequestException('General events must use ticketed booking.');
    if (input.arabic_content && !input.title_ar?.trim()) {
      throw new BadRequestException('Arabic title is required when Arabic content is enabled.');
    }
    const startsAt = input.starts_at ? new Date(input.starts_at) : null;
    const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('End date must be after the start date.');
    const [venue, category, organization] = await Promise.all([
      input.venue_id ? this.prisma.venue.findUnique({ where: { id: input.venue_id }, select: { id: true } }) : null,
      input.category_id ? this.prisma.eventCategory.findUnique({ where: { id: input.category_id }, select: { id: true } }) : null,
      input.organization_id ? this.prisma.organization.findFirst({ where: { id: input.organization_id, status: 'active' }, select: { id: true } }) : null,
    ]);
    if (input.venue_id && !venue) throw new NotFoundException('Selected venue was not found.');
    if (input.category_id && !category) throw new NotFoundException('Selected category was not found.');
    if (input.organization_id && !organization) throw new NotFoundException('Selected organization was not found.');
    const nextOrganizationId = organization?.id ?? existing.organizationId;
    const organizer = input.organizer_user_id
      ? await this.resolveOrganizer(input.organizer_user_id)
      : null;
    const organizationChanged = nextOrganizationId !== existing.organizationId;
    const organizerChanged = input.organizer_user_id !== undefined || organizationChanged;

    const existingOps = this.parseMoreOps(existing.moreOpsConfig);
    const nextOps = input.entry_access
      ? this.mergeEntryAccess(existingOps, input.entry_access)
      : null;

    try {
      const event = await this.prisma.$transaction(async (tx) => {
        await tx.eventTranslation.upsert({
          where: { eventId_locale: { eventId, locale: 'en' } },
          update: {
            title,
            subtitle: input.subtitle?.trim() || null,
            description: sanitizeCmsHtmlOrNull(input.description),
          },
          create: {
            eventId,
            locale: 'en',
            title,
            subtitle: input.subtitle?.trim() || null,
            description: sanitizeCmsHtmlOrNull(input.description),
          },
        });

        const titleAr = input.title_ar?.trim();
        if (titleAr) {
          await tx.eventTranslation.upsert({
            where: { eventId_locale: { eventId, locale: 'ar' } },
            update: {
              title: titleAr,
              subtitle: input.subtitle_ar?.trim() || null,
              description: sanitizeCmsHtmlOrNull(input.description_ar),
            },
            create: {
              eventId,
              locale: 'ar',
              title: titleAr,
              subtitle: input.subtitle_ar?.trim() || null,
              description: sanitizeCmsHtmlOrNull(input.description_ar),
            },
          });
        } else if (input.arabic_content === false) {
          await tx.eventTranslation.deleteMany({ where: { eventId, locale: 'ar' } });
        }

        return tx.event.update({
          where: { id: eventId },
          data: {
            slug,
            eventType: input.event_type,
            bookingMode: input.booking_mode,
            visibility: input.visibility,
            requiresWaiver: input.requires_waiver ?? false,
            isFeatured: input.is_featured ?? false,
            seatSelectionEnabled: input.seat_selection_enabled ?? false,
            venueId: input.venue_id || null,
            categoryId: input.category_id || null,
            organizationId: input.organization_id || undefined,
            primaryOrganizerId: organizerChanged ? organizer?.id ?? null : undefined,
            organizerAssignedByUserId: organizerChanged ? organizer ? adminUserId : null : undefined,
            organizerAssignedAt: organizerChanged ? organizer ? new Date() : null : undefined,
            startsAt,
            endsAt,
            moreOpsConfig: nextOps ? (nextOps as Prisma.InputJsonValue) : undefined,
            updatedByUserId: adminUserId,
          },
          include: eventInclude,
        });
      });
      return { success: true, data: { event: this.toDto(event, 'en') } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An event with this URL slug already exists.');
      throw error;
    }
  }

  async list(
    query: AdminEventListQueryDto,
    scopedOrganizationId?: string,
    scopedOrganizerId?: string,
    scopedEventIds?: string[] | null,
  ) {
    if (query.status && !['draft', 'review', 'published', 'archived'].includes(query.status)) {
      throw new BadRequestException('Invalid event status filter.');
    }
    if (query.visibility && !['public', 'private', 'unlisted'].includes(query.visibility)) {
      throw new BadRequestException('Invalid event visibility filter.');
    }
    const search = query.search?.trim();
    const page = Number(query.page) || 1;
    const perPage = Number(query.per_page) || 20;
    const locale = query.lang === 'ar' ? 'ar' : 'en';
    const where: Prisma.EventWhereInput = {
      organizationId: scopedOrganizationId ?? query.organization_id,
      primaryOrganizerId: scopedOrganizerId,
      ...(scopedEventIds ? { id: { in: scopedEventIds } } : {}),
      status: query.status,
      visibility: query.visibility,
      ...(search
        ? {
            OR: [
              { slug: { contains: search, mode: 'insensitive' } },
              { translations: { some: { title: { contains: search, mode: 'insensitive' } } } },
              { venue: { is: { name: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const skip = (page - 1) * perPage;
    const statusCountWhere: Prisma.EventWhereInput = {
      organizationId: scopedOrganizationId ?? query.organization_id,
      primaryOrganizerId: scopedOrganizerId,
      ...(scopedEventIds ? { id: { in: scopedEventIds } } : {}),
    };
    const [events, total, statusCounts] = await Promise.all([
      this.prisma.event.findMany({
        where,
        include: eventInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: perPage,
      }),
      this.prisma.event.count({ where }),
      this.prisma.event.groupBy({
        by: ['status'],
        where: statusCountWhere,
        orderBy: { status: 'asc' },
        _count: { status: true },
      }),
    ]);

    return {
      success: true,
      data: {
        events: events.map((event) => this.toDto(event, locale)),
        pagination: {
          page,
          per_page: perPage,
          total,
          total_pages: Math.max(1, Math.ceil(total / perPage)),
        },
        status_counts: Object.fromEntries(
          statusCounts.map((item) => [item.status, item._count.status]),
        ),
        filters: {
          search: search ?? '',
          status: query.status ?? null,
          visibility: query.visibility ?? null,
          lang: locale,
        },
      },
    };
  }

  async assignOrganizer(
    eventId: string,
    organizerUserId: string | null,
    adminUserId: string,
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, organizationId: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const organizer = organizerUserId
      ? await this.resolveOrganizer(organizerUserId)
      : null;
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        primaryOrganizerId: organizer?.id ?? null,
        organizerAssignedByUserId: organizer ? adminUserId : null,
        organizerAssignedAt: organizer ? new Date() : null,
        updatedByUserId: adminUserId,
      },
      include: eventInclude,
    });

    return { success: true, data: { event: this.toDto(updated, 'en') } };
  }

  async organizerDetails(eventId: string, organizerUserId: string) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, primaryOrganizerId: organizerUserId },
      include: eventInclude,
    });
    if (!event) throw new NotFoundException('Assigned event was not found.');
    const en = event.translations.find((item) => item.locale === 'en');
    const ar = event.translations.find((item) => item.locale === 'ar');
    return {
      success: true,
      data: {
        event: {
          ...this.toDto(event, 'en'),
          description: en?.description ?? null,
          title_ar: ar?.title ?? null,
          subtitle_ar: ar?.subtitle ?? null,
          description_ar: ar?.description ?? null,
        },
      },
    };
  }

  async updateOrganizerEvent(
    eventId: string,
    organizerUserId: string,
    input: UpdateOrganizerEventDto,
  ) {
    const existing = await this.prisma.event.findFirst({
      where: { id: eventId, primaryOrganizerId: organizerUserId },
      select: { id: true, startsAt: true, endsAt: true },
    });
    if (!existing) throw new NotFoundException('Assigned event was not found.');

    const startsAt = input.starts_at ? new Date(input.starts_at) : existing.startsAt;
    const endsAt = input.ends_at ? new Date(input.ends_at) : existing.endsAt;
    if (startsAt && endsAt && endsAt <= startsAt) {
      throw new BadRequestException('End date must be after the start date.');
    }

    const event = await this.prisma.$transaction(async (tx) => {
      const enData: Prisma.EventTranslationUpdateInput = {
        title: input.title?.trim(),
        subtitle: input.subtitle !== undefined ? input.subtitle.trim() || null : undefined,
        description:
          input.description !== undefined
            ? sanitizeCmsHtmlOrNull(input.description)
            : undefined,
      };
      if (Object.values(enData).some((value) => value !== undefined)) {
        const current = await tx.eventTranslation.findUnique({
          where: { eventId_locale: { eventId, locale: 'en' } },
          select: { title: true },
        });
        await tx.eventTranslation.upsert({
          where: { eventId_locale: { eventId, locale: 'en' } },
          update: enData,
          create: {
            eventId,
            locale: 'en',
            title: input.title?.trim() || current?.title || 'Untitled event',
            subtitle: input.subtitle?.trim() || null,
            description: sanitizeCmsHtmlOrNull(input.description),
          },
        });
      }

      const arTouched = [input.title_ar, input.subtitle_ar, input.description_ar].some(
        (value) => value !== undefined,
      );
      if (arTouched && input.title_ar?.trim()) {
        await tx.eventTranslation.upsert({
          where: { eventId_locale: { eventId, locale: 'ar' } },
          update: {
            title: input.title_ar.trim(),
            subtitle:
              input.subtitle_ar !== undefined ? input.subtitle_ar.trim() || null : undefined,
            description:
              input.description_ar !== undefined
                ? sanitizeCmsHtmlOrNull(input.description_ar)
                : undefined,
          },
          create: {
            eventId,
            locale: 'ar',
            title: input.title_ar.trim(),
            subtitle: input.subtitle_ar?.trim() || null,
            description: sanitizeCmsHtmlOrNull(input.description_ar),
          },
        });
      }

      return tx.event.update({
        where: { id: eventId },
        data: {
          startsAt: input.starts_at !== undefined ? startsAt : undefined,
          endsAt: input.ends_at !== undefined ? endsAt : undefined,
          updatedByUserId: organizerUserId,
        },
        include: eventInclude,
      });
    });

    return { success: true, data: { event: this.toDto(event, 'en') } };
  }

  async setStatus(eventId: string, status: 'archived' | 'draft', adminUserId: string) {
    const existing = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!existing) throw new NotFoundException('Event was not found.');

    const event = await this.prisma.event.update({
      where: { id: eventId },
      data: { status, updatedByUserId: adminUserId },
      select: { id: true, status: true, updatedAt: true },
    });
    return {
      success: true,
      data: {
        event: {
          id: event.id,
          status: event.status,
          updated_at: event.updatedAt.toISOString(),
        },
      },
    };
  }

  async deleteEvent(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, _count: { select: { orders: true } } },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    if (event._count.orders > 0) {
      throw new BadRequestException(
        'Events with orders cannot be deleted. Inactivate this event instead.',
      );
    }

    await this.prisma.event.delete({ where: { id: eventId } });
    return { success: true, data: { deleted_event_id: eventId } };
  }

  async setup(eventId: string, scopedVendorId?: string | null) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organization: true,
        primaryOrganizer: { select: { id: true, name: true, email: true } },
        translations: true,
        venue: { select: { id: true, name: true } },
        category: { select: { id: true, name: true } },
        media: { include: { mediaAsset: true }, orderBy: [{ mediaRole: 'asc' }, { sortOrder: 'asc' }] },
        sessions: { include: { inventoryItems: true }, orderBy: { startsAt: 'asc' } },
        ticketTypes: {
          where:
            scopedVendorId === undefined
              ? undefined
              : scopedVendorId === null
                ? { id: { in: [] } }
                : { thirdPartyVendorId: scopedVendorId },
          include: {
            variants: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
            customizationOptions: { orderBy: [{ sortOrder: 'asc' }] },
            thirdPartyVendor: { select: { id: true, name: true, isMain: true, isCafe: true } },
            thirdPartyPlatform: { select: { id: true, name: true, accessCode: true, badgeColor: true } },
          },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        thirdPartyVendors: {
          where:
            scopedVendorId === undefined
              ? undefined
              : scopedVendorId === null
                ? { id: { in: [] } }
                : { id: scopedVendorId },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
        thirdPartyPlatforms: {
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    const timingRows = await this.prisma.$queryRaw<Array<{ timing_config: unknown }>>`
      SELECT timing_config FROM events WHERE id = ${eventId}::uuid
    `;
    const timingConfigRow = timingRows[0]?.timing_config ?? null;
    const translation = event.translations.find((item) => item.locale === 'en') ?? event.translations[0];
    const translationAr = event.translations.find((item) => item.locale === 'ar');
    const title = translation?.title ?? event.slug;
    return {
      success: true,
      data: {
        event: {
          id: event.id, slug: event.slug, title, subtitle: translation?.subtitle ?? null,
          description: translation?.description ?? null,
          title_ar: translationAr?.title ?? null,
          subtitle_ar: translationAr?.subtitle ?? null,
          description_ar: translationAr?.description ?? null,
          arabic_content: Boolean(translationAr?.title),
          status: event.status,
          event_type: event.eventType, booking_mode: event.bookingMode, visibility: event.visibility,
          requires_waiver: event.requiresWaiver,
          is_featured: event.isFeatured,
          seat_selection_enabled: event.seatSelectionEnabled,
          venue_id: event.venue?.id ?? null, category_id: event.category?.id ?? null,
          venue: event.venue ? { id: event.venue.id, name: event.venue.name } : null,
          category: event.category ? { id: event.category.id, name: event.category.name } : null,
          organization_id: event.organization.id, currency: event.currency,
          organization: { id: event.organization.id, name: event.organization.name },
          organizer: event.primaryOrganizer
            ? {
                id: event.primaryOrganizer.id,
                name: event.primaryOrganizer.name,
                email: event.primaryOrganizer.email,
              }
            : null,
          starts_at: event.startsAt?.toISOString() ?? null,
          ends_at: event.endsAt?.toISOString() ?? null,
          timing_config: timingConfigRow,
          entry_access: this.parseMoreOps(event.moreOpsConfig).entry_access,
          scoped_third_party_vendor_id: scopedVendorId ?? null,
        },
        sessions: event.sessions.map((session) => ({
          id: session.id, starts_at: session.startsAt.toISOString(), ends_at: session.endsAt?.toISOString() ?? null,
          display_time: session.displayTime, capacity: session.capacity, status: session.status,
          allocated: session.inventoryItems.reduce((sum, item) => sum + (item.totalQuantity ?? 0), 0),
        })),
        ticket_types: event.ticketTypes.map((ticket) => ({
          id: ticket.id, external_key: ticket.externalKey, title: ticket.title, subtitle: ticket.subtitle,
          inclusions: ticket.inclusions, exclusions: ticket.exclusions,
          has_variants: ticket.hasVariants,
          pricing_mode: ticket.iconType === 'bands' || ticket.iconType === 'variants' || ticket.iconType === 'simple'
            ? ticket.iconType
            : ticket.hasVariants ? 'variants' : 'simple',
          price: ticket.basePrice?.toNumber() ?? null, currency: ticket.currency, status: ticket.status,
          max_qty_per_order: ticket.maxQtyPerOrder, admit_count: ticket.admitCount,
          has_duration: ticket.hasDuration,
          duration_minutes: ticket.durationMinutes,
          hide_from_online: ticket.hideFromOnline,
          hide_from_pos: ticket.hideFromPos,
          third_party_vendor_id: ticket.thirdPartyVendorId,
          third_party_vendor: ticket.thirdPartyVendor
            ? {
                id: ticket.thirdPartyVendor.id,
                name: ticket.thirdPartyVendor.name,
                is_main: ticket.thirdPartyVendor.isMain,
                is_cafe: ticket.thirdPartyVendor.isCafe,
              }
            : null,
          is_third_party_platform_ticket: ticket.isThirdPartyPlatformTicket,
          third_party_platform_id: ticket.thirdPartyPlatformId,
          third_party_platform: ticket.thirdPartyPlatform
            ? {
                id: ticket.thirdPartyPlatform.id,
                name: ticket.thirdPartyPlatform.name,
                access_code: ticket.thirdPartyPlatform.accessCode,
                badge_color: ticket.thirdPartyPlatform.badgeColor,
              }
            : null,
          sales_start_at: ticket.salesStartAt?.toISOString() ?? null,
          sales_end_at: ticket.salesEndAt?.toISOString() ?? null,
          is_customizable: ticket.isCustomizable,
          session_ids: event.sessions.filter((session) => session.inventoryItems.some((item) => item.itemType === 'ticket_type' && item.itemId === ticket.id)).map((session) => session.id),
          variants: ticket.variants.map((variant) => ({
            id: variant.id, external_key: variant.externalKey, name: variant.name,
            description: variant.description, price: variant.basePrice.toNumber(), currency: variant.currency,
            badge: variant.badge, duration_minutes: variant.durationMinutes,
            max_qty_per_order: variant.maxQtyPerOrder, status: variant.status,
          })),
          customization_options: ticket.customizationOptions
            .filter((option) => option.status !== 'archived')
            .map((option) => this.mapCustomizationOption(option)),
        })),
        third_party_vendors: event.thirdPartyVendors.map((share) => this.mapThirdPartyVendor(share)),
        third_party_platforms: event.thirdPartyPlatforms.map((platform) =>
          this.mapThirdPartyPlatform(platform),
        ),
        media: event.media.map((item) => ({
          id: item.id, role: item.mediaRole, sort_order: item.sortOrder,
          url: item.mediaAsset.url, alt_text: item.mediaAsset.altText,
          width: item.mediaAsset.width, height: item.mediaAsset.height,
          mime_type: item.mediaAsset.mimeType, size_bytes: Number(item.mediaAsset.sizeBytes ?? 0),
        })),
      },
    };
  }

  async applyTiming(eventId: string, input: ApplyAdminEventTimingDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    if (input.end_date < input.start_date) {
      throw new BadRequestException('End date must be on or after the start date.');
    }

    const trackInventory =
      input.track_inventory ?? input.default_capacity != null;
    const slotsProvideCapacity = timingSlotsProvideCapacity(input);
    if (
      trackInventory &&
      (input.default_capacity == null || input.default_capacity < 1) &&
      !slotsProvideCapacity
    ) {
      throw new BadRequestException(
        'Enter a capacity when inventory tracking is enabled.',
      );
    }
    const defaultCapacity =
      input.default_capacity != null && input.default_capacity >= 1
        ? input.default_capacity
        : null;
    const planned = planSessionsFromTiming(input, defaultCapacity);
    // Multi-year venues (e.g. InflataPark) need ~1 session/day × years; allow up to 5k.
    if (planned.length > 5000) {
      throw new BadRequestException(
        `This pattern would create ${planned.length} sessions. Narrow the date range or reduce slots (max 5000).`,
      );
    }
    if (input.mode !== 'preferred' && planned.length === 0) {
      throw new BadRequestException('No sessions match this pattern. Check days, slots, and date range.');
    }

    const windowStart = qatarDateTime(input.start_date, input.start_time ?? '00:00');
    const windowEnd = qatarDateTime(input.end_date, input.end_time ?? '23:59');

    const timingConfig = {
      mode: input.mode,
      start_date: input.start_date,
      end_date: input.end_date,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null,
      daily: input.daily ?? null,
      monthly: input.monthly ?? null,
      custom: input.custom ?? null,
      track_inventory:
        trackInventory || planned.some((item) => item.capacity != null),
      default_capacity: defaultCapacity,
      generated_at: new Date().toISOString(),
      generated_count: planned.length,
    } as Prisma.InputJsonValue;

    const result = await this.prisma.$transaction(
      async (tx) => {
        let removed = 0;
        let hidden = 0;
        if (input.replace_existing !== false) {
          // Bulk relation filters — avoid loading every session + order count
          // (weekly schedules can have hundreds of rows and blow the default 5s tx).
          const removableWhere = { eventId, orders: { none: {} } } as const;
          const removableCount = await tx.eventSession.count({
            where: removableWhere,
          });
          if (removableCount > 0) {
            // Drop holds first so hold_items no longer reference inventory rows.
            await tx.ticketHold.deleteMany({
              where: { eventSession: removableWhere },
            });
            await tx.inventoryItem.deleteMany({
              where: { eventSession: removableWhere },
            });
            const deleted = await tx.eventSession.deleteMany({
              where: removableWhere,
            });
            removed = deleted.count;
          }
          // Sessions with bookings cannot be deleted — hide them so the customer
          // schedule reflects the new pattern (e.g. preferred window without slots).
          const blocked = await tx.eventSession.updateMany({
            where: {
              eventId,
              status: { not: 'hidden' },
              orders: { some: {} },
            },
            data: { status: 'hidden' },
          });
          hidden = blocked.count;
          // Clean orphan dates with no sessions
          await tx.eventDate.deleteMany({
            where: { eventId, sessions: { none: {} } },
          });
        }

        const createdSessions: Array<{
          id: string;
          starts_at: string;
          ends_at: string | null;
          display_time: string;
          capacity: number | null;
          status: string;
        }> = [];

        const sessionItems =
          planned.length > 0
            ? planned
            : input.mode === 'preferred' && input.start_time && input.end_time
              ? [
                  {
                    startsAt: qatarDateTime(input.start_date, input.start_time),
                    endsAt: qatarDateTime(input.end_date, input.end_time),
                    displayTime: formatDisplayTimeQatar(
                      qatarDateTime(input.start_date, input.start_time),
                    ),
                    capacity: defaultCapacity,
                  },
                ]
              : [];

        if (sessionItems.length > 0) {
          const dateKeys = Array.from(
            new Set(
              sessionItems.map((item) =>
                this.qatarDate(item.startsAt).toISOString().slice(0, 10),
              ),
            ),
          );
          for (let i = 0; i < dateKeys.length; i += 100) {
            const chunk = dateKeys.slice(i, i + 100);
            await tx.eventDate.createMany({
              data: chunk.map((d) => ({
                eventId,
                date: new Date(`${d}T00:00:00.000Z`),
                status: 'active' as const,
              })),
              skipDuplicates: true,
            });
            await tx.eventDate.updateMany({
              where: {
                eventId,
                date: { in: chunk.map((d) => new Date(`${d}T00:00:00.000Z`)) },
              },
              data: { status: 'active' },
            });
          }

          const eventDates = await tx.eventDate.findMany({
            where: { eventId },
            select: { id: true, date: true },
          });
          const dateIdByKey = new Map(
            eventDates.map((d) => [d.date.toISOString().slice(0, 10), d.id]),
          );

          for (let i = 0; i < sessionItems.length; i += 250) {
            const chunk = sessionItems.slice(i, i + 250);
            await tx.eventSession.createMany({
              data: chunk.map((item) => {
                const dateKey = this.qatarDate(item.startsAt).toISOString().slice(0, 10);
                const eventDateId = dateIdByKey.get(dateKey);
                if (!eventDateId) {
                  throw new BadRequestException(`Missing event date for ${dateKey}`);
                }
                return {
                  eventId,
                  eventDateId,
                  startsAt: item.startsAt,
                  endsAt: item.endsAt,
                  displayTime: item.displayTime,
                  capacity: item.capacity,
                  status: 'active' as const,
                };
              }),
            });
          }

          const created = await tx.eventSession.findMany({
            where: { eventId, status: 'active' },
            orderBy: { startsAt: 'asc' },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              displayTime: true,
              capacity: true,
              status: true,
            },
          });
          // Only report sessions from this apply (approximate: all active after replace).
          for (const session of created) {
            createdSessions.push({
              id: session.id,
              starts_at: session.startsAt.toISOString(),
              ends_at: session.endsAt?.toISOString() ?? null,
              display_time: session.displayTime,
              capacity: session.capacity,
              status: session.status,
            });
          }
        }

        if (createdSessions.length > 0) {
          await this.ensureInventoryForSessions(
            tx,
            eventId,
            createdSessions.map((session) => ({
              id: session.id,
              capacity: session.capacity,
            })),
          );
        }

        await tx.event.update({
          where: { id: eventId },
          data: {
            startsAt: windowStart,
            endsAt: windowEnd,
          },
        });
        await tx.$executeRawUnsafe(
          `UPDATE events SET timing_config = $1::jsonb WHERE id = $2::uuid`,
          JSON.stringify(timingConfig),
          eventId,
        );

        return { createdSessions, removed, hidden };
      },
      { maxWait: 15_000, timeout: 180_000 },
    );

    return {
      success: true,
      data: {
        timing_config: timingConfig,
        sessions_created: result.createdSessions.length,
        sessions_removed: result.removed,
        sessions_hidden: result.hidden,
        sessions: result.createdSessions.slice(0, 50),
        event: {
          id: eventId,
          starts_at: windowStart.toISOString(),
          ends_at: windowEnd.toISOString(),
        },
      },
    };
  }

  async createSession(eventId: string, input: CreateAdminEventSessionDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, startsAt: true, endsAt: true } });
    if (!event) throw new NotFoundException('Event was not found.');
    const startsAt = new Date(input.starts_at); const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (endsAt && endsAt <= startsAt) throw new BadRequestException('Session end time must be after its start time.');
    const date = this.qatarDate(startsAt);
    const session = await this.prisma.$transaction(async (tx) => {
      const eventDate = await tx.eventDate.upsert({ where: { eventId_date: { eventId, date } }, update: { status: 'active' }, create: { eventId, date, status: 'active' } });
      const created = await tx.eventSession.create({ data: { eventId, eventDateId: eventDate.id, startsAt, endsAt, displayTime: new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Qatar', hour: 'numeric', minute: '2-digit' }).format(startsAt), capacity: input.capacity, status: 'active' } });
      await this.ensureInventoryForSessions(tx, eventId, [
        { id: created.id, capacity: created.capacity },
      ]);
      await tx.event.update({ where: { id: eventId }, data: { startsAt: !event.startsAt || startsAt < event.startsAt ? startsAt : event.startsAt, endsAt: endsAt && (!event.endsAt || endsAt > event.endsAt) ? endsAt : event.endsAt } });
      return created;
    });
    return { success: true, data: { session: { id: session.id, starts_at: session.startsAt.toISOString(), ends_at: session.endsAt?.toISOString() ?? null, display_time: session.displayTime, capacity: session.capacity, status: session.status, allocated: 0 } } };
  }

  async createTicketType(
    eventId: string,
    input: CreateAdminTicketTypeDto,
    scopedVendorId?: string | null,
  ) {
    if (scopedVendorId === null) {
      throw new ForbiddenException(
        'You do not have a third-party vendor assignment for this event.',
      );
    }
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true, bookingMode: true, ticketTypes: { select: { sortOrder: true } } } });
    if (!event) throw new NotFoundException('Event was not found.');
    if (event.bookingMode !== 'ticketed') throw new BadRequestException('Registration events do not use ticket types.');
    const sessionIds = input.session_ids ?? [];
    const sessions = sessionIds.length
      ? await this.prisma.eventSession.findMany({ where: { eventId, id: { in: sessionIds } }, select: { id: true, capacity: true } })
      : await this.prisma.eventSession.findMany({ where: { eventId, status: 'active' }, select: { id: true, capacity: true } });
    if (sessionIds.length && sessions.length !== new Set(sessionIds).size) {
      throw new BadRequestException('One or more selected sessions do not belong to this event.');
    }
    const isCustomizable = Boolean(input.is_customizable);
    const customizationOptions = input.customization_options ?? [];
    const variants = input.variants ?? [];
    const pricingMode =
      input.ticket_mode === 'normal' || input.ticket_mode === 'simple'
        ? 'simple'
        : input.ticket_mode === 'bands'
          ? 'bands'
          : 'variants';
    const usesVariants = pricingMode === 'bands' || pricingMode === 'variants';
    if (isCustomizable && usesVariants) {
      throw new BadRequestException(
        'Customizable tickets cannot use variants. Use a simple ticket with customization items.',
      );
    }
    if (isCustomizable) {
      this.assertCustomizationOptions(customizationOptions);
    } else if (customizationOptions.length > 0) {
      throw new BadRequestException('Turn on Customize ticket before adding customization items.');
    }
    if (!usesVariants && !isCustomizable && input.price === undefined) {
      throw new BadRequestException('Enter a price for a simple ticket.');
    }
    if (usesVariants && variants.length === 0) {
      throw new BadRequestException(
        pricingMode === 'bands' ? 'Add at least one price band.' : 'Add at least one ticket variant.',
      );
    }
    const variantKeys = variants.map((variant) => this.slugify(variant.name));
    if (variantKeys.some((key) => !key) || new Set(variantKeys).size !== variantKeys.length) throw new BadRequestException('Variant names must be unique.');
    const optionKeys = customizationOptions.map((option) => this.slugify(option.name));
    if (isCustomizable && (optionKeys.some((key) => !key) || new Set(optionKeys).size !== optionKeys.length)) {
      throw new BadRequestException('Customization item names must be unique.');
    }
    const hasDuration = Boolean(input.has_duration);
    if (hasDuration && !usesVariants && !isCustomizable && !input.duration_minutes) {
      throw new BadRequestException('Enter a duration in minutes for this timed ticket.');
    }
    if (hasDuration && usesVariants && variants.some((variant) => !variant.duration_minutes)) {
      throw new BadRequestException('Enter a duration in minutes for every variant.');
    }
    if (isCustomizable && hasDuration && customizationOptions.some((option) => !option.duration_minutes)) {
      throw new BadRequestException('Enter a duration in minutes for every customization item.');
    }
    const salesStartAt = input.sales_start_at ? new Date(input.sales_start_at) : null; const salesEndAt = input.sales_end_at ? new Date(input.sales_end_at) : null;
    if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) throw new BadRequestException('Ticket sales end must be after the sales start.');
    let thirdPartyVendorId: string | null = null;
    if (scopedVendorId) {
      thirdPartyVendorId = scopedVendorId;
    } else if (input.third_party_vendor_id) {
      const share = await this.prisma.thirdPartyVendor.findFirst({
        where: { id: input.third_party_vendor_id, eventId },
        select: { id: true },
      });
      if (!share) throw new BadRequestException('Selected vendor does not belong to this event.');
      thirdPartyVendorId = share.id;
    }
    const platformLink = await this.resolveThirdPartyPlatformLink(eventId, {
      is_third_party_platform_ticket: input.is_third_party_platform_ticket,
      third_party_platform_id: input.third_party_platform_id,
    });
    const hideFromOnline = platformLink.isThirdPartyPlatformTicket
      ? true
      : Boolean(input.hide_from_online);
    const basePrice = usesVariants
      ? null
      : isCustomizable
        ? (input.price ?? 0).toFixed(3)
        : input.price!.toFixed(3);
    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        const created = await tx.ticketType.create({
          data: {
            eventId, externalKey: this.slugify(input.title), title: input.title.trim(), subtitle: input.subtitle?.trim() || null,
            inclusions: this.cleanTicketList(input.inclusions), exclusions: this.cleanTicketList(input.exclusions),
            iconType: pricingMode,
            thirdPartyVendorId,
            isThirdPartyPlatformTicket: platformLink.isThirdPartyPlatformTicket,
            thirdPartyPlatformId: platformLink.thirdPartyPlatformId,
            hasVariants: usesVariants,
            isCustomizable,
            basePrice,
            currency: 'QAR', admitCount: input.admit_count ?? 1, maxQtyPerOrder: input.max_qty_per_order ?? 10,
            hasDuration,
            durationMinutes: hasDuration && !usesVariants && !isCustomizable ? input.duration_minutes ?? null : null,
            hideFromOnline,
            hideFromPos: Boolean(input.hide_from_pos),
            salesStartAt, salesEndAt, status: 'active', sortOrder: Math.max(0, ...event.ticketTypes.map((item) => item.sortOrder)) + 1,
            variants: usesVariants ? { create: variants.map((variant, index) => ({
              externalKey: variantKeys[index], name: variant.name.trim(), description: variant.description?.trim() || null,
              basePrice: variant.price.toFixed(3), currency: 'QAR', badge: variant.badge?.trim() || null,
              durationMinutes: hasDuration ? variant.duration_minutes ?? null : null,
              maxQtyPerOrder: variant.max_qty_per_order ?? input.max_qty_per_order ?? 10, status: 'active', sortOrder: index + 1,
            })) } : undefined,
            customizationOptions: isCustomizable
              ? {
                  create: customizationOptions.map((option, index) => ({
                      externalKey: optionKeys[index],
                      name: option.name.trim(),
                      description: option.description?.trim() || null,
                      price: option.price.toFixed(3),
                      currency: 'QAR',
                      hasDuration,
                      durationMinutes: hasDuration ? option.duration_minutes ?? null : null,
                      maxQtyPerTicket: option.max_qty_per_ticket ?? null,
                      status: 'active' as const,
                      sortOrder: index + 1,
                    })),
                }
              : undefined,
          },
          include: {
            variants: { orderBy: { sortOrder: 'asc' } },
            customizationOptions: { orderBy: { sortOrder: 'asc' } },
            thirdPartyVendor: { select: { id: true, name: true, isMain: true, isCafe: true } },
            thirdPartyPlatform: { select: { id: true, name: true, accessCode: true, badgeColor: true } },
          },
        });
        if (sessions.length && !created.hasVariants) {
          await tx.inventoryItem.createMany({ data: sessions.map((session) => ({ eventId, eventSessionId: session.id, itemType: 'ticket_type' as const, itemId: created.id, totalQuantity: input.inventory_quantity ?? session.capacity ?? null, status: 'active' as const })) });
        }
        if (sessions.length && created.hasVariants) {
          await tx.inventoryItem.createMany({ data: sessions.flatMap((session) => created.variants.map((variant) => ({ eventId, eventSessionId: session.id, itemType: 'ticket_variant' as const, itemId: variant.id, totalQuantity: input.inventory_quantity ?? session.capacity ?? null, status: 'active' as const }))) });
        }
        return created;
      });
      return {
        success: true,
        data: {
          ticket_type: this.mapAdminTicketType(ticket, pricingMode, sessionIds),
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('A ticket type with this name already exists for the event.');
      throw error;
    }
  }

  async importTicketTypes(
    eventId: string,
    input: ImportAdminTicketTypesDto,
    scopedVendorId?: string | null,
  ) {
    if (!input.tickets?.length) {
      throw new BadRequestException('Add at least one ticket product to import.');
    }
    if (input.tickets.length > 100) {
      throw new BadRequestException('Import is limited to 100 products at a time.');
    }

    const results: Array<{
      index: number;
      title: string;
      status: 'success' | 'error';
      ticket_type_id?: string;
      message?: string;
    }> = [];

    for (const [index, ticket] of input.tickets.entries()) {
      try {
        const created = await this.createTicketType(eventId, ticket, scopedVendorId);
        results.push({
          index: index + 1,
          title: ticket.title,
          status: 'success',
          ticket_type_id: created.data.ticket_type.id,
        });
      } catch (error) {
        const message =
          error instanceof BadRequestException ||
          error instanceof ConflictException ||
          error instanceof NotFoundException
            ? Array.isArray((error.getResponse() as { message?: string | string[] }).message)
              ? ((error.getResponse() as { message: string[] }).message)[0]
              : typeof (error.getResponse() as { message?: string }).message === 'string'
                ? (error.getResponse() as { message: string }).message
                : error.message
            : error instanceof Error
              ? error.message
              : 'Unable to import ticket.';
        results.push({
          index: index + 1,
          title: ticket.title,
          status: 'error',
          message,
        });
      }
    }

    const importedCount = results.filter((item) => item.status === 'success').length;
    return {
      success: true,
      data: {
        imported_count: importedCount,
        failed_count: results.length - importedCount,
        results,
      },
    };
  }

  async updateTicketType(
    eventId: string,
    ticketTypeId: string,
    input: UpdateAdminTicketTypeDto,
    scopedVendorId?: string | null,
  ) {
    if (scopedVendorId === null) {
      throw new ForbiddenException(
        'You do not have a third-party vendor assignment for this event.',
      );
    }
    const existing = await this.prisma.ticketType.findFirst({
      where: { id: ticketTypeId, eventId },
      include: {
        variants: { orderBy: { sortOrder: 'asc' } },
        customizationOptions: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!existing) throw new NotFoundException('Ticket type was not found.');
    if (scopedVendorId && existing.thirdPartyVendorId !== scopedVendorId) {
      throw new ForbiddenException(
        'You can only manage tickets for your assigned third-party vendor.',
      );
    }

    const isCustomizable = Boolean(input.is_customizable);
    const customizationOptions = input.customization_options ?? [];
    const variants = input.variants ?? [];
    const pricingMode =
      input.ticket_mode === 'normal' || input.ticket_mode === 'simple'
        ? 'simple'
        : input.ticket_mode === 'bands'
          ? 'bands'
          : 'variants';
    const usesVariants = pricingMode === 'bands' || pricingMode === 'variants';
    if (isCustomizable && usesVariants) {
      throw new BadRequestException(
        'Customizable tickets cannot use variants. Use a simple ticket with customization items.',
      );
    }
    if (isCustomizable) {
      this.assertCustomizationOptions(customizationOptions);
    } else if (customizationOptions.length > 0) {
      throw new BadRequestException('Turn on Customize ticket before adding customization items.');
    }
    if (!usesVariants && !isCustomizable && input.price === undefined) {
      throw new BadRequestException('Enter a price for a simple ticket.');
    }
    if (usesVariants && variants.length === 0) {
      throw new BadRequestException(
        pricingMode === 'bands' ? 'Add at least one price band.' : 'Add at least one ticket variant.',
      );
    }
    const variantKeys = variants.map((variant) => this.slugify(variant.name));
    if (variantKeys.some((key) => !key) || new Set(variantKeys).size !== variantKeys.length) {
      throw new BadRequestException('Variant names must be unique.');
    }
    const optionKeys = customizationOptions.map((option) => this.slugify(option.name));
    if (isCustomizable && (optionKeys.some((key) => !key) || new Set(optionKeys).size !== optionKeys.length)) {
      throw new BadRequestException('Customization item names must be unique.');
    }
    const existingIds = new Set(existing.variants.map((variant) => variant.id));
    for (const variant of variants) {
      if (variant.id && !existingIds.has(variant.id)) {
        throw new BadRequestException('One or more variants do not belong to this ticket.');
      }
    }
    const existingOptionIds = new Set(existing.customizationOptions.map((option) => option.id));
    for (const option of customizationOptions) {
      if (option.id && !existingOptionIds.has(option.id)) {
        throw new BadRequestException('One or more customization items do not belong to this ticket.');
      }
    }
    const hasDuration = Boolean(input.has_duration);
    if (hasDuration && !usesVariants && !isCustomizable && !input.duration_minutes) {
      throw new BadRequestException('Enter a duration in minutes for this timed ticket.');
    }
    if (hasDuration && usesVariants && variants.some((variant) => !variant.duration_minutes)) {
      throw new BadRequestException('Enter a duration in minutes for every variant.');
    }
    if (isCustomizable && hasDuration && customizationOptions.some((option) => !option.duration_minutes)) {
      throw new BadRequestException('Enter a duration in minutes for every customization item.');
    }
    const salesStartAt =
      input.sales_start_at === undefined
        ? existing.salesStartAt
        : input.sales_start_at
          ? new Date(input.sales_start_at)
          : null;
    const salesEndAt =
      input.sales_end_at === undefined
        ? existing.salesEndAt
        : input.sales_end_at
          ? new Date(input.sales_end_at)
          : null;
    if (salesStartAt && salesEndAt && salesEndAt <= salesStartAt) {
      throw new BadRequestException('Ticket sales end must be after the sales start.');
    }

    let thirdPartyVendorId: string | null = null;
    if (scopedVendorId) {
      thirdPartyVendorId = scopedVendorId;
    } else if (input.third_party_vendor_id) {
      const share = await this.prisma.thirdPartyVendor.findFirst({
        where: { id: input.third_party_vendor_id, eventId },
        select: { id: true },
      });
      if (!share) throw new BadRequestException('Selected vendor does not belong to this event.');
      thirdPartyVendorId = share.id;
    } else if (input.third_party_vendor_id === null) {
      thirdPartyVendorId = null;
    } else {
      thirdPartyVendorId = existing.thirdPartyVendorId;
    }

    const platformLink = await this.resolveThirdPartyPlatformLink(
      eventId,
      {
        is_third_party_platform_ticket: input.is_third_party_platform_ticket,
        third_party_platform_id: input.third_party_platform_id,
      },
      {
        isThirdPartyPlatformTicket: existing.isThirdPartyPlatformTicket,
        thirdPartyPlatformId: existing.thirdPartyPlatformId,
      },
    );
    const hideFromOnline = platformLink.isThirdPartyPlatformTicket
      ? true
      : Boolean(input.hide_from_online);

    const status =
      input.status === 'inactive' ? 'hidden' : input.status === 'active' ? 'active' : existing.status;
    const keptVariantIds = new Set(
      usesVariants ? variants.map((variant) => variant.id).filter((id): id is string => Boolean(id)) : [],
    );
    const keptOptionIds = new Set(
      isCustomizable
        ? customizationOptions.map((option) => option.id).filter((id): id is string => Boolean(id))
        : [],
    );
    const basePrice = usesVariants
      ? null
      : isCustomizable
        ? (input.price ?? 0).toFixed(3)
        : input.price!.toFixed(3);

    try {
      const ticket = await this.prisma.$transaction(async (tx) => {
        await tx.ticketType.update({
          where: { id: existing.id },
          data: {
            externalKey: this.slugify(input.title),
            title: input.title.trim(),
            subtitle: input.subtitle?.trim() || null,
            inclusions: input.inclusions === undefined ? existing.inclusions : this.cleanTicketList(input.inclusions),
            exclusions: input.exclusions === undefined ? existing.exclusions : this.cleanTicketList(input.exclusions),
            iconType: pricingMode,
            thirdPartyVendorId,
            isThirdPartyPlatformTicket: platformLink.isThirdPartyPlatformTicket,
            thirdPartyPlatformId: platformLink.thirdPartyPlatformId,
            hasVariants: usesVariants,
            isCustomizable,
            basePrice,
            admitCount: input.admit_count ?? existing.admitCount,
            maxQtyPerOrder: input.max_qty_per_order ?? existing.maxQtyPerOrder,
            hasDuration,
            durationMinutes: hasDuration && !usesVariants && !isCustomizable ? input.duration_minutes ?? null : null,
            hideFromOnline,
            hideFromPos: Boolean(input.hide_from_pos),
            salesStartAt,
            salesEndAt,
            status,
          },
        });

        if (!usesVariants) {
          if (existing.variants.length) {
            await tx.ticketVariant.updateMany({
              where: { ticketTypeId: existing.id },
              data: { status: 'archived' },
            });
          }
        } else {
          for (const [index, variant] of variants.entries()) {
            const payload = {
              externalKey: variantKeys[index],
              name: variant.name.trim(),
              description: variant.description?.trim() || null,
              basePrice: variant.price.toFixed(3),
              badge: variant.badge?.trim() || null,
              durationMinutes: hasDuration ? variant.duration_minutes ?? null : null,
              maxQtyPerOrder: variant.max_qty_per_order ?? input.max_qty_per_order ?? existing.maxQtyPerOrder ?? 10,
              status: 'active' as const,
              sortOrder: index + 1,
            };
            if (variant.id) {
              await tx.ticketVariant.update({ where: { id: variant.id }, data: payload });
            } else {
              await tx.ticketVariant.create({
                data: { ticketTypeId: existing.id, currency: 'QAR', ...payload },
              });
            }
          }
          const toArchive = existing.variants
            .filter((variant) => !keptVariantIds.has(variant.id))
            .map((variant) => variant.id);
          if (toArchive.length) {
            await tx.ticketVariant.updateMany({
              where: { id: { in: toArchive } },
              data: { status: 'archived' },
            });
          }
        }

        if (!isCustomizable) {
          if (existing.customizationOptions.length) {
            await tx.ticketCustomizationOption.updateMany({
              where: { ticketTypeId: existing.id },
              data: { status: 'archived' },
            });
          }
        } else {
          for (const [index, option] of customizationOptions.entries()) {
            const payload = {
              externalKey: optionKeys[index],
              name: option.name.trim(),
              description: option.description?.trim() || null,
              price: option.price.toFixed(3),
              hasDuration,
              durationMinutes: hasDuration ? option.duration_minutes ?? null : null,
              maxQtyPerTicket: option.max_qty_per_ticket ?? null,
              status: 'active' as const,
              sortOrder: index + 1,
            };
            if (option.id) {
              await tx.ticketCustomizationOption.update({ where: { id: option.id }, data: payload });
            } else {
              await tx.ticketCustomizationOption.create({
                data: { ticketTypeId: existing.id, currency: 'QAR', ...payload },
              });
            }
          }
          const toArchive = existing.customizationOptions
            .filter((option) => !keptOptionIds.has(option.id))
            .map((option) => option.id);
          if (toArchive.length) {
            await tx.ticketCustomizationOption.updateMany({
              where: { id: { in: toArchive } },
              data: { status: 'archived' },
            });
          }
        }

        return tx.ticketType.findUniqueOrThrow({
          where: { id: existing.id },
          include: {
            variants: { where: { status: { not: 'archived' } }, orderBy: { sortOrder: 'asc' } },
            customizationOptions: {
              where: { status: { not: 'archived' } },
              orderBy: { sortOrder: 'asc' },
            },
            thirdPartyVendor: { select: { id: true, name: true, isMain: true, isCafe: true } },
            thirdPartyPlatform: { select: { id: true, name: true, accessCode: true, badgeColor: true } },
          },
        });
      });

      return {
        success: true,
        data: {
          ticket_type: this.mapAdminTicketType(ticket, pricingMode),
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('A ticket type with this name already exists for the event.');
      }
      throw error;
    }
  }

  async createMedia(eventId: string, input: CreateAdminEventMediaDto, adminUserId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event was not found.');
    // Allow image/jpg alias + whitespace/newlines in base64 (some clients insert them).
    const match = input.data_url
      .trim()
      .match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!match) throw new BadRequestException('Upload a JPG, PNG, or WebP image.');
    const file = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
    if (!file.length || file.length > 10 * 1024 * 1024) {
      throw new BadRequestException('Images must be 10 MB or smaller.');
    }
    const target = mediaTargetDimensions[input.role];
    if (!target) throw new BadRequestException('Unsupported media role.');
    let optimizedImage: { data: Buffer; info: OutputInfo };
    try {
      optimizedImage = await sharp(file, {
        failOn: 'none',
        unlimited: true,
        limitInputPixels: 40_000_000,
      })
        .rotate()
        .resize({
          width: target.width,
          height: target.height,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer({ resolveWithObject: true });
    } catch (error) {
      this.logger.warn(
        `Event media sharp failed (${input.role}, ${file.length} bytes): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new BadRequestException('The image could not be processed.');
    }
    const stored = await this.mediaStorage.storeFile({
      folder: `events/${eventId}`,
      buffer: optimizedImage.data,
      mimeType: 'image/webp',
      extension: '.webp',
    });
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (input.role !== 'gallery') await tx.eventMedia.deleteMany({ where: { eventId, mediaRole: input.role } });
        const sortOrder = input.role === 'gallery'
          ? (await tx.eventMedia.aggregate({ where: { eventId, mediaRole: 'gallery' }, _max: { sortOrder: true } }))._max.sortOrder ?? 0
          : 0;
        const asset = await tx.mediaAsset.create({
          data: {
            storageProvider: stored.storageProvider,
            bucket: stored.bucket,
            storageKey: stored.storageKey,
            url: stored.url,
            mimeType: 'image/webp',
            sizeBytes: optimizedImage.data.length,
            width: optimizedImage.info.width,
            height: optimizedImage.info.height,
            altText: input.alt_text?.trim() || null,
            uploadedByUserId: adminUserId,
          },
        });
        const media = await tx.eventMedia.create({ data: { eventId, mediaAssetId: asset.id, mediaRole: input.role, sortOrder: input.role === 'gallery' ? sortOrder + 1 : 0 } });
        if (input.role === 'event_poster') await tx.event.update({ where: { id: eventId }, data: { primaryMediaId: asset.id, updatedByUserId: adminUserId } });
        return { media, asset };
      });
      return { success: true, data: { media: { id: result.media.id, role: result.media.mediaRole, sort_order: result.media.sortOrder, url: result.asset.url, alt_text: result.asset.altText, width: result.asset.width, height: result.asset.height, mime_type: result.asset.mimeType, size_bytes: Number(result.asset.sizeBytes ?? 0) } } };
    } catch (error) {
      if (stored.storageProvider === 'local') {
        await unlink(join(process.cwd(), 'uploads', stored.storageKey)).catch(() => undefined);
      }
      throw error;
    }
  }

  async deleteMedia(eventId: string, mediaId: string) {
    const media = await this.prisma.eventMedia.findFirst({ where: { id: mediaId, eventId }, include: { mediaAsset: true } });
    if (!media) throw new NotFoundException('Event media was not found.');
    await this.prisma.$transaction(async (tx) => {
      if (media.mediaRole === 'event_poster') await tx.event.update({ where: { id: eventId }, data: { primaryMediaId: null } });
      await tx.eventMedia.delete({ where: { id: media.id } });
      await tx.mediaAsset.delete({ where: { id: media.mediaAssetId } });
    });
    if (media.mediaAsset.storageProvider === 'local') await unlink(join(process.cwd(), 'uploads', media.mediaAsset.storageKey)).catch(() => undefined);
    return { success: true, data: { deleted_media_id: mediaId } };
  }

  async submitForReview(eventId: string, adminUserId: string) {
    await this.assertEventReadyToPublish(eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    if (event.status === 'archived') throw new BadRequestException('Archived events cannot be submitted for review.');
    if (event.status === 'published') throw new BadRequestException('This event is already published.');
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: { status: 'review', updatedByUserId: adminUserId },
      select: { id: true, status: true, updatedAt: true },
    });
    return { success: true, data: { event: { id: updated.id, status: updated.status, updated_at: updated.updatedAt.toISOString() } } };
  }

  async publishEvent(eventId: string, adminUserId: string) {
    await this.assertEventReadyToPublish(eventId);
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, status: true, publishedAt: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    if (event.status === 'archived') throw new BadRequestException('Archived events cannot be published.');
    if (event.status === 'published') {
      return {
        success: true,
        data: {
          event: {
            id: event.id,
            status: event.status,
            published_at: event.publishedAt?.toISOString() ?? null,
            updated_at: new Date().toISOString(),
          },
        },
      };
    }
    const updated = await this.prisma.event.update({
      where: { id: eventId },
      data: {
        status: 'published',
        publishedAt: event.publishedAt ?? new Date(),
        updatedByUserId: adminUserId,
      },
      select: { id: true, status: true, publishedAt: true, updatedAt: true },
    });
    return {
      success: true,
      data: {
        event: {
          id: updated.id,
          status: updated.status,
          published_at: updated.publishedAt?.toISOString() ?? null,
          updated_at: updated.updatedAt.toISOString(),
        },
      },
    };
  }

  private async assertEventReadyToPublish(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        translations: true,
        ticketTypes: { include: { variants: true } },
        media: true,
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    const title = event.translations.find((item) => item.locale === 'en')?.title?.trim();
    const issues: string[] = [];
    if (!title) issues.push('Add an event title.');
    if (event.startsAt && event.endsAt && event.endsAt <= event.startsAt) issues.push('Event end must be after its start.');
    if (event.bookingMode === 'ticketed' && event.ticketTypes.length === 0) issues.push('Add at least one ticket type.');
    const roles = new Set(event.media.map((item) => item.mediaRole));
    if (!roles.has('homepage_banner')) issues.push('Add a homepage banner.');
    if (!roles.has('event_poster')) issues.push('Add an event detail poster.');
    if (event.bookingMode === 'ticketed' && !roles.has('ticket_side')) issues.push('Add a ticket selection side image.');
    for (const ticket of event.ticketTypes) {
      if (ticket.hasVariants && ticket.variants.length === 0) issues.push(`${ticket.title} needs at least one variant.`);
      if (!ticket.hasVariants && ticket.basePrice === null) issues.push(`${ticket.title} needs a price.`);
    }
    if (issues.length) throw new BadRequestException({ message: 'Event is not ready to publish.', issues });
    return event;
  }

  async getMore(eventId: string) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        translations: true,
        organization: { select: { id: true, name: true } },
        ticketTypes: {
          where: { status: 'active' },
          include: {
            variants: { where: { status: 'active' }, orderBy: { sortOrder: 'asc' } },
          },
          orderBy: { sortOrder: 'asc' },
        },
        addons: { include: { variants: { orderBy: { sortOrder: 'asc' } } }, orderBy: { sortOrder: 'asc' } },
        taxes: { where: { status: 'active' }, orderBy: { createdAt: 'asc' } },
        registrationForms: {
          include: { fields: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        thirdPartyVendors: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
        artists: {
          include: {
            artist: { include: { translations: true, profileMedia: true } },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    const translation =
      event.translations.find((item) => item.locale === 'en') ?? event.translations[0];
    const translationAr = event.translations.find((item) => item.locale === 'ar');
    const ops = this.parseMoreOps(event.moreOpsConfig);
    const opsWithIds = await this.ensureTimeExtensionIds(event.id, event.moreOpsConfig, ops);
    const form = event.registrationForms[0] ?? null;
    const faqsEn = this.asFaqList(translation?.faqJson);
    const faqsAr = this.asFaqList(translationAr?.faqJson);
    const faqCount = Math.max(faqsEn.length, faqsAr.length);

    return {
      success: true,
      data: {
        event: {
          id: event.id,
          slug: event.slug,
          title: translation?.title ?? event.slug,
          title_ar: translationAr?.title ?? null,
          status: event.status,
          booking_mode: event.bookingMode,
          event_type: event.eventType,
          requires_waiver: event.requiresWaiver,
          seat_selection_enabled: event.seatSelectionEnabled,
          seats_io_event_key: event.seatsIoEventKey,
          seats_io_chart_key: event.seatsIoChartKey,
          currency: event.currency,
          organization: event.organization,
          arabic_content: Boolean(translationAr?.title),
        },
        artists: event.artists.map((row) => ({
          ...this.mapArtistOption(row.artist),
          sort_order: row.sortOrder,
        })),
        content: {
          terms: this.parseTermsItems(translation?.termsContent, translationAr?.termsContent),
          waiver_content: translation?.waiverContent ?? '',
          waiver_content_ar: translationAr?.waiverContent ?? '',
          faqs: Array.from({ length: faqCount }, (_, index) => ({
            question: faqsEn[index]?.question ?? '',
            answer: faqsEn[index]?.answer ?? '',
            question_ar: faqsAr[index]?.question ?? '',
            answer_ar: faqsAr[index]?.answer ?? '',
          })),
          inclusions: this.parseTitledItems(
            translation?.inclusionsJson,
            translationAr?.inclusionsJson,
          ),
          exclusions: this.parseTitledItems(
            translation?.exclusionsJson,
            translationAr?.exclusionsJson,
          ),
          meta_title: translation?.metaTitle ?? '',
          meta_title_ar: translationAr?.metaTitle ?? '',
          meta_description: translation?.metaDescription ?? '',
          meta_description_ar: translationAr?.metaDescription ?? '',
        },
        addons: event.addons.map((addon) => ({
          id: addon.id,
          title: addon.title,
          title_ar: addon.titleAr,
          subtitle: addon.subtitle,
          subtitle_ar: addon.subtitleAr,
          has_variants: addon.hasVariants,
          price: addon.basePrice?.toNumber() ?? null,
          currency: addon.currency,
          max_qty_per_order: addon.maxQtyPerOrder,
          status: addon.status,
          for_cafe_only: addon.forCafeOnly,
          thumbnail_url: addon.thumbnailUrl,
          visibility: this.addonVisibilityLabel(addon.hideFromOnline, addon.hideFromPos),
          hide_from_online: addon.hideFromOnline,
          hide_from_pos: addon.hideFromPos,
          variants: addon.variants.map((variant) => ({
            id: variant.id,
            name: variant.name,
            description: variant.description,
            price: variant.basePrice.toNumber(),
            currency: variant.currency,
            badge: variant.badge,
            max_qty_per_order: variant.maxQtyPerOrder,
            status: variant.status,
          })),
        })),
        taxes: event.taxes.map((tax) => ({
          id: tax.id,
          title: tax.title,
          title_ar: tax.titleAr,
          rate_type: tax.rateType,
          rate: tax.rate.toNumber(),
          applicable_on: tax.applicableOn,
          tax_type: tax.taxType,
          status: tax.status,
        })),
        third_party_vendors: event.thirdPartyVendors.map((share) => this.mapThirdPartyVendor(share)),
        registration_form: form
          ? {
              id: form.id,
              status: form.status,
              fields: form.fields.map((field) => ({
                id: field.id,
                field_key: field.fieldKey,
                label: field.label,
                label_ar: field.labelAr ?? '',
                field_type: field.fieldType,
                required: field.required,
                options: this.asStringList(field.optionsJson),
                sort_order: field.sortOrder,
              })),
            }
          : null,
        ops: {
          ...opsWithIds,
          entry_access: opsWithIds.entry_access,
          rfids: opsWithIds.rfids,
          bulk_booking: this.buildBulkBookingView(opsWithIds.bulk_booking, event.ticketTypes),
        },
      },
    };
  }

  async updateMore(eventId: string, input: UpdateAdminEventMoreDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: { translations: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const existingOps = this.parseMoreOps(event.moreOpsConfig);
    let nextOps = {
      pos_passwords: {
        refund: input.pos_passwords?.refund ?? existingOps.pos_passwords.refund,
        edit: input.pos_passwords?.edit ?? existingOps.pos_passwords.edit,
        complimentary:
          input.pos_passwords?.complimentary ?? existingOps.pos_passwords.complimentary,
      },
      entry_access: existingOps.entry_access,
      // Mirrored from entry_access.code_pool for older clients
      rfids: existingOps.rfids,
      feedback_form: {
        enabled: input.feedback_form?.enabled ?? existingOps.feedback_form.enabled,
        questions: input.feedback_form?.questions
          ? input.feedback_form.questions.map((q) => this.normalizeFeedbackQuestion(q))
          : existingOps.feedback_form.questions,
      },
      bulk_booking: input.bulk_booking
        ? this.normalizeBulkBooking(input.bulk_booking, existingOps.bulk_booking)
        : existingOps.bulk_booking,
      time_extensions: input.time_extensions
        ? input.time_extensions.map((item) => ({
            id: item.id?.trim() || randomUUID(),
            ...(item.legacy_id != null ? { legacy_id: item.legacy_id } : {}),
            title: item.title.trim(),
            title_ar: item.title_ar?.trim() || '',
            scope: item.scope === 'order' ? 'order' as const : 'ticket' as const,
            minutes: item.minutes,
            price: item.price,
            ticket_ids: item.scope === 'order'
              ? []
              : Array.from(
                  new Set((item.ticket_ids ?? []).map((id) => id.trim()).filter(Boolean)),
                ),
          }))
        : existingOps.time_extensions,
    };

    if (input.entry_access) {
      nextOps = this.mergeEntryAccess(nextOps, input.entry_access);
    } else if (input.rfids) {
      // Legacy RFID list → fold into entry_access.code_pool
      const legacyPass =
        nextOps.entry_access.pass_type === 'barcode' ||
        nextOps.entry_access.pass_type === 'other'
          ? nextOps.entry_access.pass_type
          : ('rfid' as const);
      nextOps = this.mergeEntryAccess(nextOps, {
        pass_type: legacyPass,
        code_pool: input.rfids.map((item) => ({
          code: item.code,
          wristband_color: '#173f37',
          status: 'active' as const,
          ticket_type_id: null,
          ticket_variant_id: null,
        })),
      });
    }

    const en = event.translations.find((item) => item.locale === 'en');
    const ar = event.translations.find((item) => item.locale === 'ar');
    const enTitle = en?.title ?? event.slug;
    const arTitle = ar?.title ?? enTitle;

    const enData: Prisma.EventTranslationUpdateInput = {
      termsContent:
        input.terms !== undefined
          ? JSON.stringify(
              input.terms
                .filter(
                  (item) =>
                    item.title.trim() ||
                    item.rule.trim() ||
                    (item.title_ar ?? '').trim() ||
                    (item.rule_ar ?? '').trim(),
                )
                .map((item) => ({
                  title: item.title.trim(),
                  title_ar: item.title_ar?.trim() || '',
                  rule: item.rule.trim(),
                  rule_ar: item.rule_ar?.trim() || '',
                })),
            )
          : undefined,
      waiverContent:
        input.waiver_content !== undefined
          ? sanitizeCmsHtmlOrNull(input.waiver_content)
          : undefined,
      faqJson:
        input.faqs !== undefined
          ? (input.faqs
              .filter((item) => item.question.trim() && item.answer.trim())
              .map((item) => ({
                question: item.question.trim(),
                answer: sanitizeCmsHtmlOrNull(item.answer) ?? '',
              })) as unknown as Prisma.InputJsonValue)
          : undefined,
      inclusionsJson:
        input.inclusions !== undefined
          ? (input.inclusions
              .filter((item) => item.title.trim() || (item.title_ar ?? '').trim())
              .map((item) => ({
                title: item.title.trim() || (item.title_ar ?? '').trim(),
                title_ar: item.title_ar?.trim() || '',
              })) as unknown as Prisma.InputJsonValue)
          : undefined,
      exclusionsJson:
        input.exclusions !== undefined
          ? (input.exclusions
              .filter((item) => item.title.trim() || (item.title_ar ?? '').trim())
              .map((item) => ({
                title: item.title.trim() || (item.title_ar ?? '').trim(),
                title_ar: item.title_ar?.trim() || '',
              })) as unknown as Prisma.InputJsonValue)
          : undefined,
      metaTitle: input.meta_title !== undefined ? input.meta_title.trim() || null : undefined,
      metaDescription:
        input.meta_description !== undefined ? input.meta_description.trim() || null : undefined,
    };

    const arData: Prisma.EventTranslationUpdateInput = {
      termsContent: input.terms !== undefined ? null : undefined,
      inclusionsJson:
        input.inclusions !== undefined ? ([] as unknown as Prisma.InputJsonValue) : undefined,
      exclusionsJson:
        input.exclusions !== undefined ? ([] as unknown as Prisma.InputJsonValue) : undefined,
      waiverContent:
        input.waiver_content_ar !== undefined
          ? sanitizeCmsHtmlOrNull(input.waiver_content_ar)
          : undefined,
      faqJson:
        input.faqs !== undefined
          ? (input.faqs
              .filter((item) => (item.question_ar ?? '').trim() && (item.answer_ar ?? '').trim())
              .map((item) => ({
                question: (item.question_ar ?? '').trim(),
                answer: (item.answer_ar ?? '').trim(),
              })) as unknown as Prisma.InputJsonValue)
          : undefined,
      metaTitle:
        input.meta_title_ar !== undefined ? input.meta_title_ar.trim() || null : undefined,
      metaDescription:
        input.meta_description_ar !== undefined
          ? input.meta_description_ar.trim() || null
          : undefined,
    };

    const touchesAr =
      input.terms !== undefined ||
      input.inclusions !== undefined ||
      input.exclusions !== undefined ||
      input.waiver_content_ar !== undefined ||
      input.faqs !== undefined ||
      input.meta_title_ar !== undefined ||
      input.meta_description_ar !== undefined;

    if (input.artist_ids !== undefined) {
      const uniqueIds = [...new Set(input.artist_ids)];
      if (uniqueIds.length) {
        const found = await this.prisma.artist.findMany({
          where: { id: { in: uniqueIds }, status: { not: 'archived' } },
          select: { id: true },
        });
        if (found.length !== uniqueIds.length) {
          throw new BadRequestException('One or more selected artists were not found.');
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.event.update({
        where: { id: eventId },
        data: {
          requiresWaiver:
            input.requires_waiver !== undefined ? input.requires_waiver : undefined,
          seatSelectionEnabled:
            input.seat_selection_enabled !== undefined
              ? input.seat_selection_enabled
              : undefined,
          seatsIoEventKey:
            input.seats_io_event_key !== undefined
              ? input.seats_io_event_key.trim() || null
              : undefined,
          seatsIoChartKey:
            input.seats_io_chart_key !== undefined
              ? input.seats_io_chart_key.trim() || null
              : undefined,
          moreOpsConfig: nextOps as Prisma.InputJsonValue,
        },
      });

      if (input.artist_ids !== undefined) {
        const uniqueIds = [...new Set(input.artist_ids)];
        await tx.eventArtist.deleteMany({ where: { eventId } });
        if (uniqueIds.length) {
          await tx.eventArtist.createMany({
            data: uniqueIds.map((artistId, index) => ({
              eventId,
              artistId,
              sortOrder: index + 1,
            })),
          });
        }
      }

      if (en) {
        await tx.eventTranslation.update({ where: { id: en.id }, data: enData });
      } else {
        await tx.eventTranslation.create({
          data: {
            eventId,
            locale: 'en',
            title: enTitle,
            termsContent:
              input.terms !== undefined
                ? JSON.stringify(
                    input.terms
                      .filter(
                        (item) =>
                          item.title.trim() ||
                          item.rule.trim() ||
                          (item.title_ar ?? '').trim() ||
                          (item.rule_ar ?? '').trim(),
                      )
                      .map((item) => ({
                        title: item.title.trim(),
                        title_ar: item.title_ar?.trim() || '',
                        rule: item.rule.trim(),
                        rule_ar: item.rule_ar?.trim() || '',
                      })),
                  )
                : null,
            waiverContent: sanitizeCmsHtmlOrNull(input.waiver_content),
            faqJson: (input.faqs
              ?.filter((item) => item.question.trim() && item.answer.trim())
              .map((item) => ({
                question: item.question.trim(),
                answer: sanitizeCmsHtmlOrNull(item.answer) ?? '',
              })) ?? []) as unknown as Prisma.InputJsonValue,
            inclusionsJson: (input.inclusions
              ?.filter((item) => item.title.trim() || (item.title_ar ?? '').trim())
              .map((item) => ({
                title: item.title.trim() || (item.title_ar ?? '').trim(),
                title_ar: item.title_ar?.trim() || '',
              })) ?? []) as unknown as Prisma.InputJsonValue,
            exclusionsJson: (input.exclusions
              ?.filter((item) => item.title.trim() || (item.title_ar ?? '').trim())
              .map((item) => ({
                title: item.title.trim() || (item.title_ar ?? '').trim(),
                title_ar: item.title_ar?.trim() || '',
              })) ?? []) as unknown as Prisma.InputJsonValue,
            metaTitle: input.meta_title?.trim() || null,
            metaDescription: input.meta_description?.trim() || null,
          },
        });
      }

      if (touchesAr) {
        if (ar) {
          await tx.eventTranslation.update({ where: { id: ar.id }, data: arData });
        } else {
          await tx.eventTranslation.create({
            data: {
              eventId,
              locale: 'ar',
              title: arTitle,
              waiverContent: sanitizeCmsHtmlOrNull(input.waiver_content_ar),
              faqJson: (input.faqs
                ?.filter((item) => (item.question_ar ?? '').trim() && (item.answer_ar ?? '').trim())
                .map((item) => ({
                  question: (item.question_ar ?? '').trim(),
                  answer: sanitizeCmsHtmlOrNull(item.answer_ar) ?? '',
                })) ?? []) as unknown as Prisma.InputJsonValue,
              metaTitle: input.meta_title_ar?.trim() || null,
              metaDescription: input.meta_description_ar?.trim() || null,
            },
          });
        }
      }
    });

    return this.getMore(eventId);
  }

  async replaceThirdPartyVendors(eventId: string, input: ReplaceThirdPartyVendorsDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event was not found.');
    const rows = this.normalizeThirdPartyVendorRows(input.shares);
    this.assertThirdPartyVendorRules(rows);

    try {
      const shares = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.thirdPartyVendor.findMany({
          where: { eventId },
          select: { id: true },
        });
        const keepIds = new Set(rows.map((row) => row.id).filter(Boolean) as string[]);
        const toDelete = existing.map((item) => item.id).filter((id) => !keepIds.has(id));
        if (toDelete.length) {
          const vendorTickets = await tx.ticketType.findMany({
            where: { eventId, thirdPartyVendorId: { in: toDelete } },
            select: { id: true },
          });
          const vendorTicketIds = new Set(vendorTickets.map((ticket) => ticket.id));
          const eventAssignments = await tx.staffAssignment.findMany({
            where: { eventId },
            select: {
              id: true,
              thirdPartyVendorId: true,
              thirdPartyVendorIds: true,
              ticketTypeIds: true,
              isCafeAgent: true,
            },
          });
          const deletedIds = new Set(toDelete);
          for (const assignment of eventAssignments) {
            const removesSingleShare =
              assignment.thirdPartyVendorId !== null && deletedIds.has(assignment.thirdPartyVendorId);
            const nextShareIds = assignment.thirdPartyVendorIds.filter((id) => !deletedIds.has(id));
            const nextTicketTypeIds = assignment.ticketTypeIds.filter(
              (id) => !vendorTicketIds.has(id),
            );
            const removesArrayShare =
              nextShareIds.length !== assignment.thirdPartyVendorIds.length;
            const changed =
              removesSingleShare ||
              removesArrayShare ||
              nextTicketTypeIds.length !== assignment.ticketTypeIds.length;
            if (!changed) continue;

            await tx.staffAssignment.update({
              where: { id: assignment.id },
              data: {
                thirdPartyVendorId: removesSingleShare ? null : assignment.thirdPartyVendorId,
                thirdPartyVendorIds: nextShareIds,
                ticketTypeIds: nextTicketTypeIds,
                isCafeAgent:
                  nextShareIds.length === 0 && (removesSingleShare || removesArrayShare)
                    ? false
                    : assignment.isCafeAgent,
              },
            });
          }
          await tx.ticketType.updateMany({
            where: { eventId, thirdPartyVendorId: { in: toDelete } },
            data: { thirdPartyVendorId: null },
          });
          await tx.thirdPartyVendor.deleteMany({ where: { id: { in: toDelete }, eventId } });
        }

        const saved = [];
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index];
          const data = {
            name: row.name,
            isMain: index === 0 ? true : Boolean(row.is_main),
            organiserShare: row.organiser_share.toFixed(2),
            vendorSharePct: row.vendor_share.toFixed(2),
            isCafe: Boolean(row.is_cafe),
            collectedBy: index > 0 ? row.collected_by?.trim() || null : null,
            ownerName:
              index === 0 && row.vendor_share > 0
                ? row.owner_name?.trim() || 'Event Owner'
                : null,
            ownerPercentageType:
              index === 0 && row.vendor_share > 0
                ? row.owner_percentage_type ?? 'normal'
                : null,
            sortOrder: index + 1,
          };
          if (row.id) {
            const updated = await tx.thirdPartyVendor.updateMany({
              where: { id: row.id, eventId },
              data,
            });
            if (!updated.count) {
              throw new BadRequestException('One or more vendors do not belong to this event.');
            }
            saved.push(await tx.thirdPartyVendor.findUniqueOrThrow({ where: { id: row.id } }));
          } else {
            saved.push(
              await tx.thirdPartyVendor.create({
                data: { eventId, ...data },
              }),
            );
          }
        }
        return saved;
      });

      return {
        success: true,
        data: { third_party_vendors: shares.map((share) => this.mapThirdPartyVendor(share)) },
        message: 'Vendors saved.',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Vendor name must be unique for this event.');
      }
      throw error;
    }
  }

  async createThirdPartyVendor(eventId: string, input: CreateThirdPartyVendorDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        thirdPartyVendors: { select: { id: true, name: true, sortOrder: true } },
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Vendor name is required.');
    const duplicate = event.thirdPartyVendors.some(
      (share) => share.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new ConflictException('Vendor name must be unique for this event.');
    }

    const isFirst = event.thirdPartyVendors.length === 0;
    const orgShare = Number(input.organiser_share);
    const vendorShare = Number(input.vendor_share);
    if (Number.isNaN(orgShare) || Number.isNaN(vendorShare)) {
      throw new BadRequestException('Enter valid share percentages.');
    }
    if (Math.abs(orgShare + vendorShare - 100) > 0.01) {
      throw new BadRequestException('Event owner revenue + vendor revenue must equal 100%.');
    }
    if (isFirst && vendorShare > 0 && !input.owner_name?.trim()) {
      throw new BadRequestException('Vendor payment name is required when vendor revenue is greater than 0.');
    }

    try {
      const share = await this.prisma.thirdPartyVendor.create({
        data: {
          eventId,
          name,
          isMain: isFirst,
          organiserShare: orgShare.toFixed(2),
          vendorSharePct: vendorShare.toFixed(2),
          isCafe: Boolean(input.is_cafe),
          collectedBy: !isFirst ? input.collected_by?.trim() || null : null,
          ownerName:
            isFirst && vendorShare > 0 ? input.owner_name?.trim() || 'Event Owner' : null,
          ownerPercentageType:
            isFirst && vendorShare > 0 ? input.owner_percentage_type ?? 'normal' : null,
          sortOrder: Math.max(0, ...event.thirdPartyVendors.map((item) => item.sortOrder)) + 1,
        },
      });
      return {
        success: true,
        data: { third_party_vendor: this.mapThirdPartyVendor(share) },
        message: 'Third-party vendor added.',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Vendor name must be unique for this event.');
      }
      throw error;
    }
  }

  async createThirdPartyPlatform(eventId: string, input: CreateThirdPartyPlatformDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        thirdPartyPlatforms: { select: { id: true, name: true, sortOrder: true } },
      },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const name = input.name.trim();
    if (!name) throw new BadRequestException('Platform name is required.');
    const duplicate = event.thirdPartyPlatforms.some(
      (platform) => platform.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      throw new ConflictException('Platform name must be unique for this event.');
    }

    const accessCode = input.access_code?.trim() || null;
    const badgeColor = input.badge_color?.toUpperCase() || '#F1E9FF';

    try {
      const platform = await this.prisma.thirdPartyPlatform.create({
        data: {
          eventId,
          name,
          accessCode,
          badgeColor,
          sortOrder:
            Math.max(0, ...event.thirdPartyPlatforms.map((item) => item.sortOrder)) + 1,
        },
      });
      return {
        success: true,
        data: { third_party_platform: this.mapThirdPartyPlatform(platform) },
        message: 'Third-party platform added.',
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Platform name must be unique for this event.');
      }
      throw error;
    }
  }

  async createAddon(eventId: string, input: CreateAdminAddonDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, addons: { select: { sortOrder: true } } },
    });
    if (!event) throw new NotFoundException('Event was not found.');

    const variants = input.variants ?? [];
    const hasVariants = variants.length > 0;
    if (!hasVariants && input.price === undefined) {
      throw new BadRequestException('Enter a price, or add addon options.');
    }
    const variantKeys = variants.map((variant) => this.slugify(variant.name));
    if (variantKeys.some((key) => !key) || new Set(variantKeys).size !== variantKeys.length) {
      throw new BadRequestException('Addon option names must be unique.');
    }

    const forCafeOnly = Boolean(input.for_cafe_only);
    const visibility = this.addonVisibilityFlags(input.visibility ?? 'both');
    let thumbnailUrl: string | null = null;
    if (input.thumbnail_data_url) {
      thumbnailUrl = await this.saveAddonThumbnail(
        eventId,
        input.thumbnail_data_url,
        input.thumbnail_file_name,
      );
    }

    try {
      const addon = await this.prisma.addon.create({
        data: {
          eventId,
          externalKey: this.slugify(input.title),
          title: input.title.trim(),
          titleAr: input.title_ar?.trim() || null,
          subtitle: input.subtitle?.trim() || null,
          subtitleAr: input.subtitle_ar?.trim() || null,
          forCafeOnly,
          thumbnailUrl,
          hideFromOnline: visibility.hideFromOnline,
          hideFromPos: visibility.hideFromPos,
          hasVariants,
          basePrice: !hasVariants ? input.price!.toFixed(3) : null,
          currency: 'QAR',
          maxQtyPerOrder: input.max_qty_per_order ?? 10,
          status: 'active',
          sortOrder: Math.max(0, ...event.addons.map((item) => item.sortOrder)) + 1,
          variants: hasVariants
            ? {
                create: variants.map((variant, index) => ({
                  externalKey: variantKeys[index],
                  name: variant.name.trim(),
                  description: variant.description?.trim() || null,
                  basePrice: variant.price.toFixed(3),
                  currency: 'QAR',
                  badge: variant.badge?.trim() || null,
                  maxQtyPerOrder: variant.max_qty_per_order ?? input.max_qty_per_order ?? 10,
                  status: 'active',
                  sortOrder: index + 1,
                })),
              }
            : undefined,
        },
        include: { variants: { orderBy: { sortOrder: 'asc' } } },
      });

      return {
        success: true,
        data: {
          addon: {
            id: addon.id,
            title: addon.title,
            title_ar: addon.titleAr,
            subtitle: addon.subtitle,
            subtitle_ar: addon.subtitleAr,
            has_variants: addon.hasVariants,
            price: addon.basePrice?.toNumber() ?? null,
            currency: addon.currency,
            max_qty_per_order: addon.maxQtyPerOrder,
            status: addon.status,
            for_cafe_only: addon.forCafeOnly,
            thumbnail_url: addon.thumbnailUrl,
            visibility: this.addonVisibilityLabel(addon.hideFromOnline, addon.hideFromPos),
            hide_from_online: addon.hideFromOnline,
            hide_from_pos: addon.hideFromPos,
            variants: addon.variants.map((variant) => ({
              id: variant.id,
              name: variant.name,
              description: variant.description,
              price: variant.basePrice.toNumber(),
              currency: variant.currency,
              badge: variant.badge,
              max_qty_per_order: variant.maxQtyPerOrder,
              status: variant.status,
            })),
          },
        },
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An add-on with this name already exists for the event.');
      }
      throw error;
    }
  }

  async deleteAddon(eventId: string, addonId: string) {
    const addon = await this.prisma.addon.findFirst({ where: { id: addonId, eventId } });
    if (!addon) throw new NotFoundException('Add-on was not found.');
    await this.prisma.addon.delete({ where: { id: addonId } });
    return { success: true, data: { deleted_addon_id: addonId } };
  }

  async createTax(eventId: string, input: CreateAdminTaxDto) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
    if (!event) throw new NotFoundException('Event was not found.');
    if (input.rate_type === 'percent' && input.rate > 100) {
      throw new BadRequestException('Percent tax rate cannot exceed 100.');
    }

    const tax = await this.prisma.tax.create({
      data: {
        eventId,
        title: input.title.trim(),
        titleAr: input.title_ar?.trim() || null,
        rateType: input.rate_type,
        rate: input.rate.toFixed(3),
        applicableOn: input.applicable_on,
        taxType: input.tax_type,
        status: 'active',
      },
    });

    return {
      success: true,
      data: {
        tax: {
          id: tax.id,
          title: tax.title,
          title_ar: tax.titleAr,
          rate_type: tax.rateType,
          rate: tax.rate.toNumber(),
          applicable_on: tax.applicableOn,
          tax_type: tax.taxType,
          status: tax.status,
        },
      },
    };
  }

  async deleteTax(eventId: string, taxId: string) {
    const tax = await this.prisma.tax.findFirst({ where: { id: taxId, eventId } });
    if (!tax) throw new NotFoundException('Tax was not found.');
    // Soft-disable so historical OrderTaxLine snapshots stay intact for fast reporting.
    await this.prisma.tax.update({ where: { id: taxId }, data: { status: 'inactive' } });
    return { success: true, data: { deleted_tax_id: taxId } };
  }

  async upsertRegistrationForm(eventId: string, input: UpsertAdminRegistrationFormDto) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, bookingMode: true, eventType: true },
    });
    if (!event) throw new NotFoundException('Event was not found.');
    if (event.bookingMode !== 'registration' && event.eventType !== 'registration_only') {
      throw new BadRequestException('Registration forms are only available on registration events.');
    }

    const keys = input.fields.map((field) => this.slugify(field.field_key || field.label));
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) {
      throw new BadRequestException('Each form field needs a unique key.');
    }

    const form = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.registrationForm.findFirst({
        where: { eventId },
        orderBy: { createdAt: 'desc' },
      });
      const status = input.status ?? existing?.status ?? 'draft';
      const saved =
        existing ??
        (await tx.registrationForm.create({
          data: {
            eventId,
            status,
            publishedAt: status === 'published' ? new Date() : null,
          },
        }));

      if (existing) {
        await tx.registrationForm.update({
          where: { id: existing.id },
          data: {
            status,
            publishedAt:
              status === 'published' ? existing.publishedAt ?? new Date() : existing.publishedAt,
          },
        });
      }

      await tx.registrationFormField.deleteMany({ where: { formId: saved.id } });
      if (input.fields.length) {
        await tx.registrationFormField.createMany({
          data: input.fields.map((field, index) => ({
            formId: saved.id,
            fieldKey: keys[index],
            label: field.label.trim(),
            labelAr: field.label_ar?.trim() || null,
            fieldType: field.field_type,
            required: Boolean(field.required),
            optionsJson: field.options?.length
              ? (field.options
                  .map((item) => item.trim())
                  .filter(Boolean) as unknown as Prisma.InputJsonValue)
              : undefined,
            sortOrder: index + 1,
          })),
        });
      }

      return tx.registrationForm.findUniqueOrThrow({
        where: { id: saved.id },
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
      });
    });

    return {
      success: true,
      data: {
        registration_form: {
          id: form.id,
          status: form.status,
          fields: form.fields.map((field) => ({
            id: field.id,
            field_key: field.fieldKey,
            label: field.label,
            label_ar: field.labelAr ?? '',
            field_type: field.fieldType,
            required: field.required,
            options: this.asStringList(field.optionsJson),
            sort_order: field.sortOrder,
          })),
        },
      },
    };
  }

  private async ensureTimeExtensionIds<
    T extends {
      time_extensions: Array<{
        id: string;
        title: string;
        title_ar: string;
        scope: 'ticket' | 'order';
        minutes: number;
        price: number;
        ticket_ids: string[];
      }>;
    },
  >(eventId: string, rawConfig: Prisma.JsonValue | null | undefined, ops: T): Promise<T> {
    if (!ops.time_extensions.some((pack) => !pack.id)) {
      return ops;
    }
    const time_extensions = ops.time_extensions.map((pack) => ({
      ...pack,
      id: pack.id || randomUUID(),
    }));
    const nextOps = { ...ops, time_extensions };
    const base =
      rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
        ? (rawConfig as Record<string, unknown>)
        : {};
    await this.prisma.event.update({
      where: { id: eventId },
      data: {
        moreOpsConfig: {
          ...base,
          time_extensions,
        } as Prisma.InputJsonValue,
      },
    });
    return nextOps;
  }

  private defaultMoreOps() {
    return {
      pos_passwords: { refund: '', edit: '', complimentary: '' },
      entry_access: this.defaultEntryAccess(),
      rfids: [] as Array<{ code: string; note: string }>,
      feedback_form: {
        enabled: false,
        questions: [] as Array<{
          label: string;
          label_ar: string;
          field_type: string;
          is_required: boolean;
          status: boolean;
          rating_count?: number;
          options: string[];
        }>,
      },
      bulk_booking: {
        self_checkout: false,
        tickets: [] as Array<{
          ticket_id: string;
          ticket_name: string;
          min_qty: number | null;
          max_qty: number | null;
          discount: number;
          packs: Array<{
            id: string;
            title: string;
            min_qty: number | null;
            max_qty: number | null;
            discount: number;
          }>;
        }>,
      },
      time_extensions: [] as Array<{
        id: string;
        title: string;
        title_ar: string;
        scope: 'ticket' | 'order';
        minutes: number;
        price: number;
        ticket_ids: string[];
      }>,
    };
  }

  private defaultEntryAccess() {
    return {
      pass_type: null as 'rfid' | 'barcode' | 'other' | null,
      other_label: '',
      scan_length: 8,
      code_pool: [] as Array<{
        id: string;
        code: string;
        ticket_type_id: string | null;
        ticket_variant_id: string | null;
        wristband_color: string;
        status: 'active' | 'inactive';
      }>,
    };
  }

  private normalizeCodePoolItem(item: {
    id?: string;
    code: string;
    ticket_type_id?: string | null;
    ticket_variant_id?: string | null;
    wristband_color?: string;
    status?: 'active' | 'inactive';
  }) {
    const code = item.code.replace(/\s+/g, '').trim();
    if (!code) return null;
    return {
      id: item.id?.trim() || randomUUID(),
      code,
      ticket_type_id: item.ticket_type_id?.trim() || null,
      ticket_variant_id: item.ticket_variant_id?.trim() || null,
      wristband_color: item.wristband_color?.trim() || '#173f37',
      status: item.status === 'inactive' ? ('inactive' as const) : ('active' as const),
    };
  }

  private mergeEntryAccess<T extends { entry_access: ReturnType<AdminEventsService['defaultEntryAccess']>; rfids: Array<{ code: string; note: string }> }>(
    existingOps: T,
    input: EntryAccessDto,
  ): T {
    const current = existingOps.entry_access ?? this.defaultEntryAccess();
    const passType = input.pass_type === undefined ? current.pass_type : input.pass_type;
    const otherLabel =
      input.other_label !== undefined ? input.other_label.trim() : current.other_label;
    const scanLength =
      input.scan_length !== undefined
        ? Math.min(64, Math.max(4, Math.round(input.scan_length)))
        : current.scan_length;
    const codePool =
      input.code_pool !== undefined
        ? input.code_pool
            .map((row) => this.normalizeCodePoolItem(row))
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
        : current.code_pool;

    const byCode = new Map<string, (typeof codePool)[number]>();
    for (const row of codePool) {
      byCode.set(row.code.toLowerCase(), row);
    }
    const deduped = [...byCode.values()];

    const entry_access: ReturnType<AdminEventsService['defaultEntryAccess']> = {
      pass_type: passType,
      other_label: passType === 'other' ? otherLabel : '',
      scan_length: scanLength,
      code_pool: passType === 'rfid' || passType === 'barcode' ? deduped : [],
    };

    return {
      ...existingOps,
      entry_access,
      rfids: entry_access.code_pool.map((row) => ({
        code: row.code,
        note: row.ticket_variant_id
          ? `variant:${row.ticket_variant_id}`
          : row.ticket_type_id
            ? `ticket:${row.ticket_type_id}`
            : '',
      })),
    };
  }

  private parseMoreOps(value: Prisma.JsonValue | null | undefined) {
    const raw =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const passwords =
      raw.pos_passwords && typeof raw.pos_passwords === 'object' && !Array.isArray(raw.pos_passwords)
        ? (raw.pos_passwords as Record<string, unknown>)
        : {};
    const feedback =
      raw.feedback_form && typeof raw.feedback_form === 'object' && !Array.isArray(raw.feedback_form)
        ? (raw.feedback_form as Record<string, unknown>)
        : {};
    const bulk =
      raw.bulk_booking && typeof raw.bulk_booking === 'object' && !Array.isArray(raw.bulk_booking)
        ? (raw.bulk_booking as Record<string, unknown>)
        : {};
    const entryRaw =
      raw.entry_access && typeof raw.entry_access === 'object' && !Array.isArray(raw.entry_access)
        ? (raw.entry_access as Record<string, unknown>)
        : null;

    const legacyRfids = Array.isArray(raw.rfids)
      ? raw.rfids.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as Record<string, unknown>;
          if (typeof row.code !== 'string' || !row.code.trim()) return [];
          return [{ code: row.code.trim(), note: typeof row.note === 'string' ? row.note : '' }];
        })
      : [];

    const parsedPool = Array.isArray(entryRaw?.code_pool)
      ? entryRaw.code_pool.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as Record<string, unknown>;
          if (typeof row.code !== 'string' || !row.code.trim()) return [];
          const normalized = this.normalizeCodePoolItem({
            id: typeof row.id === 'string' ? row.id : undefined,
            code: row.code,
            ticket_type_id: typeof row.ticket_type_id === 'string' ? row.ticket_type_id : null,
            ticket_variant_id:
              typeof row.ticket_variant_id === 'string' ? row.ticket_variant_id : null,
            wristband_color:
              typeof row.wristband_color === 'string'
                ? row.wristband_color
                : typeof row.color === 'string'
                  ? row.color
                  : '#173f37',
            status: row.status === 'inactive' ? 'inactive' : 'active',
          });
          return normalized ? [normalized] : [];
        })
      : legacyRfids
          .map((item) =>
            this.normalizeCodePoolItem({
              code: item.code,
              wristband_color: '#173f37',
              status: 'active',
              ticket_type_id: null,
              ticket_variant_id: null,
            }),
          )
          .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const passTypeRaw = entryRaw?.pass_type;
    const pass_type: 'rfid' | 'barcode' | 'other' | null =
      passTypeRaw === 'rfid' || passTypeRaw === 'barcode' || passTypeRaw === 'other'
        ? passTypeRaw
        : legacyRfids.length > 0
          ? 'rfid'
          : null;

    const entry_access: ReturnType<AdminEventsService['defaultEntryAccess']> = {
      pass_type,
      other_label: typeof entryRaw?.other_label === 'string' ? entryRaw.other_label : '',
      scan_length:
        typeof entryRaw?.scan_length === 'number' && Number.isFinite(entryRaw.scan_length)
          ? Math.min(64, Math.max(4, Math.round(entryRaw.scan_length)))
          : 8,
      code_pool: parsedPool,
    };

    return {
      pos_passwords: {
        refund: typeof passwords.refund === 'string' ? passwords.refund : '',
        edit: typeof passwords.edit === 'string' ? passwords.edit : '',
        complimentary: typeof passwords.complimentary === 'string' ? passwords.complimentary : '',
      },
      entry_access,
      rfids: entry_access.code_pool.map((row) => ({
        code: row.code,
        note: row.ticket_variant_id
          ? `variant:${row.ticket_variant_id}`
          : row.ticket_type_id
            ? `ticket:${row.ticket_type_id}`
            : '',
      })),
      feedback_form: {
        enabled: Boolean(feedback.enabled),
        questions: Array.isArray(feedback.questions)
          ? feedback.questions.flatMap((item) => {
              if (!item || typeof item !== 'object') return [];
              const row = item as Record<string, unknown>;
              if (typeof row.label !== 'string' || !row.label.trim()) return [];
              const rawType =
                (typeof row.field_type === 'string' && row.field_type) ||
                (typeof row.type === 'string' && row.type) ||
                'text';
              const fieldType = this.normalizeFeedbackFieldType(rawType);
              const options = Array.isArray(row.options)
                ? row.options.flatMap((opt) =>
                    typeof opt === 'string' && opt.trim() ? [opt.trim()] : [],
                  )
                : Array.isArray(row.field_options)
                  ? row.field_options.flatMap((opt) =>
                      typeof opt === 'string' && opt.trim() ? [opt.trim()] : [],
                    )
                  : [];
              const ratingCount =
                typeof row.rating_count === 'number' && Number.isFinite(row.rating_count)
                  ? Math.min(10, Math.max(2, Math.round(row.rating_count)))
                  : fieldType.endsWith('_rating')
                    ? 5
                    : undefined;
              return [
                {
                  label: row.label.trim(),
                  label_ar: typeof row.label_ar === 'string' ? row.label_ar : '',
                  field_type: fieldType,
                  is_required: Boolean(row.is_required),
                  status: row.status === undefined ? true : Boolean(row.status),
                  rating_count: ratingCount,
                  options,
                },
              ];
            })
          : [],
      },
      bulk_booking: this.parseBulkBookingRaw(bulk),
      time_extensions: Array.isArray(raw.time_extensions)
        ? raw.time_extensions.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const row = item as Record<string, unknown>;
            if (typeof row.title !== 'string' || !row.title.trim()) return [];
            return [
              {
                id:
                  typeof row.id === 'string' && row.id.trim()
                    ? row.id.trim()
                    : '',
                ...(row.legacy_id != null && Number.isFinite(Number(row.legacy_id))
                  ? { legacy_id: Number(row.legacy_id) }
                  : {}),
                title: row.title.trim(),
                title_ar: typeof row.title_ar === 'string' ? row.title_ar : '',
                scope: row.scope === 'order' ? 'order' as const : 'ticket' as const,
                minutes:
                  typeof row.minutes === 'number'
                    ? row.minutes
                    : typeof row.duration === 'number'
                      ? row.duration
                      : 30,
                price: typeof row.price === 'number' ? row.price : 0,
                ticket_ids: row.scope === 'order'
                  ? []
                  : Array.isArray(row.ticket_ids)
                  ? row.ticket_ids.flatMap((id) => {
                      const value = typeof id === 'string' || typeof id === 'number'
                        ? String(id).trim()
                        : '';
                      return value ? [value] : [];
                    })
                  : [],
              },
            ];
          })
        : [],
    };
  }

  private asStringList(value: Prisma.JsonValue | null | undefined): string[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => (typeof item === 'string' && item.trim() ? [item.trim()] : []));
  }

  private asQty(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) return null;
    return Math.round(num);
  }

  private parseBulkBookingRaw(bulk: Record<string, unknown>) {
    const tickets = Array.isArray(bulk.tickets)
      ? bulk.tickets.flatMap((item) => {
          if (!item || typeof item !== 'object') return [];
          const row = item as Record<string, unknown>;
          const ticketId =
            typeof row.ticket_id === 'string'
              ? row.ticket_id
              : typeof row.id === 'string'
                ? row.id
                : '';
          if (!ticketId) return [];
          const packs = Array.isArray(row.packs)
            ? row.packs.flatMap((pack) => {
                if (!pack || typeof pack !== 'object') return [];
                const p = pack as Record<string, unknown>;
                const packId =
                  typeof p.id === 'string'
                    ? p.id
                    : typeof p.pack_id === 'string'
                      ? p.pack_id
                      : '';
                if (!packId) return [];
                return [
                  {
                    id: packId,
                    title: typeof p.title === 'string' ? p.title : '',
                    min_qty: this.asQty(p.min_qty),
                    max_qty: this.asQty(p.max_qty),
                    discount:
                      typeof p.discount === 'number' && Number.isFinite(p.discount)
                        ? p.discount
                        : 0,
                  },
                ];
              })
            : [];
          return [
            {
              ticket_id: ticketId,
              ticket_name:
                typeof row.ticket_name === 'string'
                  ? row.ticket_name
                  : typeof row.title === 'string'
                    ? row.title
                    : '',
              min_qty: this.asQty(row.min_qty),
              max_qty: this.asQty(row.max_qty),
              discount:
                typeof row.discount === 'number' && Number.isFinite(row.discount)
                  ? row.discount
                  : 0,
              packs,
            },
          ];
        })
      : [];

    return {
      self_checkout: Boolean(bulk.self_checkout),
      tickets,
    };
  }

  private normalizeBulkBooking(
    input: {
      self_checkout?: boolean;
      tickets?: Array<{
        ticket_id: string;
        ticket_name?: string;
        min_qty?: number | null;
        max_qty?: number | null;
        discount?: number;
        packs?: Array<{
          id: string;
          title?: string;
          min_qty?: number | null;
          max_qty?: number | null;
          discount?: number;
        }>;
      }>;
    },
    existing: ReturnType<AdminEventsService['parseBulkBookingRaw']>,
  ) {
    const selfCheckout =
      input.self_checkout !== undefined ? Boolean(input.self_checkout) : existing.self_checkout;
    const tickets = (input.tickets ?? existing.tickets).map((ticket) => {
      const packs = (ticket.packs ?? []).map((pack) => ({
        id: pack.id,
        title: pack.title?.trim() || '',
        min_qty: this.asQty(pack.min_qty),
        max_qty: this.asQty(pack.max_qty),
        discount: selfCheckout ? Number(pack.discount) || 0 : 0,
      }));
      return {
        ticket_id: ticket.ticket_id,
        ticket_name: ticket.ticket_name?.trim() || '',
        min_qty: packs.length ? null : this.asQty(ticket.min_qty),
        max_qty: packs.length ? null : this.asQty(ticket.max_qty),
        discount: packs.length || !selfCheckout ? 0 : Number(ticket.discount) || 0,
        packs,
      };
    });
    return { self_checkout: selfCheckout, tickets };
  }

  private buildBulkBookingView(
    saved: ReturnType<AdminEventsService['parseBulkBookingRaw']>,
    ticketTypes: Array<{
      id: string;
      title: string;
      hasVariants: boolean;
      basePrice: { toNumber(): number } | null;
      hideFromOnline: boolean;
      variants: Array<{
        id: string;
        name: string;
        basePrice: { toNumber(): number };
      }>;
    }>,
  ) {
    const eligible = ticketTypes.filter((ticket) => {
      if (ticket.hideFromOnline) return false;
      if (ticket.hasVariants && ticket.variants.length > 0) {
        return ticket.variants.some((variant) => variant.basePrice.toNumber() > 0);
      }
      return (ticket.basePrice?.toNumber() ?? 0) > 0;
    });

    const toRow = (
      ticket: (typeof eligible)[number],
      savedTicket?: (typeof saved.tickets)[number],
    ) => {
      const hasPacks = ticket.hasVariants && ticket.variants.length > 0;
      const packs = hasPacks
        ? ticket.variants.map((variant) => {
            const savedPack = savedTicket?.packs.find((pack) => pack.id === variant.id);
            return {
              id: variant.id,
              title: variant.name,
              min_qty: savedPack?.min_qty ?? null,
              max_qty: savedPack?.max_qty ?? null,
              discount: savedPack?.discount ?? 0,
            };
          })
        : [];

      return {
        ticket_id: ticket.id,
        ticket_name: ticket.title,
        min_qty: hasPacks ? null : (savedTicket?.min_qty ?? null),
        max_qty: hasPacks ? null : (savedTicket?.max_qty ?? null),
        discount: hasPacks ? 0 : (savedTicket?.discount ?? 0),
        packs,
      };
    };

    const byId = new Map(eligible.map((ticket) => [ticket.id, ticket]));
    // Opt-in list: only tickets explicitly saved for group booking
    const tickets = saved.tickets.flatMap((savedTicket) => {
      const ticket = byId.get(savedTicket.ticket_id);
      if (!ticket) return [];
      return [toRow(ticket, savedTicket)];
    });

    const catalog = eligible.map((ticket) => toRow(ticket));

    return {
      self_checkout: saved.self_checkout,
      tickets,
      catalog,
    };
  }

  private normalizeFeedbackFieldType(raw: string) {
    if (raw === 'rating') return 'star_rating' as const;
    if (raw === 'yes_no') return 'radio' as const;
    const allowed = [
      'text',
      'textarea',
      'checkbox',
      'radio',
      'dropdown',
      'multiple_textboxes',
      'numeric_rating',
      'star_rating',
      'smiley_rating',
    ] as const;
    return (allowed as readonly string[]).includes(raw)
      ? (raw as (typeof allowed)[number])
      : ('text' as const);
  }

  private normalizeFeedbackQuestion(q: {
    label: string;
    label_ar?: string;
    field_type?: string;
    type?: string;
    is_required?: boolean;
    status?: boolean;
    rating_count?: number;
    options?: string[];
  }) {
    const fieldType = this.normalizeFeedbackFieldType(q.field_type || q.type || 'text');
    const needsOptions = ['checkbox', 'radio', 'dropdown', 'multiple_textboxes'].includes(fieldType);
    const isRating = ['numeric_rating', 'star_rating', 'smiley_rating'].includes(fieldType);
    let options = (q.options ?? []).map((item) => item.trim()).filter(Boolean);
    if (fieldType === 'radio' && (q.type === 'yes_no' || q.field_type === 'yes_no') && !options.length) {
      options = ['Yes', 'No'];
    }
    return {
      label: q.label.trim(),
      label_ar: q.label_ar?.trim() || '',
      field_type: fieldType,
      is_required: Boolean(q.is_required),
      status: q.status === undefined ? true : Boolean(q.status),
      rating_count: isRating
        ? Math.min(10, Math.max(2, Number(q.rating_count) || 5))
        : undefined,
      options: needsOptions ? options : [],
    };
  }

  private parseTermsItems(enRaw?: string | null, arRaw?: string | null) {
    const fromJson = (raw?: string | null) => {
      if (!raw?.trim())
        return [] as Array<{ title: string; title_ar: string; rule: string; rule_ar: string }>;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          return parsed.flatMap((item) => {
            if (!item || typeof item !== 'object') return [];
            const row = item as Record<string, unknown>;
            return [
              {
                title: typeof row.title === 'string' ? row.title : '',
                title_ar: typeof row.title_ar === 'string' ? row.title_ar : '',
                rule: typeof row.rule === 'string' ? row.rule : '',
                rule_ar: typeof row.rule_ar === 'string' ? row.rule_ar : '',
              },
            ];
          });
        }
      } catch {
        // legacy plain-text terms
      }
      return [{ title: 'Terms and conditions', title_ar: '', rule: raw, rule_ar: '' }];
    };

    const enItems = fromJson(enRaw);
    // Prefer bilingual payload stored on EN; merge legacy AR plain text if present.
    if (enItems.some((item) => item.title_ar || item.rule_ar || item.title || item.rule)) {
      if (arRaw?.trim() && !enItems.some((item) => item.rule_ar || item.title_ar)) {
        try {
          JSON.parse(arRaw);
        } catch {
          if (enItems[0]) enItems[0].rule_ar = arRaw;
          else enItems.push({ title: '', title_ar: 'الشروط والأحكام', rule: '', rule_ar: arRaw });
        }
      }
      return enItems;
    }
    return fromJson(arRaw);
  }

  private parseTitledItems(
    enJson: Prisma.JsonValue | null | undefined,
    arJson?: Prisma.JsonValue | null,
  ) {
    const fromList = (value: Prisma.JsonValue | null | undefined) => {
      if (!Array.isArray(value)) return [] as Array<{ title: string; title_ar: string }>;
      return value.flatMap((item) => {
        if (typeof item === 'string' && item.trim()) {
          return [{ title: item.trim(), title_ar: '' }];
        }
        if (!item || typeof item !== 'object') return [];
        const row = item as Record<string, unknown>;
        const title = typeof row.title === 'string' ? row.title.trim() : '';
        const titleAr = typeof row.title_ar === 'string' ? row.title_ar.trim() : '';
        if (!title && !titleAr) return [];
        return [{ title, title_ar: titleAr }];
      });
    };

    const enItems = fromList(enJson);
    if (enItems.some((item) => item.title_ar)) return enItems;

    const arTitles = this.asStringList(arJson);
    if (!arTitles.length) return enItems;
    const count = Math.max(enItems.length, arTitles.length);
    return Array.from({ length: count }, (_, index) => ({
      title: enItems[index]?.title ?? '',
      title_ar: arTitles[index] ?? enItems[index]?.title_ar ?? '',
    }));
  }

  private asFaqList(value: Prisma.JsonValue | null | undefined) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (typeof row.question !== 'string' || typeof row.answer !== 'string') return [];
      return [{ question: row.question, answer: row.answer }];
    });
  }

  private addonVisibilityFlags(visibility: 'online' | 'offline' | 'both') {
    if (visibility === 'online') return { hideFromOnline: false, hideFromPos: true };
    if (visibility === 'offline') return { hideFromOnline: true, hideFromPos: false };
    return { hideFromOnline: false, hideFromPos: false };
  }

  private addonVisibilityLabel(hideFromOnline: boolean, hideFromPos: boolean) {
    if (!hideFromOnline && hideFromPos) return 'online' as const;
    if (hideFromOnline && !hideFromPos) return 'offline' as const;
    return 'both' as const;
  }

  private async saveVenueImage(
    dataUrl: string,
    fileName: string | undefined,
    folder: 'banner' | 'gallery',
  ) {
    const stored = await this.mediaStorage.uploadDataUrlFileOnly({
      folder: `venues/${folder}`,
      dataUrl,
      fileName,
      maxBytes: 10 * 1024 * 1024,
      errorLabel: 'venue image',
    });
    return stored.url;
  }

  private async saveCategoryThumbnail(dataUrl: string, fileName?: string) {
    const stored = await this.mediaStorage.uploadDataUrlFileOnly({
      folder: 'categories',
      dataUrl,
      fileName,
      maxBytes: 5 * 1024 * 1024,
      errorLabel: 'thumbnail',
    });
    return stored.url;
  }

  private async saveAddonThumbnail(eventId: string, dataUrl: string, fileName?: string) {
    const stored = await this.mediaStorage.uploadDataUrlFileOnly({
      folder: `events/${eventId}/addons`,
      dataUrl,
      fileName,
      maxBytes: 5 * 1024 * 1024,
      errorLabel: 'thumbnail',
    });
    return stored.url;
  }

  private async resolveOrganizer(userId: string) {
    const membership = await this.prisma.organizationMember.findFirst({
      where: {
        userId,
        status: 'active',
        user: { status: 'active' },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!membership) {
      throw new BadRequestException(
        'The selected organiser account is not active.',
      );
    }

    // Panel login requires AdminProfile; org membership alone is not enough.
    const existingProfile = await this.prisma.adminProfile.findUnique({
      where: { userId },
      select: { id: true, status: true },
    });
    if (!existingProfile) {
      const organiserRole = await this.prisma.role.findUnique({
        where: { name: 'organiser' },
        select: { id: true },
      });
      if (!organiserRole) {
        throw new BadRequestException('Organiser role is not seeded.');
      }
      await this.prisma.adminProfile.create({
        data: { userId, roleId: organiserRole.id, status: 'active' },
      });
    } else if (existingProfile.status !== 'active') {
      await this.prisma.adminProfile.update({
        where: { userId },
        data: { status: 'active' },
      });
    }

    return membership.user;
  }

  private toDto(event: AdminEventRecord, locale: string) {
    const translation =
      event.translations.find((item) => item.locale === locale) ??
      event.translations.find((item) => item.locale === 'en') ??
      event.translations[0];
    const venueTranslation =
      event.venue?.translations.find((item) => item.locale === locale) ??
      event.venue?.translations.find((item) => item.locale === 'en');
    const categoryTranslation =
      event.category?.translations.find((item) => item.locale === locale) ??
      event.category?.translations.find((item) => item.locale === 'en');

    return {
      id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      subtitle: translation?.subtitle ?? null,
      status: event.status,
      visibility: event.visibility,
      organization: {
        id: event.organization.id,
        slug: event.organization.slug,
        name: event.organization.name,
      },
      organizer: event.primaryOrganizer
        ? {
            id: event.primaryOrganizer.id,
            name: event.primaryOrganizer.name,
            email: event.primaryOrganizer.email,
            status: event.primaryOrganizer.status,
          }
        : null,
      event_type: event.eventType,
      booking_mode: event.bookingMode,
      currency: event.currency,
      is_featured: event.isFeatured,
      starts_at: event.startsAt?.toISOString() ?? null,
      ends_at: event.endsAt?.toISOString() ?? null,
      published_at: event.publishedAt?.toISOString() ?? null,
      updated_at: event.updatedAt.toISOString(),
      venue: event.venue
        ? { id: event.venue.id, name: venueTranslation?.name ?? event.venue.name }
        : null,
      category: event.category
        ? { id: event.category.id, name: categoryTranslation?.name ?? event.category.name }
        : null,
      image_url: event.primaryMedia?.url ?? null,
      counts: {
        sessions: event._count.sessions,
        ticket_types: event._count.ticketTypes,
        orders: event._count.orders,
      },
    };
  }

  private assertCustomizationOptions(
    options: Array<{
      name: string;
      price: number;
      has_duration?: boolean;
      duration_minutes?: number;
    }>,
  ) {
    if (!options.length) {
      throw new BadRequestException('Add at least one customization item for a customizable ticket.');
    }
    for (const option of options) {
      if (!option.name?.trim()) {
        throw new BadRequestException('Each customization item needs a name.');
      }
      if (option.price === undefined || Number.isNaN(Number(option.price)) || Number(option.price) < 0) {
        throw new BadRequestException('Each customization item needs a valid price.');
      }
    }
  }

  private mapCustomizationOption(option: {
    id: string;
    externalKey: string;
    name: string;
    description: string | null;
    price: Prisma.Decimal | number;
    currency: string;
    hasDuration: boolean;
    durationMinutes: number | null;
    maxQtyPerTicket: number | null;
    status: string;
  }) {
    const price =
      typeof option.price === 'object' && option.price !== null && 'toNumber' in option.price
        ? option.price.toNumber()
        : Number(option.price);
    return {
      id: option.id,
      external_key: option.externalKey,
      name: option.name,
      description: option.description,
      price,
      currency: option.currency,
      has_duration: option.hasDuration,
      duration_minutes: option.durationMinutes,
      max_qty_per_ticket: option.maxQtyPerTicket,
      status: option.status,
    };
  }

  private mapAdminTicketType(
    ticket: {
      id: string;
      externalKey: string;
      title: string;
      subtitle: string | null;
      inclusions: string[];
      exclusions: string[];
      hasVariants: boolean;
      isCustomizable: boolean;
      basePrice: Prisma.Decimal | null;
      currency: string;
      status: string;
      maxQtyPerOrder: number | null;
      admitCount: number;
      hasDuration: boolean;
      durationMinutes: number | null;
      hideFromOnline: boolean;
      hideFromPos: boolean;
      thirdPartyVendorId: string | null;
      isThirdPartyPlatformTicket: boolean;
      thirdPartyPlatformId: string | null;
      salesStartAt: Date | null;
      salesEndAt: Date | null;
      variants: Array<{
        id: string;
        externalKey: string;
        name: string;
        description: string | null;
        basePrice: Prisma.Decimal;
        currency: string;
        badge: string | null;
        durationMinutes: number | null;
        maxQtyPerOrder: number | null;
        status: string;
      }>;
      customizationOptions: Array<{
        id: string;
        externalKey: string;
        name: string;
        description: string | null;
        price: Prisma.Decimal;
        currency: string;
        hasDuration: boolean;
        durationMinutes: number | null;
        maxQtyPerTicket: number | null;
        status: string;
      }>;
      thirdPartyVendor: {
        id: string;
        name: string;
        isMain: boolean;
        isCafe: boolean;
      } | null;
      thirdPartyPlatform: {
        id: string;
        name: string;
        accessCode: string | null;
        badgeColor: string;
      } | null;
    },
    pricingMode: string,
    sessionIds?: string[],
  ) {
    return {
      id: ticket.id,
      external_key: ticket.externalKey,
      title: ticket.title,
      subtitle: ticket.subtitle,
      inclusions: ticket.inclusions,
      exclusions: ticket.exclusions,
      has_variants: ticket.hasVariants,
      is_customizable: ticket.isCustomizable,
      pricing_mode: pricingMode,
      price: ticket.basePrice?.toNumber() ?? null,
      currency: ticket.currency,
      status: ticket.status,
      max_qty_per_order: ticket.maxQtyPerOrder,
      admit_count: ticket.admitCount,
      has_duration: ticket.hasDuration,
      duration_minutes: ticket.durationMinutes,
      hide_from_online: ticket.hideFromOnline,
      hide_from_pos: ticket.hideFromPos,
      third_party_vendor_id: ticket.thirdPartyVendorId,
      third_party_vendor: ticket.thirdPartyVendor
        ? {
            id: ticket.thirdPartyVendor.id,
            name: ticket.thirdPartyVendor.name,
            is_main: ticket.thirdPartyVendor.isMain,
            is_cafe: ticket.thirdPartyVendor.isCafe,
          }
        : null,
      is_third_party_platform_ticket: ticket.isThirdPartyPlatformTicket,
      third_party_platform_id: ticket.thirdPartyPlatformId,
      third_party_platform: ticket.thirdPartyPlatform
        ? {
            id: ticket.thirdPartyPlatform.id,
            name: ticket.thirdPartyPlatform.name,
            access_code: ticket.thirdPartyPlatform.accessCode,
            badge_color: ticket.thirdPartyPlatform.badgeColor,
          }
        : null,
      sales_start_at: ticket.salesStartAt?.toISOString() ?? null,
      sales_end_at: ticket.salesEndAt?.toISOString() ?? null,
      ...(sessionIds ? { session_ids: sessionIds } : {}),
      variants: ticket.variants.map((variant) => ({
        id: variant.id,
        external_key: variant.externalKey,
        name: variant.name,
        description: variant.description,
        price: variant.basePrice.toNumber(),
        currency: variant.currency,
        badge: variant.badge,
        duration_minutes: variant.durationMinutes,
        max_qty_per_order: variant.maxQtyPerOrder,
        status: variant.status,
      })),
      customization_options: ticket.customizationOptions.map((option) =>
        this.mapCustomizationOption(option),
      ),
    };
  }

  private mapThirdPartyPlatform(platform: {
    id: string;
    name: string;
    accessCode: string | null;
    badgeColor: string;
    sortOrder?: number;
  }) {
    return {
      id: platform.id,
      name: platform.name,
      access_code: platform.accessCode,
      badge_color: platform.badgeColor,
      sort_order: platform.sortOrder ?? 0,
    };
  }

  private async resolveThirdPartyPlatformLink(
    eventId: string,
    input: {
      is_third_party_platform_ticket?: boolean;
      third_party_platform_id?: string | null;
    },
    existing?: {
      isThirdPartyPlatformTicket: boolean;
      thirdPartyPlatformId: string | null;
    },
  ): Promise<{ isThirdPartyPlatformTicket: boolean; thirdPartyPlatformId: string | null }> {
    const flagProvided = input.is_third_party_platform_ticket !== undefined;
    const idProvided = input.third_party_platform_id !== undefined;

    let isThirdPartyPlatformTicket = existing?.isThirdPartyPlatformTicket ?? false;
    let thirdPartyPlatformId = existing?.thirdPartyPlatformId ?? null;

    if (flagProvided) {
      isThirdPartyPlatformTicket = Boolean(input.is_third_party_platform_ticket);
    }

    if (idProvided) {
      thirdPartyPlatformId = input.third_party_platform_id || null;
    }

    if (!flagProvided && idProvided && thirdPartyPlatformId) {
      isThirdPartyPlatformTicket = true;
    }

    if (!isThirdPartyPlatformTicket) {
      return { isThirdPartyPlatformTicket: false, thirdPartyPlatformId: null };
    }

    if (!thirdPartyPlatformId) {
      throw new BadRequestException(
        'Select a third-party platform for this platform ticket.',
      );
    }

    const platform = await this.prisma.thirdPartyPlatform.findFirst({
      where: { id: thirdPartyPlatformId, eventId },
      select: { id: true },
    });
    if (!platform) {
      throw new BadRequestException('Selected platform does not belong to this event.');
    }

    return {
      isThirdPartyPlatformTicket: true,
      thirdPartyPlatformId: platform.id,
    };
  }

  private mapThirdPartyVendor(share: {
    id: string;
    name: string;
    isMain: boolean;
    organiserShare: Prisma.Decimal | number | string;
    vendorSharePct: Prisma.Decimal | number | string;
    isCafe: boolean;
    collectedBy: string | null;
    ownerName: string | null;
    ownerPercentageType: string | null;
    sortOrder: number;
  }) {
    const organiserShare =
      typeof share.organiserShare === 'object' && share.organiserShare !== null && 'toNumber' in share.organiserShare
        ? (share.organiserShare as Prisma.Decimal).toNumber()
        : Number(share.organiserShare);
    const vendorShare =
      typeof share.vendorSharePct === 'object' && share.vendorSharePct !== null && 'toNumber' in share.vendorSharePct
        ? (share.vendorSharePct as Prisma.Decimal).toNumber()
        : Number(share.vendorSharePct);
    return {
      id: share.id,
      name: share.name,
      is_main: share.isMain,
      organiser_share: organiserShare,
      vendor_share: vendorShare,
      is_cafe: share.isCafe,
      collected_by: share.collectedBy,
      owner_name: share.ownerName,
      owner_percentage_type: share.ownerPercentageType,
      sort_order: share.sortOrder,
    };
  }

  private normalizeThirdPartyVendorRows(shares: ThirdPartyVendorItemDto[]): ThirdPartyVendorItemDto[] {
    return shares.map((share, index) => ({
      ...share,
      id: share.id || undefined,
      name: share.name.trim(),
      is_main: index === 0 ? true : Boolean(share.is_main),
      organiser_share: Number(share.organiser_share),
      vendor_share: Number(share.vendor_share),
      is_cafe: Boolean(share.is_cafe),
      collected_by: share.collected_by?.trim() || null,
      owner_name: share.owner_name?.trim() || null,
      owner_percentage_type: share.owner_percentage_type ?? null,
    }));
  }

  private assertThirdPartyVendorRules(rows: ThirdPartyVendorItemDto[]) {
    if (!rows.length) return;

    const names = rows.map((row) => row.name.toLowerCase());
    if (names.some((name) => !name)) {
      throw new BadRequestException('Vendor name is required.');
    }
    if (new Set(names).size !== names.length) {
      throw new ConflictException('Vendor name must be unique for this event.');
    }

    rows.forEach((row, index) => {
      const orgShare = Number(row.organiser_share);
      const vendorShare = Number(row.vendor_share);
      if (Number.isNaN(orgShare) || Number.isNaN(vendorShare)) {
        throw new BadRequestException(`Row ${index + 1}: enter valid share percentages.`);
      }
      if (Math.abs(orgShare + vendorShare - 100) > 0.01) {
        throw new BadRequestException(
          `Vendor ${index + 1}: event owner revenue + vendor revenue must equal 100% (currently ${(orgShare + vendorShare).toFixed(2)}%).`,
        );
      }
      if (index === 0 && vendorShare > 0 && !row.owner_name?.trim()) {
        throw new BadRequestException('Vendor payment name is required when vendor revenue is greater than 0.');
      }
      if (index === 0 && vendorShare > 0 && !row.owner_percentage_type) {
        throw new BadRequestException('Vendor revenue rule is required.');
      }
    });

    if (rows.length > 1) {
      const first = rows[0];
      if (first.vendor_share > 0 && first.owner_percentage_type === 'fixed') {
        for (let index = 1; index < rows.length; index += 1) {
          const combined = Number(first.vendor_share) + Number(rows[index].vendor_share);
          if (combined > 100.01) {
            throw new BadRequestException(
              `Row ${index + 1}: with a fixed main vendor share, combined vendor shares cannot exceed 100%.`,
            );
          }
        }
      }
    }
  }

  /**
   * Create missing inventory rows for every active ticket/variant on the given sessions.
   * Timing/session creation previously left existing tickets without inventory, which
   * marks schedule slots as "booked" and blocks checkout.
   */
  private async ensureInventoryForSessions(
    tx: Prisma.TransactionClient,
    eventId: string,
    sessions: Array<{ id: string; capacity: number | null }>,
  ) {
    if (sessions.length === 0) return;

    const ticketTypes = await tx.ticketType.findMany({
      where: { eventId, status: 'active' },
      select: {
        id: true,
        hasVariants: true,
        variants: {
          where: { status: 'active' },
          select: { id: true },
        },
      },
    });
    if (ticketTypes.length === 0) return;

    const rows: Array<{
      eventId: string;
      eventSessionId: string;
      itemType: 'ticket_type' | 'ticket_variant';
      itemId: string;
      totalQuantity: number | null;
      status: 'active';
    }> = [];

    for (const session of sessions) {
      for (const ticket of ticketTypes) {
        if (ticket.hasVariants) {
          for (const variant of ticket.variants) {
            rows.push({
              eventId,
              eventSessionId: session.id,
              itemType: 'ticket_variant',
              itemId: variant.id,
              totalQuantity: session.capacity,
              status: 'active',
            });
          }
        } else {
          rows.push({
            eventId,
            eventSessionId: session.id,
            itemType: 'ticket_type',
            itemId: ticket.id,
            totalQuantity: session.capacity,
            status: 'active',
          });
        }
      }
    }

    if (rows.length === 0) return;

    await tx.inventoryItem.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }

  private mapArtistOption(artist: {
    id: string;
    slug: string;
    name: string;
    status: string;
    translations: Array<{ locale: string; name: string; subtitle: string | null }>;
    profileMedia?: { url: string } | null;
  }) {
    const en = artist.translations.find((item) => item.locale === 'en');
    const ar = artist.translations.find((item) => item.locale === 'ar');
    return {
      id: artist.id,
      name: en?.name ?? artist.name,
      name_ar: ar?.name ?? null,
      slug: artist.slug,
      status: artist.status,
      subtitle: en?.subtitle ?? null,
      image_url: artist.profileMedia?.url ?? null,
    };
  }

  private mapArtistDetail(artist: {
    id: string;
    slug: string;
    name: string;
    status: string;
    stageName: string | null;
    dateOfBirth: Date | null;
    age: number | null;
    ageIsManual: boolean;
    origin: string | null;
    heightCm: number | null;
    ethnicity: string | null;
    nationality: string | null;
    religion: string | null;
    occupation: string | null;
    genres: string | null;
    instruments: string | null;
    netWorth: Prisma.Decimal | null;
    netWorthCurrency: string;
    maritalStatus: string | null;
    spouseName: string | null;
    children: Prisma.JsonValue;
    parents: Prisma.JsonValue;
    profileUpdatedDate: Date | null;
    translations: Array<{
      locale: string;
      name: string;
      subtitle: string | null;
      bio: string | null;
    }>;
    profileMedia?: { url: string } | null;
    bannerMedia?: { url: string } | null;
  }) {
    const en = artist.translations.find((item) => item.locale === 'en');
    const ar = artist.translations.find((item) => item.locale === 'ar');
    const parents =
      artist.parents && typeof artist.parents === 'object' && !Array.isArray(artist.parents)
        ? (artist.parents as { father?: string; mother?: string })
        : { father: '', mother: '' };
    const children = Array.isArray(artist.children)
      ? artist.children.filter((item): item is string => typeof item === 'string')
      : [];
    const splitCsv = (value: string | null) =>
      (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    return {
      id: artist.id,
      name: en?.name ?? artist.name,
      name_ar: ar?.name ?? null,
      slug: artist.slug,
      status: artist.status,
      stage_name: artist.stageName,
      stage_name_ar: ar?.subtitle ?? null,
      date_of_birth: artist.dateOfBirth
        ? artist.dateOfBirth.toISOString().slice(0, 10)
        : null,
      age: artist.age,
      age_is_manual: artist.ageIsManual,
      origin: artist.origin,
      height_cm: artist.heightCm,
      ethnicity: artist.ethnicity,
      nationality: artist.nationality,
      religion: artist.religion,
      occupation: artist.occupation,
      genres: splitCsv(artist.genres),
      instruments: splitCsv(artist.instruments),
      net_worth: artist.netWorth != null ? Number(artist.netWorth) : null,
      net_worth_currency: artist.netWorthCurrency,
      marital_status: artist.maritalStatus,
      spouse_name: artist.spouseName,
      children,
      parents: {
        father: parents.father ?? '',
        mother: parents.mother ?? '',
      },
      biography: en?.bio ?? null,
      biography_ar: ar?.bio ?? null,
      profile_updated_date: artist.profileUpdatedDate
        ? artist.profileUpdatedDate.toISOString().slice(0, 10)
        : null,
      image_url: artist.profileMedia?.url ?? null,
      banner_url: artist.bannerMedia?.url ?? null,
    };
  }

  private mapVenueDetail(venue: {
    id: string;
    slug: string;
    name: string;
    status: string;
    address: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    country: string;
    latitude: Prisma.Decimal | null;
    longitude: Prisma.Decimal | null;
    googleMapUrl: string | null;
    bannerUrl: string | null;
    galleryUrls: Prisma.JsonValue;
    translations: Array<{
      locale: string;
      name: string;
      description: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      country: string | null;
    }>;
  }) {
    const en = venue.translations.find((item) => item.locale === 'en');
    const ar = venue.translations.find((item) => item.locale === 'ar');
    const gallery = Array.isArray(venue.galleryUrls)
      ? venue.galleryUrls.filter((item): item is string => typeof item === 'string')
      : [];
    return {
      id: venue.id,
      name: en?.name ?? venue.name,
      name_ar: ar?.name ?? null,
      slug: venue.slug,
      status: venue.status === 'published' ? 'active' : 'inactive',
      about: en?.description ?? null,
      about_ar: ar?.description ?? null,
      address: en?.address ?? venue.address,
      address_ar: ar?.address ?? null,
      city: en?.city ?? venue.city,
      city_ar: ar?.city ?? null,
      state: en?.state ?? venue.state,
      state_ar: ar?.state ?? null,
      zipcode: venue.zipcode,
      country: venue.country,
      country_ar: ar?.country ?? null,
      latitude: venue.latitude != null ? Number(venue.latitude) : null,
      longitude: venue.longitude != null ? Number(venue.longitude) : null,
      google_map_url: venue.googleMapUrl,
      banner_url: venue.bannerUrl,
      gallery_urls: gallery,
    };
  }

  private csvFromTags(tags: string[] | undefined) {
    const cleaned = (tags ?? []).map((item) => item.trim()).filter(Boolean);
    return cleaned.length ? cleaned.join(', ') : null;
  }

  private ageFromBirthDate(dateOfBirth: string) {
    const birth = new Date(`${dateOfBirth}T00:00:00.000Z`);
    if (Number.isNaN(birth.getTime())) return null;
    const today = new Date();
    let age = today.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = today.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getUTCDate() < birth.getUTCDate())) {
      age -= 1;
    }
    return age >= 0 && age <= 150 ? age : null;
  }

  private async saveArtistImage(
    dataUrl: string,
    fileName: string | undefined,
    adminUserId: string,
    kind: 'profile' | 'banner' = 'profile',
  ) {
    const folder = kind === 'banner' ? 'artists/banners' : 'artists';
    return this.mediaStorage.uploadDataUrl({
      folder,
      dataUrl,
      fileName,
      maxBytes: 10 * 1024 * 1024,
      allowJpgAlias: true,
      altText: fileName?.trim() || null,
      uploadedByUserId: adminUserId,
      errorLabel: kind === 'banner' ? 'artist banner' : 'artist image',
    });
  }

  private slugify(value: string) {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 180);
  }

  private cleanTicketList(items: string[] | undefined) {
    return (items ?? []).map((item) => item.trim()).filter(Boolean);
  }

  private qatarDate(value: Date) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (type: string) => parts.find((item) => item.type === type)?.value;
    return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
  }

}
