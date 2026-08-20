import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdminPromocodesService } from './admin-promocodes.service';

describe('AdminPromocodesService', () => {
  const prisma = {
    organization: { findFirst: jest.fn(), findUnique: jest.fn() },
    event: { count: jest.fn(), findUnique: jest.fn(), findMany: jest.fn() },
    ticketType: { count: jest.fn() },
    ticketVariant: { count: jest.fn() },
    promoCode: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    promoCodeTarget: { deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const service = new AdminPromocodesService(prisma as never);

  const baseInput = {
    organization_id: 'org-1',
    code: 'save10',
    status: 'active' as const,
    discount_type: 'percent' as const,
    application_mode: 'per_ticket' as const,
    discount_value: 10,
    target_type: 'all' as const,
    target_ids: [] as string[],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.organization.findFirst.mockResolvedValue({ id: 'org-1', status: 'active' });
  });

  it('validate rejects percent over 100', async () => {
    await expect(
      service.create({ ...baseInput, discount_value: 150 }, 'admin-1'),
    ).rejects.toThrow(/cannot exceed 100%/);
  });

  it('validate rejects order_total with ticket_type targets', async () => {
    await expect(
      service.create(
        {
          ...baseInput,
          application_mode: 'order_total',
          target_type: 'ticket_type',
          target_ids: ['ticket-1'],
        },
        'admin-1',
      ),
    ).rejects.toThrow(/Order-total promocodes/);
  });

  it('validate rejects all targets with target_ids and empty non-all targets', async () => {
    await expect(
      service.create({ ...baseInput, target_type: 'all', target_ids: ['event-1'] }, 'admin-1'),
    ).rejects.toThrow(/must not include individual targets/);

    await expect(
      service.create({ ...baseInput, target_type: 'event', target_ids: [] }, 'admin-1'),
    ).rejects.toThrow(/Select at least one eligible target/);
  });

  it('create uppercases code and persists promocode', async () => {
    prisma.promoCode.create.mockResolvedValue({
      id: 'promo-1',
      organizationId: 'org-1',
      code: 'SAVE10',
      status: 'active',
      discountType: 'percent',
      discountApplication: 'per_ticket',
      discountValue: new Prisma.Decimal(10),
      currency: null,
      startsAt: null,
      endsAt: null,
      maxRedemptions: null,
      maxRedemptionsPerCustomer: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      organization: { id: 'org-1', name: 'Org', slug: 'org' },
      targets: [],
      redemptions: [],
      createdBy: { id: 'admin-1', name: 'Admin', email: 'a@b.com' },
      updatedBy: { id: 'admin-1', name: 'Admin', email: 'a@b.com' },
    });

    const result = await service.create(baseInput, 'admin-1');

    expect(prisma.promoCode.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          code: 'SAVE10',
          discountType: 'percent',
        }),
      }),
    );
    expect(result.data.promocode.code).toBe('SAVE10');
  });

  it('update rejects code changes after redemptions', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      code: 'SAVE10',
      _count: { redemptions: 2 },
    });

    await expect(
      service.update('promo-1', { ...baseInput, code: 'NEWCODE' }, 'admin-1'),
    ).rejects.toThrow(/cannot be changed after it has been redeemed/);
  });

  it('setStatus rejects activating expired promocodes', async () => {
    prisma.promoCode.findUnique.mockResolvedValue({
      id: 'promo-1',
      endsAt: new Date('2020-01-01T00:00:00.000Z'),
    });

    await expect(service.setStatus('promo-1', 'active', 'admin-1')).rejects.toThrow(
      /Extend the expiry date/,
    );
  });

  it('bulkImport rejects duplicate codes in the batch', async () => {
    await expect(
      service.bulkImport(
        {
          codes: ['AAA', 'aaa'],
          config: {
            organization_id: 'org-1',
            status: 'draft',
            discount_type: 'percent',
            application_mode: 'per_ticket',
            discount_value: 10,
            target_type: 'all',
            target_ids: [],
          },
        } as never,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('get throws NotFoundException when missing', async () => {
    prisma.promoCode.findUnique.mockResolvedValue(null);
    await expect(service.get('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create maps P2002 to ConflictException', async () => {
    prisma.promoCode.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.create(baseInput, 'admin-1')).rejects.toBeInstanceOf(ConflictException);
  });
});
