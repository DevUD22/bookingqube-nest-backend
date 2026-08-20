import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';

export type DailyClosingExpectedTotals = {
  total_cash_sale: number;
  total_card_sale: number;
  total_ticket_sale: number;
  total_addon_sale: number;
  total_time_extension_sale: number;
  total_discount_sale: number;
  total_sale: number;
  qty: number;
  order_count: number;
  organization_id: string | null;
  currency: string;
};

function money(value: Prisma.Decimal | number | null | undefined): number {
  if (value == null) return 0;
  return Number(value);
}

function dayBounds(dateStr: string): { start: Date; end: Date; day: Date } {
  const day = new Date(`${dateStr}T00:00:00.000Z`);
  const start = new Date(`${dateStr}T00:00:00.000+03:00`);
  if (Number.isNaN(day.getTime()) || Number.isNaN(start.getTime())) {
    throw new Error('Invalid closing date');
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end, day };
}

export function qatarDateKey(value = new Date()): string {
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

@Injectable()
export class DailyClosingTotalsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Expected sales for an agent on an Asia/Qatar calendar day.
   * Uses paid order tender snapshots (cash_amount / card_amount) aligned with POS reporting.
   */
  async expectedForAgentDate(
    agentId: string,
    closingForDate: string,
    eventIds?: string[] | null,
  ): Promise<DailyClosingExpectedTotals> {
    const { start, end } = dayBounds(closingForDate);

    const orders = await this.prisma.order.findMany({
      where: {
        bookedByAgentId: agentId,
        status: { in: ['paid', 'refunded', 'partially_refunded'] },
        cancelledAt: null,
        OR: [
          { paidAt: { gte: start, lt: end } },
          { AND: [{ paidAt: null }, { createdAt: { gte: start, lt: end } }] },
        ],
        ...(eventIds && eventIds.length > 0 ? { eventId: { in: eventIds } } : {}),
        ...(eventIds && eventIds.length === 0 ? { eventId: { in: [] } } : {}),
      },
      select: {
        cashAmount: true,
        cardAmount: true,
        totalQuantity: true,
        ticketsNet: true,
        addonsNet: true,
        extensionsNet: true,
        discountAmount: true,
        organizationId: true,
        currency: true,
      },
    });

    let totalCash = 0;
    let totalCard = 0;
    let totalTickets = 0;
    let totalAddons = 0;
    let totalExtensions = 0;
    let totalDiscounts = 0;
    let qty = 0;
    let organizationId: string | null = null;
    let currency = 'QAR';

    for (const order of orders) {
      totalCash += money(order.cashAmount);
      totalCard += money(order.cardAmount);
      const grossTickets = money(order.ticketsNet);
      const ticketDiscount = Math.min(grossTickets, Math.max(0, money(order.discountAmount)));
      totalTickets += grossTickets;
      totalAddons += money(order.addonsNet);
      totalExtensions += money(order.extensionsNet);
      totalDiscounts += ticketDiscount;
      qty += order.totalQuantity ?? 0;
      if (!organizationId) organizationId = order.organizationId;
      if (order.currency) currency = order.currency;
    }

    return {
      total_cash_sale: round3(totalCash),
      total_card_sale: round3(totalCard),
      total_ticket_sale: round3(totalTickets),
      total_addon_sale: round3(totalAddons),
      total_time_extension_sale: round3(totalExtensions),
      total_discount_sale: round3(totalDiscounts),
      total_sale: round3(totalCash + totalCard),
      qty,
      order_count: orders.length,
      organization_id: organizationId,
      currency,
    };
  }

  parseClosingDate(value: string): Date {
    return dayBounds(value).day;
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
