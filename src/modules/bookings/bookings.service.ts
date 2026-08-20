import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderItemType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { resolvePaymentMethodKeyLabel } from '../admin-payment-settings/payment-method-labels';
import {
  TICKET_CARD_THEMES,
  TicketCardAddon,
  TicketCardModel,
  buildTicketCardsPdf,
} from './ticket-pdf.builder';

const bookingInclude = {
  customer: true,
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
    },
  },
  venue: {
    include: {
      translations: true,
    },
  },
  eventSession: {
    include: {
      eventDate: true,
    },
  },
  items: {
    orderBy: {
      createdAt: 'asc',
    },
  },
  payments: {
    orderBy: {
      createdAt: 'desc',
    },
    take: 1,
  },
  eventReview: true,
} satisfies Prisma.OrderInclude;

type BookingRecord = Prisma.OrderGetPayload<{
  include: typeof bookingInclude;
}>;

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async getCustomerBookings(input: {
    customerId: string;
    fromDate?: string;
    toDate?: string;
    page: string;
    perPage: string;
    lang: string;
  }) {
    const page = Math.max(1, Number(input.page) || 1);
    const perPage = Math.min(50, Math.max(1, Number(input.perPage) || 6));
    const where: Prisma.OrderWhereInput = { customerId: input.customerId };
    const fromDate = this.parseDate(input.fromDate);
    const toDate = this.parseDate(input.toDate);

    if (fromDate || toDate) {
      where.eventSession = {
        eventDate: {
          date: {
            ...(fromDate ? { gte: fromDate } : {}),
            ...(toDate ? { lte: toDate } : {}),
          },
        },
      };
    }

    const [total, orders, reviewSettings] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: bookingInclude,
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }),
    ]);

    const lastPage = Math.max(1, Math.ceil(total / perPage));
    const from = total === 0 ? null : (page - 1) * perPage + 1;
    const to = total === 0 ? null : Math.min(page * perPage, total);

    return {
      success: true,
      data: {
        bookings: orders.map((order) => this.toCustomerBooking(order, input.lang, reviewSettings)),
        pagination: {
          total,
          per_page: perPage,
          current_page: page,
          last_page: lastPage,
          from,
          to,
        },
      },
    };
  }

  async buildBookingTicketsPdf(orderRef: string, format: string, customerId: string) {
    const normalizedFormat = format === 'classic' ? 'classic' : 'card';
    const order = await this.prisma.order.findFirst({
      where: {
        commonOrder: orderRef,
      },
      include: bookingInclude,
    });

    if (!order || order.customerId !== customerId) {
      throw new NotFoundException('Booking order not found.');
    }

    const cards = this.buildTicketCardModels(order);
    if (cards.length === 0) {
      throw new NotFoundException('No tickets found for this booking.');
    }

    const logoUrl =
      this.config.get<string>('TICKET_PDF_LOGO_URL') ||
      this.config.get<string>('DAILY_CLOSING_LOGO_URL') ||
      'https://bookingqube.blob.core.windows.net/bqcontainer/static/logo.png';
    const logoBuffer = await this.fetchImageBuffer(logoUrl);
    const buffer = await buildTicketCardsPdf(cards, logoBuffer);
    const filename =
      normalizedFormat === 'classic'
        ? `tickets-${order.commonOrder}-classic.pdf`
        : `tickets-${order.commonOrder}.pdf`;

    return { buffer, filename };
  }

  private buildTicketCardModels(order: BookingRecord): TicketCardModel[] {
    const tickets = order.items.filter(
      (item) =>
        item.itemType === OrderItemType.ticket_type ||
        item.itemType === OrderItemType.ticket_variant,
    );
    const addonModels = this.mapAddonModels(order);
    const eventTitle = this.getEventTitle(order, 'en');
    const venueLabel = this.getVenueLabel(order);
    const directionsUrl = this.getDirectionsUrl(order, venueLabel);
    const tagLine = this.getTagLine(order);
    const dateLabel = this.formatEventDate(order);
    const sessionLabel = this.formatSessionLabel(order);
    const briefingLabel = this.formatBriefingLabel(order);
    const attendeeName = (order.customerName || order.customer.name || '').trim();
    const contactPhone =
      this.config.get<string>('CONTACT_PHONE')?.trim() || '+974 5113 8418';
    const disclaimer =
      'Treat this ticket as cash. The unique code allows one entry per scan — unauthorised duplication or resale may prevent admittance.';

    const units: Array<{
      item: (typeof tickets)[number];
      unitIndex: number;
      unitQty: number;
    }> = [];

    for (const ticket of tickets) {
      const unitQty = Math.max(1, ticket.quantity);
      for (let unitIndex = 1; unitIndex <= unitQty; unitIndex += 1) {
        units.push({ item: ticket, unitIndex, unitQty });
      }
    }

    const totalPasses = units.length;

    return units.map((unit, index) => {
      const passNumber = index + 1;
      const theme = TICKET_CARD_THEMES[(passNumber - 1) % TICKET_CARD_THEMES.length];
      const admits = Math.max(1, unit.item.admitCount || 1);
      const paidPerPass = unit.item.totalAmount.toNumber() / Math.max(1, unit.unitQty);
      const scanCode =
        unit.item.qrCodePayload?.trim() ||
        unit.item.ticketCode?.trim() ||
        `${order.commonOrder}-${String(passNumber).padStart(2, '0')}`;

      return {
        theme,
        passLabel: `PASS ${passNumber} OF ${totalPasses}`,
        tagLine,
        eventTitle,
        ticketSubtitle: `${unit.item.displayName} · Admits ${admits}`,
        dateLabel,
        sessionLabel,
        briefingLabel,
        venueLabel,
        directionsUrl,
        attendeeName,
        paidLabel: `${order.currency.toUpperCase()} ${paidPerPass.toFixed(2)}`,
        scanCode,
        ticketExtraText:
          totalPasses > 1 ? `(${passNumber} of ${totalPasses})` : '',
        disclaimer,
        contactPhone,
        addons: addonModels,
      };
    });
  }

  private mapAddonModels(order: BookingRecord): TicketCardAddon[] {
    return order.items
      .filter(
        (item) =>
          item.itemType === OrderItemType.addon ||
          item.itemType === OrderItemType.addon_variant,
      )
      .map((item) => ({
        title: item.displayName,
        quantity: item.quantity,
        priceLabel: `${item.currency.toUpperCase()} ${item.totalAmount.toNumber().toFixed(2)}`,
      }));
  }

  private getVenueLabel(order: BookingRecord): string {
    const venue = order.venue ?? order.event.venue;
    if (!venue) {
      return '';
    }

    const translation =
      venue.translations.find((row) => row.locale === 'en') ?? venue.translations[0];
    const name = (translation?.name || venue.name || '').trim();
    const address = (translation?.address || venue.address || '').trim();

    if (name && address) {
      return `${name}, ${address}`;
    }

    return name || address;
  }

  private getDirectionsUrl(order: BookingRecord, venueLabel: string): string | null {
    const venue = order.venue ?? order.event.venue;
    if (venue?.googleMapUrl) {
      return venue.googleMapUrl;
    }

    const query = venueLabel || venue?.city || 'Qatar';
    if (!query.trim()) {
      return null;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  private getTagLine(order: BookingRecord): string {
    const category = order.event.category;
    const categoryName =
      category?.translations.find((row) => row.locale === 'en')?.name ??
      category?.name ??
      '';
    const parts = [categoryName.trim(), 'Fun'].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'BookingQube';
  }

  private formatEventDate(order: BookingRecord): string {
    const date = order.eventSession.eventDate.date;
    return date.toLocaleDateString('en-GB', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  }

  private formatSessionLabel(order: BookingRecord): string {
    const start = this.formatTime(order.eventSession.startsAt);
    const end = order.eventSession.endsAt
      ? this.formatTime(order.eventSession.endsAt)
      : '';
    if (start && end) {
      return `${start} – ${end}`;
    }

    return order.eventSession.displayTime || start || '';
  }

  private formatBriefingLabel(order: BookingRecord): string {
    const briefingAt = new Date(order.eventSession.startsAt.getTime() - 15 * 60_000);
    return this.formatTime(briefingAt);
  }

  private formatTime(value: Date): string {
    return value.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Qatar',
    });
  }

  private toCustomerBooking(
    order: BookingRecord,
    lang: string,
    reviewSettings: {
      reviewsEnabled: boolean;
      defaultOpensAfterMinutes: number;
      defaultClosesAfterDays: number;
    },
  ) {
    const tickets = order.items.filter(
      (item) =>
        item.itemType === OrderItemType.ticket_type ||
        item.itemType === OrderItemType.ticket_variant,
    );
    const addons = order.items.filter(
      (item) =>
        item.itemType === OrderItemType.addon ||
        item.itemType === OrderItemType.addon_variant,
    );
    const transactionDate = order.createdAt.toISOString().slice(0, 10);
    const transactionTime = order.createdAt.toISOString().slice(11, 16);
    const eventEnd =
      order.eventSession.endsAt ?? order.event.endsAt ?? order.eventSession.startsAt;
    const isPaid = order.status === 'paid' || order.status === 'partially_refunded';
    const reviewEnabled = order.event.reviewsEnabled ?? reviewSettings.reviewsEnabled;
    const opensAt = new Date(
      eventEnd.getTime() +
        (order.event.reviewOpensAfterMinutes ?? reviewSettings.defaultOpensAfterMinutes) *
          60_000,
    );
    const closesAt = new Date(
      opensAt.getTime() +
        (order.event.reviewClosesAfterDays ?? reviewSettings.defaultClosesAfterDays) *
          86_400_000,
    );

    return {
      common_order: order.commonOrder,
      event_id: this.numericId(order.eventId),
      event_title: this.getEventTitle(order, lang),
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone ?? '',
      gender: null,
      tickets: tickets.map((item) => ({
        ticket_title: item.displayName,
        currency: item.currency,
        quantity: item.quantity,
        price: item.totalAmount.toNumber(),
        packs_info: [],
        customizable_activities: [],
        has_customizable_activities: false,
      })),
      addons: addons.map((item) => ({
        addon_title: item.displayName,
        title: item.displayName,
        title_ar: item.displayName,
        currency: item.currency,
        quantity: item.quantity,
        price: item.unitPrice.toNumber(),
        total: item.totalAmount.toNumber(),
      })),
      total_amount: order.totalAmount.toNumber(),
      total_tickets: tickets.reduce((sum, item) => sum + item.quantity, 0),
      currency: order.currency,
      event_start_date: order.eventSession.eventDate.date.toISOString().slice(0, 10),
      event_time: order.eventSession.displayTime,
      created_at: order.createdAt.toISOString(),
      transaction_date: transactionDate,
      transaction_time: transactionTime,
      payment_type: order.paymentStatus,
      payment_method: order.payments[0]
        ? resolvePaymentMethodKeyLabel(
            order.payments[0].methodKey,
            order.payments[0].providerPaymentMethodId,
          )
        : order.paymentStatus,
      event_slug: order.event.slug,
      event_ends_at: eventEnd.toISOString(),
      review: order.eventReview
        ? {
            id: order.eventReview.id,
            rating: order.eventReview.rating,
            comment: order.eventReview.comment,
            status: order.eventReview.status,
          }
        : null,
      can_review:
        reviewEnabled &&
        isPaid &&
        Date.now() >= opensAt.getTime() &&
        Date.now() <= closesAt.getTime(),
    };
  }

  private getEventTitle(order: BookingRecord, lang: string) {
    const locale = lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
    return (
      order.event.translations.find((translation) => translation.locale === locale)?.title ??
      order.event.translations.find((translation) => translation.locale === 'en')?.title ??
      order.eventTitle ??
      order.event.slug
    );
  }

  private parseDate(value?: string) {
    if (!value) {
      return undefined;
    }
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private numericId(value: string) {
    return value.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
  }

  private async fetchImageBuffer(url: string): Promise<Buffer | null> {
    if (!url) {
      return null;
    }

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) {
        return null;
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }
}
