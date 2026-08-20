import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  DailyClosingExpectedTotals,
  DailyClosingTotalsService,
  qatarDateKey,
} from '../admin-daily-closings/daily-closing-totals.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';
import { ClosePosShiftDto } from './dto/pos-shift.dto';

function money(value: Prisma.Decimal | number | null | undefined) {
  return value == null ? 0 : Number(value);
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

@Injectable()
export class PosShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: DailyClosingTotalsService,
  ) {}

  async get(agent: AuthenticatedPosAgent, requestedDate?: string) {
    const today = qatarDateKey();
    const date = requestedDate?.slice(0, 10) || today;
    this.assertDate(date, today);

    const [expected, closing] = await Promise.all([
      this.totals.expectedForAgentDate(agent.id, date, [agent.eventId]),
      this.findClosing(agent, date),
    ]);

    return {
      success: true,
      data: this.serialize(date, today, expected, closing),
    };
  }

  async close(agent: AuthenticatedPosAgent, body: ClosePosShiftDto) {
    const today = qatarDateKey();
    const date = body.date.slice(0, 10);
    this.assertDate(date, today);

    const existing = await this.findClosing(agent, date);
    if (existing) {
      throw new ConflictException(`Shift for ${date} is already closed.`);
    }

    const expected = await this.totals.expectedForAgentDate(agent.id, date, [agent.eventId]);
    const user = await this.prisma.user.findUnique({
      where: { id: agent.id },
      select: { name: true },
    });
    const cashVariance = round3(body.declared_cash - expected.total_cash_sale);
    const cardVariance = round3(body.declared_card - expected.total_card_sale);
    const closingCode = `POS-${date.replace(/-/g, '')}-${agent.id.slice(0, 6).toUpperCase()}`;

    const closing = await this.prisma.$transaction(async (tx) => {
      const duplicate = await tx.dailyClosing.findFirst({
        where: {
          agentId: agent.id,
          eventId: agent.eventId,
          closingForDate: this.totals.parseClosingDate(date),
          deletedAt: null,
        },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException(`Shift for ${date} is already closed.`);

      const created = await tx.dailyClosing.create({
        data: {
          closingCode,
          agentId: agent.id,
          eventId: agent.eventId,
          organizationId: agent.organizationId || expected.organization_id,
          closingForDate: this.totals.parseClosingDate(date),
          receivedCashAmount: body.declared_cash,
          receivedCardAmount: body.declared_card,
          totalCashSale: expected.total_cash_sale,
          totalCardSale: expected.total_card_sale,
          cashFlowBalance: cashVariance,
          cardFlowBalance: cardVariance,
          qty: expected.qty,
          note: body.note?.trim() || null,
          status: 'generated',
        },
      });
      await tx.dailyClosingStatusHistory.create({
        data: {
          dailyClosingId: created.id,
          closingCode: created.closingCode,
          status: created.status,
          cashFlowBalance: created.cashFlowBalance,
          cardFlowBalance: created.cardFlowBalance,
          receivedCashAmount: created.receivedCashAmount,
          receivedCardAmount: created.receivedCardAmount,
          totalCashSale: created.totalCashSale,
          totalCardSale: created.totalCardSale,
          qty: created.qty,
          note: created.note,
          actorId: agent.id,
          actorName: user?.name || agent.email,
        },
      });
      return created;
    });

    return {
      success: true,
      message: `Shift for ${date} closed successfully.`,
      data: this.serialize(date, today, expected, closing),
    };
  }

  private findClosing(agent: AuthenticatedPosAgent, date: string) {
    return this.prisma.dailyClosing.findFirst({
      where: {
        agentId: agent.id,
        eventId: agent.eventId,
        closingForDate: this.totals.parseClosingDate(date),
        deletedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private assertDate(date: string, today: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('Enter a valid shift date.');
    }
    if (date > today) throw new BadRequestException('Shift date cannot be in the future.');
  }

  private serialize(
    date: string,
    today: string,
    expected: DailyClosingExpectedTotals,
    closing: Awaited<ReturnType<PosShiftsService['findClosing']>>,
  ) {
    return {
      date,
      today,
      currency: expected.currency,
      is_today: date === today,
      is_closed: Boolean(closing),
      can_close: !closing,
      sales_blocked: Boolean(closing) && date === today,
      sales: {
        total: expected.total_sale,
        cash: expected.total_cash_sale,
        card: expected.total_card_sale,
        tickets: expected.total_ticket_sale,
        addons: expected.total_addon_sale,
        time_extensions: expected.total_time_extension_sale,
        discounts: expected.total_discount_sale,
        quantity: expected.qty,
        order_count: expected.order_count,
      },
      closing: closing
        ? {
            id: closing.id,
            code: closing.closingCode,
            status: closing.status,
            declared_cash: money(closing.receivedCashAmount),
            declared_card: money(closing.receivedCardAmount),
            expected_cash: money(closing.totalCashSale),
            expected_card: money(closing.totalCardSale),
            cash_variance: money(closing.cashFlowBalance),
            card_variance: money(closing.cardFlowBalance),
            note: closing.note,
            closed_at: closing.createdAt.toISOString(),
          }
        : null,
    };
  }
}
