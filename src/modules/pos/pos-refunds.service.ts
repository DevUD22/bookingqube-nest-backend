import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { OrderItemType, PaymentStatus, PaymentTransactionStatus, Prisma, RefundStatus } from '@prisma/client';

import { upgradeHashIfNeeded, verifyPassword } from '../../common/crypto/password';
import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { ReportingService } from '../reporting/reporting.service';
import { CreatePosRefundDto } from './dto/pos-refund.dto';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

const TICKET_TYPES: OrderItemType[] = [OrderItemType.ticket_type, OrderItemType.ticket_variant];

@Injectable()
export class PosRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly reporting: ReportingService,
  ) {}

  async lookup(agent: AuthenticatedPosAgent, rawSearch: string) {
    const search = rawSearch.trim();
    if (search.length < 2) throw new BadRequestException('Enter an order, ticket code, RFID, customer name, phone, or email.');
    const digits = search.replace(/\D/g, '');
    const orders = await this.prisma.order.findMany({
      where: {
        eventId: agent.eventId,
        status: { in: ['paid', 'refunded'] },
        cancelledAt: null,
        ...(agent.thirdPartyVendorIds.length ? { items: { some: { thirdPartyVendorId: { in: agent.thirdPartyVendorIds } } } } : {}),
        OR: [
          { commonOrder: { contains: search, mode: 'insensitive' } },
          { customerName: { contains: search, mode: 'insensitive' } },
          { customerEmail: { contains: search, mode: 'insensitive' } },
          { customerPhone: { contains: search, mode: 'insensitive' } },
          ...(digits.length >= 3 ? [{ customerPhone: { contains: digits } }] : []),
          { items: { some: { OR: [
            { ticketCode: { contains: search, mode: 'insensitive' } },
            { qrCodePayload: { contains: search, mode: 'insensitive' } },
            { rfidCodes: { has: search.replace(/\s/g, '') } },
          ] } } },
        ],
      },
      include: {
        items: { where: { parentOrderItemId: null }, orderBy: { createdAt: 'asc' } },
        payments: { where: { status: PaymentTransactionStatus.paid }, orderBy: { createdAt: 'asc' } },
      },
      orderBy: { paidAt: 'desc' },
      take: 30,
    });
    const access = await Promise.all(orders.map((order) => this.hasFullOrderAccess(agent, order.items)));
    return { success: true, data: { orders: orders.filter((_, index) => access[index]).map((order) => this.serialize(order)) } };
  }

  async create(agent: AuthenticatedPosAgent, body: CreatePosRefundDto) {
    const user = await this.prisma.user.findUnique({ where: { id: agent.id }, select: { passwordHash: true } });
    if (!user?.passwordHash || !(await verifyPassword(body.password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect POS password.');
    }
    void upgradeHashIfNeeded(body.password, user.passwordHash)
      .then((upgradedHash) =>
        upgradedHash
          ? this.prisma.user.update({
              where: { id: agent.id },
              data: { passwordHash: upgradedHash },
            })
          : undefined,
      )
      .catch(() => undefined);
    const order = await this.prisma.order.findFirst({
      where: {
        id: body.order_id,
        eventId: agent.eventId,
        ...(agent.thirdPartyVendorIds.length ? { items: { some: { thirdPartyVendorId: { in: agent.thirdPartyVendorIds } } } } : {}),
      },
      include: {
        items: true,
        payments: { where: { status: PaymentTransactionStatus.paid } },
      },
    });
    if (!order) throw new NotFoundException('Order not found for this event.');
    if (!(await this.hasFullOrderAccess(agent, order.items))) {
      throw new NotFoundException('The full order is outside your assigned ticket or vendor access.');
    }
    if (order.status === 'refunded') throw new BadRequestException('This order has already been refunded.');
    if (order.status !== 'paid') throw new BadRequestException('Only fully paid orders can be refunded here.');
    if (!order.payments.length) throw new BadRequestException('No completed payment was found for this order.');
    if (order.payments.some((payment) => payment.provider !== 'internal')) {
      throw new BadRequestException('Online gateway payments must be refunded from the admin portal.');
    }

    const inventoryDeltas = order.items.filter((item) => item.inventoryItemId).map((item) => ({
      inventoryItemId: item.inventoryItemId!, quantity: item.quantity,
    }));

    const now = new Date();
    try {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ status: string }>>(
          Prisma.sql`SELECT status::text AS status FROM "orders" WHERE id = ${order.id}::uuid FOR UPDATE`,
        );
        const lockedStatus = locked[0]?.status;
        if (lockedStatus === 'refunded') {
          throw new BadRequestException('This order has already been refunded.');
        }
        if (lockedStatus !== 'paid') {
          throw new BadRequestException('Only fully paid orders can be refunded here.');
        }

        for (const payment of order.payments) {
          await tx.refund.create({ data: {
            orderId: order.id,
            paymentId: payment.id,
            status: RefundStatus.succeeded,
            amount: payment.amount,
            currency: payment.currency,
            reason: body.reason.trim(),
            providerResponse: { source: 'pos', offline: true },
            createdByUserId: agent.id,
            completedAt: now,
          } });
          await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentTransactionStatus.refunded } });
        }
        await tx.order.update({ where: { id: order.id }, data: {
          status: 'refunded',
          paymentStatus: PaymentStatus.refunded,
          reportVersion: { increment: 1 },
          metadata: this.refundMetadata(order.metadata, agent.id, body.reason, now),
        } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('This order has already been refunded.');
      }
      throw error;
    }

    if (inventoryDeltas.length) await this.inventory.releaseSold(inventoryDeltas);
    await this.reporting.syncOrder({ orderId: order.id, action: 'refund' });
    return { success: true, message: 'Refund completed successfully.', data: {
      order_id: order.id,
      common_order: order.commonOrder,
      status: 'refunded',
      amount: Number(order.totalAmount),
      currency: order.currency,
      refunded_at: now.toISOString(),
    } };
  }

  private serialize(order: Prisma.OrderGetPayload<{ include: { items: true; payments: true } }>) {
    const tickets = order.items.filter((item) => TICKET_TYPES.includes(item.itemType));
    const offline = order.payments.length > 0 && order.payments.every((payment) => payment.provider === 'internal');
    return {
      id: order.id,
      common_order: order.commonOrder,
      status: order.status,
      currency: order.currency,
      total: Number(order.totalAmount),
      payment_method: order.paymentMethodLabel,
      customer: { name: order.customerName, email: order.customerEmail, phone: order.customerPhone },
      paid_at: (order.paidAt ?? order.createdAt).toISOString(),
      tickets: tickets.map((item) => ({ id: item.id, title: item.displayName, quantity: item.quantity, code: item.rfidCodes[0] ?? item.ticketCode })),
      refundable: order.status === 'paid' && offline,
      refund_block_reason: order.status === 'refunded' ? 'Already refunded' : !offline ? 'Online payments must be refunded from admin' : null,
    };
  }

  private async hasFullOrderAccess(
    agent: AuthenticatedPosAgent,
    items: { itemType: OrderItemType; itemId: string; thirdPartyVendorId: string | null }[],
  ) {
    const tickets = items.filter((item) => TICKET_TYPES.includes(item.itemType));
    if (agent.thirdPartyVendorIds.length && tickets.some((item) => !item.thirdPartyVendorId || !agent.thirdPartyVendorIds.includes(item.thirdPartyVendorId))) return false;
    if (!agent.ticketTypeIds.length) return true;
    const variantIds = tickets.filter((item) => item.itemType === OrderItemType.ticket_variant).map((item) => item.itemId);
    const variants = variantIds.length ? await this.prisma.ticketVariant.findMany({ where: { id: { in: variantIds } }, select: { id: true, ticketTypeId: true } }) : [];
    const variantTicketTypes = new Map(variants.map((variant) => [variant.id, variant.ticketTypeId]));
    return tickets.every((item) => agent.ticketTypeIds.includes(item.itemType === OrderItemType.ticket_type ? item.itemId : variantTicketTypes.get(item.itemId) ?? ''));
  }

  private refundMetadata(metadata: Prisma.JsonValue | null, agentId: string, reason: string, at: Date): Prisma.InputJsonValue {
    const existing = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Prisma.JsonObject : {};
    return { ...existing, pos_refund: { agent_id: agentId, reason: reason.trim(), refunded_at: at.toISOString() } };
  }
}
