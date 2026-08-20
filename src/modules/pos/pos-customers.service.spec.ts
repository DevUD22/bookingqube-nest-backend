import { ConflictException } from '@nestjs/common';

import { PosCustomersService } from './pos-customers.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosCustomersService', () => {
  const prisma = {
    staffAssignment: { findFirst: jest.fn() },
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    order: { count: jest.fn() },
    $transaction: jest.fn(),
  };
  const service = new PosCustomersService(prisma as never);
  const agent: AuthenticatedPosAgent = {
    id: 'agent-1',
    email: 'agent@example.com',
    assignmentId: 'assignment-1',
    eventId: 'event-1',
    organizationId: 'organization-1',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.staffAssignment.findFirst.mockResolvedValue({ id: 'assignment-1' });
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
  });

  it('search returns organization-scoped customer summaries', async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: 'customer-1',
        name: 'Izaan Shahid',
        email: 'izaan@example.com',
        phone: '+97450000000',
        customerProfile: { ageGroup: '25-40', nationality: 'Qatari' },
        orders: [{ createdAt: new Date('2026-08-04T12:00:00.000Z') }],
        _count: { orders: 6 },
      },
    ]);
    prisma.order.count.mockResolvedValue(2);

    const result = await service.search(agent, { q: '50000000', limit: 8 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({
              AND: expect.arrayContaining([
                { orders: { some: { organizationId: 'organization-1' } } },
              ]),
            }),
            { phone: '+97450000000' },
          ]),
        }),
        take: 8,
      }),
    );
    expect(result.data.customers[0]).toEqual(
      expect.objectContaining({
        id: 'customer-1',
        total_orders: 6,
        event_orders: 2,
        last_order_at: '2026-08-04T12:00:00.000Z',
        age_group: '25-40',
        nationality: 'Qatari',
      }),
    );
  });

  it('resolve creates a passwordless customer and normalizes a Qatar phone', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      const profile = data.customerProfile as {
        create: { ageGroup: string | null; nationality: string | null };
      };
      return {
        id: 'customer-1',
        name: data.name,
        phone: data.phone,
        email: data.email,
        customerProfile: profile.create,
      };
    });

    const result = await service.resolve(agent, {
      name: 'New Customer',
      phone: '5000 0000',
      age_group: '19-25',
      nationality: 'Indian',
    });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'New Customer',
          phone: '+97450000000',
          customerProfile: {
            create: { ageGroup: '19-25', nationality: 'Indian' },
          },
        }),
        include: { customerProfile: true },
      }),
    );
    expect(result.data.created).toBe(true);
    expect(result.data.customer.email).toBeNull();
    expect(result.data.customer.age_group).toBe('19-25');
    expect(result.data.customer.nationality).toBe('Indian');
  });

  it('resolve reuses an existing phone identity', async () => {
    const existing = {
      id: 'customer-1',
      name: 'Old Name',
      phone: '+97450000000',
      email: 'customer@example.com',
    };
    prisma.user.findUnique.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    prisma.user.update.mockResolvedValue(existing);

    const result = await service.resolve(agent, {
      name: 'Updated Name',
      phone: '+97450000000',
    });

    expect(result.data.created).toBe(false);
    expect(result.data.matched_by).toBe('phone');
    expect(result.data.customer.name).toBe('Old Name');
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects phone and email that belong to different users', async () => {
    prisma.user.findUnique
      .mockResolvedValueOnce({
        id: 'customer-1',
        name: 'Phone User',
        phone: '+97450000000',
        email: 'one@example.com',
      })
      .mockResolvedValueOnce({
        id: 'customer-2',
        name: 'Email User',
        phone: '+97451111111',
        email: 'two@example.com',
      });

    await expect(
      service.resolve(agent, {
        name: 'Conflict',
        phone: '+97450000000',
        email: 'two@example.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
