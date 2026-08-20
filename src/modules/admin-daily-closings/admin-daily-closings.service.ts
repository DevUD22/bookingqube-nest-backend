import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DailyClosing, DailyClosingStatus, Prisma } from '@prisma/client';
import PDFDocument = require('pdfkit');

import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedAdmin } from '../admin-auth/strategies/admin-jwt.strategy';
import { AdminStaffService } from '../admin-staff/admin-staff.service';
import { MediaStorageService } from '../media-storage/media-storage.service';
import { DailyClosingTotalsService } from './daily-closing-totals.service';
import {
  AddDailyClosingNoteDto,
  ApproveDailyClosingDto,
  CreateDailyClosingDto,
  DailyClosingExpectedQueryDto,
  DailyClosingListQueryDto,
  UpdateDailyClosingDto,
} from './dto/admin-daily-closing.dto';

function money(value: Prisma.Decimal | number | null | undefined): number {
  return value == null ? 0 : Number(value);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dateOnly(iso: string): string {
  return iso.slice(0, 10);
}

@Injectable()
export class AdminDailyClosingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly totals: DailyClosingTotalsService,
    private readonly staff: AdminStaffService,
    private readonly mediaStorage: MediaStorageService,
  ) {}

  async list(query: DailyClosingListQueryDto, admin: AuthenticatedAdmin) {
    const date = query.date ? dateOnly(query.date) : new Date().toISOString().slice(0, 10);
    const day = this.totals.parseClosingDate(date);
    const scope = await this.resolveScope(admin, query.event_id);

    const eventFilter = query.event_id
      ? { eventId: query.event_id }
      : scope.eventIds
        ? { eventId: { in: scope.eventIds } }
        : {};

    const where: Prisma.DailyClosingWhereInput = {
      deletedAt: null,
      closingForDate: day,
      ...eventFilter,
      ...(scope.agentIds ? { agentId: { in: scope.agentIds } } : {}),
      ...(query.agent_id ? { agentId: query.agent_id } : {}),
    };

    if (scope.agentIds && query.agent_id && !scope.agentIds.includes(query.agent_id)) {
      throw new ForbiddenException('You cannot view this agent closing.');
    }

    const closings = await this.prisma.dailyClosing.findMany({
      where,
      include: {
        agent: { select: { id: true, name: true, email: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        signatureMedia: { select: { id: true, url: true } },
        signedPdfMedia: { select: { id: true, url: true } },
      },
      orderBy: [{ createdAt: 'desc' }],
    });

    const widgets = {
      expected_cash: round3(closings.reduce((s, c) => s + money(c.totalCashSale), 0)),
      expected_card: round3(closings.reduce((s, c) => s + money(c.totalCardSale), 0)),
      received_cash: round3(closings.reduce((s, c) => s + money(c.receivedCashAmount), 0)),
      received_card: round3(closings.reduce((s, c) => s + money(c.receivedCardAmount), 0)),
      discrepancy_cash: round3(closings.reduce((s, c) => s + money(c.cashFlowBalance), 0)),
      discrepancy_card: round3(closings.reduce((s, c) => s + money(c.cardFlowBalance), 0)),
    };

    // Live expected for scoped agents (widget when list empty / POS preview)
    let liveExpected = {
      total_cash_sale: 0,
      total_card_sale: 0,
      qty: 0,
      order_count: 0,
    };
    if (admin.role === 'pos' || query.agent_id) {
      const agentId = query.agent_id ?? admin.id;
      const expected = await this.totals.expectedForAgentDate(
        agentId,
        date,
        scope.eventIds,
      );
      liveExpected = {
        total_cash_sale: expected.total_cash_sale,
        total_card_sale: expected.total_card_sale,
        qty: expected.qty,
        order_count: expected.order_count,
      };
    }

    const existingSettlement = await this.prisma.settlement.findUnique({
      where: { settlementForDate: day },
      select: { id: true },
    });

    return {
      success: true,
      data: {
        date,
        widgets,
        live_expected: liveExpected,
        closings: closings.map((c) => this.serialize(c)),
        can_settle:
          closings.length > 0 &&
          closings.every((c) => c.status === 'approved') &&
          !existingSettlement,
      },
    };
  }

  async expected(query: DailyClosingExpectedQueryDto, admin: AuthenticatedAdmin) {
    const date = dateOnly(query.date);
    const scope = await this.resolveScope(admin, query.event_id);
    const agentId =
      admin.role === 'pos' ? admin.id : (query.agent_id ?? admin.id);
    if (scope.agentIds && !scope.agentIds.includes(agentId) && admin.role !== 'admin') {
      if (admin.role === 'pos' && agentId === admin.id) {
        // ok
      } else if (admin.role !== 'pos') {
        // finance/admin may preview any scoped agent
        if (scope.agentIds && query.agent_id && !scope.agentIds.includes(query.agent_id)) {
          throw new ForbiddenException('Agent out of scope.');
        }
      }
    }
    const expected = await this.totals.expectedForAgentDate(
      agentId,
      date,
      scope.eventIds,
    );
    return { success: true, data: { date, agent_id: agentId, ...expected } };
  }

  async create(body: CreateDailyClosingDto, admin: AuthenticatedAdmin) {
    const date = dateOnly(body.closing_for_date);
    if (date > new Date().toISOString().slice(0, 10)) {
      throw new BadRequestException('Closing date cannot be in the future.');
    }
    if (admin.role === 'pos' && body.agent_id && body.agent_id !== admin.id) {
      throw new ForbiddenException('POS agents can only create their own closing.');
    }
    if (
      (admin.role === 'admin' || admin.role === 'finance-manager') &&
      !body.agent_id
    ) {
      throw new BadRequestException(
        'Select the POS agent this daily closing is being created for.',
      );
    }
    const agentId = admin.role === 'pos' ? admin.id : (body.agent_id ?? admin.id);
    if (!['pos', 'finance-manager', 'admin'].includes(admin.role) && agentId !== admin.id) {
      throw new ForbiddenException('Insufficient role to create closing for another agent.');
    }

    const eventId = await this.resolveClosingEventId(admin, agentId, body.event_id);
    const scope = await this.resolveScope(admin, eventId);
    if (scope.agentIds && !scope.agentIds.includes(agentId)) {
      throw new ForbiddenException('Agent is outside your scope for this event.');
    }
    const day = this.totals.parseClosingDate(date);
    const existing = await this.prisma.dailyClosing.findFirst({
      where: { agentId, eventId, closingForDate: day, deletedAt: null },
    });
    if (existing) {
      throw new ConflictException(
        `Daily closing already created for this POS agent on ${date} for this event.`,
      );
    }

    const expected = await this.totals.expectedForAgentDate(agentId, date, [eventId]);
    if (expected.order_count <= 0) {
      throw new BadRequestException(`No paid bookings found for ${date}.`);
    }

    const cashFlow = round3(body.received_cash_amount - expected.total_cash_sale);
    const cardFlow = round3(body.received_card_amount - expected.total_card_sale);
    const signatureMediaId = await this.saveDataUrlImage(
      `daily-closings/${agentId}/signatures`,
      body.signature_data_url,
      admin.id,
    );
    const closingCode = await this.generateClosingCode(expected.organization_id);

    const created = await this.prisma.dailyClosing.create({
      data: {
        closingCode,
        agentId,
        eventId,
        organizationId: expected.organization_id,
        closingForDate: day,
        receivedCashAmount: body.received_cash_amount,
        receivedCardAmount: body.received_card_amount,
        totalCashSale: expected.total_cash_sale,
        totalCardSale: expected.total_card_sale,
        cashFlowBalance: cashFlow,
        cardFlowBalance: cardFlow,
        qty: expected.qty,
        note: body.note?.trim() || null,
        status: 'generated',
        signatureMediaId,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        signatureMedia: { select: { id: true, url: true } },
        signedPdfMedia: { select: { id: true, url: true } },
      },
    });

    await this.writeHistory(created, admin, 'generated');

    return {
      success: true,
      message: `Daily closing created for ${date}.`,
      data: this.serialize(created),
    };
  }

  async update(id: string, body: UpdateDailyClosingDto, admin: AuthenticatedAdmin) {
    const closing = await this.requireClosing(id, admin);
    if (closing.status === 'approved') {
      throw new BadRequestException('Approved closings cannot be updated.');
    }

    const date = closing.closingForDate.toISOString().slice(0, 10);
    const expected = await this.totals.expectedForAgentDate(
      closing.agentId,
      date,
      [closing.eventId],
    );
    if (expected.order_count <= 0) {
      throw new BadRequestException(`No paid bookings found for ${date}.`);
    }

    let signatureMediaId = closing.signatureMediaId;
    if (body.signature_data_url) {
      signatureMediaId = await this.saveDataUrlImage(
        `daily-closings/${closing.agentId}/signatures`,
        body.signature_data_url,
        admin.id,
      );
    }

    const cashFlow = round3(body.received_cash_amount - expected.total_cash_sale);
    const cardFlow = round3(body.received_card_amount - expected.total_card_sale);

    const updated = await this.prisma.dailyClosing.update({
      where: { id },
      data: {
        receivedCashAmount: body.received_cash_amount,
        receivedCardAmount: body.received_card_amount,
        totalCashSale: expected.total_cash_sale,
        totalCardSale: expected.total_card_sale,
        cashFlowBalance: cashFlow,
        cardFlowBalance: cardFlow,
        qty: expected.qty,
        note: body.note !== undefined ? body.note.trim() || null : closing.note,
        status: 'generated',
        rejectReason: null,
        signatureMediaId,
        signedPdfMediaId: null,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        signatureMedia: { select: { id: true, url: true } },
        signedPdfMedia: { select: { id: true, url: true } },
      },
    });

    await this.writeHistory(updated, admin, 'generated');

    return {
      success: true,
      message: `Daily closing updated for ${date}.`,
      data: this.serialize(updated),
    };
  }

  async addNote(id: string, body: AddDailyClosingNoteDto, admin: AuthenticatedAdmin) {
    const closing = await this.requireClosing(id, admin);
    if (closing.status === 'approved') {
      throw new BadRequestException('Cannot add a note to an approved closing.');
    }
    if (closing.note) {
      throw new BadRequestException('A note has already been added.');
    }
    const updated = await this.prisma.dailyClosing.update({
      where: { id },
      data: { note: body.note.trim() },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        signatureMedia: { select: { id: true, url: true } },
        signedPdfMedia: { select: { id: true, url: true } },
      },
    });
    return { success: true, message: 'Note added.', data: this.serialize(updated) };
  }

  async approve(id: string, body: ApproveDailyClosingDto, admin: AuthenticatedAdmin) {
    if (!admin.permissions.includes('closings.approve')) {
      throw new ForbiddenException('Missing closings.approve permission.');
    }
    const closing = await this.requireClosing(id, admin);
    if (closing.status === 'approved') {
      throw new BadRequestException('Closing is already approved.');
    }

    const hasDiscrepancy =
      money(closing.cashFlowBalance) !== 0 || money(closing.cardFlowBalance) !== 0;
    if (body.status === 'approved' && hasDiscrepancy) {
      const note = (body.note ?? closing.note ?? '').trim();
      if (!note) {
        throw new BadRequestException(
          'A note is required when approving a closing with a discrepancy.',
        );
      }
    }
    if (body.status === 'rejected' && !(body.reject_reason ?? '').trim()) {
      throw new BadRequestException('Reject reason is required.');
    }

    let signedPdfMediaId = closing.signedPdfMediaId;
    if (body.authorized_signature_data_url) {
      const pdfBuffer = await this.buildPdfBuffer(closing, body.authorized_signature_data_url);
      signedPdfMediaId = await this.saveBufferFile(
        `daily-closings/${closing.agentId}/signed`,
        pdfBuffer,
        'application/pdf',
        '.pdf',
        admin.id,
      );
    }

    const updated = await this.prisma.dailyClosing.update({
      where: { id },
      data: {
        status: body.status,
        rejectReason:
          body.status === 'rejected' ? (body.reject_reason ?? '').trim() : null,
        note: body.note !== undefined ? body.note.trim() || closing.note : closing.note,
        signedPdfMediaId,
      },
      include: {
        agent: { select: { id: true, name: true, email: true } },
        event: {
          select: {
            id: true,
            slug: true,
            translations: {
              where: { locale: 'en' },
              take: 1,
              select: { title: true },
            },
          },
        },
        signatureMedia: { select: { id: true, url: true } },
        signedPdfMedia: { select: { id: true, url: true } },
      },
    });

    await this.writeHistory(updated, admin, body.status);

    return {
      success: true,
      message: `Daily closing ${body.status}.`,
      data: this.serialize(updated),
    };
  }

  async history(id: string, admin: AuthenticatedAdmin) {
    await this.requireClosing(id, admin);
    const rows = await this.prisma.dailyClosingStatusHistory.findMany({
      where: { dailyClosingId: id },
      orderBy: { createdAt: 'desc' },
    });
    return {
      success: true,
      data: rows.map((row) => ({
        id: row.id,
        status: row.status,
        closing_code: row.closingCode,
        cash_flow_balance: money(row.cashFlowBalance),
        card_flow_balance: money(row.cardFlowBalance),
        received_cash_amount: money(row.receivedCashAmount),
        received_card_amount: money(row.receivedCardAmount),
        total_cash_sale: money(row.totalCashSale),
        total_card_sale: money(row.totalCardSale),
        qty: row.qty,
        note: row.note,
        reject_reason: row.rejectReason,
        actor_id: row.actorId,
        actor_name: row.actorName,
        created_at: row.createdAt.toISOString(),
      })),
    };
  }

  async pdf(id: string, admin: AuthenticatedAdmin) {
    const closing = await this.requireClosing(id, admin);
    const buffer = await this.buildPdfBuffer(closing);
    const date = closing.closingForDate.toISOString().slice(0, 10);
    return {
      success: true,
      data: {
        filename: `daily-closing-report-#${closing.closingCode}-${date}daily_closing.pdf`,
        content_type: 'application/pdf',
        pdf_base64: buffer.toString('base64'),
      },
    };
  }

  async remove(id: string, admin: AuthenticatedAdmin) {
    if (!['admin', 'super_admin', 'finance-manager'].includes(admin.role)) {
      throw new ForbiddenException(
        'Only finance managers and admins can delete daily closings.',
      );
    }

    const closing = await this.requireClosing(id, admin);
    await this.prisma.dailyClosing.update({
      where: { id: closing.id },
      data: { deletedAt: new Date() },
    });

    await this.prisma.dailyClosingStatusHistory.create({
      data: {
        dailyClosingId: closing.id,
        closingCode: closing.closingCode,
        status: closing.status,
        cashFlowBalance: closing.cashFlowBalance,
        cardFlowBalance: closing.cardFlowBalance,
        receivedCashAmount: closing.receivedCashAmount,
        receivedCardAmount: closing.receivedCardAmount,
        totalCashSale: closing.totalCashSale,
        totalCardSale: closing.totalCardSale,
        qty: closing.qty,
        note: closing.note,
        rejectReason: 'Deleted',
        actorId: admin.id,
        actorName: admin.name,
      },
    });

    return {
      success: true,
      message: 'Daily closing deleted successfully.',
    };
  }

  // --- internals ---

  private serialize(
    closing: DailyClosing & {
      agent?: { id: string; name: string; email: string };
      event?: {
        id: string;
        slug: string;
        translations?: Array<{ title: string }>;
      };
      signatureMedia?: { id: string; url: string } | null;
      signedPdfMedia?: { id: string; url: string } | null;
    },
  ) {
    return {
      id: closing.id,
      closing_code: closing.closingCode,
      agent_id: closing.agentId,
      agent_name: closing.agent?.name ?? null,
      agent_email: closing.agent?.email ?? null,
      event_id: closing.eventId,
      event_title: closing.event?.translations?.[0]?.title ?? closing.event?.slug ?? null,
      organization_id: closing.organizationId,
      closing_for_date: closing.closingForDate.toISOString().slice(0, 10),
      received_cash_amount: money(closing.receivedCashAmount),
      received_card_amount: money(closing.receivedCardAmount),
      total_cash_sale: money(closing.totalCashSale),
      total_card_sale: money(closing.totalCardSale),
      cash_flow_balance: money(closing.cashFlowBalance),
      card_flow_balance: money(closing.cardFlowBalance),
      qty: closing.qty,
      note: closing.note,
      reject_reason: closing.rejectReason,
      status: closing.status,
      signature_url: closing.signatureMedia?.url ?? null,
      signed_pdf_url: closing.signedPdfMedia?.url ?? null,
      created_at: closing.createdAt.toISOString(),
      updated_at: closing.updatedAt.toISOString(),
    };
  }

  private closingPdfInclude() {
    return {
      agent: { select: { id: true, name: true, email: true, phone: true } },
      event: {
        select: {
          id: true,
          slug: true,
          translations: {
            where: { locale: 'en' },
            take: 1,
            select: { title: true },
          },
        },
      },
      organization: { select: { id: true, name: true } },
      signatureMedia: { select: { id: true, url: true } },
      signedPdfMedia: { select: { id: true, url: true } },
    } as const;
  }

  private async requireClosing(id: string, admin: AuthenticatedAdmin) {
    const closing = await this.prisma.dailyClosing.findFirst({
      where: { id, deletedAt: null },
      include: this.closingPdfInclude(),
    });
    if (!closing) throw new NotFoundException('Daily closing not found.');

    const scope = await this.resolveScope(admin, closing.eventId);
    if (admin.role === 'pos' && closing.agentId !== admin.id) {
      throw new ForbiddenException('You can only access your own closings.');
    }
    if (
      scope.agentIds !== null &&
      !scope.agentIds.includes(closing.agentId) &&
      admin.role !== 'admin' &&
      admin.role !== 'super_admin'
    ) {
      throw new ForbiddenException('Closing is outside your scope.');
    }
    if (scope.eventIds && !scope.eventIds.includes(closing.eventId)) {
      throw new ForbiddenException('Closing is outside your event scope.');
    }
    return closing;
  }

  /**
   * Resolve which event a new closing belongs to.
   * Prefer explicit event_id; otherwise a single POS assignment for the agent.
   */
  private async resolveClosingEventId(
    admin: AuthenticatedAdmin,
    agentId: string,
    requestedEventId?: string,
  ): Promise<string> {
    const scope = await this.resolveScope(admin, requestedEventId);

    if (requestedEventId) {
      if (scope.eventIds && !scope.eventIds.includes(requestedEventId)) {
        throw new ForbiddenException('Event is outside your scope.');
      }
      const event = await this.prisma.event.findUnique({
        where: { id: requestedEventId },
        select: { id: true },
      });
      if (!event) throw new NotFoundException('Event not found.');
      return requestedEventId;
    }

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        userId: agentId,
        status: 'active',
        eventId: { not: null },
        role: { name: 'pos' },
        ...(scope.eventIds ? { eventId: { in: scope.eventIds } } : {}),
      },
      select: { eventId: true },
      distinct: ['eventId'],
    });
    const eventIds = assignments
      .map((row) => row.eventId)
      .filter((id): id is string => Boolean(id));

    if (eventIds.length === 1) return eventIds[0];
    if (eventIds.length === 0) {
      throw new BadRequestException(
        'Select an event for this daily closing (no POS event assignment found).',
      );
    }
    throw new BadRequestException(
      'Select an event for this daily closing (POS agent is assigned to multiple events).',
    );
  }

  /**
   * POS → self only.
   * Admin → unrestricted.
   * Finance-manager → POS agents assigned on overlapping events (or all if no event scope).
   */
  private async resolveScope(
    admin: AuthenticatedAdmin,
    eventId?: string,
  ): Promise<{ agentIds: string[] | null; eventIds: string[] | null }> {
    if (admin.role === 'admin' || admin.role === 'super_admin') {
      return {
        agentIds: null,
        eventIds: eventId ? [eventId] : null,
      };
    }
    if (admin.role === 'pos') {
      const eventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
      return {
        agentIds: [admin.id],
        eventIds: eventId
          ? eventIds && !eventIds.includes(eventId)
            ? []
            : [eventId]
          : eventIds,
      };
    }

    const eventIds = await this.staff.resolveReportEventIds(admin.id, admin.role);
    const scopedEvents = eventId
      ? eventIds === null
        ? [eventId]
        : eventIds.includes(eventId)
          ? [eventId]
          : []
      : eventIds;

    if (scopedEvents && scopedEvents.length === 0) {
      return { agentIds: [admin.id], eventIds: [] };
    }

    const assignments = await this.prisma.staffAssignment.findMany({
      where: {
        status: 'active',
        ...(scopedEvents ? { eventId: { in: scopedEvents } } : { eventId: { not: null } }),
        role: { name: 'pos' },
      },
      select: { userId: true },
    });
    const agentIds = [...new Set(assignments.map((a) => a.userId))];
    if (!agentIds.includes(admin.id)) agentIds.push(admin.id);

    // Finance managers with unrestricted event scope and no POS tree yet can still manage closings.
    if (
      admin.role === 'finance-manager' &&
      scopedEvents === null &&
      agentIds.length <= 1
    ) {
      return { agentIds: null, eventIds: null };
    }

    return { agentIds, eventIds: scopedEvents };
  }

  private async generateClosingCode(organizationId: string | null): Promise<string> {
    let prefix = 'DC';
    if (organizationId) {
      const org = await this.prisma.organization.findUnique({
        where: { id: organizationId },
        select: { name: true, slug: true },
      });
      const source = (org?.slug || org?.name || 'DC').replace(/[^a-zA-Z0-9]/g, '');
      prefix = (source.slice(0, 2) || 'DC').toUpperCase();
    }
    return `${prefix}-${Math.floor(10000 + Math.random() * 90000)}`;
  }

  private async writeHistory(
    closing: DailyClosing,
    admin: AuthenticatedAdmin,
    status: DailyClosingStatus,
  ) {
    await this.prisma.dailyClosingStatusHistory.create({
      data: {
        dailyClosingId: closing.id,
        closingCode: closing.closingCode,
        status,
        cashFlowBalance: closing.cashFlowBalance,
        cardFlowBalance: closing.cardFlowBalance,
        receivedCashAmount: closing.receivedCashAmount,
        receivedCardAmount: closing.receivedCardAmount,
        totalCashSale: closing.totalCashSale,
        totalCardSale: closing.totalCardSale,
        qty: closing.qty,
        note: closing.note,
        rejectReason: closing.rejectReason,
        actorId: admin.id,
        actorName: admin.name,
      },
    });
  }

  private async saveDataUrlImage(
    folder: string,
    dataUrl: string,
    uploadedByUserId: string,
  ): Promise<string> {
    const asset = await this.mediaStorage.uploadDataUrl({
      folder,
      dataUrl,
      maxBytes: 5 * 1024 * 1024,
      uploadedByUserId,
      errorLabel: 'signature',
    });
    return asset.id;
  }

  private async saveBufferFile(
    folder: string,
    file: Buffer,
    mimeType: string,
    extension: string,
    uploadedByUserId: string,
  ): Promise<string> {
    const asset = await this.mediaStorage.uploadBuffer({
      folder,
      buffer: file,
      mimeType,
      extension,
      uploadedByUserId,
    });
    return asset.id;
  }

  private async buildPdfBuffer(
    closing: DailyClosing & {
      agent?: { id: string; name: string; email: string; phone?: string | null };
      event?: {
        id: string;
        slug: string;
        translations?: Array<{ title: string }>;
      };
      organization?: { id: string; name: string } | null;
      signatureMedia?: { id: string; url: string } | null;
    },
    authorizedSignatureDataUrl?: string,
  ): Promise<Buffer> {
    const agent =
      closing.agent ??
      (await this.prisma.user.findUnique({
        where: { id: closing.agentId },
        select: { id: true, name: true, email: true, phone: true },
      }));

    const organization =
      closing.organization ??
      (closing.organizationId
        ? await this.prisma.organization.findUnique({
            where: { id: closing.organizationId },
            select: { id: true, name: true },
          })
        : null);

    const event =
      closing.event ??
      (await this.prisma.event.findUnique({
        where: { id: closing.eventId },
        select: {
          id: true,
          slug: true,
          translations: {
            where: { locale: 'en' },
            take: 1,
            select: { title: true },
          },
        },
      }));

    const currency = 'QAR';
    const cashBalance = money(closing.cashFlowBalance);
    const cardBalance = money(closing.cardFlowBalance);
    const receivedCash = money(closing.receivedCashAmount);
    const receivedCard = money(closing.receivedCardAmount);
    const expectedCash = money(closing.totalCashSale);
    const expectedCard = money(closing.totalCardSale);
    // Booking / POS sales total (what was sold), not what the agent handed in.
    const totalSale = round3(expectedCash + expectedCard);
    const totalCollected = round3(receivedCash + receivedCard);

    const eventTitle = event?.translations?.[0]?.title ?? event?.slug ?? null;
    const orgName = organization?.name ?? null;
    const createdAtLabel = closing.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const closingDate = closing.closingForDate.toISOString().slice(0, 10);

    const logoUrl =
      this.config.get<string>('DAILY_CLOSING_LOGO_URL') ||
      'https://bookingqube.blob.core.windows.net/bqcontainer/static/logo.png';
    const eeeqaLogoUrl =
      this.config.get<string>('DAILY_CLOSING_EEEQA_LOGO_URL') ||
      'https://bookingqube.blob.core.windows.net/bqcontainer/static/eeeqa-logo.png';
    const contactAddress = this.config.get<string>('CONTACT_ADDRESS') || '';
    const contactPhone = this.config.get<string>('CONTACT_PHONE') || '';
    const contactEmail = this.config.get<string>('CONTACT_EMAIL') || '';

    const [logoBuffer, eeeqaBuffer] = await Promise.all([
      this.fetchImageBuffer(logoUrl),
      this.fetchImageBuffer(eeeqaLogoUrl),
    ]);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
          Title: `Daily closing-#${closing.closingCode}${closing.createdAt.toISOString()}`,
          Author: 'BookingQube',
        },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (chunk) => chunks.push(chunk as Buffer));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width;
      const left = 50;
      const right = pageWidth - 50;
      const width = right - left;
      let y = 50;

      // Outer invoice box
      doc.roundedRect(40, 40, pageWidth - 80, doc.page.height - 80, 4).stroke('#eeeeee');

      // --- Header: logo + closing meta ---
      if (logoBuffer) {
        try {
          doc.image(logoBuffer, left, y, { fit: [135, 48] });
        } catch {
          doc.fontSize(18).fillColor('#333333').text('BookingQube', left, y);
        }
      } else {
        doc.fontSize(18).fillColor('#333333').text('BookingQube', left, y);
      }

      doc
        .fontSize(11)
        .fillColor('#555555')
        .text(`Daily closing #: ${closing.closingCode}`, left + width / 2, y, {
          width: width / 2,
          align: 'right',
        });
      doc.text(createdAtLabel, left + width / 2, y + 16, {
        width: width / 2,
        align: 'right',
      });
      if (eventTitle) {
        doc.text(eventTitle, left + width / 2, y + 32, {
          width: width / 2,
          align: 'right',
        });
      }
      y += 70;

      // --- Contact / agent information ---
      const infoTop = y;
      const leftInfo: string[] = [];
      if (contactAddress) leftInfo.push(contactAddress);
      if (contactPhone) leftInfo.push(contactPhone);
      if (contactEmail) leftInfo.push(contactEmail);
      if (!leftInfo.length) leftInfo.push('BookingQube');

      doc.fontSize(11).fillColor('#555555');
      doc.text(leftInfo.join('\n'), left, infoTop, { width: width / 2 - 10 });

      const rightInfo: string[] = [];
      if (orgName) rightInfo.push(orgName);
      if (agent?.name) rightInfo.push(agent.name);
      if (agent?.email) rightInfo.push(agent.email);
      if (agent?.phone) rightInfo.push(agent.phone);
      doc.text(rightInfo.join('\n'), left + width / 2, infoTop, {
        width: width / 2,
        align: 'right',
      });
      y = infoTop + Math.max(leftInfo.length, rightInfo.length) * 16 + 28;

      // --- Payment method summary ---
      y = this.drawPdfHeadingRow(
        doc,
        left,
        y,
        width,
        [
          { text: 'Payment Method', width: width * 0.4, align: 'left' },
          { text: 'Quantity', width: width * 0.25, align: 'left' },
          { text: 'Total sale #', width: width * 0.35, align: 'right' },
        ],
      );
      y = this.drawPdfDataRow(
        doc,
        left,
        y,
        width,
        [
          { text: 'Card/Cash', width: width * 0.4, align: 'left' },
          { text: String(closing.qty), width: width * 0.25, align: 'left' },
          {
            text: `${this.formatMoney(totalSale)} ${currency}`,
            width: width * 0.35,
            align: 'right',
          },
        ],
        false,
      );
      y += 28;

      // --- Item / Price breakdown ---
      y = this.drawPdfHeadingRow(
        doc,
        left,
        y,
        width,
        [
          { text: 'Item', width: width * 0.55, align: 'left' },
          { text: 'Price', width: width * 0.45, align: 'right' },
        ],
      );

      const items: Array<{ label: string; value: string }> = [
        {
          label: 'Expected (Card)',
          value: `${this.formatMoney(expectedCard)} ${currency}`,
        },
        {
          label: 'Expected (Cash)',
          value: `${this.formatMoney(expectedCash)} ${currency}`,
        },
        {
          label: 'Collected (Card)',
          value: `${this.formatMoney(receivedCard)} ${currency}`,
        },
        {
          label: 'Collected (Cash)',
          value: `${this.formatMoney(receivedCash)} ${currency}`,
        },
        {
          label: 'Discrepancy (Card)',
          value: `${this.formatMoney(cardBalance)} ${currency}`,
        },
        {
          label: 'Discrepancy (Cash)',
          value: `${this.formatMoney(cashBalance)} ${currency}`,
        },
        {
          label: 'Note',
          value: closing.note?.trim() || '—',
        },
      ];

      for (const item of items) {
        y = this.drawPdfDataRow(
          doc,
          left,
          y,
          width,
          [
            { text: item.label, width: width * 0.55, align: 'left' },
            { text: item.value, width: width * 0.45, align: 'right' },
          ],
          true,
        );
      }

      y += 8;
      doc
        .moveTo(left, y)
        .lineTo(right, y)
        .strokeColor('#eeeeee')
        .lineWidth(2)
        .stroke();
      y += 10;
      doc
        .fontSize(11)
        .fillColor('#555555')
        .font('Helvetica')
        .text(`Collected total : ${this.formatMoney(totalCollected)} ${currency}`, left, y, {
          width,
          align: 'right',
        });
      y += 16;
      doc
        .fontSize(12)
        .fillColor('#555555')
        .font('Helvetica-Bold')
        .text(`Total sale : ${this.formatMoney(totalSale)} ${currency}`, left, y, {
          width,
          align: 'right',
        })
        .font('Helvetica');
      y += 70;

      // --- Footer logos / authorized signature ---
      const footerY = Math.max(y, doc.page.height - 160);
      if (eeeqaBuffer) {
        try {
          doc.image(eeeqaBuffer, left, footerY, { fit: [100, 50] });
        } catch {
          /* ignore */
        }
      }

      const signX = left + width / 2;
      const signLines: string[] = [];
      if (orgName) signLines.push(orgName);
      signLines.push('Authorized signature');
      doc
        .fontSize(11)
        .fillColor('#555555')
        .text(signLines.join('\n'), signX, footerY, {
          width: width / 2,
          align: 'right',
        });

      let signatureImage: Buffer | null = null;
      if (authorizedSignatureDataUrl) {
        const match = authorizedSignatureDataUrl.match(
          /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/,
        );
        if (match) signatureImage = Buffer.from(match[1], 'base64');
      }
      if (signatureImage) {
        try {
          doc.image(signatureImage, signX + width / 2 - 110, footerY + 36, {
            fit: [100, 50],
            align: 'right',
          });
        } catch {
          doc
            .fontSize(9)
            .fillColor('#999999')
            .text('(signature image unavailable)', signX, footerY + 40, {
              width: width / 2,
              align: 'right',
            });
        }
      }

      // Small closing date / status footer note
      doc
        .fontSize(8)
        .fillColor('#999999')
        .text(`Closing date ${closingDate} · Status ${closing.status}`, left, doc.page.height - 55, {
          width,
          align: 'center',
        });

      doc.end();
    });
  }

  private formatMoney(value: number): string {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 3,
    });
  }

  private drawPdfHeadingRow(
    doc: PDFKit.PDFDocument,
    left: number,
    y: number,
    _width: number,
    cells: Array<{ text: string; width: number; align: 'left' | 'right' | 'center' }>,
  ): number {
    const height = 22;
    let x = left;
    const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
    doc.save();
    doc.rect(left, y, totalWidth, height).fill('#eeeeee');
    doc.restore();
    doc.fontSize(11).fillColor('#333333').font('Helvetica-Bold');
    for (const cell of cells) {
      doc.text(cell.text, x + 4, y + 5, {
        width: cell.width - 8,
        align: cell.align,
      });
      x += cell.width;
    }
    doc.font('Helvetica');
    doc
      .moveTo(left, y + height)
      .lineTo(left + totalWidth, y + height)
      .strokeColor('#dddddd')
      .lineWidth(1)
      .stroke();
    return y + height + 4;
  }

  private drawPdfDataRow(
    doc: PDFKit.PDFDocument,
    left: number,
    y: number,
    _width: number,
    cells: Array<{ text: string; width: number; align: 'left' | 'right' | 'center' }>,
    withBorder: boolean,
  ): number {
    const height = 22;
    let x = left;
    doc.fontSize(11).fillColor('#555555').font('Helvetica');
    for (const cell of cells) {
      doc.text(cell.text, x + 4, y + 4, {
        width: cell.width - 8,
        align: cell.align,
        lineBreak: false,
      });
      x += cell.width;
    }
    if (withBorder) {
      const totalWidth = cells.reduce((sum, cell) => sum + cell.width, 0);
      doc
        .moveTo(left, y + height)
        .lineTo(left + totalWidth, y + height)
        .strokeColor('#eeeeee')
        .lineWidth(1)
        .stroke();
    }
    return y + height;
  }

  private async fetchImageBuffer(url: string): Promise<Buffer | null> {
    if (!url) return null;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) return null;
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch {
      return null;
    }
  }
}
