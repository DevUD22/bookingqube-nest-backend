import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { DailyClosingTotalsService } from './daily-closing-totals.service';
import {
  CreateSettlementDto,
  SettlementListQueryDto,
} from './dto/admin-daily-closing.dto';

function money(value: Prisma.Decimal | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

@Injectable()
export class AdminSettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly totals: DailyClosingTotalsService,
    private readonly staff: AdminStaffService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async list(query: SettlementListQueryDto, admin: AuthenticatedAdmin) {
    if (!admin.permissions.includes('settlements.read')) {
      throw new ForbiddenException('Missing settlements.read permission.');
    }
    const where: Prisma.SettlementWhereInput = {};
    if (query.date) {
      where.settlementForDate = this.totals.parseClosingDate(query.date.slice(0, 10));
    }

    const rows = await this.prisma.settlement.findMany({
      where,
      include: {
        settlementBy: { select: { id: true, name: true, email: true } },
        signatureMedia: { select: { id: true, url: true } },
      },
      orderBy: [{ settlementForDate: 'desc' }, { createdAt: 'desc' }],
    });

    return {
      success: true,
      data: {
        settlements: rows.map((row) => ({
          id: row.id,
          settlement_by_id: row.settlementById,
          settlement_by_name: row.settlementBy.name,
          organization_id: row.organizationId,
          settlement_for_date: row.settlementForDate.toISOString().slice(0, 10),
          received_cash_amount: money(row.receivedCashAmount),
          received_card_amount: money(row.receivedCardAmount),
          booking_cash_sale: money(row.bookingCashSale),
          booking_card_sale: money(row.bookingCardSale),
          discrepancy_cash_amount: money(row.discrepancyCashAmount),
          discrepancy_card_amount: money(row.discrepancyCardAmount),
          status: row.status,
          signature_url: row.signatureMedia?.url ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      },
    };
  }

  async create(body: CreateSettlementDto, admin: AuthenticatedAdmin) {
    if (!admin.permissions.includes('settlements.write')) {
      throw new ForbiddenException('Missing settlements.write permission.');
    }

    const date = body.settlement_for_date.slice(0, 10);
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('Settlement date cannot be in the future.');
    }
    const day = this.totals.parseClosingDate(date);

    const agentIds = await this.resolveAgentScope(admin);
    const closings = await this.prisma.dailyClosing.findMany({
      where: {
        deletedAt: null,
        closingForDate: day,
        ...(agentIds ? { agentId: { in: agentIds } } : {}),
      },
    });

    if (closings.length === 0) {
      throw new BadRequestException(
        'No daily closings found for this date. Cannot create settlement.',
      );
    }
    const notApproved = closings.filter((c) => c.status !== 'approved');
    if (notApproved.length > 0) {
      throw new BadRequestException(
        'Please approve all daily closings before creating a settlement.',
      );
    }

    const existing = await this.prisma.settlement.findUnique({
      where: { settlementForDate: day },
      include: {
        settlementBy: { select: { id: true, name: true } },
      },
    });
    if (existing) {
      const by = existing.settlementBy?.name ?? 'another user';
      throw new ConflictException(
        `Settlement already created for ${date} by ${by}.`,
      );
    }

    const receivedCash = round3(
      closings.reduce((s, c) => s + money(c.receivedCashAmount), 0),
    );
    const receivedCard = round3(
      closings.reduce((s, c) => s + money(c.receivedCardAmount), 0),
    );
    const bookingCash = round3(
      closings.reduce((s, c) => s + money(c.totalCashSale), 0),
    );
    const bookingCard = round3(
      closings.reduce((s, c) => s + money(c.totalCardSale), 0),
    );
    const discrepancyCash = round3(
      closings.reduce((s, c) => s + money(c.cashFlowBalance), 0),
    );
    const discrepancyCard = round3(
      closings.reduce((s, c) => s + money(c.cardFlowBalance), 0),
    );

    const signatureMediaId = await this.saveSignature(
      body.signature_data_url,
      admin.id,
    );

    const status =
      admin.role === 'admin' && body.status ? body.status : 'generated';

    const created = await this.prisma.settlement.create({
      data: {
        settlementById: admin.id,
        organizationId: closings[0]?.organizationId ?? null,
        settlementForDate: day,
        receivedCashAmount: receivedCash,
        receivedCardAmount: receivedCard,
        bookingCashSale: bookingCash,
        bookingCardSale: bookingCard,
        discrepancyCashAmount: discrepancyCash,
        discrepancyCardAmount: discrepancyCard,
        status,
        signatureMediaId,
      },
      include: {
        settlementBy: { select: { id: true, name: true, email: true } },
        signatureMedia: { select: { id: true, url: true } },
      },
    });

    return {
      success: true,
      message: `Settlement created for ${date}.`,
      data: {
        id: created.id,
        settlement_for_date: date,
        received_cash_amount: receivedCash,
        received_card_amount: receivedCard,
        booking_cash_sale: bookingCash,
        booking_card_sale: bookingCard,
        discrepancy_cash_amount: discrepancyCash,
        discrepancy_card_amount: discrepancyCard,
        status: created.status,
        signature_url: created.signatureMedia?.url ?? null,
      },
    };
  }

  private async resolveAgentScope(admin: AuthenticatedAdmin): Promise<string[] | null> {
    if (admin.role === 'admin' || admin.role === 'super_admin') return null;
    const eventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        status: 'active',
        ...(eventIds ? { eventId: { in: eventIds } } : { eventId: { not: null } }),
        role: { name: 'pos' },
      },
      select: { userId: true },
    });
    return [...new Set(assignments.map((a) => a.userId))];
  }

  private async saveSignature(dataUrl: string, uploadedByUserId: string) {
    const asset = await this.mediaStorage.uploadDataUrl({
      folder: `settlements/${uploadedByUserId}/signatures`,
      dataUrl,
      maxBytes: 5 * 1024 * 1024,
      uploadedByUserId,
      errorLabel: 'signature',
    });
    return asset.id;
  }
}
