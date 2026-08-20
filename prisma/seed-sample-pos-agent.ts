/**
 * Seeds a POS agent on the sample family event, scoped to a third-party
 * shareholder (vendor) and that vendor's tickets.
 *
 * Prerequisites: `npm run prisma:seed`
 * Safe to rerun: upserts vendor, tickets, agent user, and staff assignment.
 */
import { PrismaClient } from '@prisma/client';

import { hashPassword } from '../src/common/crypto/password';

const prisma = new PrismaClient();

const EVENT_SLUG = 'sample-family-experience';
const VENDOR_NAME = 'Sample Share Partner';
const POS_EMAIL = 'pos-agent@example.com';
const POS_USERNAME = 'sample_pos';
const POS_PASSWORD = 'password';
const POS_NAME = 'Sample Share Partner POS';

type VariantDef = {
  externalKey: string;
  name: string;
  description: string;
  price: string;
  badge?: string;
  durationMinutes?: number;
  sortOrder: number;
  inventory: number;
};

type CustomizationDef = {
  externalKey: string;
  name: string;
  description: string;
  price: string;
  maxQtyPerTicket: number;
  sortOrder: number;
};

type TicketDef = {
  externalKey: string;
  title: string;
  subtitle: string;
  price: string | null;
  admitCount: number;
  maxQtyPerOrder: number;
  sortOrder: number;
  inventory?: number;
  iconType?: string;
  hasDuration?: boolean;
  durationMinutes?: number;
  isCustomizable?: boolean;
  hideFromOnline?: boolean;
  thirdPartyPlatformName?: string;
  variants?: VariantDef[];
  customizations?: CustomizationDef[];
};

type AddonDef = {
  externalKey: string;
  title: string;
  subtitle: string;
  price: string | null;
  maxQtyPerOrder: number;
  sortOrder: number;
  inventory?: number;
  iconType: string;
  variants?: VariantDef[];
};

const PLATFORM_DEFS = [
  { name: 'Snoonu', accessCode: 'SNOONU-SAMPLE-POS', badgeColor: '#FFF0F2', sortOrder: 1 },
  { name: 'Platinumlist', accessCode: 'PL-SAMPLE-POS', badgeColor: '#E5F4FF', sortOrder: 2 },
] as const;

const TICKET_DEFS: TicketDef[] = [
  {
    externalKey: 'sample-share-adult',
    title: 'Adult General Admission',
    subtitle: 'Standard single-entry ticket · Ages 13+',
    price: '55.000',
    admitCount: 1,
    maxQtyPerOrder: 10,
    sortOrder: 10,
    inventory: 200,
    iconType: 'ticket',
  },
  {
    externalKey: 'sample-share-child',
    title: 'Child Admission',
    subtitle: 'Discounted single-entry ticket · Ages 3–12',
    price: '30.000',
    admitCount: 1,
    maxQtyPerOrder: 10,
    sortOrder: 11,
    inventory: 160,
    iconType: 'child',
  },
  {
    externalKey: 'sample-share-family',
    title: 'Family Pack',
    subtitle: 'One group ticket admitting 2 adults + 2 children',
    price: '180.000',
    admitCount: 4,
    maxQtyPerOrder: 4,
    sortOrder: 12,
    inventory: 100,
    iconType: 'family',
  },
  {
    externalKey: 'sample-share-infant',
    title: 'Infant Entry',
    subtitle: 'Free ticket · Under 3 years',
    price: '0.000',
    admitCount: 1,
    maxQtyPerOrder: 4,
    sortOrder: 13,
    inventory: 100,
    iconType: 'child',
  },
  {
    externalKey: 'sample-share-vip',
    title: 'VIP Experience',
    subtitle: 'Choose a session and access level',
    price: null,
    admitCount: 1,
    maxQtyPerOrder: 6,
    sortOrder: 14,
    iconType: 'star',
    variants: [
      {
        externalKey: 'sample-share-vip-morning',
        name: 'VIP Morning',
        description: 'Premium morning entry',
        price: '95.000',
        badge: 'Best value',
        sortOrder: 1,
        inventory: 50,
      },
      {
        externalKey: 'sample-share-vip-evening',
        name: 'VIP Evening',
        description: 'Premium evening entry',
        price: '115.000',
        badge: 'Popular',
        sortOrder: 2,
        inventory: 40,
      },
      {
        externalKey: 'sample-share-vip-weekend',
        name: 'VIP Weekend',
        description: 'Premium weekend entry with lounge access',
        price: '135.000',
        badge: 'Limited',
        sortOrder: 3,
        inventory: 25,
      },
    ],
  },
  {
    externalKey: 'sample-share-timed',
    title: '60-Minute Play Pass',
    subtitle: 'Duration-based admission for one guest',
    price: '65.000',
    admitCount: 1,
    maxQtyPerOrder: 8,
    sortOrder: 15,
    inventory: 120,
    iconType: 'clock',
    hasDuration: true,
    durationMinutes: 60,
  },
  {
    externalKey: 'sample-share-timed-90',
    title: '90-Minute Adventure Pass',
    subtitle: 'Longer duration-based admission for one guest',
    price: '85.000',
    admitCount: 1,
    maxQtyPerOrder: 8,
    sortOrder: 16,
    inventory: 100,
    iconType: 'clock',
    hasDuration: true,
    durationMinutes: 90,
  },
  {
    externalKey: 'sample-share-custom',
    title: 'Build Your Experience',
    subtitle: 'Admission with optional paid customizations',
    price: null,
    admitCount: 1,
    maxQtyPerOrder: 6,
    sortOrder: 17,
    inventory: 100,
    iconType: 'customize',
    isCustomizable: true,
    customizations: [
      {
        externalKey: 'sample-share-photo-pack',
        name: 'Digital Photo Pack',
        description: 'Digital photos from the experience',
        price: '20.000',
        maxQtyPerTicket: 10,
        sortOrder: 1,
      },
      {
        externalKey: 'sample-share-gift-pack',
        name: 'Souvenir Gift Pack',
        description: 'Branded souvenir pack',
        price: '35.000',
        maxQtyPerTicket: 5,
        sortOrder: 2,
      },
    ],
  },
  {
    externalKey: 'sample-share-pos-exclusive',
    title: 'Walk-in POS Special',
    subtitle: 'POS-exclusive ticket hidden from online sales',
    price: '40.000',
    admitCount: 1,
    maxQtyPerOrder: 5,
    sortOrder: 18,
    inventory: 75,
    iconType: 'pos',
    hideFromOnline: true,
  },
  {
    externalKey: 'sample-share-inflatapass-direct',
    title: 'InflataPass',
    subtitle: 'BookingQube direct-sale admission ticket',
    price: '65.000',
    admitCount: 1,
    maxQtyPerOrder: 10,
    sortOrder: 19,
    inventory: 150,
    iconType: 'ticket',
  },
  {
    externalKey: 'sample-share-e3-platform',
    title: 'InflataPass',
    subtitle: 'Redeem and track an InflataPass sold through Snoonu',
    price: '0.000',
    admitCount: 1,
    maxQtyPerOrder: 10,
    sortOrder: 20,
    inventory: 100,
    iconType: 'third-party',
    hideFromOnline: true,
    thirdPartyPlatformName: 'Snoonu',
  },
  {
    externalKey: 'sample-share-platinumlist-platform',
    title: 'InflataPass',
    subtitle: 'Redeem and track an InflataPass sold through Platinumlist',
    price: '0.000',
    admitCount: 1,
    maxQtyPerOrder: 10,
    sortOrder: 21,
    inventory: 100,
    iconType: 'third-party',
    hideFromOnline: true,
    thirdPartyPlatformName: 'Platinumlist',
  },
];

const ADDON_DEFS: AddonDef[] = [
  {
    externalKey: 'sample-pos-parking',
    title: 'Parking Pass',
    subtitle: 'Single vehicle parking add-on',
    price: '15.000',
    maxQtyPerOrder: 4,
    sortOrder: 10,
    inventory: 100,
    iconType: 'parking',
  },
  {
    externalKey: 'sample-pos-merchandise',
    title: 'Event T-Shirt',
    subtitle: 'Choose a shirt size',
    price: null,
    maxQtyPerOrder: 6,
    sortOrder: 11,
    iconType: 'merchandise',
    variants: [
      {
        externalKey: 'sample-pos-shirt-small',
        name: 'Small',
        description: 'Event T-shirt · Small',
        price: '45.000',
        sortOrder: 1,
        inventory: 30,
      },
      {
        externalKey: 'sample-pos-shirt-medium',
        name: 'Medium',
        description: 'Event T-shirt · Medium',
        price: '45.000',
        badge: 'Popular',
        sortOrder: 2,
        inventory: 40,
      },
      {
        externalKey: 'sample-pos-shirt-large',
        name: 'Large',
        description: 'Event T-shirt · Large',
        price: '50.000',
        sortOrder: 3,
        inventory: 30,
      },
    ],
  },
  {
    externalKey: 'sample-pos-wristband',
    title: 'Souvenir Wristband',
    subtitle: 'Complimentary event wristband',
    price: '0.000',
    maxQtyPerOrder: 5,
    sortOrder: 12,
    inventory: 200,
    iconType: 'gift',
  },
];

async function main() {
  const [event, organization, admin, posRole, organizer] = await Promise.all([
    prisma.event.findUnique({
      where: { slug: EVENT_SLUG },
      select: { id: true, organizationId: true, currency: true, moreOpsConfig: true },
    }),
    prisma.organization.findUnique({ where: { slug: 'bookingqube' } }),
    prisma.user.findUnique({ where: { email: 'admin@bookingqube.test' } }),
    prisma.role.findUnique({ where: { name: 'pos' } }),
    prisma.user.findUnique({ where: { email: 'organizer@bookingqube.test' } }),
  ]);

  if (!event || !organization || !admin || !posRole) {
    throw new Error(
      'Run `npm run prisma:seed` first so the sample event, org, admin, and pos role exist.',
    );
  }

  const session =
    (await prisma.eventSession.findFirst({
      where: { eventId: event.id, status: 'active' },
      orderBy: { startsAt: 'asc' },
    })) ?? null;
  if (!session) {
    throw new Error('Sample event has no active session. Re-run `npm run prisma:seed`.');
  }

  const vendor =
    (await prisma.thirdPartyVendor.findUnique({
      where: {
        eventId_name: { eventId: event.id, name: VENDOR_NAME },
      },
    })) ??
    (await prisma.thirdPartyVendor.create({
      data: {
        eventId: event.id,
        name: VENDOR_NAME,
        isMain: true,
        organiserShare: '40.00',
        vendorSharePct: '60.00',
        isCafe: false,
        ownerName: 'Sample Share Partner W.L.L.',
        ownerPercentageType: 'normal',
        sortOrder: 1,
      },
    }));

  const platformsByName = new Map<string, string>();
  for (const definition of PLATFORM_DEFS) {
    const platform = await prisma.thirdPartyPlatform.upsert({
      where: {
        eventId_name: { eventId: event.id, name: definition.name },
      },
      update: {
        accessCode: definition.accessCode,
        badgeColor: definition.badgeColor,
        sortOrder: definition.sortOrder,
      },
      create: {
        eventId: event.id,
        name: definition.name,
        accessCode: definition.accessCode,
        badgeColor: definition.badgeColor,
        sortOrder: definition.sortOrder,
      },
    });
    platformsByName.set(definition.name, platform.id);
  }

  const ticketGroup =
    (await prisma.ticketGroup.findFirst({
      where: { eventId: event.id, title: 'Share Partner' },
    })) ??
    (await prisma.ticketGroup.create({
      data: {
        eventId: event.id,
        title: 'Share Partner',
        subtitle: 'Third-party shareholder tickets for POS',
        iconType: 'ticket',
        sortOrder: 20,
      },
    }));

  const ticketIds: string[] = [];
  const ticketsByKey = new Map<string, string>();
  const variantsByKey = new Map<string, string>();
  for (const def of TICKET_DEFS) {
    const thirdPartyPlatformId = def.thirdPartyPlatformName
      ? platformsByName.get(def.thirdPartyPlatformName)
      : null;
    if (def.thirdPartyPlatformName && !thirdPartyPlatformId) {
      throw new Error(`Missing seeded platform: ${def.thirdPartyPlatformName}`);
    }

    const ticket = await prisma.ticketType.upsert({
      where: {
        eventId_externalKey: {
          eventId: event.id,
          externalKey: def.externalKey,
        },
      },
      update: {
        ticketGroupId: ticketGroup.id,
        title: def.title,
        subtitle: def.subtitle,
        thirdPartyVendorId: vendor.id,
        isThirdPartyPlatformTicket: Boolean(thirdPartyPlatformId),
        thirdPartyPlatformId,
        iconType: def.iconType ?? 'ticket',
        hasVariants: Boolean(def.variants?.length),
        isCustomizable: Boolean(def.isCustomizable),
        basePrice: def.price,
        currency: event.currency,
        admitCount: def.admitCount,
        maxQtyPerOrder: def.maxQtyPerOrder,
        hasDuration: Boolean(def.hasDuration),
        durationMinutes: def.durationMinutes ?? null,
        hideFromOnline: Boolean(def.hideFromOnline),
        hideFromPos: false,
        status: 'active',
        sortOrder: def.sortOrder,
      },
      create: {
        eventId: event.id,
        ticketGroupId: ticketGroup.id,
        externalKey: def.externalKey,
        title: def.title,
        subtitle: def.subtitle,
        thirdPartyVendorId: vendor.id,
        isThirdPartyPlatformTicket: Boolean(thirdPartyPlatformId),
        thirdPartyPlatformId,
        iconType: def.iconType ?? 'ticket',
        hasVariants: Boolean(def.variants?.length),
        isCustomizable: Boolean(def.isCustomizable),
        basePrice: def.price,
        currency: event.currency,
        admitCount: def.admitCount,
        maxQtyPerOrder: def.maxQtyPerOrder,
        hasDuration: Boolean(def.hasDuration),
        durationMinutes: def.durationMinutes ?? null,
        hideFromOnline: Boolean(def.hideFromOnline),
        hideFromPos: false,
        status: 'active',
        sortOrder: def.sortOrder,
      },
    });
    ticketIds.push(ticket.id);
    ticketsByKey.set(def.externalKey, ticket.id);

    if (!def.variants?.length) {
      const staleVariants = await prisma.ticketVariant.findMany({
        where: { ticketTypeId: ticket.id },
        select: { id: true },
      });
      if (staleVariants.length) {
        await prisma.inventoryItem.deleteMany({
          where: {
            eventSessionId: session.id,
            itemType: 'ticket_variant',
            itemId: { in: staleVariants.map((variant) => variant.id) },
          },
        });
        await prisma.ticketVariant.deleteMany({ where: { ticketTypeId: ticket.id } });
      }
    }

    if (def.variants?.length) {
      for (const variantDef of def.variants) {
        const variant = await prisma.ticketVariant.upsert({
          where: {
            ticketTypeId_externalKey: {
              ticketTypeId: ticket.id,
              externalKey: variantDef.externalKey,
            },
          },
          update: {
            name: variantDef.name,
            description: variantDef.description,
            basePrice: variantDef.price,
            currency: event.currency,
            badge: variantDef.badge ?? null,
            durationMinutes: variantDef.durationMinutes ?? null,
            maxQtyPerOrder: def.maxQtyPerOrder,
            status: 'active',
            sortOrder: variantDef.sortOrder,
          },
          create: {
            ticketTypeId: ticket.id,
            externalKey: variantDef.externalKey,
            name: variantDef.name,
            description: variantDef.description,
            basePrice: variantDef.price,
            currency: event.currency,
            badge: variantDef.badge,
            durationMinutes: variantDef.durationMinutes,
            maxQtyPerOrder: def.maxQtyPerOrder,
            status: 'active',
            sortOrder: variantDef.sortOrder,
          },
        });
        variantsByKey.set(variantDef.externalKey, variant.id);

        await prisma.inventoryItem.upsert({
          where: {
            eventSessionId_itemType_itemId: {
              eventSessionId: session.id,
              itemType: 'ticket_variant',
              itemId: variant.id,
            },
          },
          update: {
            totalQuantity: variantDef.inventory,
            status: 'active',
          },
          create: {
            eventId: event.id,
            eventSessionId: session.id,
            itemType: 'ticket_variant',
            itemId: variant.id,
            totalQuantity: variantDef.inventory,
            soldQuantity: 0,
            heldQuantity: 0,
            status: 'active',
          },
        });
      }
    } else {
      await prisma.inventoryItem.upsert({
        where: {
          eventSessionId_itemType_itemId: {
            eventSessionId: session.id,
            itemType: 'ticket_type',
            itemId: ticket.id,
          },
        },
        update: {
          totalQuantity: def.inventory ?? 0,
          status: 'active',
        },
        create: {
          eventId: event.id,
          eventSessionId: session.id,
          itemType: 'ticket_type',
          itemId: ticket.id,
          totalQuantity: def.inventory ?? 0,
          soldQuantity: 0,
          heldQuantity: 0,
          status: 'active',
        },
      });
    }

    for (const customization of def.customizations ?? []) {
      await prisma.ticketCustomizationOption.upsert({
        where: {
          ticketTypeId_externalKey: {
            ticketTypeId: ticket.id,
            externalKey: customization.externalKey,
          },
        },
        update: {
          name: customization.name,
          description: customization.description,
          price: customization.price,
          currency: event.currency,
          maxQtyPerTicket: customization.maxQtyPerTicket,
          status: 'active',
          sortOrder: customization.sortOrder,
        },
        create: {
          ticketTypeId: ticket.id,
          externalKey: customization.externalKey,
          name: customization.name,
          description: customization.description,
          price: customization.price,
          currency: event.currency,
          maxQtyPerTicket: customization.maxQtyPerTicket,
          status: 'active',
          sortOrder: customization.sortOrder,
        },
      });
    }
  }

  const existingMoreOps =
    event.moreOpsConfig && typeof event.moreOpsConfig === 'object' && !Array.isArray(event.moreOpsConfig)
      ? (event.moreOpsConfig as Record<string, unknown>)
      : {};
  await prisma.event.update({
    where: { id: event.id },
    data: {
      moreOpsConfig: {
        ...existingMoreOps,
        time_extensions: [
          {
            id: 'sample-share-extra-30',
            title: 'Extra 30 Minutes',
            title_ar: '',
            scope: 'ticket',
            minutes: 30,
            price: 20,
            ticket_ids: ['sample-share-timed', 'sample-share-timed-90'],
          },
          {
            id: 'sample-share-extra-60',
            title: 'Extra 60 Minutes',
            title_ar: '',
            scope: 'ticket',
            minutes: 60,
            price: 35,
            ticket_ids: ['sample-share-timed', 'sample-share-timed-90'],
          },
          {
            id: 'sample-social-follow-extra-15',
            title: 'Social Follow Bonus · Extra 15 Minutes',
            title_ar: '',
            scope: 'order',
            minutes: 15,
            price: 0,
            ticket_ids: [],
          },
          {
            id: 'sample-order-extra-30',
            title: 'Whole Order · Extra 30 Minutes',
            title_ar: '',
            scope: 'order',
            minutes: 30,
            price: 30,
            ticket_ids: [],
          },
        ],
      },
    },
  });

  await prisma.thirdPartyPlatform.deleteMany({
    where: {
      eventId: event.id,
      name: { in: ['E3 Test Platform', 'Platinumlist Test Platform'] },
    },
  });

  const addonIds: string[] = [];
  for (const def of ADDON_DEFS) {
    const addon = await prisma.addon.upsert({
      where: {
        eventId_externalKey: {
          eventId: event.id,
          externalKey: def.externalKey,
        },
      },
      update: {
        title: def.title,
        subtitle: def.subtitle,
        iconType: def.iconType,
        forCafeOnly: false,
        hideFromOnline: false,
        hideFromPos: false,
        hasVariants: Boolean(def.variants?.length),
        basePrice: def.price,
        currency: event.currency,
        maxQtyPerOrder: def.maxQtyPerOrder,
        status: 'active',
        sortOrder: def.sortOrder,
      },
      create: {
        eventId: event.id,
        externalKey: def.externalKey,
        title: def.title,
        subtitle: def.subtitle,
        iconType: def.iconType,
        forCafeOnly: false,
        hideFromOnline: false,
        hideFromPos: false,
        hasVariants: Boolean(def.variants?.length),
        basePrice: def.price,
        currency: event.currency,
        maxQtyPerOrder: def.maxQtyPerOrder,
        status: 'active',
        sortOrder: def.sortOrder,
      },
    });
    addonIds.push(addon.id);

    if (def.variants?.length) {
      for (const variantDef of def.variants) {
        const variant = await prisma.addonVariant.upsert({
          where: {
            addonId_externalKey: {
              addonId: addon.id,
              externalKey: variantDef.externalKey,
            },
          },
          update: {
            name: variantDef.name,
            description: variantDef.description,
            basePrice: variantDef.price,
            currency: event.currency,
            badge: variantDef.badge ?? null,
            maxQtyPerOrder: def.maxQtyPerOrder,
            status: 'active',
            sortOrder: variantDef.sortOrder,
          },
          create: {
            addonId: addon.id,
            externalKey: variantDef.externalKey,
            name: variantDef.name,
            description: variantDef.description,
            basePrice: variantDef.price,
            currency: event.currency,
            badge: variantDef.badge,
            maxQtyPerOrder: def.maxQtyPerOrder,
            status: 'active',
            sortOrder: variantDef.sortOrder,
          },
        });

        await prisma.inventoryItem.upsert({
          where: {
            eventSessionId_itemType_itemId: {
              eventSessionId: session.id,
              itemType: 'addon_variant',
              itemId: variant.id,
            },
          },
          update: {
            totalQuantity: variantDef.inventory,
            status: 'active',
          },
          create: {
            eventId: event.id,
            eventSessionId: session.id,
            itemType: 'addon_variant',
            itemId: variant.id,
            totalQuantity: variantDef.inventory,
            soldQuantity: 0,
            heldQuantity: 0,
            status: 'active',
          },
        });
      }
    } else {
      await prisma.inventoryItem.upsert({
        where: {
          eventSessionId_itemType_itemId: {
            eventSessionId: session.id,
            itemType: 'addon',
            itemId: addon.id,
          },
        },
        update: {
          totalQuantity: def.inventory ?? 0,
          status: 'active',
        },
        create: {
          eventId: event.id,
          eventSessionId: session.id,
          itemType: 'addon',
          itemId: addon.id,
          totalQuantity: def.inventory ?? 0,
          soldQuantity: 0,
          heldQuantity: 0,
          status: 'active',
        },
      });
    }
  }

  const upsertPromo = async (definition: {
    code: string;
    name: string;
    description?: string;
    showInPos?: boolean;
    discountType: 'percent' | 'fixed';
    discountApplication: 'per_ticket' | 'order_total';
    discountValue: string;
    maxRedemptionsPerCustomer?: number | null;
    targets: Array<{ targetType: 'event' | 'ticket_type' | 'ticket_variant'; targetId: string }>;
  }) => {
    const promo = await prisma.promoCode.upsert({
      where: { code: definition.code },
      update: {
        organizationId: event.organizationId,
        name: definition.name,
        description: definition.description ?? null,
        showInPos: definition.showInPos ?? true,
        status: 'active',
        discountType: definition.discountType,
        discountApplication: definition.discountApplication,
        discountValue: definition.discountValue,
        currency: event.currency,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2027-12-31T20:59:59.000Z'),
        maxRedemptions: null,
        maxRedemptionsPerCustomer: definition.maxRedemptionsPerCustomer ?? null,
      },
      create: {
        organizationId: event.organizationId,
        code: definition.code,
        name: definition.name,
        description: definition.description ?? null,
        showInPos: definition.showInPos ?? true,
        status: 'active',
        discountType: definition.discountType,
        discountApplication: definition.discountApplication,
        discountValue: definition.discountValue,
        currency: event.currency,
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        endsAt: new Date('2027-12-31T20:59:59.000Z'),
        maxRedemptionsPerCustomer: definition.maxRedemptionsPerCustomer ?? null,
      },
    });
    await prisma.promoCodeTarget.deleteMany({ where: { promoCodeId: promo.id } });
    await prisma.promoCodeTarget.createMany({
      data: definition.targets.map((target) => ({ promoCodeId: promo.id, ...target })),
    });
  };

  await upsertPromo({
    code: 'POS10',
    name: 'Walk-in Offer · 10% Off',
    description: 'General walk-in promotion for this event.',
    discountType: 'percent',
    discountApplication: 'order_total',
    discountValue: '10.000',
    maxRedemptionsPerCustomer: 3,
    targets: [{ targetType: 'event', targetId: event.id }],
  });
  await upsertPromo({
    code: 'ADULT5',
    name: 'Adult Admission · QAR 5 Off',
    description: 'QAR 5 off each eligible adult admission ticket.',
    discountType: 'fixed',
    discountApplication: 'per_ticket',
    discountValue: '5.000',
    targets: [{ targetType: 'ticket_type', targetId: ticketsByKey.get('sample-share-adult')! }],
  });
  await upsertPromo({
    code: 'POSVIP15',
    name: 'VIP Morning · 15% Off',
    description: 'Special rate for the VIP Morning session.',
    discountType: 'percent',
    discountApplication: 'per_ticket',
    discountValue: '15.000',
    targets: [
      { targetType: 'ticket_variant', targetId: variantsByKey.get('sample-share-vip-morning')! },
    ],
  });
  await upsertPromo({
    code: 'CUSTOM20',
    name: 'Build Your Experience · 20% Off',
    description: 'Promotion for Build Your Experience tickets.',
    discountType: 'percent',
    discountApplication: 'per_ticket',
    discountValue: '20.000',
    targets: [{ targetType: 'ticket_type', targetId: ticketsByKey.get('sample-share-custom')! }],
  });
  await upsertPromo({
    code: 'QATAR15',
    name: 'Qatar Airways Staff · 15% Off',
    description: 'Valid Qatar Airways staff ID must be shown at the counter.',
    discountType: 'percent',
    discountApplication: 'order_total',
    discountValue: '15.000',
    targets: [{ targetType: 'event', targetId: event.id }],
  });
  await upsertPromo({
    code: 'TEACHER20',
    name: 'Teachers & School Staff · 20% Off',
    description: 'Valid school or education-sector employee ID is required.',
    discountType: 'percent',
    discountApplication: 'order_total',
    discountValue: '20.000',
    targets: [{ targetType: 'event', targetId: event.id }],
  });
  await upsertPromo({
    code: 'QNB10',
    name: 'QNB Cardholder Offer · 10% Off',
    description: 'Customer must pay using an eligible QNB card.',
    discountType: 'percent',
    discountApplication: 'order_total',
    discountValue: '10.000',
    targets: [{ targetType: 'event', targetId: event.id }],
  });

  const passwordHash = await hashPassword(POS_PASSWORD);
  const posAgent = await prisma.user.upsert({
    where: { email: POS_EMAIL },
    update: {
      name: POS_NAME,
      username: POS_USERNAME,
      passwordHash,
      status: 'active',
    },
    create: {
      email: POS_EMAIL,
      username: POS_USERNAME,
      name: POS_NAME,
      passwordHash,
      status: 'active',
    },
  });

  const managedByUserId = organizer?.id ?? admin.id;
  const existingAssignment = await prisma.staffAssignment.findFirst({
    where: {
      userId: posAgent.id,
      roleId: posRole.id,
      eventId: event.id,
    },
  });

  const assignmentData = {
    organizationId: event.organizationId,
    thirdPartyVendorId: vendor.id,
    thirdPartyVendorIds: [vendor.id],
    ticketTypeIds: ticketIds,
    managedByUserId,
    createdByUserId: admin.id,
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

  console.log('Sample POS agent ready.');
  console.log(`  event:     ${EVENT_SLUG} (${event.id})`);
  console.log(`  vendor:    ${vendor.name} (${vendor.id})`);
  console.log(`  tickets:   ${ticketIds.join(', ')}`);
  console.log(`  platforms: ${PLATFORM_DEFS.map((platform) => platform.name).join(', ')}`);
  console.log(`  addons:    ${addonIds.join(', ')}`);
  console.log('  promos:    POS10, ADULT5, POSVIP15, CUSTOM20, QATAR15, TEACHER20, QNB10');
  console.log(`  agent:     ${POS_EMAIL} / ${POS_PASSWORD}`);
  console.log(`  username:  ${POS_USERNAME}`);
  console.log(`  assignment:${assignment.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
