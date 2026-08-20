import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderItemType, PaymentLegType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../database/prisma.service';
import {
  createOfflinePaymentLegs,
  normalizeOfflinePayment,
  resolveTenderAmounts,
  roundMoney,
} from '../checkout/offline-payment.helpers';
import { ReportingService } from '../reporting/reporting.service';
import { CreatePosRebookDto } from './dto/pos-rebook.dto';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type TimeExtension = {
  id: string;
  title: string;
  titleAr: string;
  minutes: number;
  price: number;
  scope: 'ticket' | 'order';
  ticketIds: string[];
};

function extensionItemId(id: string) {
  if (UUID_PATTERN.test(id)) return id;
  const hash = createHash('md5').update(`bookingqube:time-extension:${id}`).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

function entryAccess(raw: Prisma.JsonValue | null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { pass_type: null, other_label: '', scan_length: 10 };
  }
  const config = raw as Record<string, unknown>;
  const entry = config.entry_access && typeof config.entry_access === 'object' && !Array.isArray(config.entry_access)
    ? config.entry_access as Record<string, unknown>
    : {};
  const passType = entry.pass_type;
  return {
    pass_type: passType === 'rfid' || passType === 'barcode' || passType === 'other' ? passType : null,
    other_label: typeof entry.other_label === 'string' ? entry.other_label : '',
    scan_length: typeof entry.scan_length === 'number'
      ? Math.min(64, Math.max(4, Math.round(entry.scan_length)))
      : 10,
  };
}

function timeExtensions(raw: Prisma.JsonValue | null): TimeExtension[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const rows = (raw as Record<string, unknown>).time_extensions;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id.trim() : '';
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!id || !title) return [];
    return [{
      id,
      title,
      titleAr: typeof row.title_ar === 'string' ? row.title_ar.trim() : '',
      minutes: Number(row.minutes ?? row.duration) || 30,
      price: roundMoney(Number(row.price) || 0),
      scope: row.scope === 'order' ? 'order' as const : 'ticket' as const,
      ticketIds: Array.isArray(row.ticket_ids)
        ? row.ticket_ids.map(String).map((item) => item.trim()).filter(Boolean)
        : [],
    }];
  });
}

@Injectable()
export class PosRebooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reporting: ReportingService,
  ) {}

  async config(agent: AuthenticatedPosAgent) {
    const event = await this.prisma.event.findFirst({
      where: { id: agent.eventId },
      select: { moreOpsConfig: true },
    });
    if (!event) throw new NotFoundException('Assigned event not found.');
    return { success: true, data: { entry_access: entryAccess(event.moreOpsConfig) } };
  }

  async lookup(
    agent: AuthenticatedPosAgent,
    input: { code?: string; search?: string; ticketItemId?: string },
  ) {
    const ticketItemId = input.ticketItemId?.trim();
    const code = input.code?.replace(/\s+/g, '').trim();
    const search = input.search?.trim();

    if (ticketItemId || code) {
      const item = await this.findTicket(agent, ticketItemId
        ? { id: ticketItemId }
        : {
            OR: [
              { rfidCodes: { has: code! } },
              { ticketCode: { equals: code!, mode: 'insensitive' } },
              { qrCodePayload: { equals: code!, mode: 'insensitive' } },
            ],
          });
      return { success: true, data: await this.detail(agent, item) };
    }

    if (!search || search.length < 2) {
      throw new BadRequestException('Enter an RFID, ticket code, customer name, or phone number.');
    }
    const digits = search.replace(/\D/g, '');
    const items = await this.prisma.orderItem.findMany({
      where: {
        eventId: agent.eventId,
        parentOrderItemId: null,
        itemType: { in: TICKET_TYPES },
        order: {
          status: { in: ['paid', 'partially_refunded'] },
          cancelledAt: null,
          OR: [
            { customerName: { contains: search, mode: 'insensitive' } },
            { customerEmail: { contains: search, mode: 'insensitive' } },
            { customerPhone: { contains: search, mode: 'insensitive' } },
            ...(digits.length >= 3 ? [{ customerPhone: { contains: digits } }] : []),
            { commonOrder: { contains: search, mode: 'insensitive' } },
          ],
        },
      },
      select: {
        id: true,
        displayName: true,
        ticketCode: true,
        rfidCodes: true,
        createdAt: true,
        order: {
          select: {
            commonOrder: true,
            customerName: true,
            customerEmail: true,
            customerPhone: true,
            paidAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return {
      success: true,
      data: {
        multiple: true,
        matches: items.map((item) => ({
          ticket_item_id: item.id,
          code: item.rfidCodes[0] ?? item.ticketCode,
          common_order: item.order.commonOrder,
          ticket_title: item.displayName,
          customer_name: item.order.customerName,
          customer_email: item.order.customerEmail,
          customer_phone: item.order.customerPhone,
          paid_at: (item.order.paidAt ?? item.createdAt).toISOString(),
        })),
      },
    };
  }

  async create(agent: AuthenticatedPosAgent, body: CreatePosRebookDto) {
    const existing = await this.prisma.order.findUnique({
      where: { idempotencyKey: body.idempotency_key },
      select: { id: true, commonOrder: true, totalAmount: true, currency: true },
    });
    if (existing) {
      return {
        success: true,
        message: 'Rebook already completed.',
        data: {
          id: existing.id,
          common_order: existing.commonOrder,
          total: Number(existing.totalAmount),
          currency: existing.currency,
        },
      };
    }

    const item = await this.findTicket(agent, { id: body.ticket_item_id });
    const catalog = await this.catalogForItem(agent, item);
    const configuredExtensions = timeExtensions(item.event.moreOpsConfig).filter((extension) =>
      extension.scope === 'order' ||
      extension.ticketIds.length === 0 ||
      extension.ticketIds.includes(catalog.ticketType.externalKey),
    );
    const selectedExtensionIds = [...new Set(body.extension_ids)];
    const selectedExtensions = selectedExtensionIds.map((id) => {
      const extension = configuredExtensions.find((option) => option.id === id);
      if (!extension) throw new BadRequestException(`Time extension ${id} is not available for this ticket.`);
      return extension;
    });
    const quantities = new Map<string, number>();
    for (const selected of body.customizations) {
      quantities.set(selected.option_id, (quantities.get(selected.option_id) ?? 0) + selected.quantity);
    }
    const selectedCustomizations = [...quantities].map(([id, quantity]) => {
      const option = catalog.ticketType.customizationOptions.find((row) => row.id === id);
      if (!option) throw new BadRequestException(`Activity ${id} is not available for this ticket.`);
      if (quantity > (option.maxQtyPerTicket ?? 20)) {
        throw new BadRequestException(`${option.name} allows a maximum quantity of ${option.maxQtyPerTicket ?? 20}.`);
      }
      return {
        id: option.id,
        title: option.name,
        description: option.description,
        quantity,
        unitPrice: Number(option.price),
        durationMinutes: option.durationMinutes,
      };
    });
    if (!selectedExtensions.length && !selectedCustomizations.length) {
      throw new BadRequestException('Select a time extension or activity.');
    }

    const lines = [
      ...selectedExtensions.map((extension) => ({
        itemId: extensionItemId(extension.id),
        publicId: extension.id,
        title: extension.title,
        titleAr: extension.titleAr,
        quantity: 1,
        unitPrice: extension.price,
        durationMinutes: extension.minutes,
        kind: 'time_extension' as const,
      })),
      ...selectedCustomizations.map((option) => ({
        itemId: option.id,
        publicId: option.id,
        title: option.title,
        titleAr: '',
        quantity: option.quantity,
        unitPrice: option.unitPrice,
        durationMinutes: option.durationMinutes ?? 0,
        kind: 'activity' as const,
      })),
    ];
    const total = roundMoney(lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0));
    const offline = normalizeOfflinePayment({ mode: body.payment_method, agent_id: agent.id }, agent.id)!;
    const tender = resolveTenderAmounts(offline, total, true);
    const now = new Date();
    const commonOrder = `BQ-RB-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 4).toUpperCase()}`;
    const paymentMode = body.payment_method === 'cash' ? 'offline_cash' as const : 'offline_card' as const;
    const paymentLabel = body.payment_method === 'cash' ? 'Cash' : 'Card';

    const created = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          commonOrder,
          idempotencyKey: body.idempotency_key,
          customerId: item.order.customerId,
          eventId: item.eventId,
          eventSessionId: item.eventSessionId,
          status: 'paid',
          paymentStatus: 'paid',
          currency: item.order.currency,
          subtotalAmount: total,
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: total,
          source: 'pos_rebook',
          locale: 'en',
          metadata: {
            source: 'pos_rebook',
            rebook: {
              original_order_id: item.order.id,
              original_common_order: item.order.commonOrder,
              ticket_item_id: item.id,
              ticket_code: item.ticketCode,
              rfid: item.rfidCodes[0] ?? null,
            },
            time_extensions: selectedExtensions.map((extension) => ({
              id: extension.id,
              title: extension.title,
              title_ar: extension.titleAr,
              quantity: 1,
              price: extension.price,
              minutes: extension.minutes,
              targetRfid: item.rfidCodes[0] ?? null,
            })),
          },
          paidAt: now,
          organizationId: item.order.organizationId,
          venueId: item.order.venueId,
          eventSlug: item.order.eventSlug,
          eventTitle: item.order.eventTitle,
          eventStartDate: item.order.eventStartDate,
          eventStartTime: item.order.eventStartTime,
          customerName: item.order.customerName,
          customerEmail: item.order.customerEmail,
          customerPhone: item.order.customerPhone,
          customerAgeGroup: item.order.customerAgeGroup,
          customerGeographicRegion: item.order.customerGeographicRegion,
          customerGender: item.order.customerGender,
          paymentMode,
          paymentMethodLabel: paymentLabel,
          cashAmount: tender.cashAmount,
          cardAmount: tender.cardAmount,
          onlineAmount: 0,
          compAmount: 0,
          bookedByAgentId: agent.id,
          ticketsNet: 0,
          addonsNet: 0,
          extensionsNet: total,
          totalQuantity: 0,
          totalAdmits: 0,
          isSummerCamp: item.order.isSummerCamp,
          reportVersion: 1,
          reportSyncPending: false,
        },
      });
      await tx.orderItem.createMany({
        data: lines.map((line) => ({
          orderId: order.id,
          eventId: item.eventId,
          eventSessionId: item.eventSessionId,
          inventoryItemId: null,
          itemType: OrderItemType.customization,
          itemId: line.itemId,
          parentOrderItemId: null,
          displayName: line.title,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          subtotalAmount: roundMoney(line.unitPrice * line.quantity),
          discountAmount: 0,
          taxAmount: 0,
          totalAmount: roundMoney(line.unitPrice * line.quantity),
          currency: item.order.currency,
          ticketCode: null,
          rfidCodes: item.rfidCodes,
          visitorType: 'paid' as const,
          thirdPartyVendorId: item.thirdPartyVendorId,
          admitCount: 0,
          ticketIsCafe: false,
          ticketIsPosOnly: true,
          ticketHideFromOnline: true,
          bookedByAgentId: agent.id,
        })),
      });
      await createOfflinePaymentLegs(tx, {
        orderId: order.id,
        offline,
        totalAmount: total,
        currency: item.order.currency,
        defaultLegType: body.payment_method === 'cash' ? PaymentLegType.cash : PaymentLegType.card,
        collectedByUserId: agent.id,
        now,
      });
      return order;
    });

    await this.reporting.syncOrder({ orderId: created.id, action: 'paid' });
    return {
      success: true,
      message: 'Rebook completed successfully.',
      data: {
        id: created.id,
        common_order: created.commonOrder,
        original_common_order: item.order.commonOrder,
        total,
        currency: item.order.currency,
        payment_method: body.payment_method,
        customer: {
          name: item.order.customerName,
          email: item.order.customerEmail,
          phone: item.order.customerPhone,
        },
        event: {
          title: item.order.eventTitle,
          title_ar: item.event.translations[0]?.title ?? null,
        },
        ticket: {
          title: item.displayName,
          code: item.ticketCode,
          rfid: item.rfidCodes[0] ?? null,
        },
        lines: lines.map((line) => ({
          id: line.publicId,
          kind: line.kind,
          title: line.title,
          title_ar: line.titleAr,
          quantity: line.quantity,
          unit_price: line.unitPrice,
          duration_minutes: line.durationMinutes,
        })),
        paid_at: now.toISOString(),
      },
    };
  }

  private async findTicket(agent: AuthenticatedPosAgent, where: Prisma.OrderItemWhereInput) {
    const item = await this.prisma.orderItem.findFirst({
      where: {
        ...where,
        eventId: agent.eventId,
        parentOrderItemId: null,
        itemType: { in: TICKET_TYPES },
        order: { status: { in: ['paid', 'partially_refunded'] }, cancelledAt: null },
      },
      include: {
        order: true,
        event: { include: { translations: { where: { locale: 'ar' }, take: 1 } } },
      },
    });
    if (!item) throw new NotFoundException('Ticket not found for this event.');
    return item;
  }

  private async catalogForItem(
    agent: AuthenticatedPosAgent,
    item: Awaited<ReturnType<PosRebooksService['findTicket']>>,
  ) {
    const ticketType = item.itemType === OrderItemType.ticket_type
      ? await this.prisma.ticketType.findFirst({
          where: { id: item.itemId, eventId: agent.eventId },
          include: { customizationOptions: { where: { status: 'active' }, orderBy: { sortOrder: 'asc' } } },
        })
      : (await this.prisma.ticketVariant.findFirst({
          where: { id: item.itemId, ticketType: { eventId: agent.eventId } },
          include: { ticketType: { include: { customizationOptions: { where: { status: 'active' }, orderBy: { sortOrder: 'asc' } } } } },
        }))?.ticketType;
    if (!ticketType) throw new NotFoundException('Ticket catalog entry is no longer available.');
    if (agent.ticketTypeIds.length && !agent.ticketTypeIds.includes(ticketType.id)) {
      throw new NotFoundException('Ticket is outside your assigned access.');
    }
    if (agent.thirdPartyVendorIds.length && (!item.thirdPartyVendorId || !agent.thirdPartyVendorIds.includes(item.thirdPartyVendorId))) {
      throw new NotFoundException('Ticket is outside your vendor access.');
    }
    return { ticketType };
  }

  private async detail(
    agent: AuthenticatedPosAgent,
    item: Awaited<ReturnType<PosRebooksService['findTicket']>>,
  ) {
    const catalog = await this.catalogForItem(agent, item);
    const extensions = timeExtensions(item.event.moreOpsConfig).filter((extension) =>
      extension.scope === 'order' ||
      extension.ticketIds.length === 0 ||
      extension.ticketIds.includes(catalog.ticketType.externalKey),
    );
    return {
      multiple: false,
      currency: item.order.currency,
      booking: {
        id: item.order.id,
        common_order: item.order.commonOrder,
        customer_name: item.order.customerName,
        customer_email: item.order.customerEmail,
        customer_phone: item.order.customerPhone,
        event_title: item.order.eventTitle,
        event_title_ar: item.event.translations[0]?.title ?? null,
        paid_at: (item.order.paidAt ?? item.order.createdAt).toISOString(),
      },
      ticket: {
        item_id: item.id,
        title: item.displayName,
        ticket_code: item.ticketCode,
        rfids: item.rfidCodes,
        attendance_status: item.attendanceStatus,
        checked_in_at: item.checkedInAt?.toISOString() ?? null,
      },
      entry_access: entryAccess(item.event.moreOpsConfig),
      time_extensions: extensions.map((extension) => ({
        id: extension.id,
        title: extension.title,
        title_ar: extension.titleAr,
        minutes: extension.minutes,
        price: extension.price,
      })),
      activities: catalog.ticketType.customizationOptions.map((option) => ({
        id: option.id,
        title: option.name,
        description: option.description ?? '',
        price: Number(option.price),
        duration_minutes: option.durationMinutes,
        max_qty: option.maxQtyPerTicket ?? 20,
      })),
    };
  }
}
