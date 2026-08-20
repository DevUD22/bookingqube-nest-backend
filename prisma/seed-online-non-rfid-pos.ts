/**
 * Seeds a non-RFID event with several paid website tickets for POS scanning.
 *
 * Safe to rerun: all fixtures are upserted and ticket attendance is reset.
 * Prerequisite: run the base seed once so the BookingQube organization and POS role exist.
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

const EVENT_SLUG = 'online-non-rfid-scan-test';
const TICKET_KEY = 'online-non-rfid-general-entry';
const POS_EMAIL = 'non-rfid-pos@bookingqube.test';
const POS_USERNAME = 'non_rfid_pos';
const POS_PASSWORD = process.env.SEED_NON_RFID_POS_PASSWORD ?? 'NonRfid123!';
const CUSTOMER_EMAIL = 'non-rfid-online-customer@bookingqube.test';
const CUSTOMER_PHONE = '+97455222222';
const TICKET_CODES = [
  'WEB-NORFID-001',
  'WEB-NORFID-002',
  'WEB-NORFID-003',
  'WEB-NORFID-004',
  'WEB-NORFID-005',
] as const;

function qatarDateKey(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Qatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

async function main() {
  const [organization, posRole, admin] = await Promise.all([
    prisma.organization.findUnique({ where: { slug: 'bookingqube' } }),
    prisma.role.findUnique({ where: { name: 'pos' } }),
    prisma.user.findUnique({ where: { email: 'admin@bookingqube.test' } }),
  ]);
  if (!organization || !posRole) {
    throw new Error('Run `npm run prisma:seed` first to create the BookingQube organization and POS role.');
  }

  const now = new Date();
  const event = await prisma.event.upsert({
    where: { slug: EVENT_SLUG },
    update: {
      organizationId: organization.id,
      eventType: 'general',
      status: 'published',
      visibility: 'unlisted',
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      moreOpsConfig: {
        entry_access: {
          pass_type: 'barcode',
          other_label: '',
          scan_length: 0,
          code_pool: [],
        },
        rfids: [],
        time_extensions: [],
      } satisfies Prisma.InputJsonObject,
      publishedAt: now,
      updatedByUserId: admin?.id ?? null,
    },
    create: {
      organizationId: organization.id,
      slug: EVENT_SLUG,
      eventType: 'general',
      status: 'published',
      visibility: 'unlisted',
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      endsAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      moreOpsConfig: {
        entry_access: {
          pass_type: 'barcode',
          other_label: '',
          scan_length: 0,
          code_pool: [],
        },
        rfids: [],
        time_extensions: [],
      } satisfies Prisma.InputJsonObject,
      publishedAt: now,
      createdByUserId: admin?.id ?? null,
      updatedByUserId: admin?.id ?? null,
    },
  });

  await prisma.eventTranslation.upsert({
    where: { eventId_locale: { eventId: event.id, locale: 'en' } },
    update: {
      title: 'Non-RFID Online Ticket Test',
      subtitle: 'Fast online ticket verification without RFID assignment',
      description: 'Dedicated POS test event with multiple website tickets ready to scan.',
    },
    create: {
      eventId: event.id,
      locale: 'en',
      title: 'Non-RFID Online Ticket Test',
      subtitle: 'Fast online ticket verification without RFID assignment',
      description: 'Dedicated POS test event with multiple website tickets ready to scan.',
    },
  });

  const dateValue = new Date(`${qatarDateKey(now)}T00:00:00.000Z`);
  const eventDate = await prisma.eventDate.upsert({
    where: { eventId_date: { eventId: event.id, date: dateValue } },
    update: { status: 'active' },
    create: { eventId: event.id, date: dateValue, status: 'active' },
  });
  const existingSession = await prisma.eventSession.findFirst({
    where: { eventId: event.id, displayTime: 'All-day scan test' },
  });
  const sessionData = {
    eventDateId: eventDate.id,
    startsAt: new Date(now.getTime() - 60 * 60 * 1000),
    endsAt: new Date(now.getTime() + 10 * 60 * 60 * 1000),
    status: 'active' as const,
    capacity: 1000,
  };
  const session = existingSession
    ? await prisma.eventSession.update({ where: { id: existingSession.id }, data: sessionData })
    : await prisma.eventSession.create({
        data: {
          eventId: event.id,
          displayTime: 'All-day scan test',
          ...sessionData,
        },
      });

  const group =
    (await prisma.ticketGroup.findFirst({ where: { eventId: event.id, title: 'Admission' } })) ??
    (await prisma.ticketGroup.create({
      data: {
        eventId: event.id,
        title: 'Admission',
        subtitle: 'Website admission tickets',
        iconType: 'ticket',
        sortOrder: 1,
      },
    }));
  const ticketType = await prisma.ticketType.upsert({
    where: { eventId_externalKey: { eventId: event.id, externalKey: TICKET_KEY } },
    update: {
      ticketGroupId: group.id,
      title: 'General Entry',
      subtitle: 'Online admission — no RFID required',
      iconType: 'ticket',
      basePrice: '50.000',
      currency: 'QAR',
      admitCount: 1,
      maxQtyPerOrder: 10,
      hideFromOnline: false,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      eventId: event.id,
      ticketGroupId: group.id,
      externalKey: TICKET_KEY,
      title: 'General Entry',
      subtitle: 'Online admission — no RFID required',
      iconType: 'ticket',
      basePrice: '50.000',
      currency: 'QAR',
      admitCount: 1,
      maxQtyPerOrder: 10,
      hideFromOnline: false,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
  });

  await prisma.inventoryItem.upsert({
    where: {
      eventSessionId_itemType_itemId: {
        eventSessionId: session.id,
        itemType: 'ticket_type',
        itemId: ticketType.id,
      },
    },
    update: { totalQuantity: 1000, status: 'active' },
    create: {
      eventId: event.id,
      eventSessionId: session.id,
      itemType: 'ticket_type',
      itemId: ticketType.id,
      totalQuantity: 1000,
      status: 'active',
    },
  });

  const passwordHash = await hashPassword(POS_PASSWORD);
  const posAgent = await prisma.user.upsert({
    where: { email: POS_EMAIL },
    update: {
      username: POS_USERNAME,
      name: 'Non-RFID Test POS',
      passwordHash,
      status: 'active',
    },
    create: {
      email: POS_EMAIL,
      username: POS_USERNAME,
      name: 'Non-RFID Test POS',
      passwordHash,
      status: 'active',
    },
  });
  const existingAssignment = await prisma.staffAssignment.findFirst({
    where: { userId: posAgent.id, roleId: posRole.id, eventId: event.id },
  });
  const assignmentData = {
    organizationId: organization.id,
    thirdPartyVendorId: null,
    thirdPartyVendorIds: [],
    ticketTypeIds: [ticketType.id],
    managedByUserId: admin?.id ?? null,
    createdByUserId: admin?.id ?? null,
    isCafeAgent: false,
    status: 'active' as const,
  };
  const assignment = existingAssignment
    ? await prisma.staffAssignment.update({
        where: { id: existingAssignment.id },
        data: assignmentData,
      })
    : await prisma.staffAssignment.create({
        data: {
          userId: posAgent.id,
          roleId: posRole.id,
          eventId: event.id,
          ...assignmentData,
        },
      });

  const customer = await prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: { name: 'Multiple Ticket Customer', phone: CUSTOMER_PHONE, status: 'active' },
    create: {
      email: CUSTOMER_EMAIL,
      name: 'Multiple Ticket Customer',
      phone: CUSTOMER_PHONE,
      status: 'active',
    },
  });
  const total = 50 * TICKET_CODES.length;
  const order = await prisma.order.upsert({
    where: { idempotencyKey: 'seed-online-non-rfid-multiple-tickets' },
    update: {
      customerId: customer.id,
      eventId: event.id,
      eventSessionId: session.id,
      status: 'paid',
      paymentStatus: 'paid',
      source: 'web',
      paidAt: now,
      cancelledAt: null,
      eventStartDate: dateValue,
      eventStartTime: session.displayTime,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
    },
    create: {
      commonOrder: 'BQ-WEB-NORFID-001',
      idempotencyKey: 'seed-online-non-rfid-multiple-tickets',
      customerId: customer.id,
      eventId: event.id,
      eventSessionId: session.id,
      organizationId: organization.id,
      status: 'paid',
      paymentStatus: 'paid',
      currency: 'QAR',
      subtotalAmount: total.toFixed(3),
      discountAmount: '0.000',
      taxAmount: '0.000',
      totalAmount: total.toFixed(3),
      source: 'web',
      locale: 'en',
      paidAt: now,
      eventSlug: event.slug,
      eventTitle: 'Non-RFID Online Ticket Test',
      eventStartDate: dateValue,
      eventStartTime: session.displayTime,
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      paymentMode: 'online',
      paymentMethodLabel: 'Online',
      onlineAmount: total.toFixed(3),
      ticketsNet: total.toFixed(3),
      totalQuantity: TICKET_CODES.length,
      totalAdmits: TICKET_CODES.length,
    },
  });

  for (const ticketCode of TICKET_CODES) {
    const existingItem = await prisma.orderItem.findFirst({
      where: { orderId: order.id, ticketCode },
    });
    const itemData = {
      eventId: event.id,
      eventSessionId: session.id,
      itemType: 'ticket_type' as const,
      itemId: ticketType.id,
      displayName: ticketType.title,
      quantity: 1,
      unitPrice: '50.000',
      subtotalAmount: '50.000',
      discountAmount: '0.000',
      taxAmount: '0.000',
      totalAmount: '50.000',
      currency: 'QAR',
      ticketCode,
      qrCodePayload: ticketCode,
      rfidCodes: [] as string[],
      attendanceStatus: 'not_checked_in' as const,
      checkedInAt: null,
      checkedInByUserId: null,
      admitCount: 1,
      visitorType: 'paid' as const,
      ticketIsCafe: false,
      ticketIsPosOnly: false,
      ticketHideFromOnline: false,
    };
    if (existingItem) {
      await prisma.orderItem.update({ where: { id: existingItem.id }, data: itemData });
    } else {
      await prisma.orderItem.create({ data: { orderId: order.id, ...itemData } });
    }
  }

  console.log('Non-RFID online ticket test seed ready.');
  console.log(`  event:      ${EVENT_SLUG} (${event.id})`);
  console.log(`  POS email:  ${POS_EMAIL}`);
  console.log(`  username:   ${POS_USERNAME}`);
  console.log(`  password:   ${POS_PASSWORD}`);
  console.log(`  assignment: ${assignment.id}`);
  console.log(`  phone:      ${CUSTOMER_PHONE}`);
  console.log(`  tickets:    ${TICKET_CODES.join(', ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
