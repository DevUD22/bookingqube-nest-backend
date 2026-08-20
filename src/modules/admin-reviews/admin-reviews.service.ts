import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AdminReviewsQueryDto, UpdateEventReviewSettingsDto, UpdateReviewSettingsDto, UpdateReviewStatusDto } from './dto/admin-review.dto';

@Injectable()
export class AdminReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminReviewsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const q = query.q?.trim();
    const where: Prisma.EventReviewWhereInput = {
      ...(query.status && query.status !== 'all' ? { status: query.status as ReviewStatus } : {}),
      ...(q ? { OR: [
        { comment: { contains: q, mode: 'insensitive' } },
        { customer: { name: { contains: q, mode: 'insensitive' } } },
        { customer: { email: { contains: q, mode: 'insensitive' } } },
        { event: { translations: { some: { title: { contains: q, mode: 'insensitive' } } } } },
        { order: { commonOrder: { contains: q, mode: 'insensitive' } } },
      ] } : {}),
    };
    const [total, rows, statusGroups] = await Promise.all([
      this.prisma.eventReview.count({ where }),
      this.prisma.eventReview.findMany({ where, include: { customer: true, order: true, event: { include: { translations: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
      this.prisma.eventReview.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);
    return { success: true, data: { items: rows.map((row) => ({
      id: row.id, rating: row.rating, comment: row.comment, status: row.status,
      verified_booking: row.verifiedBooking, verified_attendee: row.verifiedAttendee,
      moderator_note: row.moderatorNote, customer_name: row.customer.name, customer_email: row.customer.email,
      event_id: row.eventId, event_title: row.event.translations.find((t) => t.locale === 'en')?.title ?? row.event.slug,
      order_reference: row.order.commonOrder, created_at: row.createdAt.toISOString(), published_at: row.publishedAt?.toISOString() ?? null,
    })), pagination: { total, page, per_page: perPage, last_page: Math.max(1, Math.ceil(total / perPage)) }, counts: Object.fromEntries(statusGroups.map((item) => [item.status, item._count._all])) } };
  }

  async listBookingFeedback(query: AdminReviewsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.per_page ?? 20;
    const q = query.q?.trim();
    const where: Prisma.BookingFeedbackWhereInput = q
      ? {
          OR: [
            { comment: { contains: q, mode: 'insensitive' } },
            { customer: { name: { contains: q, mode: 'insensitive' } } },
            { customer: { email: { contains: q, mode: 'insensitive' } } },
            { order: { commonOrder: { contains: q, mode: 'insensitive' } } },
            { order: { eventTitle: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {};
    const [total, rows, aggregate] = await Promise.all([
      this.prisma.bookingFeedback.count({ where }),
      this.prisma.bookingFeedback.findMany({
        where,
        include: { customer: true, order: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.bookingFeedback.aggregate({ where, _avg: { rating: true } }),
    ]);

    return {
      success: true,
      data: {
        items: rows.map((row) => ({
          id: row.id,
          rating: row.rating,
          tags: row.tags,
          comment: row.comment,
          customer_name: row.customer.name,
          customer_email: row.customer.email,
          event_title: row.order.eventTitle,
          event_slug: row.order.eventSlug,
          order_reference: row.order.commonOrder,
          created_at: row.createdAt.toISOString(),
          updated_at: row.updatedAt.toISOString(),
        })),
        summary: { total, average_rating: aggregate._avg.rating ?? 0 },
        pagination: {
          total,
          page,
          per_page: perPage,
          last_page: Math.max(1, Math.ceil(total / perPage)),
        },
      },
    };
  }

  async updateStatus(id: string, body: UpdateReviewStatusDto) {
    const found = await this.prisma.eventReview.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Review not found.');
    const row = await this.prisma.eventReview.update({ where: { id }, data: { status: body.status, moderatorNote: body.moderator_note?.trim() || null, publishedAt: body.status === 'published' ? (found.publishedAt ?? new Date()) : null } });
    return { success: true, data: { id: row.id, status: row.status }, message: `Review marked ${row.status}.` };
  }

  async getSettings() {
    const row = await this.settings();
    const events = await this.prisma.event.findMany({ where: { status: { not: 'archived' } }, select: { id: true, slug: true, reviewsEnabled: true, reviewOpensAfterMinutes: true, reviewClosesAfterDays: true, translations: { where: { locale: 'en' }, select: { title: true } } }, orderBy: { updatedAt: 'desc' } });
    return { success: true, data: { settings: this.serializeSettings(row), events: events.map((event) => ({ id: event.id, slug: event.slug, title: event.translations[0]?.title ?? event.slug, reviews_enabled: event.reviewsEnabled, review_opens_after_minutes: event.reviewOpensAfterMinutes, review_closes_after_days: event.reviewClosesAfterDays })) } };
  }

  async updateSettings(body: UpdateReviewSettingsDto) {
    const row = await this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1, ...this.settingsData(body) }, update: this.settingsData(body) });
    return { success: true, data: { settings: this.serializeSettings(row) }, message: 'Review settings saved.' };
  }

  async updateEventSettings(id: string, body: UpdateEventReviewSettingsDto) {
    const found = await this.prisma.event.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Event not found.');
    await this.prisma.event.update({ where: { id }, data: { reviewsEnabled: body.reviews_enabled ?? null, reviewOpensAfterMinutes: body.review_opens_after_minutes ?? null, reviewClosesAfterDays: body.review_closes_after_days ?? null } });
    return { success: true, message: 'Event review settings saved.' };
  }

  private settings() { return this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} }); }
  private settingsData(body: UpdateReviewSettingsDto) { return { reviewsEnabled: body.reviews_enabled, bookingFeedbackEnabled: body.booking_feedback_enabled, requireCheckedIn: body.require_checked_in, autoPublish: body.auto_publish, allowComments: body.allow_comments, showOnEventPages: body.show_on_event_pages, showOnHomepageCards: body.show_on_homepage_cards, minimumReviewCount: body.minimum_review_count, defaultOpensAfterMinutes: body.default_opens_after_minutes, defaultClosesAfterDays: body.default_closes_after_days }; }
  private serializeSettings(row: Awaited<ReturnType<AdminReviewsService['settings']>>) { return { reviews_enabled: row.reviewsEnabled, booking_feedback_enabled: row.bookingFeedbackEnabled, require_checked_in: row.requireCheckedIn, auto_publish: row.autoPublish, allow_comments: row.allowComments, show_on_event_pages: row.showOnEventPages, show_on_homepage_cards: row.showOnHomepageCards, minimum_review_count: row.minimumReviewCount, default_opens_after_minutes: row.defaultOpensAfterMinutes, default_closes_after_days: row.defaultClosesAfterDays }; }
}
