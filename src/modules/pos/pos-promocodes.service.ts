import { Injectable, UnauthorizedException } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { ApplyPosPromocodeDto } from './dto/pos-promocode.dto';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

type ResolvedPromoLine = {
  ticketId: string;
  variantId: string | null;
  databaseItemId: string;
  quantity: number;
  subtotal: number;
};

@Injectable()
export class PosPromocodesService {
  constructor(private readonly prisma: PrismaService) {}

  async listOffers(agent: AuthenticatedPosAgent, lang: string) {
    const locale = lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        id: agent.assignmentId,
        userId: agent.id,
        eventId: agent.eventId,
        status: 'active',
        role: { name: 'pos' },
      },
      select: {
        ticketTypeIds: true,
        thirdPartyVendorId: true,
        thirdPartyVendorIds: true,
        event: { select: { id: true, organizationId: true, status: true, currency: true } },
      },
    });
    if (!assignment?.event) throw new UnauthorizedException('Invalid or expired POS session.');
    const event = assignment.event;

    const vendorIds = [
      ...new Set(
        [...assignment.thirdPartyVendorIds, assignment.thirdPartyVendorId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const visibleTickets = await this.prisma.ticketType.findMany({
      where: {
        eventId: event.id,
        status: 'active',
        hideFromPos: false,
        ...(assignment.ticketTypeIds.length ? { id: { in: assignment.ticketTypeIds } } : {}),
        ...(vendorIds.length ? { thirdPartyVendorId: { in: vendorIds } } : {}),
      },
      select: { id: true, variants: { where: { status: 'active' }, select: { id: true } } },
    });
    const visibleProductIds = new Set([
      ...visibleTickets.map((ticket) => ticket.id),
      ...visibleTickets.flatMap((ticket) => ticket.variants.map((variant) => variant.id)),
    ]);
    const now = new Date();
    const promos = await this.prisma.promoCode.findMany({
      where: {
        organizationId: event.organizationId,
        showInPos: true,
        status: 'active',
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      include: { targets: true, _count: { select: { redemptions: true } } },
      orderBy: [{ name: 'asc' }, { code: 'asc' }],
    });

    const offers = promos.filter((promo) => {
      if (promo.maxRedemptions !== null && promo._count.redemptions >= promo.maxRedemptions) {
        return false;
      }
      if (promo.targets.some((target) => target.targetType === 'customer')) return false;
      const eventTargets = promo.targets.filter((target) => target.targetType === 'event');
      if (eventTargets.length && !eventTargets.some((target) => target.targetId === event.id)) {
        return false;
      }
      const productTargets = promo.targets.filter(
        (target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant',
      );
      return productTargets.length === 0 || productTargets.some((target) => visibleProductIds.has(target.targetId));
    }).map((promo) => ({
      id: promo.id,
      name: promo.name?.trim() || promo.code.toUpperCase(),
      description: promo.description ?? '',
      code: promo.code.toUpperCase(),
      discount_type: promo.discountType,
      application_mode: promo.discountApplication,
      discount_value: promo.discountValue.toNumber(),
      currency: promo.currency ?? event.currency,
      discount_label: this.summaryLabel(
        promo.discountType,
        promo.discountApplication,
        promo.discountValue.toNumber(),
        locale,
      ),
      target_type: promo.targets.some(
        (target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant',
      ) ? 'selected_tickets' : 'order',
    }));

    return { success: true, data: { offers } };
  }

  async apply(agent: AuthenticatedPosAgent, input: ApplyPosPromocodeDto, lang: string) {
    const locale = lang.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
    const code = input.code.trim().toUpperCase();
    const assignment = await this.prisma.staffAssignment.findFirst({
      where: {
        id: agent.assignmentId,
        userId: agent.id,
        eventId: agent.eventId,
        status: 'active',
        role: { name: 'pos' },
      },
      select: {
        ticketTypeIds: true,
        thirdPartyVendorId: true,
        thirdPartyVendorIds: true,
        event: { select: { id: true, organizationId: true, status: true, currency: true } },
      },
    });
    if (!assignment?.event) throw new UnauthorizedException('Invalid or expired POS session.');

    if (!input.tickets.length)
      return this.failure(code, locale, 'Select at least one ticket before applying a promo code.');

    const [customer, promo] = await Promise.all([
      this.prisma.user.findFirst({
        where: { id: input.customer_id, status: 'active' },
        select: { id: true },
      }),
      this.prisma.promoCode.findUnique({
        where: { code },
        include: { targets: true, redemptions: true },
      }),
    ]);
    if (!customer)
      return this.failure(code, locale, 'Select a valid customer before applying a promo code.');
    if (!promo || promo.status !== 'active')
      return this.failure(code, locale, 'This promo code is invalid or inactive.');

    const event = assignment.event;
    if (event.status !== 'published' || promo.organizationId !== event.organizationId) {
      return this.failure(code, locale, 'This promo code is not valid for the selected event.');
    }
    if (promo.currency && promo.currency !== event.currency) {
      return this.failure(code, locale, 'This promo code uses a different currency.');
    }

    const now = new Date();
    if (promo.startsAt && promo.startsAt > now)
      return this.failure(code, locale, 'This promo code is not active yet.');
    if (promo.endsAt && promo.endsAt < now)
      return this.failure(code, locale, 'This promo code has expired.');
    if (promo.maxRedemptions !== null && promo.redemptions.length >= promo.maxRedemptions) {
      return this.failure(code, locale, 'This promo code has reached its redemption limit.');
    }
    if (
      promo.maxRedemptionsPerCustomer !== null &&
      promo.redemptions.filter((redemption) => redemption.customerId === customer.id).length >=
        promo.maxRedemptionsPerCustomer
    ) {
      return this.failure(
        code,
        locale,
        'This customer has reached the usage limit for this promo code.',
      );
    }

    const eventTargets = promo.targets.filter((target) => target.targetType === 'event');
    if (eventTargets.length && !eventTargets.some((target) => target.targetId === event.id)) {
      return this.failure(code, locale, 'This promo code is not valid for the selected event.');
    }
    const customerTargets = promo.targets.filter((target) => target.targetType === 'customer');
    if (
      customerTargets.length &&
      !customerTargets.some((target) => target.targetId === customer.id)
    ) {
      return this.failure(code, locale, 'This promo code is not valid for this customer.');
    }

    const resolved = await this.resolveLines(
      {
        ticketTypeIds: assignment.ticketTypeIds,
        thirdPartyVendorId: assignment.thirdPartyVendorId,
        thirdPartyVendorIds: assignment.thirdPartyVendorIds,
        event,
      },
      input,
    );
    if ('message' in resolved) return this.failure(code, locale, resolved.message);

    const itemTargets = promo.targets.filter(
      (target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant',
    );
    const eligible = resolved.filter((line) =>
      itemTargets.length === 0
        ? true
        : itemTargets.some((target) => target.targetId === line.databaseItemId),
    );
    if (!eligible.length)
      return this.failure(code, locale, 'This promo code is not valid for the selected tickets.');

    const breakdown =
      promo.discountApplication === 'order_total'
        ? [
            {
              target_type: 'total_order',
              target_id: event.id,
              discount_applied_per_unit: 0,
              total_item_discount: this.orderDiscount(
                promo.discountType,
                promo.discountValue.toNumber(),
                eligible.reduce((sum, line) => sum + line.subtotal, 0),
              ),
            },
          ]
        : eligible.map((line) => {
            const total =
              promo.discountType === 'percent'
                ? this.round(line.subtotal * (promo.discountValue.toNumber() / 100))
                : this.round(
                    Math.min(line.subtotal, promo.discountValue.toNumber() * line.quantity),
                  );
            return {
              target_type: itemTargets.length ? 'ticket_specific' : 'ticket',
              target_id: line.variantId ?? line.ticketId,
              discount_applied_per_unit: this.round(total / line.quantity),
              total_item_discount: total,
            };
          });
    const totalDiscount = this.round(
      breakdown.reduce((sum, row) => sum + row.total_item_discount, 0),
    );
    if (totalDiscount <= 0)
      return this.failure(code, locale, 'This promo code does not apply a discount.');

    return {
      valid: true,
      code,
      offer_name: promo.name?.trim() || null,
      offer_description: promo.description ?? null,
      discount_type: itemTargets.length ? 'ticket_specific' : 'total_order',
      summary_label: this.summaryLabel(
        promo.discountType,
        promo.discountApplication,
        promo.discountValue.toNumber(),
        locale,
      ),
      total_discount_text: `${event.currency} ${totalDiscount.toFixed(2)}`,
      total_discount_amount: totalDiscount,
      currency: promo.currency ?? event.currency,
      applied_breakdown: breakdown,
    };
  }

  private async resolveLines(
    assignment: {
      ticketTypeIds: string[];
      thirdPartyVendorId: string | null;
      thirdPartyVendorIds: string[];
      event: { id: string };
    },
    input: ApplyPosPromocodeDto,
  ): Promise<ResolvedPromoLine[] | { message: string }> {
    const ticketKeys = [...new Set(input.tickets.map((line) => line.ticket_id))];
    const vendorIds = [
      ...new Set(
        [...assignment.thirdPartyVendorIds, assignment.thirdPartyVendorId].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const tickets = await this.prisma.ticketType.findMany({
      where: {
        eventId: assignment.event.id,
        externalKey: { in: ticketKeys },
        status: 'active',
        hideFromPos: false,
        ...(assignment.ticketTypeIds.length ? { id: { in: assignment.ticketTypeIds } } : {}),
        ...(vendorIds.length ? { thirdPartyVendorId: { in: vendorIds } } : {}),
      },
      include: {
        variants: { where: { status: 'active' } },
        customizationOptions: { where: { status: 'active' } },
      },
    });
    const byKey = new Map(tickets.map((ticket) => [ticket.externalKey, ticket]));
    const resolved: ResolvedPromoLine[] = [];

    for (const line of input.tickets) {
      const ticket = byKey.get(line.ticket_id);
      if (!ticket)
        return { message: `Ticket ${line.ticket_id} is not available to this POS agent.` };
      if (line.variant_id) {
        const variant = ticket.variants.find((item) => item.externalKey === line.variant_id);
        if (!variant) return { message: `Ticket variant ${line.variant_id} is not available.` };
        resolved.push({
          ticketId: ticket.externalKey,
          variantId: variant.externalKey,
          databaseItemId: variant.id,
          quantity: line.quantity,
          subtotal: this.round(variant.basePrice.toNumber() * line.quantity),
        });
        continue;
      }

      let subtotal = (ticket.basePrice?.toNumber() ?? 0) * line.quantity;
      if (ticket.isCustomizable) {
        subtotal = 0;
        const seen = new Set<string>();
        for (const selection of line.customization_options ?? []) {
          if (seen.has(selection.id)) return { message: 'Customization options must be unique.' };
          seen.add(selection.id);
          const option = ticket.customizationOptions.find(
            (item) => item.externalKey === selection.id,
          );
          if (!option) return { message: `Customization ${selection.id} is not available.` };
          const maximum =
            option.maxQtyPerTicket === null ? null : option.maxQtyPerTicket * line.quantity;
          if (maximum !== null && selection.qty > maximum) {
            return {
              message: `Customization ${selection.id} exceeds the maximum quantity of ${maximum}.`,
            };
          }
          subtotal += option.price.toNumber() * selection.qty;
        }
      }
      resolved.push({
        ticketId: ticket.externalKey,
        variantId: null,
        databaseItemId: ticket.id,
        quantity: line.quantity,
        subtotal: this.round(subtotal),
      });
    }
    return resolved;
  }

  private orderDiscount(type: 'percent' | 'fixed', value: number, subtotal: number) {
    return this.round(Math.min(subtotal, type === 'percent' ? subtotal * (value / 100) : value));
  }

  private summaryLabel(
    type: 'percent' | 'fixed',
    application: 'per_ticket' | 'order_total',
    value: number,
    locale: string,
  ) {
    if (type === 'percent') return locale === 'ar' ? `خصم ${value}%` : `${value}% off`;
    return locale === 'ar'
      ? `خصم QAR ${value.toFixed(2)}`
      : `QAR ${value.toFixed(2)} off${application === 'order_total' ? ' the order' : ' each ticket'}`;
  }

  private failure(code: string, locale: string, message: string) {
    const arabic: Record<string, string> = {
      'Select at least one ticket before applying a promo code.':
        'اختر تذكرة واحدة على الأقل قبل تطبيق الرمز الترويجي.',
      'Select a valid customer before applying a promo code.':
        'اختر عميلاً صالحاً قبل تطبيق الرمز الترويجي.',
      'This promo code is invalid or inactive.': 'هذا الرمز الترويجي غير صالح أو غير نشط.',
      'This promo code is not active yet.': 'هذا الرمز الترويجي غير نشط بعد.',
      'This promo code has expired.': 'انتهت صلاحية هذا الرمز الترويجي.',
      'This promo code has reached its redemption limit.':
        'وصل هذا الرمز الترويجي إلى حد الاستخدام.',
      'This customer has reached the usage limit for this promo code.':
        'وصل هذا العميل إلى حد استخدام الرمز الترويجي.',
      'This promo code is not valid for the selected event.':
        'هذا الرمز الترويجي غير صالح للفعالية المحددة.',
      'This promo code uses a different currency.': 'يستخدم هذا الرمز الترويجي عملة مختلفة.',
      'This promo code is not valid for this customer.': 'هذا الرمز الترويجي غير صالح لهذا العميل.',
      'This promo code is not valid for the selected tickets.':
        'هذا الرمز الترويجي غير صالح للتذاكر المحددة.',
      'This promo code does not apply a discount.': 'هذا الرمز لا يطبق أي خصم.',
    };
    return {
      valid: false,
      code: code || undefined,
      message: locale === 'ar' ? (arabic[message] ?? message) : message,
    };
  }

  private round(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
