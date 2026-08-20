import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminOrdersService } from './admin-orders.service';

describe('AdminOrdersService', () => {
  const prisma = {
    order: {
      findUnique: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    user: { update: jest.fn() },
    event: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const inventory = {
    release: jest.fn(),
    releaseSold: jest.fn(),
  };

  const jobs = {
    enqueueReportSync: jest.fn(),
    cancelHoldExpiry: jest.fn(),
  };

  const service = new AdminOrdersService(prisma as never, inventory as never, jobs as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('list returns empty when scoped event or vendor ids are empty arrays', async () => {
    const emptyEvents = await service.list({ page: 1, per_page: 20 } as never, [], null);
    expect(emptyEvents.data.orders).toEqual([]);
    expect(prisma.order.count).not.toHaveBeenCalled();

    const emptyVendors = await service.list({ page: 1, per_page: 20 } as never, null, []);
    expect(emptyVendors.data.orders).toEqual([]);
  });

  it('list rejects event_id outside scopedEventIds', async () => {
    await expect(
      service.list({ page: 1, per_page: 20, event_id: 'event-2' } as never, ['event-1'], null),
    ).rejects.toThrow(/do not have access to this event/);
  });

  it('assertStatusTransition allows pending_payment → paid and rejects expired → paid', () => {
    const assertStatusTransition = (
      service as unknown as {
        assertStatusTransition: (from: string, to: string) => void;
      }
    ).assertStatusTransition.bind(service);

    expect(() => assertStatusTransition('pending_payment', 'paid')).not.toThrow();
    expect(() => assertStatusTransition('expired', 'paid')).toThrow(BadRequestException);
  });

  it('update cancels order, releases inventory, and enqueues expire sync', async () => {
    prisma.order.findUnique
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'pending_payment',
        customerId: 'customer-1',
        customer: { name: 'Guest', phone: null },
      })
      .mockResolvedValueOnce({
        id: 'order-1',
        status: 'cancelled',
        customer: { id: 'customer-1', name: 'Guest', email: 'g@x.com', phone: null },
        event: {
          id: 'event-1',
          slug: 'demo',
          translations: [{ locale: 'en', title: 'Demo' }],
          organization: { id: 'org-1', slug: 'org', name: 'Org' },
        },
        eventSession: null,
        items: [],
        payments: [],
        hold: null,
        customerName: 'Guest',
        customerPhone: null,
        customerEmail: 'g@x.com',
        commonOrder: 'BQ-1',
        paymentStatus: 'unpaid',
        locale: 'en',
        source: 'web',
        waiverAccepted: false,
        waiverSignedBy: null,
        currency: 'QAR',
        subtotalAmount: 0,
        discountAmount: 0,
        taxAmount: 0,
        totalAmount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        cancelledAt: new Date(),
        paidAt: null,
        metadata: null,
      });

    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    jest.spyOn(service as never, 'releaseInventoryForOrder' as never).mockResolvedValue(undefined as never);
    jest.spyOn(service as never, 'get' as never).mockResolvedValue({
      success: true,
      data: { id: 'order-1', status: 'cancelled' },
    } as never);

    const result = await service.update('order-1', { status: 'cancelled' });

    expect(jobs.enqueueReportSync).toHaveBeenCalledWith({
      orderId: 'order-1',
      action: 'expire',
    });
    expect(result.data.status).toBe('cancelled');
  });

  it('remove is a no-op when already cancelled', async () => {
    prisma.order.findUnique.mockResolvedValue({
      id: 'order-1',
      status: 'cancelled',
      items: [],
      hold: null,
    });

    const result = await service.remove('order-1');
    expect(result.message).toMatch(/already cancelled/i);
  });

  it('remove throws NotFoundException when missing', async () => {
    prisma.order.findUnique.mockResolvedValue(null);
    await expect(service.remove('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
