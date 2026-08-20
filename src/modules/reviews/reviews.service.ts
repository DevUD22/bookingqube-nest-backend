import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AttendanceStatus, OrderStatus, PaymentStatus, ReviewStatus } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { UpsertBookingFeedbackDto, UpsertEventReviewDto } from './dto/review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async publicForEvent(slug: string, page = 1, perPage = 6) {
    const settings = await this.settings();
    const event = await this.prisma.event.findFirst({ where: { slug, status: 'published' } });
    if (!event) throw new NotFoundException('Event not found.');
    const enabled = event.reviewsEnabled ?? settings.reviewsEnabled;
    if (!enabled || !settings.showOnEventPages) return { success: true, data: { enabled: false, summary: null, reviews: [] } };

    const where = { eventId: event.id, status: ReviewStatus.published };
    const [count, aggregate, rows] = await Promise.all([
      this.prisma.eventReview.count({ where }),
      this.prisma.eventReview.aggregate({ where, _avg: { rating: true }, _count: { rating: true } }),
      this.prisma.eventReview.findMany({
        where,
        include: { customer: { select: { name: true } } },
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (Math.max(1, page) - 1) * Math.min(20, Math.max(1, perPage)),
        take: Math.min(20, Math.max(1, perPage)),
      }),
    ]);
    const visible = count >= settings.minimumReviewCount;
    return {
      success: true,
      data: {
        enabled: true,
        summary: visible ? { average: aggregate._avg.rating ?? 0, count: aggregate._count.rating } : null,
        reviews: visible ? rows.map((row) => ({
          id: row.id,
          rating: row.rating,
          comment: row.comment,
          author_name: this.maskName(row.customer.name),
          verified_booking: row.verifiedBooking,
          verified_attendee: row.verifiedAttendee,
          published_at: row.publishedAt?.toISOString() ?? row.createdAt.toISOString(),
        })) : [],
      },
    };
  }

  async upsertEventReview(customerId: string, body: UpsertEventReviewDto) {
    const order = await this.eligibleOrder(customerId, body.order_reference);
    const settings = await this.settings();
    const enabled = order.event.reviewsEnabled ?? settings.reviewsEnabled;
    if (!enabled) throw new BadRequestException('Reviews are disabled for this event.');
    const eventEnd = order.eventSession.endsAt ?? order.event.endsAt ?? order.eventSession.startsAt;
    const opensAfter = order.event.reviewOpensAfterMinutes ?? settings.defaultOpensAfterMinutes;
    const closesAfter = order.event.reviewClosesAfterDays ?? settings.defaultClosesAfterDays;
    const opensAt = new Date(eventEnd.getTime() + opensAfter * 60_000);
    const closesAt = new Date(opensAt.getTime() + closesAfter * 86_400_000);
    if (Date.now() < opensAt.getTime()) throw new BadRequestException(`Reviews open after ${opensAt.toISOString()}.`);
    if (Date.now() > closesAt.getTime()) throw new BadRequestException('The review period for this event has closed.');
    const attended = order.items.some((item) => item.attendanceStatus === AttendanceStatus.checked_in);
    if (settings.requireCheckedIn && !attended) throw new BadRequestException('Only checked-in attendees can review this event.');
    const status = settings.autoPublish ? ReviewStatus.published : ReviewStatus.pending;
    const comment = settings.allowComments ? body.comment?.trim() || null : null;
    const review = await this.prisma.eventReview.upsert({
      where: { eventId_customerId: { eventId: order.eventId, customerId } },
      create: { eventId: order.eventId, customerId, orderId: order.id, rating: body.rating, comment, status, verifiedAttendee: attended, publishedAt: status === ReviewStatus.published ? new Date() : null },
      update: { rating: body.rating, comment, status, verifiedAttendee: attended, moderatorNote: null, publishedAt: status === ReviewStatus.published ? new Date() : null },
    });
    return { success: true, data: { id: review.id, status: review.status }, message: status === ReviewStatus.published ? 'Your review is live.' : 'Your review was submitted for approval.' };
  }

  async upsertBookingFeedback(customerId: string, body: UpsertBookingFeedbackDto) {
    const settings = await this.settings();
    if (!settings.bookingFeedbackEnabled) throw new BadRequestException('Booking feedback is disabled.');
    const order = await this.prisma.order.findFirst({ where: { commonOrder: body.order_reference, customerId } });
    if (!order) throw new NotFoundException('Booking not found.');
    const feedback = await this.prisma.bookingFeedback.upsert({
      where: { orderId: order.id },
      create: { orderId: order.id, customerId, rating: body.rating, tags: body.tags?.slice(0, 8) ?? [], comment: body.comment?.trim() || null },
      update: { rating: body.rating, tags: body.tags?.slice(0, 8) ?? [], comment: body.comment?.trim() || null },
    });
    return { success: true, data: { id: feedback.id }, message: 'Thanks for your feedback.' };
  }

  private async eligibleOrder(customerId: string, reference: string) {
    const order = await this.prisma.order.findFirst({
      where: { commonOrder: reference, customerId, status: { in: [OrderStatus.paid, OrderStatus.partially_refunded] }, paymentStatus: { in: [PaymentStatus.paid, PaymentStatus.partially_refunded] } },
      include: { event: true, eventSession: true, items: true },
    });
    if (!order) throw new NotFoundException('Eligible paid booking not found.');
    return order;
  }

  private settings() {
    return this.prisma.reviewSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  }

  private maskName(name: string) {
    const words = name.trim().split(/\s+/).filter(Boolean);
    return words.map((word, index) => index === 0 ? word : `${word[0]}.`).join(' ') || 'BookingQube customer';
  }
}
