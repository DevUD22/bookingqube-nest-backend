/**
 * Seeds a focused Open RFID POS test event.
 *
 * Safe to rerun: event, catalog, inventory, POS user, and assignment are upserted.
 * Prerequisite: run the base seed once so the BookingQube organization and POS role exist.
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

const EVENT_SLUG = 'open-rfid-pos-test';
const TICKET_KEY = 'open-rfid-inflatapass';
const ADDON_KEY = 'open-rfid-grip-socks';
const POS_EMAIL = 'open-rfid-pos@bookingqube.test';
const POS_USERNAME = 'open_rfid_pos';
const POS_PASSWORD = process.env.SEED_OPEN_RFID_POS_PASSWORD ?? 'OpenRfid123!';
const ONLINE_CUSTOMER_EMAIL = 'open-rfid-online-customer@bookingqube.test';
const ONLINE_CUSTOMER_PHONE = '+97455123456';
const ONLINE_TICKET_CODE = 'WEB-OPEN-RFID-001';

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
  const eventStartsAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const eventEndsAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const moreOpsConfig = {
    entry_access: {
      pass_type: 'other',
      other_label: 'Open RFIDs',
      scan_length: 10,
      code_pool: [],
    },
    rfids: [],
    time_extensions: [
      {
        id: 'open-rfid-inflatapass-extra-15',
        title: 'InflataPass Extra 15 Minutes',
        title_ar: '',
        scope: 'ticket',
        minutes: 15,
        price: 20,
        ticket_ids: [TICKET_KEY],
      },
    ],
  } satisfies Prisma.InputJsonObject;

  const event = await prisma.event.upsert({
    where: { slug: EVENT_SLUG },
    update: {
      organizationId: organization.id,
      eventType: 'general',
      status: 'published',
      visibility: 'unlisted',
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      moreOpsConfig,
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
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      moreOpsConfig,
      publishedAt: now,
      createdByUserId: admin?.id ?? null,
      updatedByUserId: admin?.id ?? null,
    },
  });

  await prisma.eventTranslation.upsert({
    where: { eventId_locale: { eventId: event.id, locale: 'en' } },
    update: {
      title: 'Open RFID POS Test',
      subtitle: 'Test ticket-level RFID and time-extension assignment',
      description: 'Dedicated test event for the Open RFID POS checkout flow.',
    },
    create: {
      eventId: event.id,
      locale: 'en',
      title: 'Open RFID POS Test',
      subtitle: 'Test ticket-level RFID and time-extension assignment',
      description: 'Dedicated test event for the Open RFID POS checkout flow.',
    },
  });

  const dateValue = new Date(`${qatarDateKey(now)}T00:00:00.000Z`);
  const eventDate = await prisma.eventDate.upsert({
    where: { eventId_date: { eventId: event.id, date: dateValue } },
    update: { status: 'active' },
    create: { eventId: event.id, date: dateValue, status: 'active' },
  });
  const sessionStartsAt = new Date(now.getTime() - 60 * 60 * 1000);
  const sessionEndsAt = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const existingSession = await prisma.eventSession.findFirst({
    where: { eventId: event.id, displayTime: 'Open test session' },
  });
  const session = existingSession
    ? await prisma.eventSession.update({
        where: { id: existingSession.id },
        data: {
          eventDateId: eventDate.id,
          startsAt: sessionStartsAt,
          endsAt: sessionEndsAt,
          status: 'active',
          capacity: 500,
        },
      })
    : await prisma.eventSession.create({
        data: {
          eventId: event.id,
          eventDateId: eventDate.id,
          startsAt: sessionStartsAt,
          endsAt: sessionEndsAt,
          displayTime: 'Open test session',
          status: 'active',
          capacity: 500,
        },
      });

  const group =
    (await prisma.ticketGroup.findFirst({ where: { eventId: event.id, title: 'Admission' } })) ??
    (await prisma.ticketGroup.create({
      data: {
        eventId: event.id,
        title: 'Admission',
        subtitle: 'Open RFID test tickets',
        iconType: 'ticket',
        sortOrder: 1,
      },
    }));

  const ticket = await prisma.ticketType.upsert({
    where: { eventId_externalKey: { eventId: event.id, externalKey: TICKET_KEY } },
    update: {
      ticketGroupId: group.id,
      title: 'InflataPass',
      subtitle: '60-minute admission requiring one RFID per ticket',
      iconType: 'clock',
      basePrice: '65.000',
      currency: 'QAR',
      admitCount: 1,
      maxQtyPerOrder: 10,
      hasDuration: true,
      durationMinutes: 60,
      hideFromOnline: true,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      eventId: event.id,
      ticketGroupId: group.id,
      externalKey: TICKET_KEY,
      title: 'InflataPass',
      subtitle: '60-minute admission requiring one RFID per ticket',
      iconType: 'clock',
      basePrice: '65.000',
      currency: 'QAR',
      admitCount: 1,
      maxQtyPerOrder: 10,
      hasDuration: true,
      durationMinutes: 60,
      hideFromOnline: true,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
  });

  const addon = await prisma.addon.upsert({
    where: { eventId_externalKey: { eventId: event.id, externalKey: ADDON_KEY } },
    update: {
      title: 'Grip Socks',
      subtitle: 'Test addon — must not receive an RFID',
      iconType: 'addon',
      basePrice: '10.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      hideFromOnline: true,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
    create: {
      eventId: event.id,
      externalKey: ADDON_KEY,
      title: 'Grip Socks',
      subtitle: 'Test addon — must not receive an RFID',
      iconType: 'addon',
      basePrice: '10.000',
      currency: 'QAR',
      maxQtyPerOrder: 10,
      hideFromOnline: true,
      hideFromPos: false,
      status: 'active',
      sortOrder: 1,
    },
  });

  await Promise.all([
    prisma.inventoryItem.upsert({
      where: {
        eventSessionId_itemType_itemId: {
          eventSessionId: session.id,
          itemType: 'ticket_type',
          itemId: ticket.id,
        },
      },
      update: { totalQuantity: 500, status: 'active' },
      create: {
        eventId: event.id,
        eventSessionId: session.id,
        itemType: 'ticket_type',
        itemId: ticket.id,
        totalQuantity: 500,
        status: 'active',
      },
    }),
    prisma.inventoryItem.upsert({
      where: {
        eventSessionId_itemType_itemId: {
          eventSessionId: session.id,
          itemType: 'addon',
          itemId: addon.id,
        },
      },
      update: { totalQuantity: 500, status: 'active' },
      create: {
        eventId: event.id,
        eventSessionId: session.id,
        itemType: 'addon',
        itemId: addon.id,
        totalQuantity: 500,
        status: 'active',
      },
    }),
  ]);

  const passwordHash = await hashPassword(POS_PASSWORD);
  const posAgent = await prisma.user.upsert({
    where: { email: POS_EMAIL },
    update: {
      username: POS_USERNAME,
      name: 'Open RFID Test POS',
      passwordHash,
      status: 'active',
    },
    create: {
      email: POS_EMAIL,
      username: POS_USERNAME,
      name: 'Open RFID Test POS',
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
    ticketTypeIds: [],
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

  const onlineCustomer = await prisma.user.upsert({
    where: { email: ONLINE_CUSTOMER_EMAIL },
    update: {
      name: 'Online RFID Customer',
      phone: ONLINE_CUSTOMER_PHONE,
      status: 'active',
    },
    create: {
      email: ONLINE_CUSTOMER_EMAIL,
      name: 'Online RFID Customer',
      phone: ONLINE_CUSTOMER_PHONE,
      status: 'active',
    },
  });
  const onlineOrder = await prisma.order.upsert({
    where: { idempotencyKey: 'seed-open-rfid-online-ticket' },
    update: {
      customerId: onlineCustomer.id,
      eventId: event.id,
      eventSessionId: session.id,
      status: 'paid',
      paymentStatus: 'paid',
      source: 'web',
      paidAt: now,
      cancelledAt: null,
      eventStartDate: dateValue,
      eventStartTime: session.displayTime,
      customerName: onlineCustomer.name,
      customerEmail: onlineCustomer.email,
      customerPhone: onlineCustomer.phone,
    },
    create: {
      commonOrder: 'BQ-WEB-OPEN-RFID-001',
      idempotencyKey: 'seed-open-rfid-online-ticket',
      customerId: onlineCustomer.id,
      eventId: event.id,
      eventSessionId: session.id,
      organizationId: organization.id,
      status: 'paid',
      paymentStatus: 'paid',
      currency: 'QAR',
      subtotalAmount: '65.000',
      discountAmount: '0.000',
      taxAmount: '0.000',
      totalAmount: '65.000',
      source: 'web',
      locale: 'en',
      paidAt: now,
      eventSlug: event.slug,
      eventTitle: 'Open RFID POS Test',
      eventStartDate: dateValue,
      eventStartTime: session.displayTime,
      customerName: onlineCustomer.name,
      customerEmail: onlineCustomer.email,
      customerPhone: onlineCustomer.phone,
      paymentMode: 'online',
      paymentMethodLabel: 'Online',
      onlineAmount: '65.000',
      ticketsNet: '65.000',
      totalQuantity: 1,
      totalAdmits: 1,
    },
  });
  const onlineOrderItem = await prisma.orderItem.findFirst({
    where: { orderId: onlineOrder.id, ticketCode: ONLINE_TICKET_CODE },
  });
  const onlineOrderItemData = {
    eventId: event.id,
    eventSessionId: session.id,
    itemType: 'ticket_type' as const,
    itemId: ticket.id,
    displayName: ticket.title,
    quantity: 1,
    unitPrice: '65.000',
    subtotalAmount: '65.000',
    discountAmount: '0.000',
    taxAmount: '0.000',
    totalAmount: '65.000',
    currency: 'QAR',
    ticketCode: ONLINE_TICKET_CODE,
    qrCodePayload: ONLINE_TICKET_CODE,
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
  if (onlineOrderItem) {
    await prisma.orderItem.update({
      where: { id: onlineOrderItem.id },
      data: onlineOrderItemData,
    });
  } else {
    await prisma.orderItem.create({
      data: { orderId: onlineOrder.id, ...onlineOrderItemData },
    });
  }

  console.log('Open RFID POS test seed ready.');
  console.log(`  event:      ${EVENT_SLUG} (${event.id})`);
  console.log(`  ticket:     ${TICKET_KEY} (${ticket.id})`);
  console.log(`  addon:      ${ADDON_KEY} (${addon.id})`);
  console.log('  extension:  open-rfid-inflatapass-extra-15 · 15 min · QAR 20');
  console.log(`  POS email:  ${POS_EMAIL}`);
  console.log(`  username:   ${POS_USERNAME}`);
  console.log(`  password:   ${POS_PASSWORD}`);
  console.log(`  assignment: ${assignment.id}`);
  console.log(`  online test: ${ONLINE_TICKET_CODE} · ${ONLINE_CUSTOMER_PHONE}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
