import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DailyClosing, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  DailyClosingTotalsService,
  qatarDateKey,
} from '../admin-daily-closings/daily-closing-totals.service';
import { SavePosSalesEntryDto } from './dto/pos-sales-entry.dto';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

function money(value: Prisma.Decimal | number | null | undefined) {
  return value == null ? 0 : Number(value);
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}

@Injectable()
export class PosSalesEntryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: DailyClosingTotalsService,
  ) {}

  async get(agent: AuthenticatedPosAgent, requestedDate?: string) {
    this.assertAccess(agent);
    const today = qatarDateKey();
    const date = requestedDate?.slice(0, 10) || today;
    this.assertDate(date, today);

    const [closing, event] = await Promise.all([
      this.findReport(agent, date),
      this.prisma.event.findUnique({
        where: { id: agent.eventId },
        select: {
          currency: true,
          translations: {
            where: { locale: { in: ['en', 'ar'] } },
            select: { locale: true, title: true },
            take: 2,
          },
        },
      }),
    ]);

    const eventTitle =
      event?.translations.find((row) => row.locale === 'en')?.title ||
      event?.translations[0]?.title ||
      'Assigned event';

    return {
      success: true,
      data: this.serialize(date, today, event?.currency || 'QAR', eventTitle, closing),
    };
  }

  async save(agent: AuthenticatedPosAgent, body: SavePosSalesEntryDto) {
    this.assertAccess(agent);
    const today = qatarDateKey();
    const date = body.date.slice(0, 10);
    this.assertDate(date, today);

    const cash = round3(body.cash_sales);
    const card = round3(body.card_sales);
    const existing = await this.findReport(agent, date);
    if (existing?.status === 'approved') {
      throw new ConflictException('This sales report has been approved and can no longer be edited.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: agent.id },
      select: { name: true },
    });
    const note = body.note?.trim() || null;

    const saved = await this.prisma.$transaction(async (tx) => {
      let report: DailyClosing;
      if (existing) {
        report = await tx.dailyClosing.update({
          where: { id: existing.id },
          data: {
            receivedCashAmount: cash,
            receivedCardAmount: card,
            totalCashSale: cash,
            totalCardSale: card,
            cashFlowBalance: 0,
            cardFlowBalance: 0,
            qty: body.total_transactions,
            note,
            status: 'generated',
            rejectReason: null,
          },
        });
      } else {
        const duplicate = await tx.dailyClosing.findFirst({
          where: {
            agentId: agent.id,
            eventId: agent.eventId,
            closingForDate: this.totals.parseClosingDate(date),
            deletedAt: null,
          },
        });
        if (duplicate) {
          throw new ConflictException(`A sales report already exists for ${date}.`);
        }
        report = await tx.dailyClosing.create({
          data: {
            closingCode: `EXT-${date.replace(/-/g, '')}-${agent.id.slice(0, 6).toUpperCase()}`,
            agentId: agent.id,
            eventId: agent.eventId,
            organizationId: agent.organizationId || null,
            closingForDate: this.totals.parseClosingDate(date),
            receivedCashAmount: cash,
            receivedCardAmount: card,
            totalCashSale: cash,
            totalCardSale: card,
            cashFlowBalance: 0,
            cardFlowBalance: 0,
            qty: body.total_transactions,
            note,
            status: 'generated',
          },
        });
      }

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

    const event = await this.prisma.event.findUnique({
      where: { id: agent.eventId },
      select: {
        currency: true,
        translations: {
          where: { locale: { in: ['en', 'ar'] } },
          select: { locale: true, title: true },
          take: 2,
        },
      },
    });
    const eventTitle =
      event?.translations.find((row) => row.locale === 'en')?.title ||
      event?.translations[0]?.title ||
      'Assigned event';

    return {
      success: true,
      message: existing ? 'Sales report updated.' : 'Sales report submitted.',
      data: this.serialize(date, today, event?.currency || 'QAR', eventTitle, saved),
    };
  }

  private assertAccess(agent: AuthenticatedPosAgent) {
    if (!agent.salesEntryMode) {
      throw new ForbiddenException('This account does not use the external sales-entry workspace.');
    }
  }

  private assertDate(date: string, today: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      throw new BadRequestException('Enter a valid sales date.');
    }
    if (date > today) throw new BadRequestException('Sales date cannot be in the future.');
  }

  private findReport(agent: AuthenticatedPosAgent, date: string) {
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

  private serialize(
    date: string,
    today: string,
    currency: string,
    eventTitle: string,
    report: DailyClosing | null,
  ) {
    const cash = money(report?.totalCashSale);
    const card = money(report?.totalCardSale);
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
            total_sales: round3(cash + card),
            total_transactions: report.qty,
            note: report.note,
            submitted_at: report.createdAt.toISOString(),
            updated_at: report.updatedAt.toISOString(),
          }
        : null,
    };
  }
}
