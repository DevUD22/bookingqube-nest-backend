import { BadRequestException } from '@nestjs/common';
import { OrderItemType, PaymentTransactionStatus, Prisma } from '@prisma/client';

import { PosRefundsService } from './pos-refunds.service';
import type { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

jest.mock('../../common/crypto/password', () => ({
  verifyPassword: jest.fn().mockResolvedValue(true),
  upgradeHashIfNeeded: jest.fn().mockResolvedValue(undefined),
}));

describe('PosRefundsService', () => {
  const agent: AuthenticatedPosAgent = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'cashier@example.test',
    assignmentId: '22222222-2222-4222-a222-222222222222',
    eventId: '33333333-3333-4333-a333-333333333333',
    organizationId: '44444444-4444-4444-a444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  it('returns event-scoped offline orders as refundable', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([{
      id: '55555555-5555-4555-a555-555555555555',
      commonOrder: 'BQ-ORDER-1',
      status: 'paid',
      currency: 'QAR',
      totalAmount: new Prisma.Decimal(55),
      paymentMethodLabel: 'Card',
      customerName: 'Aisha Customer',
      customerEmail: 'aisha@example.test',
      customerPhone: '+97455000000',
      paidAt: new Date('2026-08-13T09:00:00Z'),
      createdAt: new Date('2026-08-13T08:59:00Z'),
      items: [{ id: '66666666-6666-4666-a666-666666666666', itemType: OrderItemType.ticket_type, displayName: 'Adult Admission', quantity: 1, rfidCodes: ['1234567890'], ticketCode: 'BQ-TICKET-1' }],
      payments: [{ provider: 'internal', status: PaymentTransactionStatus.paid }],
    }]) } };
    const service = new PosRefundsService(prisma as never, {} as never, {} as never);

    const result = await service.lookup(agent, 'Aisha');

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ eventId: agent.eventId }) }));
    expect(result.data.orders[0]).toEqual(expect.objectContaining({ common_order: 'BQ-ORDER-1', refundable: true, total: 55 }));
  });

  it('writes the refund and marks the order refunded before releasing sold inventory', async () => {
    const calls: string[] = [];
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'hash' }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-a555-555555555555',
          commonOrder: 'BQ-ORDER-1',
          eventId: agent.eventId,
          status: 'paid',
          currency: 'QAR',
          totalAmount: new Prisma.Decimal(55),
          metadata: {},
          items: [{
            itemType: OrderItemType.ticket_type,
            itemId: '66666666-6666-4666-a666-666666666666',
            inventoryItemId: '77777777-7777-4777-a777-777777777777',
            quantity: 2,
            thirdPartyVendorId: null,
          }],
          payments: [{
            id: '88888888-8888-4888-a888-888888888888',
            provider: 'internal',
            amount: new Prisma.Decimal(55),
            currency: 'QAR',
          }],
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
        calls.push('tx');
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ status: 'paid' }]),
          refund: {
            create: jest.fn().mockImplementation(async () => {
              calls.push('refund');
            }),
          },
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
        };
        await fn(tx);
      }),
    };
    const inventory = {
      releaseSold: jest.fn().mockImplementation(async () => {
        calls.push('inventory');
      }),
    };
    const reporting = { syncOrder: jest.fn() };
    const service = new PosRefundsService(prisma as never, inventory as never, reporting as never);

    await service.create(agent, {
      order_id: '55555555-5555-4555-a555-555555555555',
      password: 'secret',
      reason: 'Customer left',
    });

    expect(calls).toEqual(['tx', 'refund', 'inventory']);
    expect(inventory.releaseSold).toHaveBeenCalledTimes(1);
    expect(reporting.syncOrder).toHaveBeenCalledWith({
      orderId: '55555555-5555-4555-a555-555555555555',
      action: 'refund',
    });
  });

  it('does not release inventory when the locked order is already refunded', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ passwordHash: 'hash' }) },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          id: '55555555-5555-4555-a555-555555555555',
          commonOrder: 'BQ-ORDER-1',
          eventId: agent.eventId,
          status: 'paid',
          currency: 'QAR',
          totalAmount: new Prisma.Decimal(55),
          metadata: {},
          items: [{
            itemType: OrderItemType.ticket_type,
            itemId: '66666666-6666-4666-a666-666666666666',
            inventoryItemId: '77777777-7777-4777-a777-777777777777',
            quantity: 2,
            thirdPartyVendorId: null,
          }],
          payments: [{
            id: '88888888-8888-4888-a888-888888888888',
            provider: 'internal',
            amount: new Prisma.Decimal(55),
            currency: 'QAR',
          }],
        }),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: jest.fn().mockResolvedValue([{ status: 'refunded' }]),
          refund: { create: jest.fn() },
          payment: { update: jest.fn() },
          order: { update: jest.fn() },
        };
        await fn(tx);
      }),
    };
    const inventory = { releaseSold: jest.fn() };
    const reporting = { syncOrder: jest.fn() };
    const service = new PosRefundsService(prisma as never, inventory as never, reporting as never);

    await expect(
      service.create(agent, {
        order_id: '55555555-5555-4555-a555-555555555555',
        password: 'secret',
        reason: 'Customer left',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.releaseSold).not.toHaveBeenCalled();
    expect(reporting.syncOrder).not.toHaveBeenCalled();
  });
});
