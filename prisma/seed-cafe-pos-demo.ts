/**
 * Complete local Cafe POS test fixture.
 *
 * Prerequisite: npm run prisma:seed
 * Safe to rerun: only records owned by BQFood Complete Test Cafe and the
 * BQFOOD-* fixture keys are replaced or updated.
 */
import { Prisma, PrismaClient, ReportPaymentMode } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

const CAFE_NAME = 'BQFood Complete Test Cafe';
const EVENT_SLUG = 'demo-lego-marketplace-vendor-sales';
const AGENT_EMAIL = 'cafe.pos@bqfood.test';
const AGENT_USERNAME = 'bqfood_cafe_pos';
const AGENT_PASSWORD = 'CafePos123!';

const MENU = [
  {
    titleEn: 'Hot Drinks',
    titleAr: 'مشروبات ساخنة',
    items: [
      ['Espresso', 'إسبريسو', 12, true],
      ['Cappuccino', 'كابتشينو', 18, true],
      ['Cafe Latte', 'كافيه لاتيه', 20, true],
    ],
  },
  {
    titleEn: 'Cold Drinks',
    titleAr: 'مشروبات باردة',
    items: [
      ['Iced Tea', 'شاي مثلج', 14, false],
      ['Fresh Orange Juice', 'عصير برتقال طازج', 22, false],
      ['Still Water', 'مياه', 5, false],
    ],
  },
  {
    titleEn: 'Food',
    titleAr: 'طعام',
    items: [
      ['Butter Croissant', 'كرواسون بالزبدة', 10, true],
      ['Classic Burger', 'برجر كلاسيكي', 38, true],
      ['Margherita Pizza', 'بيتزا مارجريتا', 42, true],
      ['Breakfast Platter', 'طبق إفطار', 35, true],
    ],
  },
  {
    titleEn: 'Desserts',
    titleAr: 'حلويات',
    items: [
      ['Cheesecake', 'تشيز كيك', 22, true],
      ['Chocolate Brownie', 'براوني الشوكولاتة', 16, true],
    ],
  },
] as const;

const PROMO_CODES = [
  'CAFE10',
  'FLAT5',
  'COFFEE2',
  'FREEWATER',
  'FUTURE20',
  'EXPIRED15',
  'LIMIT0',
  'OTHERCAFE',
] as const;

function startOfDay(offsetDays = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + offsetDays);
  return date;
}

async function upsertPromo(input: {
  code: (typeof PROMO_CODES)[number];
  name: string;
  description: string;
  discountType: 'percent' | 'fixed';
  discountApplication: 'per_ticket' | 'order_total';
  discountValue: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
  maxRedemptions?: number | null;
  targets: Array<{ targetType: 'cafe' | 'cafe_menu_item'; targetId: string }>;
  organizationId: string;
  adminId: string;
}) {
  const promo = await prisma.promoCode.upsert({
    where: { code: input.code },
    update: {
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      showInPos: true,
      status: 'active',
      discountType: input.discountType,
      discountApplication: input.discountApplication,
      discountValue: input.discountValue,
      currency: input.discountType === 'fixed' ? 'QAR' : null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      maxRedemptionsPerCustomer: null,
      updatedByUserId: input.adminId,
    },
    create: {
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      description: input.description,
      showInPos: true,
      status: 'active',
      discountType: input.discountType,
      discountApplication: input.discountApplication,
      discountValue: input.discountValue,
      currency: input.discountType === 'fixed' ? 'QAR' : null,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      maxRedemptions: input.maxRedemptions ?? null,
      createdByUserId: input.adminId,
      updatedByUserId: input.adminId,
    },
  });
  await prisma.promoCodeTarget.deleteMany({ where: { promoCodeId: promo.id } });
  await prisma.promoCodeTarget.createMany({
    data: input.targets.map((target) => ({ promoCodeId: promo.id, ...target })),
  });
  return promo;
}

async function main() {
  const [organization, event, admin, cafePosRole] = await Promise.all([
    prisma.organization.findUnique({ where: { slug: 'bookingqube' } }),
    prisma.event.findUnique({
      where: { slug: EVENT_SLUG },
      include: {
        translations: { where: { locale: 'en' }, take: 1 },
        sessions: { where: { status: 'active' }, orderBy: { startsAt: 'desc' }, take: 1 },
      },
    }),
    prisma.user.findUnique({ where: { email: 'admin@bookingqube.test' } }),
    prisma.role.findUnique({ where: { name: 'cafe_pos' } }),
  ]);
  if (!organization || !event || !admin || !cafePosRole || !event.sessions[0]) {
    throw new Error(
      'Run `npm run prisma:seed` and `npm run prisma:seed-vendor-demo` first; required demo records are missing.',
    );
  }

  const existingCafe = await prisma.cafe.findFirst({ where: { name: CAFE_NAME } });
  const cafe = existingCafe
    ? await prisma.cafe.update({
        where: { id: existingCafe.id },
        data: {
          organizationId: organization.id,
          details: 'Complete local test fixture for the BQFood Cafe POS application.',
          tableCount: 12,
          managerUserId: admin.id,
          activeEventId: event.id,
          status: 'published',
        },
      })
    : await prisma.cafe.create({
        data: {
          organizationId: organization.id,
          name: CAFE_NAME,
          details: 'Complete local test fixture for the BQFood Cafe POS application.',
          tableCount: 12,
          managerUserId: admin.id,
          activeEventId: event.id,
          status: 'published',
        },
      });

  const assignment = await prisma.cafeEventAssignment.findFirst({
    where: { cafeId: cafe.id, eventId: event.id },
  });
  if (assignment) {
    await prisma.cafeEventAssignment.update({
      where: { id: assignment.id },
      data: { unassignedAt: null, assignedByUserId: admin.id },
    });
  } else {
    await prisma.cafeEventAssignment.create({
      data: { cafeId: cafe.id, eventId: event.id, assignedByUserId: admin.id },
    });
  }

  const passwordHash = await hashPassword(AGENT_PASSWORD);
  const agent = await prisma.user.upsert({
    where: { email: AGENT_EMAIL },
    update: {
      username: AGENT_USERNAME,
      name: 'BQFood Cafe POS Tester',
      passwordHash,
      status: 'active',
    },
    create: {
      email: AGENT_EMAIL,
      username: AGENT_USERNAME,
      name: 'BQFood Cafe POS Tester',
      passwordHash,
      status: 'active',
    },
  });
  await prisma.cafePosAgent.upsert({
    where: { cafeId_userId: { cafeId: cafe.id, userId: agent.id } },
    update: { status: 'active' },
    create: { cafeId: cafe.id, userId: agent.id, status: 'active' },
  });
  const staff = await prisma.staffAssignment.findFirst({
    where: { userId: agent.id, roleId: cafePosRole.id, organizationId: organization.id },
  });
  if (staff) {
    await prisma.staffAssignment.update({
      where: { id: staff.id },
      data: { eventId: event.id, isCafeAgent: true, status: 'active' },
    });
  } else {
    await prisma.staffAssignment.create({
      data: {
        userId: agent.id,
        roleId: cafePosRole.id,
        organizationId: organization.id,
        eventId: event.id,
        isCafeAgent: true,
        status: 'active',
        createdByUserId: admin.id,
      },
    });
  }

  await prisma.cafeOrder.deleteMany({ where: { cafeId: cafe.id } });
  await prisma.cafeMenuCategory.deleteMany({ where: { cafeId: cafe.id } });

  const menuItems = new Map<string, { id: string; title: string; price: number; isKot: boolean }>();
  for (const [categoryIndex, definition] of MENU.entries()) {
    const category = await prisma.cafeMenuCategory.create({
      data: {
        cafeId: cafe.id,
        titleEn: definition.titleEn,
        titleAr: definition.titleAr,
        sortOrder: categoryIndex + 1,
        status: 'active',
      },
    });
    const subcategory = await prisma.cafeMenuSubcategory.create({
      data: {
        categoryId: category.id,
        titleEn: 'All items',
        titleAr: 'جميع الأصناف',
        isUngrouped: true,
        sortOrder: 0,
        status: 'active',
      },
    });
    for (const [itemIndex, item] of definition.items.entries()) {
      const [titleEn, titleAr, price, isKot] = item;
      const created = await prisma.cafeMenuItem.create({
        data: {
          subcategoryId: subcategory.id,
          titleEn,
          titleAr,
          description: `${titleEn} demo item for Cafe POS testing.`,
          price,
          currency: 'QAR',
          isKot,
          sortOrder: itemIndex + 1,
          status: 'active',
        },
      });
      menuItems.set(titleEn, { id: created.id, title: titleEn, price, isKot });
    }
  }

  const cafeTarget = [{ targetType: 'cafe' as const, targetId: cafe.id }];
  const espresso = menuItems.get('Espresso')!;
  const water = menuItems.get('Still Water')!;
  const otherCafe = await prisma.cafe.findFirst({
    where: { id: { not: cafe.id }, organizationId: organization.id },
  });
  const now = new Date();
  await Promise.all([
    upsertPromo({
      code: 'CAFE10',
      name: '10% off the whole order',
      description: 'Valid order-level percentage discount.',
      discountType: 'percent',
      discountApplication: 'order_total',
      discountValue: 10,
      targets: cafeTarget,
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'FLAT5',
      name: 'QAR 5 off the whole order',
      description: 'Valid order-level fixed discount.',
      discountType: 'fixed',
      discountApplication: 'order_total',
      discountValue: 5,
      targets: cafeTarget,
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'COFFEE2',
      name: 'QAR 2 off each espresso',
      description: 'Valid item-targeted fixed discount.',
      discountType: 'fixed',
      discountApplication: 'per_ticket',
      discountValue: 2,
      targets: [...cafeTarget, { targetType: 'cafe_menu_item', targetId: espresso.id }],
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'FREEWATER',
      name: 'Free water',
      description: 'Valid 100% item-targeted discount.',
      discountType: 'percent',
      discountApplication: 'per_ticket',
      discountValue: 100,
      targets: [...cafeTarget, { targetType: 'cafe_menu_item', targetId: water.id }],
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'FUTURE20',
      name: 'Future promotion',
      description: 'Negative test: starts tomorrow.',
      discountType: 'percent',
      discountApplication: 'order_total',
      discountValue: 20,
      startsAt: startOfDay(1),
      targets: cafeTarget,
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'EXPIRED15',
      name: 'Expired promotion',
      description: 'Negative test: ended yesterday.',
      discountType: 'percent',
      discountApplication: 'order_total',
      discountValue: 15,
      startsAt: startOfDay(-30),
      endsAt: new Date(startOfDay(0).getTime() - 1),
      targets: cafeTarget,
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'LIMIT0',
      name: 'Redemption limit reached',
      description: 'Negative test: maximum redemptions is zero.',
      discountType: 'percent',
      discountApplication: 'order_total',
      discountValue: 25,
      maxRedemptions: 0,
      targets: cafeTarget,
      organizationId: organization.id,
      adminId: admin.id,
    }),
    upsertPromo({
      code: 'OTHERCAFE',
      name: 'Wrong cafe promotion',
      description: 'Negative test: targets a different cafe.',
      discountType: 'percent',
      discountApplication: 'order_total',
      discountValue: 50,
      targets: [{ targetType: 'cafe', targetId: otherCafe?.id ?? cafe.id }],
      organizationId: organization.id,
      adminId: admin.id,
    }),
  ]);

  const customers = await Promise.all(
    [
      ['Aisha Test Customer', 'aisha.cafe@bqfood.test', '+97455001001'],
      ['Omar Test Customer', 'omar.cafe@bqfood.test', '+97455001002'],
      ['Walk-in Regular', 'regular.cafe@bqfood.test', '+97455001003'],
    ].map(async ([name, email, phone]) => {
      const user = await prisma.user.upsert({
        where: { email },
        update: { name, phone, status: 'active' },
        create: { name, email, phone, status: 'active' },
      });
      await prisma.customerProfile.upsert({
        where: { userId: user.id },
        update: { nationality: 'Qatar', ageGroup: 'adult' },
        create: { userId: user.id, nationality: 'Qatar', ageGroup: 'adult' },
      });
      return user;
    }),
  );

  const session = event.sessions[0];
  const reportPlans = [
    {
      customer: customers[0],
      item: espresso,
      mode: ReportPaymentMode.offline_cash,
      total: 24,
      offset: 0,
    },
    {
      customer: customers[1],
      item: menuItems.get('Classic Burger')!,
      mode: ReportPaymentMode.offline_card,
      total: 38,
      offset: -1,
    },
    {
      customer: customers[2],
      item: menuItems.get('Cheesecake')!,
      mode: ReportPaymentMode.split,
      total: 44,
      offset: -2,
    },
  ];
  for (const [index, plan] of reportPlans.entries()) {
    const paidAt = new Date(startOfDay(plan.offset).getTime() + 12 * 60 * 60 * 1000);
    const order = await prisma.order.upsert({
      where: { idempotencyKey: `BQFOOD-CAFE-DEMO-${index + 1}` },
      update: {
        customerId: plan.customer.id,
        eventId: event.id,
        eventSessionId: session.id,
        status: 'paid',
        paymentStatus: 'paid',
        subtotalAmount: plan.total,
        discountAmount: 0,
        totalAmount: plan.total,
        paidAt,
        createdAt: paidAt,
        customerName: plan.customer.name,
        customerEmail: plan.customer.email,
        customerPhone: plan.customer.phone,
        paymentMode: plan.mode,
        paymentMethodLabel:
          plan.mode === ReportPaymentMode.split
            ? 'Cash + Card'
            : plan.mode === ReportPaymentMode.offline_cash
              ? 'Cash'
              : 'Card',
        cashAmount:
          plan.mode === ReportPaymentMode.offline_cash
            ? plan.total
            : plan.mode === ReportPaymentMode.split
              ? plan.total / 2
              : 0,
        cardAmount:
          plan.mode === ReportPaymentMode.offline_card
            ? plan.total
            : plan.mode === ReportPaymentMode.split
              ? plan.total / 2
              : 0,
        bookedByAgentId: agent.id,
        totalQuantity: index === 2 ? 2 : 1,
        ticketsNet: 0,
        reportSyncPending: true,
      },
      create: {
        commonOrder: `BQF-CAFE-${1001 + index}`,
        idempotencyKey: `BQFOOD-CAFE-DEMO-${index + 1}`,
        customerId: plan.customer.id,
        eventId: event.id,
        eventSessionId: session.id,
        status: 'paid',
        paymentStatus: 'paid',
        currency: 'QAR',
        subtotalAmount: plan.total,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: plan.total,
        source: 'pos_cafe',
        locale: 'en',
        paidAt,
        createdAt: paidAt,
        organizationId: organization.id,
        venueId: event.venueId,
        eventSlug: event.slug,
        eventTitle: event.translations[0]?.title ?? event.slug,
        customerName: plan.customer.name,
        customerEmail: plan.customer.email,
        customerPhone: plan.customer.phone,
        paymentMode: plan.mode,
        paymentMethodLabel:
          plan.mode === ReportPaymentMode.split
            ? 'Cash + Card'
            : plan.mode === ReportPaymentMode.offline_cash
              ? 'Cash'
              : 'Card',
        cashAmount:
          plan.mode === ReportPaymentMode.offline_cash
            ? plan.total
            : plan.mode === ReportPaymentMode.split
              ? plan.total / 2
              : 0,
        cardAmount:
          plan.mode === ReportPaymentMode.offline_card
            ? plan.total
            : plan.mode === ReportPaymentMode.split
              ? plan.total / 2
              : 0,
        bookedByAgentId: agent.id,
        totalQuantity: index === 2 ? 2 : 1,
        ticketsNet: 0,
        totalAdmits: 0,
        reportSyncPending: true,
      },
    });
    await prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await prisma.orderItem.create({
      data: {
        orderId: order.id,
        eventId: event.id,
        eventSessionId: session.id,
        itemType: 'cafe_item',
        itemId: plan.item.id,
        displayName: plan.item.title,
        quantity: index === 2 ? 2 : 1,
        unitPrice: plan.total / (index === 2 ? 2 : 1),
        subtotalAmount: plan.total,
        totalAmount: plan.total,
        currency: 'QAR',
        ticketCode: `BQF-CAFE-${1001 + index}-01`,
        visitorType: 'paid',
        admitCount: 0,
        ticketIsCafe: true,
        ticketIsPosOnly: true,
        ticketHideFromOnline: true,
        bookedByAgentId: agent.id,
      },
    });
  }

  const latte = menuItems.get('Cafe Latte')!;
  const croissant = menuItems.get('Butter Croissant')!;
  await prisma.cafeOrder.create({
    data: {
      cafeId: cafe.id,
      eventId: event.id,
      agentUserId: agent.id,
      tableNumber: 2,
      tokenNo: 9001,
      paymentType: 'postpaid',
      status: 'open',
      linesJson: [
        {
          menu_item_id: latte.id,
          title_en: latte.title,
          title_ar: null,
          quantity: 2,
          unit_price: latte.price,
          currency: 'QAR',
          is_kot: latte.isKot,
        },
        {
          menu_item_id: croissant.id,
          title_en: croissant.title,
          title_ar: null,
          quantity: 1,
          unit_price: croissant.price,
          currency: 'QAR',
          is_kot: croissant.isKot,
        },
      ] as Prisma.InputJsonValue,
      customerName: 'Table Two Guest',
      customerEmail: 'table.two@bqfood.test',
      orderTotal: 50,
      discountAmount: 0,
      currency: 'QAR',
    },
  });

  console.log(
    JSON.stringify(
      {
        cafe: { id: cafe.id, name: cafe.name, tables: cafe.tableCount },
        login: { email: AGENT_EMAIL, username: AGENT_USERNAME, password: AGENT_PASSWORD },
        menu: { categories: MENU.length, items: menuItems.size },
        occupied_table: 2,
        customers: customers.map((customer) => ({
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        })),
        promos: PROMO_CODES,
        api: 'http://localhost:4000/api/v2/pos/cafe',
        seeded_at: now.toISOString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
