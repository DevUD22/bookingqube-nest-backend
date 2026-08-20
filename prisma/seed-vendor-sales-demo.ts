/**
 * End-to-end vendor/POS/reporting demo.
 *
 * Safe to rerun: only the event with DEMO_EVENT_SLUG and its transactional
 * children are replaced. Existing non-demo events and orders are untouched.
 */
import {
  AttendanceStatus,
  OrderItemType,
  PaymentLegType,
  PaymentProvider,
  PaymentTransactionStatus,
  PrismaClient,
  ReportPaymentMode,
  VisitorType,
} from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';
import { PrismaService } from '../src/database/prisma.service';
import { ReportTimezoneService } from '../src/modules/reporting/report-timezone.service';
import { ReportingService } from '../src/modules/reporting/reporting.service';

const prisma = new PrismaClient();
const DEMO_EVENT_SLUG = 'demo-lego-marketplace-vendor-sales';
const DEMO_PASSWORD = 'DemoPass123!';
const EVENT_TITLE = 'LEGO Marketplace — Vendor & POS Demo';

type DemoProduct = {
  id: string;
  title: string;
  price: number;
  thirdPartyVendorId: string | null;
  admitCount: number;
  inventoryItemId: string;
};

type DemoAgent = {
  id: string;
  name: string;
};

type OrderPlan = {
  product: DemoProduct;
  agent: DemoAgent | null;
  mode: ReportPaymentMode;
  quantity: number;
  dayOffset: number;
  visitorType: VisitorType;
  refunded?: boolean;
};

async function upsertLoginUser(input: {
  email: string;
  username?: string;
  name: string;
  passwordHash: string;
}) {
  return prisma.user.upsert({
    where: { email: input.email },
    update: {
      name: input.name,
      username: input.username,
      passwordHash: input.passwordHash,
      status: 'active',
    },
    create: {
      email: input.email,
      username: input.username,
      name: input.name,
      passwordHash: input.passwordHash,
      status: 'active',
    },
  });
}

async function main() {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const [organization, admin, venue, category] = await Promise.all([
    prisma.organization.findUnique({ where: { slug: 'bookingqube' } }),
    prisma.user.findUnique({ where: { email: 'admin@bookingqube.test' } }),
    prisma.venue.findUnique({ where: { slug: 'doha-exhibition-center' } }),
    prisma.eventCategory.findUnique({ where: { slug: 'experiences' } }),
  ]);
  if (!organization || !admin || !venue || !category) {
    throw new Error(
      'Run `npm run prisma:seed` first so BookingQube, the admin, venue, and category exist.',
    );
  }

  const roles = await prisma.role.findMany({
    where: {
      name: {
        in: ['organiser', 'event_manager', 'pos', 'scanner', 'finance-manager', 'hr'],
      },
    },
  });
  const roleId = new Map(roles.map((role) => [role.name, role.id]));
  for (const requiredRole of [
    'organiser',
    'event_manager',
    'pos',
    'scanner',
    'finance-manager',
    'hr',
  ]) {
    if (!roleId.has(requiredRole)) {
      throw new Error(`Run the main seed first; role "${requiredRole}" is missing.`);
    }
  }

  const previous = await prisma.event.findUnique({
    where: { slug: DEMO_EVENT_SLUG },
    select: { id: true },
  });
  if (previous) {
    await prisma.order.deleteMany({ where: { eventId: previous.id } });
    await prisma.event.delete({ where: { id: previous.id } });
  }

  const organiser = await upsertLoginUser({
    email: 'demo.organiser@bookingqube.test',
    username: 'demo_organiser',
    name: 'LEGO Marketplace Organiser',
    passwordHash,
  });
  const eventManager = await upsertLoginUser({
    email: 'demo.manager@bookingqube.test',
    username: 'demo_event_manager',
    name: 'Demo Event Manager',
    passwordHash,
  });
  const ownerPos = await upsertLoginUser({
    email: 'demo.pos@bookingqube.test',
    username: 'demo_owner_pos',
    name: 'BookingQube Main POS',
    passwordHash,
  });
  const balloonPos = await upsertLoginUser({
    email: 'qballoons.pos@bookingqube.test',
    username: 'qballoons_pos',
    name: 'Qballoons POS',
    passwordHash,
  });
  const brickPos = await upsertLoginUser({
    email: 'brickcraft.pos@bookingqube.test',
    username: 'brickcraft_pos',
    name: 'BrickCraft Store POS',
    passwordHash,
  });
  const scanner = await upsertLoginUser({
    email: 'demo.scanner@bookingqube.test',
    username: 'demo_scanner',
    name: 'Demo Gate Scanner',
    passwordHash,
  });
  const finance = await upsertLoginUser({
    email: 'demo.finance@bookingqube.test',
    username: 'demo_finance',
    name: 'Demo Finance Manager',
    passwordHash,
  });
  const hr = await upsertLoginUser({
    email: 'demo.hr@bookingqube.test',
    username: 'demo_hr',
    name: 'Demo HR Manager',
    passwordHash,
  });

  await prisma.organizationMember.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: organiser.id,
      },
    },
    update: { role: 'manager', status: 'active' },
    create: {
      organizationId: organization.id,
      userId: organiser.id,
      role: 'manager',
      status: 'active',
    },
  });
  for (const [userId, roleName] of [
    [organiser.id, 'organiser'],
    [eventManager.id, 'event_manager'],
    [finance.id, 'finance-manager'],
    [hr.id, 'hr'],
  ] as const) {
    await prisma.adminProfile.upsert({
      where: { userId },
      update: { roleId: roleId.get(roleName)!, status: 'active' },
      create: { userId, roleId: roleId.get(roleName)!, status: 'active' },
    });
  }

  const eventStartsAt = new Date('2026-08-21T07:00:00.000Z');
  const eventEndsAt = new Date('2026-08-23T18:00:00.000Z');
  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      slug: DEMO_EVENT_SLUG,
      eventType: 'general',
      status: 'published',
      visibility: 'unlisted',
      venueId: venue.id,
      categoryId: category.id,
      bookingMode: 'ticketed',
      currency: 'QAR',
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      publishedAt: new Date(),
      createdByUserId: admin.id,
      updatedByUserId: admin.id,
      primaryOrganizerId: organiser.id,
      organizerAssignedByUserId: admin.id,
      organizerAssignedAt: new Date(),
      translations: {
        create: [
          {
            locale: 'en',
            title: EVENT_TITLE,
            subtitle: 'Complete seeded marketplace, vendor, POS, and reporting scenario',
            description:
              'A safe local demo containing BookingQube passes, third-party vendor products, POS agents, completed sales, refunds, attendance, and reporting data.',
          },
          {
            locale: 'ar',
            title: 'سوق ليغو — تجربة البائعين ونقاط البيع',
            subtitle: 'سيناريو تجريبي متكامل للتقارير ونقاط البيع',
            description:
              'فعالية محلية تجريبية تشمل تذاكر BookingQube ومنتجات البائعين والمبيعات والتقارير.',
          },
        ],
      },
    },
  });

  const eventDate = await prisma.eventDate.create({
    data: {
      eventId: event.id,
      date: new Date('2026-08-21T00:00:00.000Z'),
      status: 'active',
    },
  });
  const session = await prisma.eventSession.create({
    data: {
      eventId: event.id,
      eventDateId: eventDate.id,
      startsAt: eventStartsAt,
      endsAt: eventEndsAt,
      displayTime: '10:00 AM – 9:00 PM',
      status: 'active',
      capacity: 2500,
    },
  });
  const ticketGroup = await prisma.ticketGroup.create({
    data: {
      eventId: event.id,
      title: 'Marketplace products',
      subtitle: 'BookingQube passes and third-party vendor items',
      iconType: 'ticket',
      sortOrder: 1,
    },
  });

  const qballoons = await prisma.thirdPartyVendor.create({
    data: {
      eventId: event.id,
      name: 'Qballoons',
      isMain: true,
      organiserShare: '30.00',
      vendorSharePct: '70.00',
      isCafe: false,
      ownerName: 'Qballoons W.L.L.',
      ownerPercentageType: 'normal',
      sortOrder: 1,
    },
  });
  const brickCraft = await prisma.thirdPartyVendor.create({
    data: {
      eventId: event.id,
      name: 'BrickCraft Store',
      isMain: false,
      organiserShare: '75.00',
      vendorSharePct: '25.00',
      isCafe: false,
      collectedBy: 'BrickCraft Store',
      sortOrder: 2,
    },
  });

  const productDefinitions = [
    {
      externalKey: 'demo-adult-pass',
      title: 'Adult Day Pass',
      subtitle: 'BookingQube event-owner product',
      price: 80,
      thirdPartyVendorId: null,
      admitCount: 1,
      sortOrder: 1,
    },
    {
      externalKey: 'demo-family-pass',
      title: 'Family Pass',
      subtitle: '2 adults + 2 children',
      price: 250,
      thirdPartyVendorId: null,
      admitCount: 4,
      sortOrder: 2,
    },
    {
      externalKey: 'demo-qballoon-classic',
      title: 'Qballoons Classic Balloon',
      subtitle: 'Third-party vendor product',
      price: 35,
      thirdPartyVendorId: qballoons.id,
      admitCount: 0,
      sortOrder: 3,
    },
    {
      externalKey: 'demo-qballoon-led',
      title: 'Qballoons LED Balloon',
      subtitle: 'Premium third-party vendor product',
      price: 55,
      thirdPartyVendorId: qballoons.id,
      admitCount: 0,
      sortOrder: 4,
    },
    {
      externalKey: 'demo-brick-minifigure',
      title: 'Custom Mini Figure',
      subtitle: 'BrickCraft third-party vendor product',
      price: 65,
      thirdPartyVendorId: brickCraft.id,
      admitCount: 0,
      sortOrder: 5,
    },
    {
      externalKey: 'demo-brick-kit',
      title: 'Build-at-Home Brick Kit',
      subtitle: 'BrickCraft premium kit',
      price: 120,
      thirdPartyVendorId: brickCraft.id,
      admitCount: 0,
      sortOrder: 6,
    },
  ];

  const products: DemoProduct[] = [];
  for (const definition of productDefinitions) {
    const ticket = await prisma.ticketType.create({
      data: {
        eventId: event.id,
        ticketGroupId: ticketGroup.id,
        externalKey: definition.externalKey,
        title: definition.title,
        subtitle: definition.subtitle,
        thirdPartyVendorId: definition.thirdPartyVendorId,
        hasVariants: false,
        basePrice: definition.price.toFixed(3),
        currency: 'QAR',
        admitCount: definition.admitCount,
        maxQtyPerOrder: 10,
        status: 'active',
        sortOrder: definition.sortOrder,
      },
    });
    const inventory = await prisma.inventoryItem.create({
      data: {
        eventId: event.id,
        eventSessionId: session.id,
        itemType: 'ticket_type',
        itemId: ticket.id,
        totalQuantity: definition.admitCount ? 1000 : 500,
        status: 'active',
      },
    });
    products.push({
      id: ticket.id,
      title: ticket.title,
      price: definition.price,
      thirdPartyVendorId: definition.thirdPartyVendorId,
      admitCount: definition.admitCount,
      inventoryItemId: inventory.id,
    });
  }

  const [adultPass, familyPass, classicBalloon, ledBalloon, miniFigure, brickKit] =
    products;

  await prisma.staffAssignment.createMany({
    data: [
      {
        userId: eventManager.id,
        roleId: roleId.get('event_manager')!,
        organizationId: organization.id,
        eventId: event.id,
        thirdPartyVendorId: qballoons.id,
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
      {
        userId: ownerPos.id,
        roleId: roleId.get('pos')!,
        organizationId: organization.id,
        eventId: event.id,
        thirdPartyVendorIds: [],
        ticketTypeIds: [adultPass.id, familyPass.id],
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
      {
        userId: balloonPos.id,
        roleId: roleId.get('pos')!,
        organizationId: organization.id,
        eventId: event.id,
        thirdPartyVendorId: qballoons.id,
        thirdPartyVendorIds: [qballoons.id],
        ticketTypeIds: [classicBalloon.id, ledBalloon.id],
        managedByUserId: eventManager.id,
        createdByUserId: admin.id,
      },
      {
        userId: brickPos.id,
        roleId: roleId.get('pos')!,
        organizationId: organization.id,
        eventId: event.id,
        thirdPartyVendorId: brickCraft.id,
        thirdPartyVendorIds: [brickCraft.id],
        ticketTypeIds: [miniFigure.id, brickKit.id],
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
      {
        userId: scanner.id,
        roleId: roleId.get('scanner')!,
        organizationId: organization.id,
        eventId: event.id,
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
      {
        userId: finance.id,
        roleId: roleId.get('finance-manager')!,
        organizationId: organization.id,
        eventId: event.id,
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
      {
        userId: hr.id,
        roleId: roleId.get('hr')!,
        organizationId: organization.id,
        eventId: event.id,
        managedByUserId: organiser.id,
        createdByUserId: admin.id,
      },
    ],
  });

  const customers = [];
  const customerNames = [
    'Aisha Al-Kuwari',
    'Omar Al-Mansoori',
    'Maya Thomas',
    'Noah Williams',
    'Fatima Hassan',
    'Lucas Martin',
    'Sara Ahmed',
    'Yousef Ali',
  ];
  for (let index = 0; index < customerNames.length; index += 1) {
    const email = `demo.customer${index + 1}@bookingqube.test`;
    const customer = await prisma.user.upsert({
      where: { email },
      update: { name: customerNames[index], status: 'active' },
      create: {
        email,
        name: customerNames[index],
        status: 'active',
        customerProfile: { create: { defaultLocale: index % 3 === 0 ? 'ar' : 'en' } },
      },
    });
    customers.push(customer);
  }

  const agents = {
    owner: { id: ownerPos.id, name: ownerPos.name },
    balloon: { id: balloonPos.id, name: balloonPos.name },
    brick: { id: brickPos.id, name: brickPos.name },
  };
  const plans: OrderPlan[] = [];
  for (let index = 0; index < 42; index += 1) {
    const pattern = index % 7;
    const common = {
      quantity: 1 + (index % 3),
      dayOffset: 41 - index,
      visitorType:
        index % 9 === 0
          ? VisitorType.promocode
          : index % 11 === 0
            ? VisitorType.pos_only
            : VisitorType.paid,
      refunded: index === 10 || index === 31,
    };
    if (pattern === 0) {
      plans.push({
        ...common,
        product: adultPass,
        agent: null,
        mode: ReportPaymentMode.online,
      });
    } else if (pattern === 1) {
      plans.push({
        ...common,
        product: familyPass,
        agent: agents.owner,
        mode: ReportPaymentMode.offline_card,
        quantity: 1,
      });
    } else if (pattern === 2) {
      plans.push({
        ...common,
        product: classicBalloon,
        agent: agents.balloon,
        mode: ReportPaymentMode.offline_cash,
      });
    } else if (pattern === 3) {
      plans.push({
        ...common,
        product: ledBalloon,
        agent: agents.balloon,
        mode: ReportPaymentMode.offline_card,
      });
    } else if (pattern === 4) {
      plans.push({
        ...common,
        product: miniFigure,
        agent: agents.brick,
        mode: ReportPaymentMode.offline_cash,
      });
    } else if (pattern === 5) {
      plans.push({
        ...common,
        product: brickKit,
        agent: agents.brick,
        mode: ReportPaymentMode.offline_card,
      });
    } else {
      plans.push({
        ...common,
        product: adultPass,
        agent: agents.owner,
        mode: ReportPaymentMode.split,
      });
    }
  }

  const reportTz = new ReportTimezoneService(prisma as unknown as PrismaService);
  const reporting = new ReportingService(
    prisma as unknown as PrismaService,
    reportTz,
  );
  let grossSales = 0;
  let refundedSales = 0;
  let checkedIn = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const customer = customers[index % customers.length];
    const paidAt = new Date();
    paidAt.setUTCDate(paidAt.getUTCDate() - plan.dayOffset);
    paidAt.setUTCHours(8 + (index % 9), (index * 7) % 60, 0, 0);
    const total = plan.product.price * plan.quantity;
    const admits = plan.product.admitCount * plan.quantity;
    const modeLabel: Record<ReportPaymentMode, string> = {
      online: 'Online card',
      offline_cash: 'POS cash',
      offline_card: 'POS card',
      split: 'Split cash / card',
      advance: 'Advance',
      comp: 'Complimentary',
      free: 'Free',
    };
    const cashAmount =
      plan.mode === ReportPaymentMode.offline_cash
        ? total
        : plan.mode === ReportPaymentMode.split
          ? Math.round(total * 0.4 * 100) / 100
          : 0;
    const cardAmount =
      plan.mode === ReportPaymentMode.offline_card
        ? total
        : plan.mode === ReportPaymentMode.split
          ? total - cashAmount
          : 0;
    const onlineAmount = plan.mode === ReportPaymentMode.online ? total : 0;
    const attendanceStatus =
      admits > 0 && index % 3 !== 0
        ? AttendanceStatus.checked_in
        : AttendanceStatus.not_checked_in;
    if (attendanceStatus === AttendanceStatus.checked_in) checkedIn += admits;

    const order = await prisma.order.create({
      data: {
        commonOrder: `DEMO-VENDOR-${String(index + 1).padStart(3, '0')}`,
        idempotencyKey: `demo-vendor-order-${index + 1}`,
        customerId: customer.id,
        eventId: event.id,
        eventSessionId: session.id,
        status: 'paid',
        paymentStatus: 'paid',
        currency: 'QAR',
        subtotalAmount: total.toFixed(3),
        totalAmount: total.toFixed(3),
        promoCode: plan.visitorType === VisitorType.promocode ? 'DEMO15' : null,
        source: plan.agent ? 'pos' : 'web',
        locale: index % 3 === 0 ? 'ar' : 'en',
        createdAt: paidAt,
        paidAt,
        organizationId: organization.id,
        venueId: venue.id,
        eventSlug: event.slug,
        eventTitle: EVENT_TITLE,
        eventStartDate: new Date('2026-08-21T00:00:00.000Z'),
        eventStartTime: '10:00 AM',
        customerName: customer.name,
        customerEmail: customer.email,
        customerAgeGroup: ['18–24', '25–34', '35–44', '45+'][index % 4],
        customerGeographicRegion: ['Doha', 'Al Rayyan', 'Al Wakrah'][index % 3],
        paymentMode: plan.mode,
        paymentMethodLabel: modeLabel[plan.mode],
        cashAmount: cashAmount.toFixed(3),
        cardAmount: cardAmount.toFixed(3),
        onlineAmount: onlineAmount.toFixed(3),
        bookedByAgentId: plan.agent?.id,
        ticketsNet: total.toFixed(3),
        totalQuantity: plan.quantity,
        totalAdmits: admits,
        items: {
          create: {
            eventId: event.id,
            eventSessionId: session.id,
            inventoryItemId: plan.product.inventoryItemId,
            itemType: OrderItemType.ticket_type,
            itemId: plan.product.id,
            displayName: plan.product.title,
            quantity: plan.quantity,
            unitPrice: plan.product.price.toFixed(3),
            subtotalAmount: total.toFixed(3),
            totalAmount: total.toFixed(3),
            currency: 'QAR',
            ticketCode: `DEMO-${String(index + 1).padStart(3, '0')}`,
            qrCodePayload: `BQ-DEMO-${event.id}-${index + 1}`,
            attendanceStatus,
            checkedInAt:
              attendanceStatus === AttendanceStatus.checked_in ? new Date() : null,
            checkedInByUserId:
              attendanceStatus === AttendanceStatus.checked_in ? scanner.id : null,
            visitorType: plan.visitorType,
            thirdPartyVendorId: plan.product.thirdPartyVendorId,
            admitCount: plan.product.admitCount,
            bookedByAgentId: plan.agent?.id,
            ticketIsPosOnly: Boolean(plan.agent),
          },
        },
      },
    });
    const legType =
      plan.mode === ReportPaymentMode.offline_cash
        ? PaymentLegType.cash
        : plan.mode === ReportPaymentMode.online
          ? PaymentLegType.online_gateway
          : PaymentLegType.card;
    const payment = await prisma.payment.create({
      data: {
        orderId: order.id,
        provider: PaymentProvider.internal,
        methodKey: plan.mode,
        legType,
        status: PaymentTransactionStatus.paid,
        amount: total.toFixed(3),
        currency: 'QAR',
        providerPaymentId: `demo-payment-${index + 1}`,
        collectedByUserId: plan.agent?.id,
        createdAt: paidAt,
        paidAt,
      },
    });

    await reporting.syncOrder({ orderId: order.id, action: 'paid' });
    grossSales += total;

    if (plan.refunded) {
      await prisma.refund.create({
        data: {
          orderId: order.id,
          paymentId: payment.id,
          status: 'succeeded',
          amount: total.toFixed(3),
          currency: 'QAR',
          reason: 'Seeded customer refund for reporting demo',
          providerRefundId: `demo-refund-${index + 1}`,
          createdByUserId: admin.id,
          createdAt: new Date(paidAt.getTime() + 86_400_000),
          completedAt: new Date(paidAt.getTime() + 86_400_000),
        },
      });
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'refunded', paymentStatus: 'refunded' },
      });
      await reporting.syncOrder({ orderId: order.id, action: 'refund' });
      refundedSales += total;
    }
  }

  for (const product of products) {
    const sold = plans
      .filter((plan) => plan.product.id === product.id && !plan.refunded)
      .reduce((sum, plan) => sum + plan.quantity, 0);
    await prisma.inventoryItem.update({
      where: { id: product.inventoryItemId },
      data: { soldQuantity: sold },
    });
  }
  await prisma.eventAttendanceCounter.upsert({
    where: { eventId: event.id },
    update: { checkedInCount: checkedIn, checkedOutCount: 0 },
    create: { eventId: event.id, checkedInCount: checkedIn, checkedOutCount: 0 },
  });

  const [vendorReport, staffCount, paymentMix] = await Promise.all([
    prisma.bookingReportThirdPartyVendorDaily.groupBy({
      by: ['thirdPartyVendorId'],
      where: { eventId: event.id, reportBasis: 'trx' },
      _sum: { revenueTotal: true, ticketQty: true, orderCount: true },
    }),
    prisma.staffAssignment.count({ where: { eventId: event.id } }),
    prisma.order.groupBy({
      by: ['paymentMode'],
      where: { eventId: event.id },
      _count: { _all: true },
      _sum: { totalAmount: true },
    }),
  ]);
  const shareDetails = new Map([
    [
      qballoons.id,
      {
        name: qballoons.name,
        ownerShare: qballoons.organiserShare.toNumber(),
        vendorShare: qballoons.vendorSharePct.toNumber(),
      },
    ],
    [
      brickCraft.id,
      {
        name: brickCraft.name,
        ownerShare: brickCraft.organiserShare.toNumber(),
        vendorShare: brickCraft.vendorSharePct.toNumber(),
      },
    ],
  ]);
  const vendorSettlements = vendorReport.map((row) => {
    const detail = shareDetails.get(row.thirdPartyVendorId)!;
    const sales = row._sum.revenueTotal?.toNumber() ?? 0;
    const ownerRevenue = Math.round(sales * (detail.ownerShare / 100) * 100) / 100;
    return {
      vendor: detail.name,
      net_sales: sales,
      bookingqube_share: ownerRevenue,
      vendor_payout: Math.round((sales - ownerRevenue) * 100) / 100,
      items_sold: row._sum.ticketQty ?? 0,
      vendor_orders: row._sum.orderCount ?? 0,
    };
  });

  console.log({
    created: true,
    event_id: event.id,
    event_slug: event.slug,
    event_title: EVENT_TITLE,
    orders: plans.length,
    gross_sales: grossSales,
    refunds: refundedSales,
    net_sales: grossSales - refundedSales,
    checked_in_admits: checkedIn,
    products: products.length,
    staff_assignments: staffCount,
    vendor_settlements: vendorSettlements,
    payment_mix: paymentMix.map((row) => ({
      mode: row.paymentMode,
      orders: row._count._all,
      sales: row._sum.totalAmount?.toNumber() ?? 0,
    })),
    credentials: {
      password: DEMO_PASSWORD,
      organiser: organiser.email,
      event_manager: eventManager.email,
      owner_pos: ownerPos.username,
      qballoons_pos: balloonPos.username,
      brickcraft_pos: brickPos.username,
      scanner: scanner.username,
      finance: finance.email,
      hr: hr.email,
    },
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
