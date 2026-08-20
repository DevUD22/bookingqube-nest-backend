import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { catalogEventKey } from '../inventory/inventory.scripts';
import { RedisService } from '../redis/redis.service';

export const checkoutEventInclude = {
  translations: true,
  dates: true,
  sessions: {
    include: {
      inventoryItems: true,
    },
  },
  ticketTypes: {
    include: {
      variants: true,
      customizationOptions: true,
      thirdPartyVendor: true,
    },
  },
  addons: {
    include: {
      variants: true,
    },
  },
} satisfies Prisma.EventInclude;

export type CheckoutEventRecord = Prisma.EventGetPayload<{
  include: typeof checkoutEventInclude;
}>;

const CATALOG_TTL_SECONDS = 45;

function money(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return value.toNumber();
}

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getPublishedEventBySlug(slug: string): Promise<CheckoutEventRecord> {
    const client = this.redis.getClient();
    if (client) {
      const cached = await client.get(catalogEventKey(slug));
      if (cached) {
        return this.hydrate(JSON.parse(cached));
      }
    }

    const event = await this.prisma.event.findUnique({
      where: { slug },
      include: checkoutEventInclude,
    });

    if (!event || event.status !== 'published') {
      throw new NotFoundException('Event not found.');
    }

    if (client) {
      await client.set(
        catalogEventKey(slug),
        JSON.stringify(this.serialize(event)),
        'EX',
        CATALOG_TTL_SECONDS,
      );
    }

    return event;
  }

  async invalidateEvent(slug: string): Promise<void> {
    const client = this.redis.getClient();
    if (!client) return;
    await client.del(catalogEventKey(slug));
    this.logger.debug(`Invalidated catalog cache for ${slug}`);
  }

  private serialize(event: CheckoutEventRecord) {
    return {
      ...event,
      ticketTypes: event.ticketTypes.map((ticket) => ({
        ...ticket,
        basePrice: ticket.basePrice === null ? null : money(ticket.basePrice),
        thirdPartyVendor: ticket.thirdPartyVendor
          ? {
              ...ticket.thirdPartyVendor,
              organiserShare: money(ticket.thirdPartyVendor.organiserShare),
              vendorSharePct: money(ticket.thirdPartyVendor.vendorSharePct),
            }
          : null,
        variants: ticket.variants.map((variant) => ({
          ...variant,
          basePrice: money(variant.basePrice),
        })),
        customizationOptions: (ticket.customizationOptions ?? []).map((option) => ({
          ...option,
          price: money(option.price),
        })),
      })),
      addons: event.addons.map((addon) => ({
        ...addon,
        basePrice: addon.basePrice === null ? null : money(addon.basePrice),
        variants: addon.variants.map((variant) => ({
          ...variant,
          basePrice: money(variant.basePrice),
        })),
      })),
    };
  }

  private hydrate(raw: ReturnType<CatalogCacheService['serialize']>): CheckoutEventRecord {
    const toDecimal = (value: number | null) => (value === null ? null : new Prisma.Decimal(value));

    return {
      ...raw,
      startsAt: raw.startsAt ? new Date(raw.startsAt) : null,
      endsAt: raw.endsAt ? new Date(raw.endsAt) : null,
      publishedAt: raw.publishedAt ? new Date(raw.publishedAt) : null,
      createdAt: new Date(raw.createdAt),
      updatedAt: new Date(raw.updatedAt),
      dates: raw.dates.map((date) => ({
        ...date,
        date: new Date(date.date),
        createdAt: new Date(date.createdAt),
        updatedAt: new Date(date.updatedAt),
      })),
      sessions: raw.sessions.map((session) => ({
        ...session,
        startsAt: new Date(session.startsAt),
        endsAt: session.endsAt ? new Date(session.endsAt) : null,
        createdAt: new Date(session.createdAt),
        updatedAt: new Date(session.updatedAt),
        inventoryItems: session.inventoryItems.map((item) => ({
          ...item,
          createdAt: new Date(item.createdAt),
          updatedAt: new Date(item.updatedAt),
        })),
      })),
      ticketTypes: raw.ticketTypes.map((ticket) => ({
        ...ticket,
        basePrice: toDecimal(ticket.basePrice as number | null),
        salesStartAt: ticket.salesStartAt ? new Date(ticket.salesStartAt) : null,
        salesEndAt: ticket.salesEndAt ? new Date(ticket.salesEndAt) : null,
        createdAt: new Date(ticket.createdAt),
        updatedAt: new Date(ticket.updatedAt),
        thirdPartyVendor: ticket.thirdPartyVendor
          ? {
              ...ticket.thirdPartyVendor,
              organiserShare: new Prisma.Decimal(ticket.thirdPartyVendor.organiserShare as number),
              vendorSharePct: new Prisma.Decimal(ticket.thirdPartyVendor.vendorSharePct as number),
              createdAt: new Date(ticket.thirdPartyVendor.createdAt),
              updatedAt: new Date(ticket.thirdPartyVendor.updatedAt),
            }
          : null,
        variants: ticket.variants.map((variant) => ({
          ...variant,
          basePrice: new Prisma.Decimal(variant.basePrice as number),
          createdAt: new Date(variant.createdAt),
          updatedAt: new Date(variant.updatedAt),
        })),
        customizationOptions: (ticket.customizationOptions ?? []).map((option) => ({
          ...option,
          price: new Prisma.Decimal(option.price as number),
        })),
      })),
      addons: raw.addons.map((addon) => ({
        ...addon,
        basePrice: toDecimal(addon.basePrice as number | null),
        createdAt: new Date(addon.createdAt),
        updatedAt: new Date(addon.updatedAt),
        variants: addon.variants.map((variant) => ({
          ...variant,
          basePrice: new Prisma.Decimal(variant.basePrice as number),
          createdAt: new Date(variant.createdAt),
          updatedAt: new Date(variant.updatedAt),
        })),
      })),
    } as CheckoutEventRecord;
  }
}
