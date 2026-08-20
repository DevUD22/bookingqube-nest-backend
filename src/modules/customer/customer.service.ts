import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { revokeAuthSessionsForUser } from '../../common/auth/session-revocation';
import { hashPassword, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { CustomerSessionService } from '../auth/customer-session.service';
import { OtpService } from '../auth/otp.service';
import { MailService } from '../mail/mail.service';
import { AddCustomerFavoriteDto } from './dto/customer-favorite.dto';
import {
  ConfirmEmailChangeDto,
  UpdateCustomerPasswordDto,
  UpdateCustomerProfileDto,
} from './dto/customer-profile.dto';

const DEFAULT_AVATAR_URL =
  'https://bookingqube.blob.core.windows.net/bqcontainer/static/default-avatar.png';
const FALLBACK_EVENT_IMAGE = 'https://images.unsplash.com/photo-1501281668745-f7f57925c3b4';

const favoriteEventInclude = {
  translations: true,
  dates: {
    where: {
      status: 'active',
    },
    orderBy: {
      date: 'asc',
    },
  },
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
  ticketTypes: {
    where: {
      status: 'active',
    },
    orderBy: {
      sortOrder: 'asc',
    },
  },
} satisfies Prisma.EventInclude;

type FavoriteEventRecord = Prisma.EventGetPayload<{
  include: typeof favoriteEventInclude;
}>;

@Injectable()
export class CustomerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: CustomerSessionService,
    private readonly otpService: OtpService,
    private readonly mailService: MailService,
  ) {}

  async getProfile(userId: string) {
    const user = await this.getUser(userId);
    return {
      success: true,
      data: this.toProfileDto(user),
    };
  }

  async updateProfile(userId: string, input: UpdateCustomerProfileDto) {
    const current = await this.getUser(userId);
    const requestedEmail = input.email?.trim().toLowerCase() || current.email;
    const name = input.name?.trim() || current.name;
    const phone =
      input.phone !== undefined ? input.phone.trim() || null : current.phone;
    const address =
      input.address !== undefined
        ? input.address.trim() || null
        : current.customerProfile?.address ?? null;

    if (phone && phone !== current.phone) {
      const existingUser = await this.prisma.user.findUnique({
        where: { phone },
      });
      if (existingUser && existingUser.id !== current.id) {
        throw new BadRequestException('Phone is already in use.');
      }
    }

    const emailChanged = requestedEmail !== current.email;
    if (emailChanged) {
      await this.assertEmailAvailable(requestedEmail, current.id);
      if (current.passwordHash) {
        if (!input.current_password?.trim()) {
          throw new BadRequestException(
            'Current password is required to change your email.',
          );
        }
        if (!(await verifyPassword(input.current_password, current.passwordHash))) {
          throw new BadRequestException('Current password is incorrect.');
        }
      }
    }

    const user = await this.prisma.user.update({
      where: { id: current.id },
      data: {
        name,
        phone,
        customerProfile: {
          upsert: {
            create: {
              address,
            },
            update: {
              address,
            },
          },
        },
      },
      include: {
        customerProfile: true,
      },
    });

    if (emailChanged) {
      await this.startEmailChange(user.id, user.name, user.email, requestedEmail);
      const refreshed = await this.getUser(user.id);
      return {
        success: true,
        message: 'Check your new email for a verification code.',
        data: this.toProfileDto(refreshed),
      };
    }

    return {
      success: true,
      message: 'Profile updated successfully.',
      data: this.toProfileDto(user),
    };
  }

  async confirmEmailChange(userId: string, input: ConfirmEmailChangeDto) {
    const current = await this.getUser(userId);
    const pendingEmail = current.pendingEmail?.trim().toLowerCase();
    if (!pendingEmail) {
      throw new BadRequestException('No email change is pending.');
    }

    const consumed = await this.otpService.consumeEmailChange(userId, input.otp);
    if (!consumed || consumed.newEmail !== pendingEmail) {
      throw new BadRequestException('Invalid or expired code.');
    }

    await this.assertEmailAvailable(pendingEmail, current.id);

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: current.id },
        data: {
          email: pendingEmail,
          pendingEmail: null,
          emailVerifiedAt: new Date(),
          tokenVersion: { increment: 1 },
        },
        include: { customerProfile: true },
      });
      await revokeAuthSessionsForUser(tx, current.id);
      return row;
    });

    const issued = await this.sessions.issue({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      tokenVersion: updated.tokenVersion,
    });

    return {
      success: true,
      message: 'Email updated successfully.',
      token: issued.token,
      refresh_token: issued.refresh_token,
      expires_in: issued.expires_in,
      data: this.toProfileDto(updated),
    };
  }

  async resendEmailChange(userId: string) {
    const current = await this.getUser(userId);
    const pendingEmail = current.pendingEmail?.trim().toLowerCase();
    if (!pendingEmail) {
      throw new BadRequestException('No email change is pending.');
    }
    await this.assertEmailAvailable(pendingEmail, current.id);
    await this.startEmailChange(current.id, current.name, current.email, pendingEmail);
    return {
      success: true,
      message: 'Check your new email for a verification code.',
      data: this.toProfileDto(await this.getUser(userId)),
    };
  }

  async cancelEmailChange(userId: string) {
    const current = await this.getUser(userId);
    await this.otpService.invalidateEmailChange(userId);
    const user = await this.prisma.user.update({
      where: { id: current.id },
      data: { pendingEmail: null },
      include: { customerProfile: true },
    });
    return {
      success: true,
      message: 'Email change cancelled.',
      data: this.toProfileDto(user),
    };
  }

  async updatePassword(userId: string, input: UpdateCustomerPasswordDto) {
    const user = await this.getUser(userId);

    if (!user.passwordHash) {
      throw new BadRequestException(
        'This account has no password set yet. Use "Forgot password" to create one.',
      );
    }
    if (!input.current || !(await verifyPassword(input.current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect.');
    }
    if (!input.password || input.password.length < 8) {
      throw new BadRequestException('Password must be at least 8 characters.');
    }
    if (input.password !== input.password_confirmation) {
      throw new BadRequestException('Password confirmation does not match.');
    }

    const passwordHash = await hashPassword(input.password);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          tokenVersion: true,
        },
      });
      await revokeAuthSessionsForUser(tx, user.id);
      return row;
    });

    const issued = await this.sessions.issue({
      id: updated.id,
      name: updated.name,
      email: updated.email,
      phone: updated.phone,
      tokenVersion: updated.tokenVersion,
    });

    return {
      success: true,
      message: 'Password updated successfully.',
      token: issued.token,
      refresh_token: issued.refresh_token,
      expires_in: issued.expires_in,
    };
  }

  async getFavorites(userId: string, lang: string) {
    const favorites = await this.prisma.customerFavorite.findMany({
      where: {
        customerId: userId,
      },
      include: {
        event: {
          include: favoriteEventInclude,
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return {
      success: true,
      data: favorites.map((favorite) => this.toFavoriteEventDto(favorite.event, lang)),
    };
  }

  async addFavorite(userId: string, input: AddCustomerFavoriteDto, lang: string) {
    const event = await this.resolveEvent(input.event_id ?? input.eventId ?? input.slug);

    await this.prisma.customerFavorite.upsert({
      where: {
        customerId_eventId: {
          customerId: userId,
          eventId: event.id,
        },
      },
      update: {},
      create: {
        customerId: userId,
        eventId: event.id,
      },
    });

    return {
      success: true,
      message: 'Favourite added successfully.',
      data: this.toFavoriteEventDto(event, lang),
    };
  }

  async removeFavorite(userId: string, eventId: string) {
    const event = await this.resolveEvent(eventId);

    await this.prisma.customerFavorite.deleteMany({
      where: {
        customerId: userId,
        eventId: event.id,
      },
    });

    return {
      success: true,
      message: 'Favourite removed successfully.',
    };
  }

  private async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        customerProfile: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Customer not found.');
    }

    return user;
  }

  private async assertEmailAvailable(email: string, userId: string) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Enter a valid email address.');
    }
    const existingUser = await this.prisma.user.findUnique({ where: { email } });
    if (existingUser && existingUser.id !== userId) {
      throw new BadRequestException('Email is already in use.');
    }
  }

  private async startEmailChange(
    userId: string,
    name: string,
    currentEmail: string,
    newEmail: string,
  ) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingEmail: newEmail },
    });
    const otp = await this.otpService.generateEmailChange(userId, newEmail);
    await Promise.all([
      this.mailService.sendEmailChangeOtp({
        to: newEmail,
        name,
        otp,
        newEmail,
      }),
      this.mailService.sendEmailChangeNotice({
        to: currentEmail,
        name,
        newEmail,
      }),
    ]);
  }

  private toProfileDto(user: Awaited<ReturnType<CustomerService['getUser']>>) {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      pending_email: user.pendingEmail ?? null,
      phone: user.phone ?? '',
      address: user.customerProfile?.address ?? '',
      created_at: user.createdAt.toISOString(),
      avatar: '',
      avatar_url: DEFAULT_AVATAR_URL,
      default_avatar_url: DEFAULT_AVATAR_URL,
      image_url_prefix: '',
    };
  }

  private async resolveEvent(identifier?: string | null) {
    const value = identifier?.trim();
    if (!value) {
      throw new BadRequestException('Event is required.');
    }

    const event = await this.prisma.event.findFirst({
      where: {
        OR: [
          { id: value },
          { slug: value },
        ],
      },
      include: favoriteEventInclude,
    });

    if (!event || event.status !== 'published') {
      throw new NotFoundException('Event not found.');
    }

    return event;
  }

  private toFavoriteEventDto(event: FavoriteEventRecord, lang: string) {
    const locale = this.normalizeLocale(lang);
    const translation = this.pickTranslation(event.translations, locale);
    const venueTranslation = event.venue
      ? this.pickTranslation(event.venue.translations, locale)
      : null;
    const categoryTranslation = event.category
      ? this.pickTranslation(event.category.translations, locale)
      : null;
    const nextDate = event.dates[0]?.date ?? event.startsAt ?? event.publishedAt ?? event.createdAt;
    const categoryName = categoryTranslation?.name ?? event.category?.name ?? 'Events';
    const startingPrice = event.ticketTypes
      .map((ticket) => ticket.basePrice?.toNumber())
      .filter((price): price is number => typeof price === 'number')
      .sort((left, right) => left - right)[0];

    return {
      id: event.id,
      slug: event.slug,
      title: translation?.title ?? event.slug,
      date: this.formatDateLabel(nextDate, locale),
      location: venueTranslation?.name ?? event.venue?.name ?? event.venue?.city ?? 'Qatar',
      image: event.primaryMedia?.url ?? event.media[0]?.mediaAsset.url ?? FALLBACK_EVENT_IMAGE,
      price:
        startingPrice !== undefined
          ? `From ${event.currency} ${startingPrice.toFixed(2)}`
          : event.bookingMode === 'registration'
            ? 'Free registration'
            : 'Price unavailable',
      category: categoryName,
      tags: [categoryName],
      status: 'available',
      status_label: 'Available',
      event_type: event.eventType,
      currentEventDate: nextDate.toISOString().slice(0, 10),
    };
  }

  private pickTranslation<T extends { locale: string }>(translations: T[], locale: string) {
    return (
      translations.find((translation) => translation.locale === locale) ??
      translations.find((translation) => translation.locale === 'en') ??
      translations[0]
    );
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private formatDateLabel(date: Date, locale: string) {
    return new Intl.DateTimeFormat(locale === 'ar' ? 'ar-QA' : 'en-QA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(date);
  }
}
