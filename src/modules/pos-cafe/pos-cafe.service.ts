import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  OrderItemType,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { randomBytes } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import { DailyClosingTotalsService } from '../admin-daily-closings/daily-closing-totals.service';
import {
  assertOfflinePayment,
  createOfflinePaymentLegs,
  normalizeOfflinePayment,
  resolveTenderAmounts,
} from '../checkout/offline-payment.helpers';
import { assertPromoRedemptionCapacity } from '../promocodes/assert-promo-capacity';
import { BookingJobsService } from '../queues/booking-jobs.service';
import { OrderReportingEnricher } from '../reporting/order-reporting.enricher';
import {
  ApplyCafePromocodeDto,
  BookCafeTableDto,
  CafeCustomerSearchQueryDto,
  CafePosReportDto,
  ClearCafeTableDto,
  CreateCafePosCategoryDto,
  CreateCafePosDailyClosingDto,
  CreateCafePosMenuItemDto,
  CreateCafePosSubcategoryDto,
  InstantCafeOrderDto,
  SaveCafePosSalesEntryDto,
} from './dto/pos-cafe.dto';
import { AuthenticatedCafePosAgent } from './strategies/cafe-pos-jwt.strategy';

const UNGROUPED_SUBCATEGORY_TITLE = 'All items';

type CafeLine = {
  menu_item_id: string;
  title_en: string;
  title_ar: string | null;
  quantity: number;
  unit_price: number;
  currency: string;
  is_kot: boolean;
};

@Injectable()
export class PosCafeService {
  private readonly enricher = new OrderReportingEnricher();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: BookingJobsService,
    private readonly closingTotals: DailyClosingTotalsService,
  ) {}

  async getContext(agent: AuthenticatedCafePosAgent) {
    const cafe = await this.requireCafeForAgent(agent);
    return {
      success: true,
      data: {
        cafe: {
          id: cafe.id,
          name: cafe.name,
          table_count: cafe.tableCount,
          status: cafe.status,
          organization_id: cafe.organizationId,
        },
        event: cafe.activeEvent
          ? {
              id: cafe.activeEvent.id,
              slug: cafe.activeEvent.slug,
              title:
                cafe.activeEvent.translations[0]?.title ?? cafe.activeEvent.slug,
            }
          : null,
        agent_id: agent.id,
      },
    };
  }

  async getMenu(agent: AuthenticatedCafePosAgent) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    const categories = await this.prisma.cafeMenuCategory.findMany({
      where: { cafeId: cafe.id, status: 'active' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: {
        imageMedia: { select: { id: true, url: true, altText: true } },
        subcategories: {
          where: { status: 'active' },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
          include: {
            imageMedia: { select: { id: true, url: true, altText: true } },
            items: {
              where: { status: 'active' },
              orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
              include: {
                imageMedia: { select: { id: true, url: true, altText: true } },
                variants: {
                  where: { status: 'active' },
                  orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                },
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      data: {
        cafe_id: cafe.id,
        categories: categories.map((category) => {
          const ungrouped = category.subcategories.find((sub) => sub.isUngrouped);
          const namedSubs = category.subcategories.filter((sub) => !sub.isUngrouped);

          return {
            id: category.id,
            title_en: category.titleEn,
            title_ar: category.titleAr,
            image_media: category.imageMedia,
            /** Items with no real subcategory (stored under the internal ungrouped bucket). */
            items: (ungrouped?.items ?? []).map((item) => this.toMenuItemDto(item)),
            subcategories: namedSubs.map((sub) => ({
              id: sub.id,
              title_en: sub.titleEn,
              title_ar: sub.titleAr,
              image_media: sub.imageMedia,
              items: sub.items.map((item) => this.toMenuItemDto(item)),
            })),
          };
        }),
      },
    };
  }

  async createCategory(
    agent: AuthenticatedCafePosAgent,
    dto: CreateCafePosCategoryDto,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    const category = await this.prisma.$transaction(async (tx) => {
      const created = await tx.cafeMenuCategory.create({
        data: {
          cafeId: cafe.id,
          titleEn: dto.title_en.trim(),
          titleAr: dto.title_ar?.trim() || null,
          sortOrder: dto.sort_order ?? 0,
          status: 'active',
        },
      });
      await tx.cafeMenuSubcategory.create({
        data: {
          categoryId: created.id,
          titleEn: UNGROUPED_SUBCATEGORY_TITLE,
          isUngrouped: true,
          sortOrder: 0,
          status: 'active',
        },
      });
      return created;
    });

    return {
      success: true,
      data: {
        category: {
          id: category.id,
          title_en: category.titleEn,
          title_ar: category.titleAr,
          sort_order: category.sortOrder,
          status: category.status,
        },
      },
      message: 'Menu category created.',
    };
  }

  async createSubcategory(
    agent: AuthenticatedCafePosAgent,
    dto: CreateCafePosSubcategoryDto,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    const category = await this.prisma.cafeMenuCategory.findFirst({
      where: { id: dto.category_id, cafeId: cafe.id },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Menu category not found.');

    const subcategory = await this.prisma.cafeMenuSubcategory.create({
      data: {
        categoryId: category.id,
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        isUngrouped: false,
        sortOrder: dto.sort_order ?? 0,
        status: 'active',
      },
    });

    return {
      success: true,
      data: {
        subcategory: {
          id: subcategory.id,
          category_id: subcategory.categoryId,
          title_en: subcategory.titleEn,
          title_ar: subcategory.titleAr,
          is_ungrouped: subcategory.isUngrouped,
          sort_order: subcategory.sortOrder,
          status: subcategory.status,
        },
      },
      message: 'Menu subcategory created.',
    };
  }

  async createMenuItem(
    agent: AuthenticatedCafePosAgent,
    dto: CreateCafePosMenuItemDto,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    const category = await this.prisma.cafeMenuCategory.findFirst({
      where: { id: dto.category_id, cafeId: cafe.id },
      select: { id: true },
    });
    if (!category) throw new NotFoundException('Menu category not found.');

    let subcategoryId = dto.subcategory_id;
    if (subcategoryId) {
      const sub = await this.prisma.cafeMenuSubcategory.findFirst({
        where: { id: subcategoryId, categoryId: category.id },
        select: { id: true },
      });
      if (!sub) throw new NotFoundException('Menu subcategory not found.');
      subcategoryId = sub.id;
    } else {
      subcategoryId = (await this.ensureUngroupedSubcategory(category.id)).id;
    }

    const item = await this.prisma.cafeMenuItem.create({
      data: {
        subcategoryId,
        titleEn: dto.title_en.trim(),
        titleAr: dto.title_ar?.trim() || null,
        price: new Prisma.Decimal(dto.price),
        currency: dto.currency?.trim() || 'QAR',
        isKot: dto.is_kot ?? false,
        sortOrder: dto.sort_order ?? 0,
        status: 'active',
      },
    });

    return {
      success: true,
      data: {
        item: {
          id: item.id,
          subcategory_id: item.subcategoryId,
          title_en: item.titleEn,
          title_ar: item.titleAr,
          price: Number(item.price),
          currency: item.currency,
          is_kot: item.isKot,
          sort_order: item.sortOrder,
          status: item.status,
        },
      },
      message: 'Menu item created.',
    };
  }

  async getTables(agent: AuthenticatedCafePosAgent) {
    const cafe = await this.requireCafeForAgent(agent);
    if (!cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const openOrders = await this.prisma.cafeOrder.findMany({
      where: {
        cafeId: cafe.id,
        eventId: cafe.activeEventId,
        status: 'open',
      },
      orderBy: [{ tableNumber: 'asc' }, { createdAt: 'asc' }],
    });

    const byTable = new Map<number, typeof openOrders>();
    for (const order of openOrders) {
      const list = byTable.get(order.tableNumber) ?? [];
      list.push(order);
      byTable.set(order.tableNumber, list);
    }

    const tables = [];
    for (let n = 1; n <= cafe.tableCount; n += 1) {
      const orders = byTable.get(n) ?? [];
      tables.push({
        table: n,
        status: orders.length ? 'OCCUPIED' : 'FREE',
        orders: orders.map((order) => this.serializeOpenOrder(order)),
      });
    }

    return {
      success: true,
      data: {
        cafe_id: cafe.id,
        event_id: cafe.activeEventId,
        table_count: cafe.tableCount,
        tables,
      },
    };
  }

  /**
   * Preview a cafe promocode against cart lines (and optional open table cart).
   * Soft-fails with `{ valid: false, message }` — does not mutate orders.
   */
  async applyPromocode(
    agent: AuthenticatedCafePosAgent,
    dto: ApplyCafePromocodeDto,
    lang = 'en',
  ) {
    const locale = lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
    const code = dto.code.trim().toUpperCase();
    const cafe = await this.requireCafeForAgent(agent);
    if (!cafe.activeEventId) {
      return this.promoFailure(code, locale, 'Cafe has no active event.');
    }

    const menuItems = await this.loadMenuItems(
      cafe.id,
      dto.items.map((item) => item.menu_item_id),
    );
    const requestLines: CafeLine[] = [];
    for (const item of dto.items) {
      const menuItem = menuItems.get(item.menu_item_id);
      if (!menuItem) {
        return this.promoFailure(
          code,
          locale,
          `Menu item not found: ${item.menu_item_id}`,
        );
      }
      requestLines.push({
        menu_item_id: menuItem.id,
        title_en: menuItem.titleEn,
        title_ar: menuItem.titleAr,
        quantity: item.quantity,
        unit_price: Number(menuItem.price),
        currency: menuItem.currency,
        is_kot: menuItem.isKot,
      });
    }

    let lines = requestLines;
    if (dto.table_number != null) {
      if (dto.table_number < 1 || dto.table_number > cafe.tableCount) {
        return this.promoFailure(
          code,
          locale,
          `table_number must be between 1 and ${cafe.tableCount}.`,
        );
      }
      const openOrder = await this.prisma.cafeOrder.findFirst({
        where: {
          cafeId: cafe.id,
          eventId: cafe.activeEventId,
          tableNumber: dto.table_number,
          status: 'open',
        },
        orderBy: { createdAt: 'asc' },
      });
      if (openOrder) {
        lines = this.mergeLines(this.parseLines(openOrder.linesJson), requestLines);
      }
    }

    const evaluated = await this.evaluateCafePromo({
      organizationId: cafe.organizationId,
      cafeId: cafe.id,
      lines,
      code,
    });
    if (!evaluated.ok) {
      return this.promoFailure(code, locale, evaluated.message);
    }

    const currency = lines[0]?.currency ?? 'QAR';
    return {
      valid: true,
      code: evaluated.promoCode,
      offer_name: evaluated.offerName,
      offer_description: evaluated.offerDescription,
      discount_type: evaluated.discountTypeLabel,
      summary_label: this.cafePromoSummaryLabel(
        evaluated.discountType,
        evaluated.discountApplication,
        evaluated.discountValue,
        locale,
      ),
      total_discount_text: `${currency} ${evaluated.discountAmount.toFixed(2)}`,
      total_discount_amount: evaluated.discountAmount,
      subtotal_amount: evaluated.subtotal,
      order_total: evaluated.orderTotal,
      currency,
      applied_breakdown: evaluated.breakdown,
    };
  }

  async bookToTable(agent: AuthenticatedCafePosAgent, dto: BookCafeTableDto) {
    const agentId = this.resolveAgentId(agent, dto.agent_id);
    const cafe = await this.requireCafeForAgent(agent);
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }
    if (dto.table_number < 1 || dto.table_number > cafe.tableCount) {
      throw new BadRequestException(
        `table_number must be between 1 and ${cafe.tableCount}.`,
      );
    }

    const menuItems = await this.loadMenuItems(
      cafe.id,
      dto.items.map((item) => item.menu_item_id),
    );
    const newLines: CafeLine[] = dto.items.map((item) => {
      const menuItem = menuItems.get(item.menu_item_id);
      if (!menuItem) {
        throw new BadRequestException(`Menu item not found: ${item.menu_item_id}`);
      }
      return {
        menu_item_id: menuItem.id,
        title_en: menuItem.titleEn,
        title_ar: menuItem.titleAr,
        quantity: item.quantity,
        unit_price: Number(menuItem.price),
        currency: menuItem.currency,
        is_kot: menuItem.isKot,
      };
    });

    const existing = await this.prisma.cafeOrder.findFirst({
      where: {
        cafeId: cafe.id,
        eventId: cafe.activeEventId,
        tableNumber: dto.table_number,
        status: 'open',
      },
      orderBy: { createdAt: 'asc' },
    });

    if (existing) {
      const merged = this.mergeLines(this.parseLines(existing.linesJson), newLines);
      const promoState = await this.resolveCafePromoState({
        organizationId: cafe.organizationId,
        cafeId: cafe.id,
        lines: merged,
        requestedCode: dto.promo_code,
        existingPromoCodeId: existing.promoCodeId,
        existingPromoCode: existing.promoCode,
      });
      const updated = await this.prisma.cafeOrder.update({
        where: { id: existing.id },
        data: {
          linesJson: merged,
          orderTotal: promoState.orderTotal,
          discountAmount: promoState.discountAmount,
          promoCodeId: promoState.promoCodeId,
          promoCode: promoState.promoCode,
          paymentType: dto.payment_type,
          ...(dto.customer_name !== undefined
            ? { customerName: dto.customer_name?.trim() || null }
            : {}),
          ...(dto.customer_email !== undefined
            ? { customerEmail: dto.customer_email?.trim().toLowerCase() || null }
            : {}),
        },
      });
      return {
        success: true,
        data: { order: this.serializeOpenOrder(updated) },
        message: 'Items added to table.',
      };
    }

    const tokenNo = await this.nextToken(cafe.id, cafe.activeEventId);
    const promoState = await this.resolveCafePromoState({
      organizationId: cafe.organizationId,
      cafeId: cafe.id,
      lines: newLines,
      requestedCode: dto.promo_code,
      existingPromoCodeId: null,
      existingPromoCode: null,
    });
    const created = await this.prisma.cafeOrder.create({
      data: {
        cafeId: cafe.id,
        eventId: cafe.activeEventId,
        agentUserId: agentId,
        tableNumber: dto.table_number,
        tokenNo,
        paymentType: dto.payment_type,
        status: 'open',
        linesJson: newLines,
        customerName: dto.customer_name?.trim() || null,
        customerEmail: dto.customer_email?.trim().toLowerCase() || null,
        orderTotal: promoState.orderTotal,
        discountAmount: promoState.discountAmount,
        promoCodeId: promoState.promoCodeId,
        promoCode: promoState.promoCode,
        currency: newLines[0]?.currency ?? 'QAR',
      },
    });

    return {
      success: true,
      data: { order: this.serializeOpenOrder(created) },
      message: 'Table order created.',
    };
  }

  async clearTable(agent: AuthenticatedCafePosAgent, dto: ClearCafeTableDto) {
    const agentId = this.resolveAgentId(agent, dto.agent_id);
    const cafe = await this.requireCafeForAgent(agent);
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const openOrder = await this.prisma.cafeOrder.findFirst({
      where: {
        cafeId: cafe.id,
        eventId: cafe.activeEventId,
        tableNumber: dto.table_number,
        status: 'open',
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!openOrder) {
      throw new NotFoundException('No open order for this table.');
    }

    const lines = this.parseLines(openOrder.linesJson);
    if (!lines.length) {
      throw new BadRequestException('Table order has no items.');
    }

    return this.settleCafeOrder({
      agentId,
      cafe,
      openOrder,
      lines,
      paymentMode: dto.payment_mode,
      splitCashAmount: dto.split_cash_amount,
      splitCardAmount: dto.split_card_amount,
      customerName: dto.customer_name,
      customerEmail: dto.customer_email,
      customerPhone: null,
      customerId: null,
      successMessage: 'Table settled successfully.',
    });
  }

  /**
   * Walk-up / counter sale: book items and settle immediately (cash/card/split).
   * Does not leave an open table cart. Optional table_number is metadata only.
   */
  async checkoutInstant(agent: AuthenticatedCafePosAgent, dto: InstantCafeOrderDto) {
    const agentId = this.resolveAgentId(agent, dto.agent_id);
    const cafe = await this.requireCafeForAgent(agent);
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }
    if (dto.table_number != null) {
      if (dto.table_number < 1 || dto.table_number > cafe.tableCount) {
        throw new BadRequestException(
          `table_number must be between 1 and ${cafe.tableCount}.`,
        );
      }
      const occupied = await this.prisma.cafeOrder.findFirst({
        where: {
          cafeId: cafe.id,
          eventId: cafe.activeEventId,
          tableNumber: dto.table_number,
          status: 'open',
        },
        select: { id: true },
      });
      if (occupied) {
        throw new ConflictException(
          'This table already has an open order. Use tables/book or clear it first.',
        );
      }
    }

    const menuItems = await this.loadMenuItems(
      cafe.id,
      dto.items.map((item) => item.menu_item_id),
    );
    const lines: CafeLine[] = dto.items.map((item) => {
      const menuItem = menuItems.get(item.menu_item_id);
      if (!menuItem) {
        throw new BadRequestException(`Menu item not found: ${item.menu_item_id}`);
      }
      return {
        menu_item_id: menuItem.id,
        title_en: menuItem.titleEn,
        title_ar: menuItem.titleAr,
        quantity: item.quantity,
        unit_price: Number(menuItem.price),
        currency: menuItem.currency,
        is_kot: menuItem.isKot,
      };
    });

    const promoState = await this.resolveCafePromoState({
      organizationId: cafe.organizationId,
      cafeId: cafe.id,
      lines,
      requestedCode: dto.promo_code,
      existingPromoCodeId: null,
      existingPromoCode: null,
    });

    const tokenNo = await this.nextToken(cafe.id, cafe.activeEventId);
    const tableNumber = dto.table_number ?? 0;
    const openOrder = await this.prisma.cafeOrder.create({
      data: {
        cafeId: cafe.id,
        eventId: cafe.activeEventId,
        agentUserId: agentId,
        tableNumber,
        tokenNo,
        paymentType: 'prepaid',
        status: 'open',
        linesJson: lines,
        customerName: dto.customer_name?.trim() || null,
        customerEmail: dto.customer_email?.trim().toLowerCase() || null,
        orderTotal: promoState.orderTotal,
        discountAmount: promoState.discountAmount,
        promoCodeId: promoState.promoCodeId,
        promoCode: promoState.promoCode,
        currency: lines[0]?.currency ?? 'QAR',
      },
    });

    try {
      return await this.settleCafeOrder({
        agentId,
        cafe,
        openOrder,
        lines,
        paymentMode: dto.payment_mode,
        splitCashAmount: dto.split_cash_amount,
        splitCardAmount: dto.split_card_amount,
        customerName: dto.customer_name,
        customerEmail: dto.customer_email,
        customerPhone: dto.customer_phone,
        customerId: dto.customer_id ?? null,
        successMessage: 'Order settled successfully.',
      });
    } catch (error) {
      await this.prisma.cafeOrder
        .deleteMany({ where: { id: openOrder.id, status: 'open' } })
        .catch(() => undefined);
      throw error;
    }
  }

  async searchCustomers(
    agent: AuthenticatedCafePosAgent,
    query: CafeCustomerSearchQueryDto,
  ) {
    await this.requireCafeForAgent(agent, { requirePublished: false });

    const rawQuery = query.q.trim();
    const normalizedEmail = rawQuery.toLowerCase();
    const normalizedPhone = this.tryNormalizePhone(rawQuery);
    const organizationScope: Prisma.UserWhereInput = {
      orders: { some: { organizationId: agent.organizationId } },
    };
    const scopedIdentityFilters: Prisma.UserWhereInput[] = [
      { name: { contains: rawQuery, mode: 'insensitive' } },
      { email: { contains: normalizedEmail, mode: 'insensitive' } },
    ];
    const globalExactFilters: Prisma.UserWhereInput[] = [];
    if (normalizedPhone) {
      globalExactFilters.push({ phone: normalizedPhone });
    }
    if (rawQuery.includes('@')) {
      globalExactFilters.push({ email: normalizedEmail });
    }
    const phoneDigits = rawQuery.replace(/\D/g, '');
    if (phoneDigits.length >= 3) {
      scopedIdentityFilters.push({ phone: { contains: phoneDigits } });
    }

    const customers = await this.prisma.user.findMany({
      where: {
        status: 'active',
        OR: [
          { AND: [organizationScope, { OR: scopedIdentityFilters }] },
          ...globalExactFilters,
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        customerProfile: true,
        orders: {
          where: { organizationId: agent.organizationId },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
        _count: {
          select: {
            orders: { where: { organizationId: agent.organizationId } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });

    const eventId = agent.eventId;
    const rows = await Promise.all(
      customers.map(async (customer) => ({
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email.endsWith('@bookingqube.local') ? null : customer.email,
        age_group: customer.customerProfile?.ageGroup ?? null,
        nationality: customer.customerProfile?.nationality ?? null,
        total_orders: customer._count.orders,
        event_orders: eventId
          ? await this.prisma.order.count({
              where: { customerId: customer.id, eventId },
            })
          : 0,
        last_order_at: customer.orders[0]?.createdAt?.toISOString() ?? null,
      })),
    );

    return { success: true, data: { customers: rows } };
  }

  private async settleCafeOrder(input: {
    agentId: string;
    cafe: Awaited<ReturnType<PosCafeService['requireCafeForAgent']>>;
    openOrder: {
      id: string;
      tableNumber: number;
      tokenNo: number | null;
      paymentType: string;
      currency: string;
      discountAmount: Prisma.Decimal | number;
      promoCodeId: string | null;
      promoCode: string | null;
      customerName: string | null;
      customerEmail: string | null;
    };
    lines: CafeLine[];
    paymentMode: 'cash' | 'card' | 'split';
    splitCashAmount?: number;
    splitCardAmount?: number;
    customerName?: string | null;
    customerEmail?: string | null;
    customerPhone?: string | null;
    customerId?: string | null;
    successMessage: string;
  }) {
    const {
      agentId,
      cafe,
      openOrder,
      lines,
      paymentMode,
      successMessage,
    } = input;
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const subtotalAmount = this.linesTotal(lines);
    const discountAmount = this.roundMoney(Number(openOrder.discountAmount) || 0);
    const totalAmount = this.roundMoney(Math.max(0, subtotalAmount - discountAmount));
    const hasPromo = Boolean(openOrder.promoCodeId && discountAmount > 0);
    const currency = openOrder.currency || lines[0]?.currency || 'QAR';
    const offline = normalizeOfflinePayment(
      {
        mode: paymentMode,
        split_cash_amount: input.splitCashAmount,
        split_card_amount: input.splitCardAmount,
        agent_id: agentId,
      },
      agentId,
    );
    assertOfflinePayment(offline, totalAmount);
    const tender = resolveTenderAmounts(offline, totalAmount, true, false);

    const session = await this.resolveEventSession(cafe.activeEventId);
    const thirdPartyVendorId = await this.ensureCafeThirdPartyVendor(
      cafe.activeEventId,
      cafe.name,
    );

    const customer = await this.resolveCafeCustomer({
      customerId: input.customerId,
      customerName:
        input.customerName?.trim() || openOrder.customerName || 'Cafe Guest',
      customerEmail:
        input.customerEmail?.trim().toLowerCase() ||
        openOrder.customerEmail ||
        null,
      customerPhone: input.customerPhone?.trim() || null,
      guestEmailFallback: `cafe-guest-${openOrder.id}@bookingqube.local`,
    });

    const now = new Date();
    const commonOrder = this.generateCommonOrder();
    const idempotencyKey = `cafe-settle-${openOrder.id}`;
    const eventTitle =
      cafe.activeEvent.translations[0]?.title ?? cafe.activeEvent.slug;
    const eventDate = session.eventDate;

    const enricherLines = lines.map((line) => ({
      itemType: OrderItemType.cafe_item,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      lineTotal: this.roundMoney(line.unit_price * line.quantity),
      admitCount: 0,
      thirdPartyVendorId,
      ticketIsCafe: true,
      ticketIsPosOnly: true,
      ticketHideFromOnline: true,
    }));
    const header = this.enricher.buildHeader(enricherLines, {
      organizationId: cafe.organizationId,
      venueId: cafe.activeEvent.venueId,
      eventSlug: cafe.activeEvent.slug,
      eventTitle,
      eventStartDate: eventDate?.date ?? null,
      eventStartTime: session.displayTime,
      isSummerCamp: cafe.activeEvent.eventType === 'summer_camp',
      customerName: customer.name,
      customerEmail: customer.email,
      customerPhone: customer.phone,
      source: 'pos_cafe',
      hasPromo,
      isPaid: true,
      offlinePaymentMode: offline?.mode ?? 'cash',
    });

    const settled = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.order.findUnique({
        where: { idempotencyKey },
        select: { id: true, commonOrder: true },
      });
      if (existing) {
        await tx.cafeOrder.update({
          where: { id: openOrder.id },
          data: {
            status: 'closed',
            commonOrder: existing.commonOrder,
            settledOrderId: existing.id,
          },
        });
        return existing;
      }

      const order = await tx.order.create({
        data: {
          commonOrder,
          idempotencyKey,
          customerId: customer.id,
          eventId: cafe.activeEventId!,
          eventSessionId: session.id,
          status: 'paid',
          paymentStatus: PaymentStatus.paid,
          currency,
          subtotalAmount,
          discountAmount,
          taxAmount: 0,
          totalAmount,
          promoCodeId: openOrder.promoCodeId,
          promoCode: openOrder.promoCode,
          source: 'pos_cafe',
          locale: 'en',
          metadata: {
            cafe_id: cafe.id,
            cafe_order_id: openOrder.id,
            table_number: openOrder.tableNumber || null,
            token_no: openOrder.tokenNo,
            payment_type: openOrder.paymentType,
            instant_checkout: openOrder.tableNumber === 0,
          },
          paidAt: now,
          organizationId: header.organizationId,
          venueId: header.venueId,
          eventSlug: header.eventSlug,
          eventTitle: header.eventTitle,
          eventStartDate: header.eventStartDate,
          eventStartTime: header.eventStartTime,
          customerName: header.customerName,
          customerEmail: header.customerEmail,
          customerPhone: header.customerPhone,
          customerAgeGroup: header.customerAgeGroup,
          customerGeographicRegion: header.customerGeographicRegion,
          customerGender: header.customerGender,
          paymentMode: header.paymentMode,
          paymentMethodLabel: header.paymentMethodLabel,
          cashAmount: tender.cashAmount,
          cardAmount: tender.cardAmount,
          onlineAmount: tender.onlineAmount,
          compAmount: tender.compAmount,
          bookedByAgentId: agentId,
          ticketsNet: header.ticketsNet,
          addonsNet: header.addonsNet,
          extensionsNet: header.extensionsNet,
          totalQuantity: header.totalQuantity,
          totalAdmits: header.totalAdmits,
          isSummerCamp: header.isSummerCamp,
          reportVersion: 1,
          reportSyncPending: true,
        },
      });

      for (const [index, line] of lines.entries()) {
        const lineSubtotal = this.roundMoney(line.unit_price * line.quantity);
        const lineSnap = this.enricher.classifyLine(
          {
            itemType: OrderItemType.cafe_item,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            lineTotal: lineSubtotal,
            admitCount: 0,
            thirdPartyVendorId,
            ticketIsCafe: true,
            ticketIsPosOnly: true,
            ticketHideFromOnline: true,
          },
          {
            hasPromo,
            source: 'pos_cafe',
            offlinePaymentMode: offline?.mode ?? 'cash',
          },
        );
        await tx.orderItem.create({
          data: {
            orderId: order.id,
            eventId: cafe.activeEventId!,
            eventSessionId: session.id,
            itemType: OrderItemType.cafe_item,
            itemId: line.menu_item_id,
            displayName: line.title_en,
            quantity: line.quantity,
            unitPrice: line.unit_price,
            subtotalAmount: lineSubtotal,
            discountAmount: 0,
            taxAmount: 0,
            totalAmount: lineSubtotal,
            currency: line.currency,
            ticketCode: `${commonOrder}-${String(index + 1).padStart(2, '0')}`,
            visitorType: lineSnap.visitorType,
            thirdPartyVendorId: lineSnap.thirdPartyVendorId,
            admitCount: 0,
            ticketIsCafe: true,
            ticketIsPosOnly: true,
            ticketHideFromOnline: true,
            bookedByAgentId: agentId,
          },
        });
      }

      if (openOrder.promoCodeId && discountAmount > 0) {
        const promo = await tx.promoCode.findUnique({
          where: { id: openOrder.promoCodeId },
          select: {
            id: true,
            maxRedemptions: true,
            maxRedemptionsPerCustomer: true,
          },
        });
        if (promo) {
          await assertPromoRedemptionCapacity(tx, {
            promoCodeId: promo.id,
            customerId: customer.id,
            maxRedemptions: promo.maxRedemptions,
            maxRedemptionsPerCustomer: promo.maxRedemptionsPerCustomer,
          });
        }
        await tx.promoCodeRedemption.create({
          data: {
            promoCodeId: openOrder.promoCodeId,
            orderId: order.id,
            customerId: customer.id,
            discountAmount,
          },
        });
      }

      await createOfflinePaymentLegs(tx, {
        orderId: order.id,
        offline,
        onlinePaid: null,
        totalAmount,
        currency,
        defaultLegType: header.paymentLegType,
        collectedByUserId: agentId,
        now,
      });

      await tx.cafeOrder.update({
        where: { id: openOrder.id },
        data: {
          status: 'closed',
          commonOrder,
          settledOrderId: order.id,
          orderTotal: totalAmount,
          discountAmount,
          customerName: customer.name,
          customerEmail: customer.email,
        },
      });

      return order;
    });

    await this.jobs.enqueueReportSync({ orderId: settled.id, action: 'paid' });

    return {
      success: true,
      data: {
        common_order: settled.commonOrder,
        order_id: settled.id,
        table_number: openOrder.tableNumber || null,
        token_no: openOrder.tokenNo,
        subtotal: subtotalAmount,
        discount_amount: discountAmount,
        promo_code: openOrder.promoCode,
        total_amount: totalAmount,
        currency,
        payment_mode: paymentMode,
      },
      message: successMessage,
    };
  }

  private async resolveCafeCustomer(input: {
    customerId?: string | null;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    guestEmailFallback: string;
  }) {
    if (input.customerId) {
      const existing = await this.prisma.user.findFirst({
        where: { id: input.customerId, status: 'active' },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (!existing) {
        throw new BadRequestException('Customer was not found.');
      }
      const updated = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          name: input.customerName || existing.name,
          ...(input.customerPhone && !existing.phone
            ? { phone: this.tryNormalizePhone(input.customerPhone) ?? undefined }
            : {}),
        },
        select: { id: true, name: true, email: true, phone: true },
      });
      return updated;
    }

    const phone = input.customerPhone
      ? this.tryNormalizePhone(input.customerPhone)
      : null;
    if (phone) {
      const byPhone = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true, name: true, email: true, phone: true },
      });
      if (byPhone) {
        return this.prisma.user.update({
          where: { id: byPhone.id },
          data: { name: input.customerName || byPhone.name },
          select: { id: true, name: true, email: true, phone: true },
        });
      }
    }

    const email = input.customerEmail || input.guestEmailFallback;
    return this.prisma.user.upsert({
      where: { email },
      update: {
        name: input.customerName,
        ...(phone ? { phone } : {}),
      },
      create: {
        email,
        name: input.customerName,
        ...(phone ? { phone } : {}),
      },
      select: { id: true, name: true, email: true, phone: true },
    });
  }

  private tryNormalizePhone(value: string) {
    let compact = value.trim().replace(/[\s().-]/g, '');
    if (!compact) return null;
    if (compact.startsWith('00')) compact = `+${compact.slice(2)}`;
    if (/^\d{8}$/.test(compact)) compact = `+974${compact}`;
    if (/^974\d{8}$/.test(compact)) compact = `+${compact}`;
    return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
  }

  async getReport(agent: AuthenticatedCafePosAgent, dto: CafePosReportDto) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const startDate = this.dateOnly(dto.date);
    const endDate = this.dateOnly(dto.end_date || dto.date);
    if (endDate < startDate) {
      throw new BadRequestException('end_date must be on or after date.');
    }

    const { start } = this.dayBounds(startDate);
    const { end } = this.dayBounds(endDate);

    const menuItemFilter = await this.resolveReportItemFilter(
      cafe.id,
      dto.category_id,
      dto.menu_item_id,
    );

    const orders = await this.prisma.order.findMany({
      where: {
        bookedByAgentId: agent.id,
        eventId: cafe.activeEventId,
        source: 'pos_cafe',
        status: { in: ['paid', 'refunded', 'partially_refunded'] },
        cancelledAt: null,
        OR: [
          { paidAt: { gte: start, lt: end } },
          { AND: [{ paidAt: null }, { createdAt: { gte: start, lt: end } }] },
        ],
        ...(menuItemFilter
          ? {
              items: {
                some: {
                  itemType: OrderItemType.cafe_item,
                  itemId: { in: menuItemFilter },
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        commonOrder: true,
        customerName: true,
        customerEmail: true,
        totalAmount: true,
        cashAmount: true,
        cardAmount: true,
        discountAmount: true,
        totalQuantity: true,
        currency: true,
        paymentMode: true,
        paidAt: true,
        createdAt: true,
        metadata: true,
        items: {
          where: {
            itemType: OrderItemType.cafe_item,
            ...(menuItemFilter ? { itemId: { in: menuItemFilter } } : {}),
          },
          select: {
            itemId: true,
            displayName: true,
            quantity: true,
            totalAmount: true,
            unitPrice: true,
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
    });

    let cashTotal = 0;
    let cardTotal = 0;
    let qty = 0;
    let revenue = 0;
    let discount = 0;

    const bookings = orders.map((order) => {
      const cash = Number(order.cashAmount ?? 0);
      const card = Number(order.cardAmount ?? 0);
      cashTotal += cash;
      cardTotal += card;
      qty += order.totalQuantity ?? 0;
      revenue += Number(order.totalAmount ?? 0);
      discount += Number(order.discountAmount ?? 0);
      const meta =
        order.metadata && typeof order.metadata === 'object'
          ? (order.metadata as Record<string, unknown>)
          : {};
      return {
        id: order.id,
        common_order: order.commonOrder,
        customer_name: order.customerName,
        customer_email: order.customerEmail,
        total_amount: Number(order.totalAmount ?? 0),
        cash_amount: cash,
        card_amount: card,
        discount_amount: Number(order.discountAmount ?? 0),
        quantity: order.totalQuantity ?? 0,
        currency: order.currency,
        payment_mode: order.paymentMode,
        table_number: meta.table_number ?? null,
        paid_at: order.paidAt,
        created_at: order.createdAt,
        items: order.items.map((item) => ({
          menu_item_id: item.itemId,
          title: item.displayName,
          quantity: item.quantity,
          unit_price: Number(item.unitPrice),
          total_amount: Number(item.totalAmount),
        })),
      };
    });

    return {
      success: true,
      data: {
        cafe_id: cafe.id,
        event_id: cafe.activeEventId,
        agent_id: agent.id,
        date: startDate,
        end_date: endDate,
        currency: orders[0]?.currency ?? 'QAR',
        totals: {
          order_count: orders.length,
          qty: this.roundMoney(qty),
          revenue: this.roundMoney(revenue),
          cash: this.roundMoney(cashTotal),
          card: this.roundMoney(cardTotal),
          discount: this.roundMoney(discount),
        },
        bookings,
      },
    };
  }

  async listDailyClosings(
    agent: AuthenticatedCafePosAgent,
    closingForDate?: string,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const date = closingForDate ? this.dateOnly(closingForDate) : undefined;
    const closings = await this.prisma.dailyClosing.findMany({
      where: {
        agentId: agent.id,
        eventId: cafe.activeEventId,
        deletedAt: null,
        ...(date
          ? { closingForDate: this.closingTotals.parseClosingDate(date) }
          : {}),
      },
      orderBy: [{ closingForDate: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });

    const liveDate = date ?? new Date().toISOString().slice(0, 10);
    const expected = await this.closingTotals.expectedForAgentDate(
      agent.id,
      liveDate,
      [cafe.activeEventId],
    );

    return {
      success: true,
      data: {
        cafe_id: cafe.id,
        event_id: cafe.activeEventId,
        agent_id: agent.id,
        live_sales: {
          date: liveDate,
          ...expected,
        },
        closings: closings.map((row) => this.serializeClosing(row)),
      },
    };
  }

  async getSalesEntry(
    agent: AuthenticatedCafePosAgent,
    requestedDate?: string,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }
    const today = this.qatarDateKey();
    const date = requestedDate?.slice(0, 10) || today;
    this.assertSalesEntryDate(date, today);
    const report = await this.findSalesEntry(agent.id, cafe.activeEventId, date);
    return {
      success: true,
      data: this.serializeSalesEntry(
        date,
        today,
        cafe.activeEvent.currency,
        cafe.name,
        report,
      ),
    };
  }

  async saveSalesEntry(
    agent: AuthenticatedCafePosAgent,
    dto: SaveCafePosSalesEntryDto,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId || !cafe.activeEvent) {
      throw new BadRequestException('Cafe has no active event.');
    }
    const today = this.qatarDateKey();
    const date = dto.date.slice(0, 10);
    this.assertSalesEntryDate(date, today);
    const existing = await this.findSalesEntry(agent.id, cafe.activeEventId, date);
    if (existing?.status === 'approved') {
      throw new ConflictException(
        'This sales report has been approved and can no longer be edited.',
      );
    }

    const cash = this.roundMoney(dto.cash_sales);
    const card = this.roundMoney(dto.card_sales);
    const note = dto.note?.trim() || null;
    const user = await this.prisma.user.findUnique({
      where: { id: agent.id },
      select: { name: true },
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      const report = existing
        ? await tx.dailyClosing.update({
            where: { id: existing.id },
            data: {
              receivedCashAmount: cash,
              receivedCardAmount: card,
              totalCashSale: cash,
              totalCardSale: card,
              cashFlowBalance: 0,
              cardFlowBalance: 0,
              qty: dto.total_transactions,
              note,
              status: 'generated',
              rejectReason: null,
            },
          })
        : await tx.dailyClosing.create({
            data: {
              closingCode: `EXT-${date.replace(/-/g, '')}-${agent.id.slice(0, 6).toUpperCase()}`,
              agentId: agent.id,
              eventId: cafe.activeEventId!,
              organizationId: cafe.organizationId,
              closingForDate: this.closingTotals.parseClosingDate(date),
              receivedCashAmount: cash,
              receivedCardAmount: card,
              totalCashSale: cash,
              totalCardSale: card,
              cashFlowBalance: 0,
              cardFlowBalance: 0,
              qty: dto.total_transactions,
              note,
              status: 'generated',
            },
          });

      await tx.dailyClosingStatusHistory.create({
        data: {
          dailyClosingId: report.id,
          closingCode: report.closingCode,
          status: report.status,
          cashFlowBalance: report.cashFlowBalance,
          cardFlowBalance: report.cardFlowBalance,
          receivedCashAmount: report.receivedCashAmount,
          receivedCardAmount: report.receivedCardAmount,
          totalCashSale: report.totalCashSale,
          totalCardSale: report.totalCardSale,
          qty: report.qty,
          note: report.note,
          actorId: agent.id,
          actorName: user?.name || agent.email,
        },
      });
      return report;
    });

    return {
      success: true,
      message: existing ? 'Sales report updated.' : 'Sales report submitted.',
      data: this.serializeSalesEntry(
        date,
        today,
        cafe.activeEvent.currency,
        cafe.name,
        saved,
      ),
    };
  }

  async createDailyClosing(
    agent: AuthenticatedCafePosAgent,
    dto: CreateCafePosDailyClosingDto,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const date = this.dateOnly(dto.closing_for_date);
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('Closing date cannot be in the future.');
    }

    const day = this.closingTotals.parseClosingDate(date);
    const existing = await this.prisma.dailyClosing.findFirst({
      where: {
        agentId: agent.id,
        eventId: cafe.activeEventId,
        closingForDate: day,
        deletedAt: null,
      },
    });
    if (existing) {
      throw new ConflictException(
        `Daily closing already created for ${date} on this cafe event.`,
      );
    }

    const expected = await this.closingTotals.expectedForAgentDate(
      agent.id,
      date,
      [cafe.activeEventId],
    );
    if (expected.order_count <= 0) {
      throw new BadRequestException(`No paid cafe bookings found for ${date}.`);
    }

    const cashFlow = this.roundMoney(
      dto.received_cash_amount - expected.total_cash_sale,
    );
    const cardFlow = this.roundMoney(
      dto.received_card_amount - expected.total_card_sale,
    );
    const closingCode = await this.generateClosingCode(
      expected.organization_id ?? cafe.organizationId,
    );

    const created = await this.prisma.dailyClosing.create({
      data: {
        closingCode,
        agentId: agent.id,
        eventId: cafe.activeEventId,
        organizationId: expected.organization_id ?? cafe.organizationId,
        closingForDate: day,
        receivedCashAmount: dto.received_cash_amount,
        receivedCardAmount: dto.received_card_amount,
        totalCashSale: expected.total_cash_sale,
        totalCardSale: expected.total_card_sale,
        cashFlowBalance: cashFlow,
        cardFlowBalance: cardFlow,
        qty: expected.qty,
        note: dto.note?.trim() || null,
        status: 'generated',
      },
    });

    await this.prisma.dailyClosingStatusHistory.create({
      data: {
        dailyClosingId: created.id,
        closingCode: created.closingCode,
        status: 'generated',
        cashFlowBalance: created.cashFlowBalance,
        cardFlowBalance: created.cardFlowBalance,
        receivedCashAmount: created.receivedCashAmount,
        receivedCardAmount: created.receivedCardAmount,
        totalCashSale: created.totalCashSale,
        totalCardSale: created.totalCardSale,
        qty: created.qty,
        note: created.note,
        actorId: agent.id,
        actorName: agent.email,
      },
    });

    return {
      success: true,
      message: `Daily closing created for ${date}.`,
      data: this.serializeClosing(created),
    };
  }

  async addDailyClosingNote(
    agent: AuthenticatedCafePosAgent,
    closingId: string,
    note: string,
  ) {
    const cafe = await this.requireCafeForAgent(agent, { requirePublished: false });
    if (!cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event.');
    }

    const closing = await this.prisma.dailyClosing.findFirst({
      where: {
        id: closingId,
        agentId: agent.id,
        eventId: cafe.activeEventId,
        deletedAt: null,
      },
    });
    if (!closing) throw new NotFoundException('Daily closing not found.');

    const updated = await this.prisma.dailyClosing.update({
      where: { id: closing.id },
      data: { note: note.trim() },
    });

    return {
      success: true,
      message: 'Note added.',
      data: this.serializeClosing(updated),
    };
  }

  private resolveAgentId(
    agent: AuthenticatedCafePosAgent,
    bodyAgentId?: string,
  ) {
    if (bodyAgentId && bodyAgentId !== agent.id) {
      throw new ForbiddenException('agent_id does not match cafe POS session.');
    }
    return agent.id;
  }

  private async requireCafeForAgent(
    agent: AuthenticatedCafePosAgent,
    options?: { requirePublished?: boolean },
  ) {
    const requirePublished = options?.requirePublished !== false;

    const cafeAgent = await this.prisma.cafePosAgent.findFirst({
      where: {
        id: agent.cafePosAgentId,
        userId: agent.id,
        cafeId: agent.cafeId,
        status: 'active',
      },
      include: {
        cafe: {
          include: {
            activeEvent: {
              select: {
                id: true,
                slug: true,
                venueId: true,
                organizationId: true,
                eventType: true,
                currency: true,
                translations: {
                  where: { locale: 'en' },
                  select: { title: true },
                  take: 1,
                },
              },
            },
          },
        },
      },
    });

    if (!cafeAgent) {
      throw new UnauthorizedException('Cafe POS session is no longer valid.');
    }

    const user = await this.prisma.user.findFirst({
      where: { id: agent.id, status: 'active' },
      select: { id: true },
    });
    if (!user) {
      throw new UnauthorizedException('Cafe POS session is no longer valid.');
    }

    if (requirePublished && cafeAgent.cafe.status !== 'published') {
      throw new BadRequestException('Cafe is not published.');
    }
    if (requirePublished && !cafeAgent.cafe.activeEventId) {
      throw new BadRequestException('Cafe has no active event assigned.');
    }

    return cafeAgent.cafe;
  }

  private toMenuItemDto(item: {
    id: string;
    titleEn: string;
    titleAr: string | null;
    description: string | null;
    price: Prisma.Decimal | number;
    currency: string;
    isKot: boolean;
    imageMedia: { id: string; url: string; altText: string | null } | null;
    variants: Array<{
      id: string;
      titleEn: string;
      titleAr: string | null;
      price: Prisma.Decimal | number;
    }>;
  }) {
    return {
      id: item.id,
      title_en: item.titleEn,
      title_ar: item.titleAr,
      description: item.description,
      price: Number(item.price),
      currency: item.currency,
      is_kot: item.isKot,
      image_media: item.imageMedia,
      has_variants: item.variants.length > 0,
      variants: item.variants.map((variant) => ({
        id: variant.id,
        title_en: variant.titleEn,
        title_ar: variant.titleAr,
        price: Number(variant.price),
      })),
    };
  }

  private async ensureUngroupedSubcategory(categoryId: string) {
    const existing = await this.prisma.cafeMenuSubcategory.findFirst({
      where: { categoryId, isUngrouped: true },
      select: { id: true },
    });
    if (existing) return existing;

    return this.prisma.cafeMenuSubcategory.create({
      data: {
        categoryId,
        titleEn: UNGROUPED_SUBCATEGORY_TITLE,
        isUngrouped: true,
        sortOrder: 0,
        status: 'active',
      },
      select: { id: true },
    });
  }

  private async resolveReportItemFilter(
    cafeId: string,
    categoryId?: string,
    menuItemId?: string,
  ): Promise<string[] | null> {
    if (menuItemId) {
      const item = await this.prisma.cafeMenuItem.findFirst({
        where: {
          id: menuItemId,
          subcategory: { category: { cafeId } },
        },
        select: { id: true },
      });
      if (!item) throw new BadRequestException('menu_item_id is invalid for this cafe.');
      return [item.id];
    }

    if (categoryId) {
      const items = await this.prisma.cafeMenuItem.findMany({
        where: {
          subcategory: { categoryId, category: { cafeId } },
        },
        select: { id: true },
      });
      return items.map((row) => row.id);
    }

    return null;
  }

  private async loadMenuItems(cafeId: string, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    const items = await this.prisma.cafeMenuItem.findMany({
      where: {
        id: { in: uniqueIds },
        status: 'active',
        subcategory: {
          status: 'active',
          category: { cafeId, status: 'active' },
        },
      },
    });
    return new Map(items.map((item) => [item.id, item]));
  }

  private async resolveEventSession(eventId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const session =
      (await this.prisma.eventSession.findFirst({
        where: {
          eventId,
          status: 'active',
          eventDate: { date: { gte: today }, status: 'active' },
        },
        include: { eventDate: true },
        orderBy: [{ eventDate: { date: 'asc' } }, { startsAt: 'asc' }],
      })) ??
      (await this.prisma.eventSession.findFirst({
        where: { eventId, status: 'active' },
        include: { eventDate: true },
        orderBy: [{ eventDate: { date: 'desc' } }, { startsAt: 'desc' }],
      }));

    if (!session) {
      throw new BadRequestException(
        'Assigned event has no active session to attach cafe sales.',
      );
    }
    return session;
  }

  private async ensureCafeThirdPartyVendor(eventId: string, cafeName: string) {
    const name = cafeName.trim() || 'Cafe';

    // Unique key is (event_id, name). Prefer an exact name match even if
    // is_cafe was never flipped (admin/migration vendors often land that way).
    const byName = await this.prisma.thirdPartyVendor.findFirst({
      where: { eventId, name },
      select: { id: true, isCafe: true },
    });
    if (byName) {
      if (!byName.isCafe) {
        await this.prisma.thirdPartyVendor.update({
          where: { id: byName.id },
          data: { isCafe: true },
        });
      }
      return byName.id;
    }

    const byCafeFlag = await this.prisma.thirdPartyVendor.findFirst({
      where: { eventId, isCafe: true },
      select: { id: true },
      orderBy: { sortOrder: 'asc' },
    });
    if (byCafeFlag) return byCafeFlag.id;

    try {
      const created = await this.prisma.thirdPartyVendor.create({
        data: {
          eventId,
          name,
          isMain: false,
          isCafe: true,
          organiserShare: 100,
          vendorSharePct: 0,
          sortOrder: 999,
        },
        select: { id: true },
      });
      return created.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const raced = await this.prisma.thirdPartyVendor.findFirst({
          where: { eventId, name },
          select: { id: true },
        });
        if (raced) return raced.id;
      }
      throw error;
    }
  }

  private async nextToken(cafeId: string, eventId: string) {
    const latest = await this.prisma.cafeOrder.findFirst({
      where: { cafeId, eventId, tokenNo: { not: null } },
      orderBy: { tokenNo: 'desc' },
      select: { tokenNo: true },
    });
    return (latest?.tokenNo ?? 0) + 1;
  }

  private parseLines(raw: Prisma.JsonValue): CafeLine[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => {
      const item = row as Record<string, unknown>;
      return {
        menu_item_id: String(item.menu_item_id),
        title_en: String(item.title_en ?? ''),
        title_ar: item.title_ar == null ? null : String(item.title_ar),
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        currency: String(item.currency ?? 'QAR'),
        is_kot: Boolean(item.is_kot),
      };
    });
  }

  private mergeLines(existing: CafeLine[], incoming: CafeLine[]): CafeLine[] {
    const map = new Map<string, CafeLine>();
    for (const line of [...existing, ...incoming]) {
      const prev = map.get(line.menu_item_id);
      if (prev) {
        map.set(line.menu_item_id, {
          ...prev,
          quantity: prev.quantity + line.quantity,
        });
      } else {
        map.set(line.menu_item_id, { ...line });
      }
    }
    return [...map.values()];
  }

  private linesTotal(lines: CafeLine[]) {
    return this.roundMoney(
      lines.reduce((sum, line) => sum + line.unit_price * line.quantity, 0),
    );
  }

  private serializeOpenOrder(order: {
    id: string;
    cafeId: string;
    eventId: string;
    agentUserId: string;
    tableNumber: number;
    tokenNo: number | null;
    paymentType: string;
    status: string;
    linesJson: Prisma.JsonValue;
    customerName: string | null;
    customerEmail: string | null;
    orderTotal: Prisma.Decimal;
    discountAmount?: Prisma.Decimal | number | null;
    promoCode?: string | null;
    currency: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    const items = this.parseLines(order.linesJson);
    const subtotal = this.linesTotal(items);
    const discountAmount = this.roundMoney(Number(order.discountAmount ?? 0) || 0);
    return {
      id: order.id,
      cafe_id: order.cafeId,
      event_id: order.eventId,
      agent_user_id: order.agentUserId,
      table_number: order.tableNumber,
      token_no: order.tokenNo,
      payment_type: order.paymentType,
      status: order.status,
      items,
      customer_name: order.customerName,
      customer_email: order.customerEmail,
      subtotal,
      discount_amount: discountAmount,
      promo_code: order.promoCode ?? null,
      order_total: Number(order.orderTotal),
      currency: order.currency,
      created_at: order.createdAt,
      updated_at: order.updatedAt,
    };
  }

  private async resolveCafePromoState(input: {
    organizationId: string;
    cafeId: string;
    lines: CafeLine[];
    requestedCode?: string | null;
    existingPromoCodeId?: string | null;
    existingPromoCode?: string | null;
  }): Promise<{
    promoCodeId: string | null;
    promoCode: string | null;
    discountAmount: number;
    orderTotal: number;
  }> {
    const subtotal = this.linesTotal(input.lines);
    const requested = input.requestedCode?.trim().toUpperCase() || null;
    const codeToUse = requested || input.existingPromoCode?.trim().toUpperCase() || null;

    if (!codeToUse) {
      return {
        promoCodeId: null,
        promoCode: null,
        discountAmount: 0,
        orderTotal: subtotal,
      };
    }

    const evaluated = await this.evaluateCafePromo({
      organizationId: input.organizationId,
      cafeId: input.cafeId,
      lines: input.lines,
      code: codeToUse,
    });
    if (!evaluated.ok) {
      throw new BadRequestException(evaluated.message);
    }
    return {
      promoCodeId: evaluated.promoCodeId,
      promoCode: evaluated.promoCode,
      discountAmount: evaluated.discountAmount,
      orderTotal: evaluated.orderTotal,
    };
  }

  private async evaluateCafePromo(input: {
    organizationId: string;
    cafeId: string;
    lines: CafeLine[];
    code: string;
  }): Promise<
    | {
        ok: true;
        promoCodeId: string;
        promoCode: string;
        offerName: string | null;
        offerDescription: string | null;
        discountType: string;
        discountApplication: string;
        discountValue: number;
        discountTypeLabel: string;
        subtotal: number;
        discountAmount: number;
        orderTotal: number;
        breakdown: Array<{
          target_type: string;
          target_id: string;
          discount_applied_per_unit: number;
          total_item_discount: number;
        }>;
      }
    | { ok: false; message: string }
  > {
    const subtotal = this.linesTotal(input.lines);
    if (!input.lines.length) {
      return { ok: false, message: 'Select at least one menu item before applying a promo code.' };
    }

    const promo = await this.prisma.promoCode.findUnique({
      where: { code: input.code },
      include: { targets: true, redemptions: true },
    });
    if (!promo || promo.status !== 'active') {
      return { ok: false, message: 'This promo code is invalid or inactive.' };
    }
    if (promo.organizationId !== input.organizationId) {
      return { ok: false, message: 'This promo code is not valid for this cafe.' };
    }

    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) {
      return { ok: false, message: 'This promo code is not active yet.' };
    }
    if (promo.endsAt && promo.endsAt < now) {
      return { ok: false, message: 'This promo code has expired.' };
    }
    if (promo.maxRedemptions !== null && promo.redemptions.length >= promo.maxRedemptions) {
      return { ok: false, message: 'This promo code has reached its redemption limit.' };
    }

    const cafeTargets = promo.targets.filter((t) => t.targetType === 'cafe');
    const menuTargets = promo.targets.filter((t) => t.targetType === 'cafe_menu_item');
    const ticketTargets = promo.targets.filter(
      (t) =>
        t.targetType === 'event' ||
        t.targetType === 'ticket_type' ||
        t.targetType === 'ticket_variant',
    );

    if (cafeTargets.length === 0 && menuTargets.length === 0) {
      if (ticketTargets.length > 0 || promo.targets.length === 0) {
        return {
          ok: false,
          message: 'This promo code is for events/tickets, not cafe orders.',
        };
      }
      return { ok: false, message: 'This promo code is not valid for this cafe.' };
    }

    if (cafeTargets.length > 0 && !cafeTargets.some((t) => t.targetId === input.cafeId)) {
      return { ok: false, message: 'This promo code is not valid for this cafe.' };
    }

    const menuTargetIds = new Set(menuTargets.map((t) => t.targetId));
    const eligibleLines =
      menuTargets.length === 0
        ? input.lines
        : input.lines.filter((line) => menuTargetIds.has(line.menu_item_id));

    if (eligibleLines.length === 0) {
      return {
        ok: false,
        message: 'This promo code is not valid for the selected menu items.',
      };
    }

    let discountAmount = 0;
    let breakdown: Array<{
      target_type: string;
      target_id: string;
      discount_applied_per_unit: number;
      total_item_discount: number;
    }>;

    if (promo.discountApplication === 'order_total') {
      const eligibleSubtotal = this.linesTotal(eligibleLines);
      discountAmount = this.calculateCafeOrderDiscount(promo, eligibleSubtotal);
      breakdown = [
        {
          target_type: 'total_order',
          target_id: input.cafeId,
          discount_applied_per_unit: 0,
          total_item_discount: discountAmount,
        },
      ];
    } else {
      breakdown = eligibleLines.map((line) => {
        const perUnit = this.calculateCafeDiscountPerUnit(promo, line.unit_price);
        const total = this.roundMoney(perUnit * line.quantity);
        return {
          target_type: menuTargets.length ? 'menu_item_specific' : 'menu_item',
          target_id: line.menu_item_id,
          discount_applied_per_unit: perUnit,
          total_item_discount: total,
        };
      });
      discountAmount = this.roundMoney(
        breakdown.reduce((sum, row) => sum + row.total_item_discount, 0),
      );
    }

    if (discountAmount <= 0) {
      return { ok: false, message: 'This promo code does not apply a discount.' };
    }

    discountAmount = this.roundMoney(Math.min(subtotal, discountAmount));
    return {
      ok: true,
      promoCodeId: promo.id,
      promoCode: promo.code.toUpperCase(),
      offerName: promo.name?.trim() || null,
      offerDescription: promo.description ?? null,
      discountType: promo.discountType,
      discountApplication: promo.discountApplication,
      discountValue: promo.discountValue.toNumber(),
      discountTypeLabel: menuTargets.length ? 'menu_item_specific' : 'total_order',
      subtotal,
      discountAmount,
      orderTotal: this.roundMoney(Math.max(0, subtotal - discountAmount)),
      breakdown,
    };
  }

  private cafePromoSummaryLabel(
    type: string,
    application: string,
    value: number,
    locale: string,
  ) {
    if (type === 'percent') return locale === 'ar' ? `خصم ${value}%` : `${value}% off`;
    return locale === 'ar'
      ? `خصم QAR ${value.toFixed(2)}`
      : `QAR ${value.toFixed(2)} off${application === 'order_total' ? ' the order' : ' each item'}`;
  }

  private promoFailure(code: string, locale: string, message: string) {
    const arabic: Record<string, string> = {
      'Cafe has no active event.': 'لا توجد فعالية نشطة لهذا المقهى.',
      'Select at least one menu item before applying a promo code.':
        'اختر عنصراً واحداً على الأقل قبل تطبيق الرمز الترويجي.',
      'This promo code is invalid or inactive.': 'هذا الرمز الترويجي غير صالح أو غير نشط.',
      'This promo code is not active yet.': 'هذا الرمز الترويجي غير نشط بعد.',
      'This promo code has expired.': 'انتهت صلاحية هذا الرمز الترويجي.',
      'This promo code has reached its redemption limit.':
        'وصل هذا الرمز الترويجي إلى حد الاستخدام.',
      'This promo code is not valid for this cafe.': 'هذا الرمز الترويجي غير صالح لهذا المقهى.',
      'This promo code is for events/tickets, not cafe orders.':
        'هذا الرمز الترويجي للفعاليات/التذاكر وليس لطلبات المقهى.',
      'This promo code is not valid for the selected menu items.':
        'هذا الرمز الترويجي غير صالح للعناصر المحددة.',
      'This promo code does not apply a discount.': 'هذا الرمز لا يطبق أي خصم.',
    };
    return {
      valid: false as const,
      code: code || undefined,
      message: locale === 'ar' ? (arabic[message] ?? message) : message,
    };
  }

  private calculateCafeDiscountPerUnit(
    promo: {
      discountType: string;
      discountValue: Prisma.Decimal;
    },
    unitPrice: number,
  ) {
    if (promo.discountType === 'percent') {
      const percent = promo.discountValue.toNumber();
      return this.roundMoney(Math.min(unitPrice, unitPrice * (percent / 100)));
    }
    return this.roundMoney(Math.min(unitPrice, promo.discountValue.toNumber()));
  }

  private calculateCafeOrderDiscount(
    promo: {
      discountType: string;
      discountValue: Prisma.Decimal;
    },
    eligibleSubtotal: number,
  ) {
    const value = promo.discountValue.toNumber();
    return this.roundMoney(
      Math.min(
        eligibleSubtotal,
        promo.discountType === 'percent'
          ? eligibleSubtotal * (value / 100)
          : value,
      ),
    );
  }

  private qatarDateKey(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Qatar',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((item) => item.type === type)?.value ?? '';
    return `${part('year')}-${part('month')}-${part('day')}`;
  }

  private assertSalesEntryDate(date: string, today: string) {
    this.dateOnly(date);
    if (date > today) {
      throw new BadRequestException('Sales date cannot be in the future.');
    }
  }

  private findSalesEntry(agentId: string, eventId: string, date: string) {
    return this.prisma.dailyClosing.findFirst({
      where: {
        agentId,
        eventId,
        closingForDate: this.closingTotals.parseClosingDate(date),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private serializeSalesEntry(
    date: string,
    today: string,
    currency: string,
    eventTitle: string,
    report: Awaited<ReturnType<PosCafeService['findSalesEntry']>>,
  ) {
    const cash = Number(report?.totalCashSale ?? 0);
    const card = Number(report?.totalCardSale ?? 0);
    return {
      date,
      today,
      currency,
      event_title: eventTitle,
      has_report: Boolean(report),
      can_edit: !report || report.status !== 'approved',
      report: report
        ? {
            id: report.id,
            code: report.closingCode,
            status: report.status,
            cash_sales: cash,
            card_sales: card,
            total_sales: this.roundMoney(cash + card),
            total_transactions: report.qty,
            note: report.note,
            submitted_at: report.createdAt.toISOString(),
            updated_at: report.updatedAt.toISOString(),
          }
        : null,
    };
  }

  private serializeClosing(closing: {
    id: string;
    closingCode: string;
    agentId: string;
    eventId: string;
    organizationId: string | null;
    closingForDate: Date;
    receivedCashAmount: Prisma.Decimal;
    receivedCardAmount: Prisma.Decimal;
    totalCashSale: Prisma.Decimal;
    totalCardSale: Prisma.Decimal;
    cashFlowBalance: Prisma.Decimal;
    cardFlowBalance: Prisma.Decimal;
    qty: number;
    note: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: closing.id,
      closing_code: closing.closingCode,
      agent_id: closing.agentId,
      event_id: closing.eventId,
      organization_id: closing.organizationId,
      closing_for_date: closing.closingForDate.toISOString().slice(0, 10),
      received_cash_amount: Number(closing.receivedCashAmount),
      received_card_amount: Number(closing.receivedCardAmount),
      total_cash_sale: Number(closing.totalCashSale),
      total_card_sale: Number(closing.totalCardSale),
      cash_flow_balance: Number(closing.cashFlowBalance),
      card_flow_balance: Number(closing.cardFlowBalance),
      qty: closing.qty,
      note: closing.note,
      status: closing.status,
      created_at: closing.createdAt,
      updated_at: closing.updatedAt,
    };
  }

  private async generateClosingCode(organizationId: string | null) {
    let prefix = 'CC';
    if (organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
      const source = (org?.slug || org?.name || 'CC').replace(/[^a-zA-Z0-9]/g, '');
      prefix = (source.slice(0, 2) || 'CC').toUpperCase();
    }
    return `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;
  }

  private dateOnly(value: string) {
    const trimmed = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException('Date must be YYYY-MM-DD.');
    }
    const parsed = new Date(`${trimmed}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException('Invalid date.');
    }
    return trimmed;
  }

  private dayBounds(dateStr: string): { start: Date; end: Date } {
    const start = new Date(`${dateStr}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  private generateCommonOrder() {
    return `BQ-CAFE-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 1000) / 1000;
  }
}
