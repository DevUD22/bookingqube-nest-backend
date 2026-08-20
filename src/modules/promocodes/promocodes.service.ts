import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  PromoApplyFailureDto,
  PromoApplyRequestDto,
  PromoApplyResponseDto,
  PromoSelectedTicketDto,
} from './dto/promo-apply.dto';

const promoInclude = {
  targets: true,
  redemptions: true,
} satisfies Prisma.PromoCodeInclude;

const promoEventInclude = {
  ticketTypes: {
    include: {
      variants: true,
    },
  },
} satisfies Prisma.EventInclude;

type PromoRecord = Prisma.PromoCodeGetPayload<{
  include: typeof promoInclude;
}>;

type PromoEventRecord = Prisma.EventGetPayload<{
  include: typeof promoEventInclude;
}>;

@Injectable()
export class PromocodesService {
  constructor(private readonly prisma: PrismaService) {}

  async applyPromocode(
    input: PromoApplyRequestDto,
    lang: string,
  ): Promise<PromoApplyResponseDto | PromoApplyFailureDto> {
    const locale = this.normalizeLocale(lang);
    const code = input.code?.trim().toUpperCase() ?? '';

    if (!code) {
      return this.failure(code, locale, 'Promo code is required.');
    }

    if (!input.event_slug) {
      return this.failure(code, locale, 'Event is required.');
    }

    const selectedTickets = this.normalizeSelectedTickets(input.selected_tickets);
    if (selectedTickets.length === 0) {
      return this.failure(code, locale, 'Select at least one ticket before applying a promo code.');
    }

    const [promo, event] = await Promise.all([
      this.prisma.promoCode.findUnique({
        where: { code },
        include: promoInclude,
      }),
      this.prisma.event.findUnique({
        where: { slug: input.event_slug },
        include: promoEventInclude,
      }),
    ]);

    if (!promo || promo.status !== 'active') {
      return this.failure(code, locale, 'This promo code is invalid or inactive.');
    }

    if (!event || event.status !== 'published') {
      return this.failure(code, locale, 'This promo code is not valid for the selected event.');
    }

    if (promo.organizationId !== event.organizationId) {
      return this.failure(code, locale, 'This promo code is not valid for the selected event.');
    }

    const now = new Date();
    if (promo.startsAt && promo.startsAt > now) {
      return this.failure(code, locale, 'This promo code is not active yet.');
    }

    if (promo.endsAt && promo.endsAt < now) {
      return this.failure(code, locale, 'This promo code has expired.');
    }

    if (promo.maxRedemptions !== null && promo.redemptions.length >= promo.maxRedemptions) {
      return this.failure(code, locale, 'This promo code has reached its redemption limit.');
    }

    if (!this.isPromoTargetedToEvent(promo, event.id)) {
      return this.failure(code, locale, 'This promo code is not valid for the selected event.');
    }

    const eligibleTickets = this.getEligibleTickets(promo, selectedTickets, event);
    if (eligibleTickets.length === 0) {
      return this.failure(code, locale, 'This promo code is not valid for the selected tickets.');
    }

    const breakdown = promo.discountApplication === 'order_total'
      ? [{
          target_type: 'total_order',
          target_id: event.id,
          discount_applied_per_unit: 0,
          total_item_discount: this.calculateOrderDiscount(promo, eligibleTickets.reduce((sum, ticket) => sum + ticket.unit_price * ticket.quantity, 0)),
        }]
      : eligibleTickets.map((ticket) => {
          const discountPerUnit = this.calculateDiscountPerUnit(promo, ticket.unit_price);
          return {
            target_type: this.hasTicketSpecificTarget(promo) ? 'ticket_specific' : 'ticket',
            target_id: ticket.variant_id ?? ticket.ticket_id,
            discount_applied_per_unit: discountPerUnit,
            total_item_discount: this.roundMoney(discountPerUnit * ticket.quantity),
          };
        });
    const totalDiscount = this.roundMoney(
      breakdown.reduce((sum, item) => sum + item.total_item_discount, 0),
    );

    if (totalDiscount <= 0) {
      return this.failure(code, locale, 'This promo code does not apply a discount.');
    }

    const summaryLabel = this.getSummaryLabel(promo, locale);

    return {
      valid: true,
      code: promo.code.toUpperCase(),
      discount_type: this.hasTicketSpecificTarget(promo) ? 'ticket_specific' : 'total_order',
      summary_label: summaryLabel,
      total_discount_text: `QAR ${totalDiscount.toFixed(2)}`,
      total_discount_amount: totalDiscount,
      currency: promo.currency ?? 'QAR',
      applied_breakdown: breakdown,
    };
  }

  private normalizeSelectedTickets(value: unknown): PromoSelectedTicketDto[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return [];
      }

      const input = item as Partial<PromoSelectedTicketDto>;
      const quantity = Number(input.quantity);
      const unitPrice = Number(input.unit_price);

      if (!input.ticket_id || !Number.isFinite(quantity) || quantity <= 0) {
        return [];
      }

      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        return [];
      }

      return [
        {
          ticket_id: String(input.ticket_id),
          variant_id: input.variant_id ? String(input.variant_id) : null,
          quantity,
          unit_price: unitPrice,
        },
      ];
    });
  }

  private isPromoTargetedToEvent(promo: PromoRecord, eventId: string) {
    const eventTargets = promo.targets.filter((target) => target.targetType === 'event');
    return eventTargets.length === 0 || eventTargets.some((target) => target.targetId === eventId);
  }

  private getEligibleTickets(
    promo: PromoRecord,
    selectedTickets: PromoSelectedTicketDto[],
    event: PromoEventRecord,
  ) {
    const ticketTypeTargets = new Set(
      promo.targets
        .filter((target) => target.targetType === 'ticket_type')
        .map((target) => target.targetId),
    );
    const ticketVariantTargets = new Set(
      promo.targets
        .filter((target) => target.targetType === 'ticket_variant')
        .map((target) => target.targetId),
    );

    if (ticketTypeTargets.size === 0 && ticketVariantTargets.size === 0) {
      return selectedTickets;
    }

    const ticketTypeIdsByExternalKey = new Map(
      event.ticketTypes.map((ticketType) => [ticketType.externalKey, ticketType.id]),
    );
    const ticketVariantIdsByExternalKey = new Map(
      event.ticketTypes.flatMap((ticketType) =>
        ticketType.variants.map((variant) => [variant.externalKey, variant.id] as const),
      ),
    );

    return selectedTickets.filter((ticket) => {
      if (ticketVariantTargets.size > 0 && ticket.variant_id) {
        const variantId = ticketVariantIdsByExternalKey.get(ticket.variant_id);
        if (variantId && ticketVariantTargets.has(variantId)) {
          return true;
        }
      }

      const ticketTypeId = ticketTypeIdsByExternalKey.get(ticket.ticket_id);
      return Boolean(ticketTypeId && ticketTypeTargets.has(ticketTypeId));
    });
  }

  private calculateDiscountPerUnit(promo: PromoRecord, unitPrice: number) {
    if (promo.discountType === 'percent') {
      const percent = promo.discountValue.toNumber();
      return this.roundMoney(Math.min(unitPrice, unitPrice * (percent / 100)));
    }

    return this.roundMoney(Math.min(unitPrice, promo.discountValue.toNumber()));
  }

  private calculateOrderDiscount(promo: PromoRecord, eligibleSubtotal: number) {
    const value = promo.discountValue.toNumber();
    return this.roundMoney(Math.min(eligibleSubtotal, promo.discountType === 'percent' ? eligibleSubtotal * (value / 100) : value));
  }

  private getSummaryLabel(promo: PromoRecord, locale: string) {
    if (promo.discountType === 'percent') {
      const percent = promo.discountValue.toNumber();
      return locale === 'ar'
        ? `خصم ${this.formatNumber(percent)}%`
        : `${this.formatNumber(percent)}% off`;
    }

    const amount = promo.discountValue.toNumber();
    return locale === 'ar'
      ? `خصم QAR ${amount.toFixed(2)}`
      : `QAR ${amount.toFixed(2)} off${promo.discountApplication === 'order_total' ? ' the order' : ' each ticket'}`;
  }

  private hasTicketSpecificTarget(promo: PromoRecord) {
    return promo.targets.some(
      (target) => target.targetType === 'ticket_type' || target.targetType === 'ticket_variant',
    );
  }

  private failure(code: string, locale: string, message: string): PromoApplyFailureDto {
    return {
      valid: false,
      code: code || undefined,
      message: locale === 'ar' ? this.toArabicMessage(message) : message,
    };
  }

  private toArabicMessage(message: string) {
    const messages: Record<string, string> = {
      'Promo code is required.': 'الرمز الترويجي مطلوب.',
      'Event is required.': 'الفعالية مطلوبة.',
      'Select at least one ticket before applying a promo code.':
        'اختر تذكرة واحدة على الأقل قبل تطبيق الرمز الترويجي.',
      'This promo code is invalid or inactive.': 'هذا الرمز الترويجي غير صالح أو غير نشط.',
      'This promo code is not valid for the selected event.':
        'هذا الرمز الترويجي غير صالح للفعالية المحددة.',
      'This promo code is not active yet.': 'هذا الرمز الترويجي غير نشط بعد.',
      'This promo code has expired.': 'انتهت صلاحية هذا الرمز الترويجي.',
      'This promo code has reached its redemption limit.':
        'وصل هذا الرمز الترويجي إلى حد الاستخدام.',
      'This promo code is not valid for the selected tickets.':
        'هذا الرمز الترويجي غير صالح للتذاكر المحددة.',
      'This promo code does not apply a discount.': 'هذا الرمز لا يطبق أي خصم.',
    };

    return messages[message] ?? message;
  }

  private normalizeLocale(locale: string) {
    return locale.trim().toLowerCase() === 'ar' ? 'ar' : 'en';
  }

  private roundMoney(value: number) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  private formatNumber(value: number) {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }
}
