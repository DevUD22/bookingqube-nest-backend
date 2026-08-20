import { OrderItemType, PaymentLegType, ReportPaymentMode, VisitorType } from '@prisma/client';

import {
  normalizePaymentMethodLabel,
  resolveOnlinePaymentMethodLabel,
} from '../admin-payment-settings/payment-method-labels';
import { normalizeCustomerAgeGroup } from './camp-age-groups';

const TICKET_TYPES: OrderItemType[] = [OrderItemType.ticket_type, OrderItemType.ticket_variant];
const ADDON_TYPES: OrderItemType[] = [OrderItemType.addon, OrderItemType.addon_variant];
const CAFE_TYPES: OrderItemType[] = [OrderItemType.cafe_item];

export type OfflinePaymentMode = 'cash' | 'card' | 'split' | 'advance' | 'comp';

export type EnricherLineInput = {
  itemType: OrderItemType;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  admitCount?: number;
  thirdPartyVendorId?: string | null;
  ticketIsCafe?: boolean;
  ticketIsPosOnly?: boolean;
  ticketHideFromOnline?: boolean;
};

export type EnricherContext = {
  organizationId: string;
  venueId?: string | null;
  eventSlug: string;
  eventTitle: string;
  eventStartDate?: Date | null;
  eventStartTime?: string | null;
  isSummerCamp: boolean;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  customerAgeGroup?: string | null;
  customerGeographicRegion?: string | null;
  customerGender?: string | null;
  source: string;
  hasPromo: boolean;
  isPaid: boolean;
  paymentMethodId?: number | null;
  paymentMethodLabel?: string | null;
  offlinePaymentMode?: OfflinePaymentMode | null;
};

export type EnrichedLineSnapshot = {
  visitorType: VisitorType;
  thirdPartyVendorId: string | null;
  admitCount: number;
  ticketIsCafe: boolean;
  ticketIsPosOnly: boolean;
  ticketHideFromOnline: boolean;
};

export type OrderHeaderSnapshot = {
  organizationId: string;
  venueId: string | null;
  eventSlug: string;
  eventTitle: string;
  eventStartDate: Date | null;
  eventStartTime: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerAgeGroup: string | null;
  customerGeographicRegion: string | null;
  customerGender: string | null;
  paymentMode: ReportPaymentMode;
  paymentMethodLabel: string;
  ticketsNet: number;
  addonsNet: number;
  extensionsNet: number;
  totalQuantity: number;
  totalAdmits: number;
  isSummerCamp: boolean;
  paymentLegType: PaymentLegType;
};

export class OrderReportingEnricher {
  buildHeader(lines: EnricherLineInput[], ctx: EnricherContext): OrderHeaderSnapshot {
    let ticketsNet = 0;
    let cafeNet = 0;
    let addonsNet = 0;
    let extensionsNet = 0;
    let totalQuantity = 0;
    let totalAdmits = 0;

    for (const line of lines) {
      if (TICKET_TYPES.includes(line.itemType)) {
        if (line.ticketIsCafe) {
          // Legacy cafe-as-ticket lines: keep out of ticket admits, count as cafe.
          cafeNet += line.lineTotal;
        } else {
          ticketsNet += line.lineTotal;
          totalQuantity += line.quantity;
          totalAdmits += (line.admitCount ?? 1) * line.quantity;
        }
      } else if (CAFE_TYPES.includes(line.itemType)) {
        // Cafe POS menu sales are separate from tickets (cafe / cafe-agent rollups).
        cafeNet += line.lineTotal;
      } else if (ADDON_TYPES.includes(line.itemType)) {
        addonsNet += line.lineTotal;
      } else if (line.itemType === OrderItemType.customization) {
        extensionsNet += line.lineTotal;
      }
    }

    ticketsNet = roundMoney(ticketsNet);
    cafeNet = roundMoney(cafeNet);
    addonsNet = roundMoney(addonsNet);
    extensionsNet = roundMoney(extensionsNet);
    // Include cafe in payment-mode resolution total, but not in ticketsNet.
    const orderTotal = roundMoney(ticketsNet + cafeNet + addonsNet + extensionsNet);
    const { paymentMode, paymentMethodLabel, paymentLegType } = this.resolvePayment(
      ctx,
      orderTotal,
    );

    return {
      organizationId: ctx.organizationId,
      venueId: ctx.venueId ?? null,
      eventSlug: ctx.eventSlug,
      eventTitle: ctx.eventTitle,
      eventStartDate: ctx.eventStartDate ?? null,
      eventStartTime: ctx.eventStartTime ?? null,
      customerName: ctx.customerName,
      customerEmail: ctx.customerEmail,
      customerPhone: ctx.customerPhone ?? null,
      customerAgeGroup: normalizeCustomerAgeGroup(ctx.customerAgeGroup),
      customerGeographicRegion: ctx.customerGeographicRegion ?? null,
      customerGender: ctx.customerGender ?? null,
      paymentMode,
      paymentMethodLabel,
      ticketsNet,
      addonsNet,
      extensionsNet,
      totalQuantity,
      totalAdmits,
      isSummerCamp: ctx.isSummerCamp,
      paymentLegType,
    };
  }

  classifyLine(
    line: EnricherLineInput,
    ctx: Pick<EnricherContext, 'hasPromo' | 'source' | 'offlinePaymentMode'>,
  ): EnrichedLineSnapshot {
    const isTicket = TICKET_TYPES.includes(line.itemType);
    const ticketIsCafe = Boolean(line.ticketIsCafe);
    const ticketIsPosOnly = Boolean(line.ticketIsPosOnly);
    const ticketHideFromOnline = Boolean(line.ticketHideFromOnline);
    const admitCount = line.admitCount ?? (isTicket ? 1 : 0);

    let visitorType: VisitorType = VisitorType.paid;
    if (!isTicket) {
      visitorType = VisitorType.paid;
    } else if (ctx.offlinePaymentMode === 'comp') {
      visitorType = VisitorType.comp;
    } else if (ticketIsPosOnly || (ticketHideFromOnline && ctx.source === 'pos')) {
      visitorType = VisitorType.pos_only;
    } else if (line.lineTotal <= 0 && ctx.hasPromo) {
      visitorType = VisitorType.comp_promo;
    } else if (line.lineTotal <= 0) {
      visitorType = VisitorType.comp;
    } else if (ctx.hasPromo) {
      visitorType = VisitorType.promocode;
    }

    return {
      visitorType,
      thirdPartyVendorId: line.thirdPartyVendorId ?? null,
      admitCount,
      ticketIsCafe,
      ticketIsPosOnly,
      ticketHideFromOnline,
    };
  }

  private resolvePayment(ctx: EnricherContext, orderTotal: number) {
    if (ctx.offlinePaymentMode === 'comp') {
      return {
        paymentMode: ReportPaymentMode.comp,
        paymentMethodLabel: 'Comp',
        paymentLegType: PaymentLegType.comp,
      };
    }

    if (orderTotal <= 0) {
      return {
        paymentMode: ReportPaymentMode.free,
        paymentMethodLabel: 'Free',
        paymentLegType: PaymentLegType.comp,
      };
    }

    if (ctx.offlinePaymentMode) {
      switch (ctx.offlinePaymentMode) {
        case 'cash':
          return {
            paymentMode: ReportPaymentMode.offline_cash,
            paymentMethodLabel: ctx.paymentMethodLabel?.trim() || 'Cash',
            paymentLegType: PaymentLegType.cash,
          };
        case 'card':
          return {
            paymentMode: ReportPaymentMode.offline_card,
            paymentMethodLabel: ctx.paymentMethodLabel?.trim() || 'Card',
            paymentLegType: PaymentLegType.card,
          };
        case 'split':
          return {
            paymentMode: ReportPaymentMode.split,
            paymentMethodLabel: ctx.paymentMethodLabel?.trim() || 'Split',
            paymentLegType: PaymentLegType.other,
          };
        case 'advance':
          return {
            paymentMode: ReportPaymentMode.advance,
            paymentMethodLabel: ctx.paymentMethodLabel?.trim() || 'Advance',
            paymentLegType: PaymentLegType.other,
          };
      }
    }

    // Legacy: source=pos without explicit mode defaults to cash (backward compatible).
    if (ctx.source === 'pos') {
      return {
        paymentMode: ReportPaymentMode.offline_cash,
        paymentMethodLabel: ctx.paymentMethodLabel?.trim() || 'Cash',
        paymentLegType: PaymentLegType.cash,
      };
    }

    const label = normalizePaymentMethodLabel(
      ctx.paymentMethodLabel,
      ctx.paymentMethodId,
    );

    return {
      paymentMode: ReportPaymentMode.online,
      paymentMethodLabel:
        label || resolveOnlinePaymentMethodLabel(ctx.paymentMethodId),
      paymentLegType: PaymentLegType.online_gateway,
    };
  }
}

export const orderReportingEnricher = new OrderReportingEnricher();

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}
