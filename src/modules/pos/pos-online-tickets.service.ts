import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { AttendanceStatus, OrderItemType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { qatarDateKey } from '../admin-daily-closings/daily-closing-totals.service';
import { ReportingService } from '../reporting/reporting.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EntryAccess = {
  passType: 'rfid' | 'barcode' | 'other' | null;
  otherLabel: string;
  scanLength: number;
  codePool: Array<{
    code: string;
    ticketTypeId: string | null;
    ticketVariantId: string | null;
    status: 'active' | 'inactive';
  }>;
};

type AccessibleCatalogItem = {
  ticketTypeId: string;
  ticketVariantId: string | null;
};

const itemInclude = {
  order: {
    select: {
      commonOrder: true,
      status: true,
      paymentStatus: true,
      source: true,
      customerName: true,
      customerPhone: true,
      customerEmail: true,
      customer: { select: { phone: true } },
    },
  },
  eventSession: {
    select: {
      startsAt: true,
      endsAt: true,
      displayTime: true,
      status: true,
      eventDate: { select: { date: true } },
    },
  },
} satisfies Prisma.OrderItemInclude;

type TicketRecord = Prisma.OrderItemGetPayload<{ include: typeof itemInclude }>;

@Injectable()
export class PosOnlineTicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reporting: ReportingService,
  ) {}

  async search(agent: AuthenticatedPosAgent, rawQuery: string) {
    const query = rawQuery.trim();
    if (query.length < 3) throw new BadRequestException('Enter a phone number or ticket ID.');

    const access = await this.resolveAccess(agent);
    const allowedItemIds = [...access.catalog.keys()];
    if (!allowedItemIds.length) {
      return { success: true, data: { query, count: 0, ...this.accessPayload(access), tickets: [] } };
    }

    const digits = query.replace(/\D/g, '');
    const phoneNeedle = digits.length >= 8 ? digits.slice(-8) : digits;
    const isUuid = UUID_PATTERN.test(query);
    const searchOr: Prisma.OrderItemWhereInput[] = [
      { ticketCode: { equals: query, mode: 'insensitive' } },
      { qrCodePayload: { equals: query, mode: 'insensitive' } },
      { order: { commonOrder: { equals: query, mode: 'insensitive' } } },
      ...(isUuid ? [{ id: query }] : []),
      ...(phoneNeedle.length >= 3
        ? [
            { order: { customerPhone: { contains: phoneNeedle } } },
            { order: { customer: { phone: { contains: phoneNeedle } } } },
          ]
        : []),
    ];

    const tickets = await this.prisma.orderItem.findMany({
      where: {
        eventId: agent.eventId,
        parentOrderItemId: null,
        itemType: { in: TICKET_TYPES },
        itemId: { in: allowedItemIds },
        order: { source: { not: 'pos' } },
        OR: searchOr,
      },
      include: itemInclude,
      orderBy: [{ attendanceStatus: 'asc' }, { createdAt: 'desc' }],
      take: 50,
    });

    return {
      success: true,
      data: {
        query,
        count: tickets.length,
        ...this.accessPayload(access),
        tickets: tickets.map((ticket) => this.serialize(ticket, access.catalog.get(ticket.itemId))),
      },
    };
  }

  async use(agent: AuthenticatedPosAgent, ticketId: string, submittedRfids?: string[]) {
    if (!UUID_PATTERN.test(ticketId)) {
      throw new NotFoundException('Ticket not found.');
    }
    const access = await this.resolveAccess(agent);
    const ticket = await this.prisma.orderItem.findFirst({
      where: {
        id: ticketId,
        eventId: agent.eventId,
        parentOrderItemId: null,
        itemType: { in: TICKET_TYPES },
        itemId: { in: [...access.catalog.keys()] },
        order: { source: { not: 'pos' } },
      },
      include: itemInclude,
    });
    if (!ticket) throw new NotFoundException('Ticket not found or outside your access.');

    const catalogItem = access.catalog.get(ticket.itemId);
    const validity = this.validity(ticket);
    if (!validity.valid) throw new ConflictException(validity.message);

    const rfids = this.normalizeRfids(submittedRfids);
    if (this.requiresRfid(access.entryAccess)) {
      if (rfids.length !== ticket.quantity) {
        throw new BadRequestException(
          `Assign ${ticket.quantity} RFID${ticket.quantity === 1 ? '' : 's'} before using this ticket.`,
        );
      }
      if (new Set(rfids.map((rfid) => rfid.toLowerCase())).size !== rfids.length) {
        throw new BadRequestException('Each ticket unit must use a different RFID.');
      }
      this.assertRfidsAllowed(rfids, access.entryAccess, catalogItem);
      const alreadyAssigned = await this.prisma.orderItem.findFirst({
        where: { eventId: agent.eventId, rfidCodes: { hasSome: rfids } },
        select: { id: true },
      });
      if (alreadyAssigned) throw new ConflictException('One or more RFIDs are already assigned.');
    } else if (rfids.length) {
      throw new BadRequestException('This event does not require RFID assignment.');
    }

    const now = new Date();
    const updated = await this.prisma.orderItem.updateMany({
      where: { id: ticket.id, attendanceStatus: AttendanceStatus.not_checked_in },
      data: {
        attendanceStatus: AttendanceStatus.checked_in,
        checkedInAt: now,
        checkedInByUserId: agent.id,
        ...(rfids.length ? { rfidCodes: rfids } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException('This ticket has already been used.');
    }

    await this.reporting.syncAttendance({
      eventId: ticket.eventId,
      fromStatus: AttendanceStatus.not_checked_in,
      toStatus: AttendanceStatus.checked_in,
      quantity: ticket.quantity,
    }).catch(() => undefined);

    const usedTicket: TicketRecord = {
      ...ticket,
      attendanceStatus: AttendanceStatus.checked_in,
      checkedInAt: now,
      checkedInByUserId: agent.id,
      rfidCodes: rfids,
    };
    return {
      success: true,
      message: 'Ticket verified and used successfully.',
      data: {
        ...this.accessPayload(access),
        ticket: this.serialize(usedTicket, catalogItem),
      },
    };
  }

  private async resolveAccess(agent: AuthenticatedPosAgent) {
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
        event: { select: { moreOpsConfig: true } },
      },
    });
    if (!assignment) throw new UnauthorizedException('Invalid or expired POS assignment.');

    const vendorIds = [...new Set([
      ...assignment.thirdPartyVendorIds,
      assignment.thirdPartyVendorId,
    ].filter((id): id is string => Boolean(id)))];
    const ticketTypes = await this.prisma.ticketType.findMany({
      where: {
        eventId: agent.eventId,
        ...(assignment.ticketTypeIds.length ? { id: { in: assignment.ticketTypeIds } } : {}),
        ...(vendorIds.length ? { thirdPartyVendorId: { in: vendorIds } } : {}),
      },
      select: { id: true, variants: { select: { id: true } } },
    });
    const catalog = new Map<string, AccessibleCatalogItem>();
    for (const ticketType of ticketTypes) {
      catalog.set(ticketType.id, { ticketTypeId: ticketType.id, ticketVariantId: null });
      for (const variant of ticketType.variants) {
        catalog.set(variant.id, { ticketTypeId: ticketType.id, ticketVariantId: variant.id });
      }
    }
    return { catalog, entryAccess: this.parseEntryAccess(assignment.event?.moreOpsConfig) };
  }

  private parseEntryAccess(raw: Prisma.JsonValue | null | undefined): EntryAccess {
    const config = raw && typeof raw === 'object' && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const entry = config.entry_access && typeof config.entry_access === 'object' && !Array.isArray(config.entry_access)
      ? config.entry_access as Record<string, unknown>
      : {};
    const passType = entry.pass_type;
    const codePool = Array.isArray(entry.code_pool) ? entry.code_pool.flatMap((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const row = value as Record<string, unknown>;
      const code = typeof row.code === 'string' ? row.code.replace(/\s+/g, '').trim() : '';
      if (!code) return [];
      return [{
        code,
        ticketTypeId: typeof row.ticket_type_id === 'string' ? row.ticket_type_id : null,
        ticketVariantId: typeof row.ticket_variant_id === 'string' ? row.ticket_variant_id : null,
        status: row.status === 'inactive' ? 'inactive' as const : 'active' as const,
      }];
    }) : [];
    return {
      passType: passType === 'rfid' || passType === 'barcode' || passType === 'other' ? passType : null,
      otherLabel: typeof entry.other_label === 'string' ? entry.other_label : '',
      scanLength: typeof entry.scan_length === 'number' ? entry.scan_length : 8,
      codePool,
    };
  }

  private validity(ticket: TicketRecord) {
    if (ticket.attendanceStatus === AttendanceStatus.checked_in) {
      return { valid: false, status: 'used', message: 'This ticket has already been used.' };
    }
    if (ticket.attendanceStatus === AttendanceStatus.cancelled) {
      return { valid: false, status: 'cancelled', message: 'This ticket is cancelled.' };
    }
    if (ticket.order.status === 'refunded' || ticket.order.paymentStatus === 'refunded') {
      return { valid: false, status: 'refunded', message: 'This ticket has been refunded.' };
    }
    if (!['paid', 'partially_refunded'].includes(ticket.order.status)) {
      return { valid: false, status: 'unpaid', message: 'This ticket is not paid.' };
    }
    if (ticket.eventSession.status === 'cancelled') {
      return { valid: false, status: 'cancelled', message: 'This ticket session is cancelled.' };
    }
    const scheduledDate = ticket.eventSession.eventDate.date.toISOString().slice(0, 10);
    if (scheduledDate !== qatarDateKey()) {
      return {
        valid: false,
        status: 'wrong_date',
        message: `This ticket is valid on ${scheduledDate}, not today.`,
      };
    }
    return { valid: true, status: 'valid', message: 'Valid and ready to use.' };
  }

  private serialize(ticket: TicketRecord, catalogItem?: AccessibleCatalogItem) {
    const validity = this.validity(ticket);
    return {
      id: ticket.id,
      ticket_id: ticket.ticketCode,
      qr_code: ticket.qrCodePayload,
      order_id: ticket.order.commonOrder,
      title: ticket.displayName,
      quantity: ticket.quantity,
      admits: ticket.quantity * Math.max(1, ticket.admitCount),
      customer: {
        name: ticket.order.customerName,
        phone: ticket.order.customerPhone || ticket.order.customer.phone || '',
        email: ticket.order.customerEmail,
      },
      schedule: {
        date: ticket.eventSession.eventDate.date.toISOString().slice(0, 10),
        time: ticket.eventSession.displayTime,
        starts_at: ticket.eventSession.startsAt.toISOString(),
        ends_at: ticket.eventSession.endsAt?.toISOString() ?? null,
      },
      status: validity.status,
      valid: validity.valid,
      status_message: validity.message,
      used_at: ticket.checkedInAt?.toISOString() ?? null,
      rfids: ticket.rfidCodes,
      catalog: catalogItem ?? null,
    };
  }

  private requiresRfid(entry: EntryAccess) {
    return entry.passType === 'rfid' || entry.passType === 'other';
  }

  private normalizeRfids(values: string[] | undefined) {
    if (!Array.isArray(values)) return [];
    return values.map((value) => String(value).replace(/\s+/g, '').trim()).filter(Boolean);
  }

  private assertRfidsAllowed(
    rfids: string[],
    entry: EntryAccess,
    catalogItem?: AccessibleCatalogItem,
  ) {
    if (entry.passType !== 'rfid') return;
    for (const submitted of rfids) {
      const poolItem = entry.codePool.find(
        (row) => row.status === 'active' && row.code.toLowerCase() === submitted.toLowerCase(),
      );
      if (!poolItem) throw new BadRequestException(`RFID ${submitted} is not available for this event.`);
      if (
        (poolItem.ticketTypeId && poolItem.ticketTypeId !== catalogItem?.ticketTypeId) ||
        (poolItem.ticketVariantId && poolItem.ticketVariantId !== catalogItem?.ticketVariantId)
      ) {
        throw new BadRequestException(`RFID ${submitted} is not assigned to this ticket type.`);
      }
    }
  }

  private accessPayload(access: { entryAccess: EntryAccess }) {
    return {
      entry_access: {
        pass_type: access.entryAccess.passType,
        other_label: access.entryAccess.otherLabel,
        scan_length: access.entryAccess.scanLength,
        rfid_required: this.requiresRfid(access.entryAccess),
      },
    };
  }
}
