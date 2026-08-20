import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderItemType, Prisma, PromoTargetType } from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { AdminPromocodeInsightsQueryDto, AdminPromocodeListQueryDto, BulkGenerateAdminPromocodesDto, BulkImportAdminPromocodesDto, BulkPromocodeConfigDto, UpsertAdminPromocodeDto } from './dto/admin-promocode.dto';

const promoInclude = {
  organization: { select: { id: true, name: true, slug: true } },
  targets: true,
  redemptions: { select: { discountAmount: true, createdAt: true } },
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
} satisfies Prisma.PromoCodeInclude;

type PromoRecord = Prisma.PromoCodeGetPayload<{ include: typeof promoInclude }>;

@Injectable()
export class AdminPromocodesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminPromocodeListQueryDto) {
    const now = new Date();
    const where: Prisma.PromoCodeWhereInput = {};
    const conditions: Prisma.PromoCodeWhereInput[] = [];
    if (query.search?.trim()) {
      const search = query.search.trim();
      conditions.push({ OR: [{ code: { contains: search } }, { name: { contains: search, mode: 'insensitive' } }] });
    }
    if (query.organization_id) where.organizationId = query.organization_id;
    if (query.status === 'scheduled') {
      where.status = 'active';
      where.startsAt = { gt: now };
    } else if (query.status === 'expired') {
      conditions.push({ OR: [{ status: 'expired' }, { endsAt: { lt: now } }] });
    } else if (query.status === 'active') {
      where.status = 'active';
      conditions.push(
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      );
    } else if (query.status) {
      where.status = query.status as 'draft' | 'paused';
    }

    if (query.event_id) {
      const event = await this.prisma.event.findUnique({
        where: { id: query.event_id },
        select: { id: true, organizationId: true, ticketTypes: { select: { id: true, variants: { select: { id: true } } } } },
      });
      if (!event) throw new NotFoundException('Event not found.');
      conditions.push({ organizationId: event.organizationId });
      const ticketTypeIds = event.ticketTypes.map((ticket) => ticket.id);
      const variantIds = event.ticketTypes.flatMap((ticket) => ticket.variants.map((variant) => variant.id));
      conditions.push({ OR: [
        { targets: { none: {} } },
        { targets: { some: { targetType: 'event', targetId: event.id } } },
        ...(ticketTypeIds.length ? [{ targets: { some: { targetType: 'ticket_type' as const, targetId: { in: ticketTypeIds } } } }] : []),
        ...(variantIds.length ? [{ targets: { some: { targetType: 'ticket_variant' as const, targetId: { in: variantIds } } } }] : []),
      ] });
    }
    if (conditions.length) where.AND = conditions;

    const page = query.page;
    const perPage = query.per_page;
    const [items, total] = await Promise.all([
      this.prisma.promoCode.findMany({
        where,
        include: promoInclude,
        orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.promoCode.count({ where }),
    ]);

    return {
      success: true,
      data: {
        promocodes: items.map((item) => this.serialize(item)),
        pagination: { page, per_page: perPage, total, total_pages: Math.max(1, Math.ceil(total / perPage)) },
      },
    };
  }

  async options(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!organization) throw new NotFoundException('Organizer not found.');
    const [events, cafes] = await Promise.all([
      this.prisma.event.findMany({
        where: { organizationId, status: { not: 'archived' } },
        include: {
          translations: true,
          ticketTypes: { include: { variants: true }, orderBy: { sortOrder: 'asc' } },
        },
        orderBy: [{ startsAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.cafe.findMany({
        where: { organizationId },
        include: {
          categories: {
            where: { status: 'active' },
            orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
            include: {
              subcategories: {
                where: { status: 'active' },
                include: {
                  items: {
                    where: { status: 'active' },
                    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                    select: { id: true, titleEn: true, titleAr: true, price: true, currency: true },
                  },
                },
              },
            },
          },
        },
        orderBy: [{ name: 'asc' }, { createdAt: 'desc' }],
      }),
    ]);
    return {
      success: true,
      data: {
        organization: { id: organization.id, name: organization.name, slug: organization.slug },
        events: events.map((event) => ({
          id: event.id,
          slug: event.slug,
          title: event.translations.find((item) => item.locale === 'en')?.title ?? event.slug,
          status: event.status,
          ticket_types: event.ticketTypes.map((ticket) => ({
            id: ticket.id,
            title: ticket.title,
            external_key: ticket.externalKey,
            variants: ticket.variants.map((variant) => ({ id: variant.id, name: variant.name, external_key: variant.externalKey })),
          })),
        })),
        cafes: cafes.map((cafe) => ({
          id: cafe.id,
          name: cafe.name,
          status: cafe.status,
          menu_items: cafe.categories.flatMap((category) =>
            category.subcategories.flatMap((sub) =>
              sub.items.map((item) => ({
                id: item.id,
                title: item.titleEn,
                title_ar: item.titleAr,
                price: item.price.toNumber(),
                currency: item.currency,
                category_id: category.id,
                category_title: category.titleEn,
              })),
            ),
          ),
        })),
      },
    };
  }

  async get(id: string) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id }, include: promoInclude });
    if (!promo) throw new NotFoundException('Promocode not found.');
    return { success: true, data: { promocode: this.serialize(promo) } };
  }

  async insights(id: string, query: AdminPromocodeInsightsQueryDto) {
    const promo = await this.prisma.promoCode.findUnique({ where: { id }, include: promoInclude });
    if (!promo) throw new NotFoundException('Promocode not found.');

    const rangeDays = query.range === '7d' ? 7 : query.range === '30d' ? 30 : query.range === '90d' ? 90 : null;
    const from = rangeDays ? new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000) : null;
    const dateWhere = from ? { gte: from } : undefined;
    const search = query.search?.trim();
    const redemptionWhere: Prisma.PromoCodeRedemptionWhereInput = {
      promoCodeId: id,
      ...(dateWhere ? { createdAt: dateWhere } : {}),
      ...(search ? { OR: [
        { customer: { OR: [{ name: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } },
        { order: { commonOrder: { contains: search, mode: 'insensitive' } } },
        { order: { event: { OR: [
          { slug: { contains: search, mode: 'insensitive' } },
          { translations: { some: { title: { contains: search, mode: 'insensitive' } } } },
        ] } } },
      ] } : {}),
    };
    const metricWhere: Prisma.PromoCodeRedemptionWhereInput = {
      promoCodeId: id,
      ...(dateWhere ? { createdAt: dateWhere } : {}),
    };
    const orderWhere: Prisma.OrderWhereInput = {
      promoCodeId: id,
      ...(dateWhere ? { createdAt: dateWhere } : {}),
    };
    const itemTargetIds = promo.targets
      .filter((target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant')
      .map((target) => target.targetId);
    const ticketItemWhere: Prisma.OrderItemWhereInput = {
      itemType: { in: [OrderItemType.ticket_type, OrderItemType.ticket_variant] },
      order: orderWhere,
      ...(itemTargetIds.length ? { itemId: { in: itemTargetIds } } : {}),
    };

    const [aggregate, uniqueCustomers, orderAggregate, eventGroups, ticketGroups, trendRows, redemptions, total] = await Promise.all([
      this.prisma.promoCodeRedemption.aggregate({ where: metricWhere, _count: { _all: true }, _sum: { discountAmount: true }, _avg: { discountAmount: true } }),
      this.prisma.promoCodeRedemption.findMany({ where: metricWhere, distinct: ['customerId'], select: { customerId: true } }),
      this.prisma.order.aggregate({ where: orderWhere, _sum: { totalAmount: true, subtotalAmount: true, discountAmount: true } }),
      this.prisma.order.groupBy({ by: ['eventId'], where: orderWhere, _count: { _all: true }, _sum: { totalAmount: true, discountAmount: true }, orderBy: { _count: { eventId: 'desc' } } }),
      this.prisma.orderItem.groupBy({
        by: ['eventId', 'itemType', 'itemId'],
        where: ticketItemWhere,
        _count: { _all: true },
        _sum: { quantity: true, subtotalAmount: true },
        orderBy: { _sum: { quantity: 'desc' } },
      }),
      this.prisma.promoCodeRedemption.findMany({ where: metricWhere, select: { createdAt: true, discountAmount: true }, orderBy: { createdAt: 'asc' } }),
      this.prisma.promoCodeRedemption.findMany({
        where: redemptionWhere,
        include: {
          customer: { select: { id: true, name: true, email: true } },
          order: { select: {
            id: true, commonOrder: true, status: true, paymentStatus: true, currency: true,
            subtotalAmount: true, discountAmount: true, totalAmount: true, createdAt: true,
            items: {
              where: {
                itemType: { in: [OrderItemType.ticket_type, OrderItemType.ticket_variant] },
                ...(itemTargetIds.length ? { itemId: { in: itemTargetIds } } : {}),
              },
              select: { id: true, itemType: true, itemId: true, displayName: true, quantity: true, unitPrice: true, subtotalAmount: true, currency: true },
              orderBy: { createdAt: 'asc' },
            },
            event: { select: { id: true, slug: true, translations: { where: { locale: 'en' }, select: { title: true }, take: 1 } } },
          } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.per_page,
        take: query.per_page,
      }),
      this.prisma.promoCodeRedemption.count({ where: redemptionWhere }),
    ]);

    const eventIds = [...new Set([...eventGroups.map((item) => item.eventId), ...ticketGroups.map((item) => item.eventId)])];
    const events = eventIds.length ? await this.prisma.event.findMany({
      where: { id: { in: eventIds } },
      select: { id: true, slug: true, translations: { where: { locale: 'en' }, select: { title: true }, take: 1 } },
    }) : [];
    const eventMap = new Map(events.map((event) => [event.id, event]));
    const ticketTypeIds = new Set<string>();
    const variantIds = new Set<string>();
    ticketGroups.forEach((item) => item.itemType === OrderItemType.ticket_type ? ticketTypeIds.add(item.itemId) : variantIds.add(item.itemId));
    redemptions.forEach((redemption) => redemption.order.items.forEach((item) => item.itemType === OrderItemType.ticket_type ? ticketTypeIds.add(item.itemId) : variantIds.add(item.itemId)));
    const [ticketTypes, variants] = await Promise.all([
      ticketTypeIds.size ? this.prisma.ticketType.findMany({ where: { id: { in: Array.from(ticketTypeIds) } }, select: { id: true, title: true, externalKey: true } }) : [],
      variantIds.size ? this.prisma.ticketVariant.findMany({ where: { id: { in: Array.from(variantIds) } }, select: { id: true, name: true, externalKey: true, ticketType: { select: { id: true, title: true, externalKey: true } } } }) : [],
    ]);
    const ticketTypeMap = new Map(ticketTypes.map((item) => [item.id, item]));
    const variantMap = new Map(variants.map((item) => [item.id, item]));
    const daily = new Map<string, { redemptions: number; discount: number }>();
    trendRows.forEach((row) => {
      const day = row.createdAt.toISOString().slice(0, 10);
      const current = daily.get(day) ?? { redemptions: 0, discount: 0 };
      current.redemptions += 1;
      current.discount += row.discountAmount.toNumber();
      daily.set(day, current);
    });

    return {
      success: true,
      data: {
        promocode: this.serialize(promo),
        range: query.range,
        from: from?.toISOString() ?? null,
        metrics: {
          redemptions: aggregate._count._all,
          unique_customers: uniqueCustomers.length,
          discount_granted: Number(aggregate._sum.discountAmount ?? 0),
          average_discount: Number(aggregate._avg.discountAmount ?? 0),
          attributed_revenue: Number(orderAggregate._sum.totalAmount ?? 0),
          pre_discount_sales: Number(orderAggregate._sum.subtotalAmount ?? 0),
        },
        trend: Array.from(daily.entries()).map(([date, value]) => ({
          date,
          redemptions: value.redemptions,
          discount_granted: Math.round(value.discount * 100) / 100,
        })),
        events: eventGroups.map((group) => {
          const event = eventMap.get(group.eventId);
          return {
            id: group.eventId,
            slug: event?.slug ?? '',
            title: event?.translations[0]?.title ?? event?.slug ?? 'Unknown event',
            redemptions: group._count._all,
            discount_granted: Number(group._sum.discountAmount ?? 0),
            attributed_revenue: Number(group._sum.totalAmount ?? 0),
          };
        }),
        ticket_breakdown: ticketGroups.map((group) => {
          const event = eventMap.get(group.eventId);
          const variant = group.itemType === OrderItemType.ticket_variant ? variantMap.get(group.itemId) : null;
          const ticketType = variant?.ticketType ?? ticketTypeMap.get(group.itemId);
          return {
            event: { id: group.eventId, slug: event?.slug ?? '', title: event?.translations[0]?.title ?? event?.slug ?? 'Unknown event' },
            ticket_type: { id: ticketType?.id ?? group.itemId, title: ticketType?.title ?? 'Unknown ticket', external_key: ticketType?.externalKey ?? '' },
            variant: variant ? { id: variant.id, name: variant.name, external_key: variant.externalKey } : null,
            orders: group._count._all,
            quantity: group._sum.quantity ?? 0,
            gross_sales: Number(group._sum.subtotalAmount ?? 0),
          };
        }),
        redemptions: redemptions.map((redemption) => ({
          id: redemption.id,
          redeemed_at: redemption.createdAt.toISOString(),
          discount_amount: redemption.discountAmount.toNumber(),
          customer: redemption.customer,
          order: {
            id: redemption.order.id,
            number: redemption.order.commonOrder,
            status: redemption.order.status,
            payment_status: redemption.order.paymentStatus,
            currency: redemption.order.currency,
            subtotal: redemption.order.subtotalAmount.toNumber(),
            discount: redemption.order.discountAmount.toNumber(),
            total: redemption.order.totalAmount.toNumber(),
            created_at: redemption.order.createdAt.toISOString(),
          },
          event: {
            id: redemption.order.event.id,
            slug: redemption.order.event.slug,
            title: redemption.order.event.translations[0]?.title ?? redemption.order.event.slug,
          },
          tickets: redemption.order.items.map((item) => {
            const variant = item.itemType === OrderItemType.ticket_variant ? variantMap.get(item.itemId) : null;
            const ticketType = variant?.ticketType ?? ticketTypeMap.get(item.itemId);
            return {
              id: item.id,
              item_type: item.itemType,
              ticket_type: { id: ticketType?.id ?? item.itemId, title: ticketType?.title ?? item.displayName, external_key: ticketType?.externalKey ?? '' },
              variant: variant ? { id: variant.id, name: variant.name, external_key: variant.externalKey } : null,
              display_name: item.displayName,
              quantity: item.quantity,
              unit_price: item.unitPrice.toNumber(),
              subtotal: item.subtotalAmount.toNumber(),
              currency: item.currency,
            };
          }),
        })),
        pagination: { page: query.page, per_page: query.per_page, total, total_pages: Math.max(1, Math.ceil(total / query.per_page)) },
      },
    };
  }

  async create(input: UpsertAdminPromocodeDto, adminUserId: string) {
    await this.validate(input);
    try {
      const promo = await this.prisma.promoCode.create({
        data: {
          ...this.toData(input),
          createdByUserId: adminUserId,
          updatedByUserId: adminUserId,
          targets: { create: this.targetRows(input) },
        },
        include: promoInclude,
      });
      return { success: true, data: { promocode: this.serialize(promo) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That promocode is already in use.');
      }
      throw error;
    }
  }

  async bulkGenerate(input: BulkGenerateAdminPromocodesDto, adminUserId: string) {
    const prefix = input.prefix?.trim().toUpperCase() ?? '';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const codes = new Set<string>();
    while (codes.size < input.quantity) {
      const bytes = randomBytes(input.code_length);
      let suffix = '';
      for (let index = 0; index < input.code_length; index += 1) suffix += alphabet[bytes[index] % alphabet.length];
      codes.add(`${prefix}${suffix}`.slice(0, 40));
    }
    return this.bulkCreate(Array.from(codes), input.config, adminUserId, 'generated');
  }

  async bulkImport(input: BulkImportAdminPromocodesDto, adminUserId: string) {
    return this.bulkCreate(input.codes, input.config, adminUserId, 'imported');
  }

  private async bulkCreate(codes: string[], config: BulkPromocodeConfigDto, adminUserId: string, source: 'generated' | 'imported') {
    const normalizedCodes = codes.map((code) => code.trim().toUpperCase());
    if (new Set(normalizedCodes).size !== normalizedCodes.length) throw new BadRequestException('The batch contains duplicate promocodes.');
    const sample: UpsertAdminPromocodeDto = { ...config, code: normalizedCodes[0] };
    await this.validate(sample);
    const existing = await this.prisma.promoCode.findMany({ where: { code: { in: normalizedCodes } }, select: { code: true } });
    if (existing.length) throw new ConflictException(`Already in use: ${existing.slice(0, 5).map((item) => item.code).join(', ')}${existing.length > 5 ? '…' : ''}`);
    const created = await this.prisma.$transaction(normalizedCodes.map((code) => {
      const row: UpsertAdminPromocodeDto = { ...config, code };
      return this.prisma.promoCode.create({
        data: { ...this.toData(row), createdByUserId: adminUserId, updatedByUserId: adminUserId, targets: { create: this.targetRows(row) } },
        include: promoInclude,
      });
    }));
    return { success: true, data: { source, count: created.length, promocodes: created.map((promo) => this.serialize(promo)) } };
  }

  async update(id: string, input: UpsertAdminPromocodeDto, adminUserId: string) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id }, select: { id: true, code: true, _count: { select: { redemptions: true } } } });
    if (!existing) throw new NotFoundException('Promocode not found.');
    if (existing._count.redemptions > 0 && existing.code.toUpperCase() !== input.code.trim().toUpperCase()) {
      throw new BadRequestException('The code cannot be changed after it has been redeemed.');
    }
    await this.validate(input);
    try {
      const promo = await this.prisma.$transaction(async (tx) => {
        await tx.promoCodeTarget.deleteMany({ where: { promoCodeId: id } });
        return tx.promoCode.update({
          where: { id },
          data: {
            ...this.toData(input),
            updatedByUserId: adminUserId,
            targets: { create: this.targetRows(input) },
          },
          include: promoInclude,
        });
      });
      return { success: true, data: { promocode: this.serialize(promo) } };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That promocode is already in use.');
      }
      throw error;
    }
  }

  async setStatus(id: string, status: 'active' | 'paused', adminUserId: string) {
    const existing = await this.prisma.promoCode.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Promocode not found.');
    if (status === 'active' && existing.endsAt && existing.endsAt < new Date()) {
      throw new BadRequestException('Extend the expiry date before activating this promocode.');
    }
    const promo = await this.prisma.promoCode.update({
      where: { id },
      data: { status, updatedByUserId: adminUserId },
      include: promoInclude,
    });
    return { success: true, data: { promocode: this.serialize(promo) } };
  }

  private async validate(input: UpsertAdminPromocodeDto) {
    if (input.discount_type === 'percent' && input.discount_value > 100) {
      throw new BadRequestException('Percentage discounts cannot exceed 100%.');
    }
    if (input.show_in_pos && !input.name?.trim()) {
      throw new BadRequestException('Enter an offer name before showing this promotion in POS.');
    }
    if (
      input.application_mode === 'order_total' &&
      (input.target_type === 'ticket_type' ||
        input.target_type === 'ticket_variant' ||
        input.target_type === 'cafe_menu_item')
    ) {
      throw new BadRequestException(
        'Order-total promocodes can only apply to all organizer events, selected events, or selected cafes.',
      );
    }
    if (input.target_type === 'all' && input.target_ids.length > 0) {
      throw new BadRequestException('All-events promocodes must not include individual targets.');
    }
    if (input.target_type !== 'all' && input.target_ids.length === 0) {
      throw new BadRequestException('Select at least one eligible target.');
    }
    const startsAt = input.starts_at ? new Date(input.starts_at) : null;
    const endsAt = input.ends_at ? new Date(input.ends_at) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('Expiry must be after the start date.');

    const organization = await this.prisma.organization.findFirst({ where: { id: input.organization_id, status: 'active' } });
    if (!organization) throw new BadRequestException('Select an active organizer.');
    if (input.target_type === 'event') {
      const count = await this.prisma.event.count({ where: { id: { in: input.target_ids }, organizationId: input.organization_id } });
      if (count !== input.target_ids.length) throw new BadRequestException('One or more events do not belong to this organizer.');
    }
    if (input.target_type === 'ticket_type') {
      const count = await this.prisma.ticketType.count({ where: { id: { in: input.target_ids }, event: { organizationId: input.organization_id } } });
      if (count !== input.target_ids.length) throw new BadRequestException('One or more ticket types do not belong to this organizer.');
    }
    if (input.target_type === 'ticket_variant') {
      const count = await this.prisma.ticketVariant.count({ where: { id: { in: input.target_ids }, ticketType: { event: { organizationId: input.organization_id } } } });
      if (count !== input.target_ids.length) throw new BadRequestException('One or more ticket variants do not belong to this organizer.');
    }
    if (input.target_type === 'cafe') {
      const count = await this.prisma.cafe.count({ where: { id: { in: input.target_ids }, organizationId: input.organization_id } });
      if (count !== input.target_ids.length) throw new BadRequestException('One or more cafes do not belong to this organizer.');
    }
    if (input.target_type === 'cafe_menu_item') {
      const count = await this.prisma.cafeMenuItem.count({
        where: {
          id: { in: input.target_ids },
          subcategory: { category: { cafe: { organizationId: input.organization_id } } },
        },
      });
      if (count !== input.target_ids.length) {
        throw new BadRequestException('One or more cafe menu items do not belong to this organizer.');
      }
    }
  }

  private toData(input: UpsertAdminPromocodeDto) {
    return {
      organizationId: input.organization_id,
      code: input.code.trim().toUpperCase(),
      name: input.name?.trim() || null,
      description: input.description?.trim() || null,
      showInPos: Boolean(input.show_in_pos),
      status: input.status,
      discountType: input.discount_type,
      discountApplication: input.application_mode,
      discountValue: new Prisma.Decimal(input.discount_value),
      currency: input.discount_type === 'fixed' ? (input.currency ?? 'QAR').toUpperCase() : null,
      startsAt: input.starts_at ? new Date(input.starts_at) : null,
      endsAt: input.ends_at ? new Date(input.ends_at) : null,
      maxRedemptions: input.max_redemptions ?? null,
      maxRedemptionsPerCustomer: input.max_redemptions_per_customer ?? null,
    };
  }

  private targetRows(input: UpsertAdminPromocodeDto) {
    if (input.target_type === 'all') return [];
    return input.target_ids.map((targetId) => ({ targetType: input.target_type as PromoTargetType, targetId }));
  }

  private serialize(promo: PromoRecord) {
    const now = new Date();
    const computedStatus = promo.status === 'active' && promo.startsAt && promo.startsAt > now
      ? 'scheduled'
      : promo.status === 'expired' || (promo.endsAt && promo.endsAt < now)
        ? 'expired'
        : promo.status;
    const targetTypes = [...new Set(promo.targets.map((target) => target.targetType))];
    const targetType = targetTypes.length === 0 ? 'all' : targetTypes.length === 1 ? targetTypes[0] : 'mixed';
    const discountGranted = promo.redemptions.reduce((sum, redemption) => sum + redemption.discountAmount.toNumber(), 0);
    return {
      id: promo.id,
      code: promo.code.toUpperCase(),
      name: promo.name,
      description: promo.description,
      show_in_pos: promo.showInPos,
      organization: promo.organization,
      status: computedStatus,
      stored_status: promo.status,
      discount_type: promo.discountType,
      application_mode: promo.discountApplication,
      discount_value: promo.discountValue.toNumber(),
      currency: promo.currency,
      starts_at: promo.startsAt?.toISOString() ?? null,
      ends_at: promo.endsAt?.toISOString() ?? null,
      max_redemptions: promo.maxRedemptions,
      max_redemptions_per_customer: promo.maxRedemptionsPerCustomer,
      target_type: targetType,
      target_ids: promo.targets.map((target) => target.targetId),
      targets: promo.targets.map((target) => ({ id: target.id, type: target.targetType, target_id: target.targetId })),
      usage: promo.redemptions.length,
      discount_granted: Math.round(discountGranted * 100) / 100,
      created_by: promo.createdBy,
      updated_by: promo.updatedBy,
      created_at: promo.createdAt.toISOString(),
      updated_at: promo.updatedAt.toISOString(),
    };
  }
}
