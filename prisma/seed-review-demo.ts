import { AttendanceStatus, EventType, OrderItemType, PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

const EVENT_SLUG = 'doha-summer-festival-review-demo';
const EVENT_TITLE = 'Doha Summer Festival — Review Demo';
const EVENT_DATE = new Date('2026-08-01T00:00:00.000Z');
const EVENT_START = new Date('2026-08-01T15:00:00.000Z');
const EVENT_END = new Date('2026-08-01T19:00:00.000Z');

async function main() {
  const organization = await prisma.organization.findFirst({ where: { status: 'active' } });
  if (!organization) throw new Error('Run the main seed first: no active organization exists.');

  const category = await prisma.eventCategory.findFirst({ where: { status: 'active' } });
  const venue = await prisma.venue.findFirst({ where: { status: 'published' } });

  const event = await prisma.event.upsert({
    where: { slug: EVENT_SLUG },
    update: {
      status: 'published',
      visibility: 'public',
      startsAt: EVENT_START,
      endsAt: EVENT_END,
      reviewsEnabled: true,
      reviewOpensAfterMinutes: 0,
      reviewClosesAfterDays: 365,
    },
    create: {
      organizationId: organization.id,
      slug: EVENT_SLUG,
      eventType: EventType.general,
      status: 'published',
      visibility: 'public',
      venueId: venue?.id,
      categoryId: category?.id,
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: EVENT_START,
      endsAt: EVENT_END,
      publishedAt: new Date(),
      reviewsEnabled: true,
      reviewOpensAfterMinutes: 0,
      reviewClosesAfterDays: 365,
    },
  });

  await prisma.eventTranslation.upsert({
    where: { eventId_locale: { eventId: event.id, locale: 'en' } },
    update: {
      title: EVENT_TITLE,
      subtitle: 'A completed demo event for testing verified customer reviews.',
      description:
        'This event is intentionally dated in the past so review controls are immediately available in My Tickets.',
    },
    create: {
      eventId: event.id,
      locale: 'en',
      title: EVENT_TITLE,
      subtitle: 'A completed demo event for testing verified customer reviews.',
      description:
        'This event is intentionally dated in the past so review controls are immediately available in My Tickets.',
    },
  });

  const eventDate = await prisma.eventDate.upsert({
    where: { eventId_date: { eventId: event.id, date: EVENT_DATE } },
    update: { status: 'active' },
    create: { eventId: event.id, date: EVENT_DATE, status: 'active' },
  });

  let session = await prisma.eventSession.findFirst({
    where: { eventId: event.id, startsAt: EVENT_START },
  });
  session ??= await prisma.eventSession.create({
    data: {
      eventId: event.id,
      eventDateId: eventDate.id,
      startsAt: EVENT_START,
      endsAt: EVENT_END,
      displayTime: '6:00 PM',
      status: 'active',
      capacity: 500,
    },
  });

  const ticketType = await prisma.ticketType.upsert({
    where: { eventId_externalKey: { eventId: event.id, externalKey: 'review-demo-general' } },
    update: { title: 'General Admission', basePrice: 50, status: 'active' },
    create: {
      eventId: event.id,
      externalKey: 'review-demo-general',
      title: 'General Admission',
      basePrice: 50,
      currency: 'QAR',
      maxQtyPerOrder: 6,
      status: 'active',
    },
  });

  const passwordHash = await hashPassword('CustomerPass123!');
  const customers = [
    {
      email: 'customer@bookingqube.test',
      name: 'BookingQube Customer',
      comment: null,
      rating: null,
    },
    {
      email: 'reviewer.amal@bookingqube.test',
      name: 'Amal Hassan',
      comment: 'Very well organized and the staff were friendly. Entry was quick and easy.',
      rating: 5,
    },
    {
      email: 'reviewer.omar@bookingqube.test',
      name: 'Omar Khalid',
      comment:
        'A fun evening with a great atmosphere. More food counters would make it even better.',
      rating: 4,
    },
    {
      email: 'reviewer.sara@bookingqube.test',
      name: 'Sara Ahmed',
      comment: 'The activities were excellent for families and everything felt safe and clean.',
      rating: 5,
    },
    {
      email: 'reviewer.noor@bookingqube.test',
      name: 'Noor Ali',
      comment: 'Good event overall. The ticket process and check-in were both straightforward.',
      rating: 4,
    },
    {
      email: 'reviewer.layla@bookingqube.test',
      name: 'Layla Mahmoud',
      comment: 'A lovely family event with plenty to do. We would happily attend again.',
      rating: 5,
    },
    {
      email: 'reviewer.yousef@bookingqube.test',
      name: 'Yousef Ibrahim',
      comment: 'The entertainment was strong and the venue was easy to navigate.',
      rating: 4,
    },
    {
      email: 'reviewer.mariam@bookingqube.test',
      name: 'Mariam Saleh',
      comment: 'Excellent organization, clean facilities and helpful team members.',
      rating: 5,
    },
    {
      email: 'reviewer.fahad@bookingqube.test',
      name: 'Fahad Mansoor',
      comment: 'Enjoyable experience overall, although the busiest areas needed more seating.',
      rating: 4,
    },
  ] as const;

  for (const [index, demo] of customers.entries()) {
    const customer = await prisma.user.upsert({
      where: { email: demo.email },
      update: { name: demo.name, passwordHash, status: 'active' },
      create: {
        email: demo.email,
        name: demo.name,
        passwordHash,
        status: 'active',
        emailVerifiedAt: new Date(),
      },
    });

    const reference = index === 0 ? 'BQ-REVIEW-YOURS' : `BQ-REVIEW-DEMO-${index}`;
    const order = await prisma.order.upsert({
      where: { commonOrder: reference },
      update: {
        customerId: customer.id,
        eventId: event.id,
        eventSessionId: session.id,
        status: 'paid',
        paymentStatus: 'paid',
        paidAt: new Date('2026-08-01T14:30:00.000Z'),
      },
      create: {
        commonOrder: reference,
        idempotencyKey: `review-demo-${index}`,
        customerId: customer.id,
        eventId: event.id,
        eventSessionId: session.id,
        status: 'paid',
        paymentStatus: 'paid',
        currency: 'QAR',
        subtotalAmount: 50,
        totalAmount: 50,
        source: 'web',
        paidAt: new Date('2026-08-01T14:30:00.000Z'),
        organizationId: organization.id,
        venueId: venue?.id,
        eventSlug: EVENT_SLUG,
        eventTitle: EVENT_TITLE,
        eventStartDate: EVENT_DATE,
        eventStartTime: '6:00 PM',
        customerName: demo.name,
        customerEmail: demo.email,
        paymentMode: 'online',
        paymentMethodLabel: 'Demo payment',
        onlineAmount: 50,
        ticketsNet: 50,
        totalQuantity: 1,
        totalAdmits: 1,
      },
    });

    const existingItem = await prisma.orderItem.findFirst({ where: { orderId: order.id } });
    if (!existingItem) {
      await prisma.orderItem.create({
        data: {
          orderId: order.id,
          eventId: event.id,
          eventSessionId: session.id,
          itemType: OrderItemType.ticket_type,
          itemId: ticketType.id,
          displayName: 'General Admission',
          quantity: 1,
          unitPrice: 50,
          subtotalAmount: 50,
          totalAmount: 50,
          currency: 'QAR',
          ticketCode: `${reference}-T1`,
          attendanceStatus:
            index === 2 ? AttendanceStatus.not_checked_in : AttendanceStatus.checked_in,
          checkedInAt: index === 2 ? null : new Date('2026-08-01T15:10:00.000Z'),
        },
      });
    }

    if (index > 0) {
      const feedbackTags = index === 2
        ? ['Easy checkout', 'Payment issue']
        : ['Easy checkout', 'Clear information', 'Fast payment'];
      await prisma.bookingFeedback.upsert({
        where: { orderId: order.id },
        update: {
          rating: index === 2 ? 3 : 5,
          tags: feedbackTags,
          comment: index === 2 ? 'Payment confirmation took longer than expected.' : null,
        },
        create: {
          orderId: order.id,
          customerId: customer.id,
          rating: index === 2 ? 3 : 5,
          tags: feedbackTags,
          comment: index === 2 ? 'Payment confirmation took longer than expected.' : null,
        },
      });
    }

    if (demo.rating && demo.comment) {
      await prisma.eventReview.upsert({
        where: { eventId_customerId: { eventId: event.id, customerId: customer.id } },
        update: {
          rating: demo.rating,
          comment: demo.comment,
          status: 'published',
          verifiedBooking: true,
          verifiedAttendee: index !== 2,
          publishedAt: new Date(),
        },
        create: {
          eventId: event.id,
          customerId: customer.id,
          orderId: order.id,
          rating: demo.rating,
          comment: demo.comment,
          status: 'published',
          verifiedBooking: true,
          verifiedAttendee: index !== 2,
          publishedAt: new Date(),
        },
      });
    } else {
      await prisma.eventReview.deleteMany({
        where: { eventId: event.id, customerId: customer.id },
      });
    }
  }

  await prisma.reviewSettings.upsert({
    where: { id: 1 },
    create: { id: 1, reviewsEnabled: true, showOnEventPages: true, minimumReviewCount: 1 },
    update: { reviewsEnabled: true, showOnEventPages: true, minimumReviewCount: 1 },
  });

  console.log(`Seeded ${EVENT_TITLE}`);
  console.log('Review it with customer@bookingqube.test / CustomerPass123!');
  console.log(`Order reference: BQ-REVIEW-YOURS`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
