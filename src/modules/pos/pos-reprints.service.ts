import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderItemType, Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { qatarDateKey } from '../admin-daily-closings/daily-closing-totals.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

const TICKET_TYPES: OrderItemType[] = [
  OrderItemType.ticket_type,
  OrderItemType.ticket_variant,
];
const ADDON_TYPES: OrderItemType[] = [
  OrderItemType.addon,
  OrderItemType.addon_variant,
];

function money(value: Prisma.Decimal | number | null | undefined) {
  return value == null ? 0 : Number(value);
}

function qatarDayBounds(date: string) {
  const start = new Date(`${date}T00:00:00.000+03:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(start.getTime())) {
    throw new BadRequestException('Enter a valid booking date.');
  }
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function timeExtensions(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const rows = (metadata as Record<string, unknown>).time_extensions;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const title = typeof row.title === 'string' ? row.title.trim() : '';
    if (!title) return [];
    return [{
      title,
      quantity: Number(row.quantity) || 1,
      price: Number(row.price) || 0,
      minutes: Number(row.minutes) || 0,
      rfid: typeof row.targetRfid === 'string' ? row.targetRfid : null,
    }];
  });
}

@Injectable()
export class PosReprintsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(agent: AuthenticatedPosAgent, requestedDate?: string, rawSearch = '') {
    const today = qatarDateKey();
    const date = requestedDate?.slice(0, 10) || today;
    const { start, end } = qatarDayBounds(date);
    if (date > today) throw new BadRequestException('Booking date cannot be in the future.');

    const search = rawSearch.trim();
    const phone = search.replace(/\D/g, '');
    const searchFilter: Prisma.OrderWhereInput = search
      ? {
          OR: [
            { bookedByAgentId: agent.id, commonOrder: { contains: search, mode: 'insensitive' } },
            { bookedByAgentId: agent.id, customerName: { contains: search, mode: 'insensitive' } },
            { bookedByAgentId: agent.id, customerEmail: { contains: search, mode: 'insensitive' } },
            { bookedByAgentId: agent.id, customerPhone: { contains: search, mode: 'insensitive' } },
            ...(phone.length >= 3
              ? [{ bookedByAgentId: agent.id, customerPhone: { contains: phone } }]
              : []),
            {
              bookedByAgentId: agent.id,
              items: {
                some: {
                  OR: [
                    { displayName: { contains: search, mode: 'insensitive' } },
                    { ticketCode: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            },
            {
              bookedByAgentId: agent.id,
              commonOrder: { equals: search, mode: 'insensitive' },
            },
            {
              bookedByAgentId: agent.id,
              items: {
                some: { ticketCode: { equals: search, mode: 'insensitive' } },
              },
            },
          ],
        }
      : { bookedByAgentId: agent.id };

    const orders = await this.prisma.order.findMany({
      where: {
        eventId: agent.eventId,
        status: { in: ['paid', 'refunded', 'partially_refunded'] },
        cancelledAt: null,
        OR: [
          { paidAt: { gte: start, lt: end } },
          { AND: [{ paidAt: null }, { createdAt: { gte: start, lt: end } }] },
        ],
        AND: [searchFilter],
      },
      select: {
        id: true,
        commonOrder: true,
        status: true,
        currency: true,
        totalAmount: true,
        discountAmount: true,
        paymentMode: true,
        paymentMethodLabel: true,
        customerName: true,
        customerEmail: true,
        customerPhone: true,
        customerAgeGroup: true,
        customerGeographicRegion: true,
        eventTitle: true,
        createdAt: true,
        paidAt: true,
        metadata: true,
        bookedByAgent: { select: { name: true } },
        event: {
          select: {
            translations: {
              where: { locale: 'ar' },
              select: { title: true },
              take: 1,
            },
          },
        },
        items: {
          where: { parentOrderItemId: null },
          select: {
            id: true,
            itemType: true,
            displayName: true,
            quantity: true,
            unitPrice: true,
            totalAmount: true,
            ticketCode: true,
            rfidCodes: true,
            childItems: {
              select: {
                id: true,
                displayName: true,
                quantity: true,
                unitPrice: true,
                totalAmount: true,
              },
            },
          },
        },
      },
      orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    });

    return {
      success: true,
      data: {
        date,
        today,
        query: search,
        count: orders.length,
        orders: orders.map((order) => ({
          id: order.id,
          common_order: order.commonOrder,
          status: order.status,
          currency: order.currency,
          total: money(order.totalAmount),
          discount: money(order.discountAmount),
          payment_method: this.paymentMethod(order.paymentMode, order.paymentMethodLabel),
          customer: {
            name: order.customerName,
            email: order.customerEmail,
            phone: order.customerPhone,
            age_group: order.customerAgeGroup,
            nationality: order.customerGeographicRegion,
          },
          event: {
            title: order.eventTitle,
            title_ar: order.event.translations[0]?.title ?? null,
          },
          booked_by: order.bookedByAgent?.name ?? null,
          created_at: order.createdAt.toISOString(),
          paid_at: (order.paidAt ?? order.createdAt).toISOString(),
          tickets: order.items.filter((item) => TICKET_TYPES.includes(item.itemType)).map((item) => ({
            id: item.id,
            title: item.displayName,
            quantity: item.quantity,
            unit_price: money(item.unitPrice),
            total: money(item.totalAmount),
            ticket_code: item.ticketCode,
            rfids: item.rfidCodes,
            customizations: item.childItems.map((child) => ({
              id: child.id,
              title: child.displayName,
              quantity: child.quantity,
              unit_price: money(child.unitPrice),
              total: money(child.totalAmount),
            })),
          })),
          addons: order.items.filter((item) => ADDON_TYPES.includes(item.itemType)).map((item) => ({
            id: item.id,
            title: item.displayName,
            quantity: item.quantity,
            unit_price: money(item.unitPrice),
            total: money(item.totalAmount),
          })),
          time_extensions: timeExtensions(order.metadata),
        })),
      },
    };
  }

  private paymentMethod(mode: string, label: string) {
    if (mode === 'offline_cash') return 'cash';
    if (mode === 'offline_card') return 'card';
    return mode === 'online' ? label || 'Online' : mode;
  }
}
