import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AdminDailyClosingsService } from './admin-daily-closings.service';
import { AdminSettlementsService } from './admin-settlements.service';
import { DailyClosingTotalsService } from './daily-closing-totals.service';

describe('DailyClosingTotalsService', () => {
  const prisma = {
    order: { findMany: jest.fn() },
  };
  const service = new DailyClosingTotalsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('aggregates cash/card/qty for agent day', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        cashAmount: new Prisma.Decimal(100),
        cardAmount: new Prisma.Decimal(50),
        totalQuantity: 2,
        organizationId: 'org-1',
        currency: 'QAR',
      },
      {
        cashAmount: new Prisma.Decimal(25.5),
        cardAmount: new Prisma.Decimal(0),
        totalQuantity: 1,
        organizationId: 'org-1',
        currency: 'QAR',
      },
    ]);

    const result = await service.expectedForAgentDate('agent-1', '2026-08-03');

    expect(result.total_cash_sale).toBe(125.5);
    expect(result.total_card_sale).toBe(50);
    expect(result.qty).toBe(3);
    expect(result.order_count).toBe(2);
    expect(result.organization_id).toBe('org-1');
    expect(prisma.order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ bookedByAgentId: 'agent-1' }),
      }),
    );
  });

  it('returns zeros when no orders', async () => {
    prisma.order.findMany.mockResolvedValue([]);
    const result = await service.expectedForAgentDate('agent-1', '2026-08-03');
    expect(result).toEqual({
      total_cash_sale: 0,
      total_card_sale: 0,
      total_ticket_sale: 0,
      total_addon_sale: 0,
      total_time_extension_sale: 0,
      total_discount_sale: 0,
      total_sale: 0,
      qty: 0,
      order_count: 0,
      organization_id: null,
      currency: 'QAR',
    });
  });

  it('subtracts ticket discounts while reporting them separately', async () => {
    prisma.order.findMany.mockResolvedValue([
      {
        cashAmount: new Prisma.Decimal(0),
        cardAmount: new Prisma.Decimal(373.5),
        ticketsNet: new Prisma.Decimal(385),
        addonsNet: new Prisma.Decimal(0),
        extensionsNet: new Prisma.Decimal(35),
        discountAmount: new Prisma.Decimal(46.5),
        totalQuantity: 5,
        organizationId: 'org-1',
        currency: 'QAR',
      },
    ]);

    const result = await service.expectedForAgentDate('agent-1', '2026-08-13');

    expect(result.total_ticket_sale).toBe(385);
    expect(result.total_time_extension_sale).toBe(35);
    expect(result.total_discount_sale).toBe(46.5);
    expect(result.total_sale).toBe(373.5);
    expect(
      result.total_ticket_sale +
        result.total_addon_sale +
        result.total_time_extension_sale -
        result.total_discount_sale,
    ).toBe(result.total_sale);
  });
});

describe('AdminDailyClosingsService create/approve', () => {
  const prisma = {
    dailyClosing: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    dailyClosingStatusHistory: { create: jest.fn() },
    mediaAsset: { create: jest.fn() },
    organization: { findUnique: jest.fn() },
    staffAssignment: { findMany: jest.fn() },
    event: { findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  const config = { get: jest.fn().mockReturnValue('http://localhost:3001') };
  const totals = {
    expectedForAgentDate: jest.fn(),
    parseClosingDate: jest.fn((d: string) => new Date(`${d}T00:00:00.000Z`)),
  };
  const staff = {
    resolveReportEventIds: jest.fn().mockResolvedValue(null),
  };
  const mediaStorage = {
    uploadDataUrl: jest.fn().mockResolvedValue({ id: 'media-1' }),
    uploadBuffer: jest.fn().mockResolvedValue({ id: 'media-pdf' }),
  };

  const service = new AdminDailyClosingsService(
    prisma as never,
    config as never,
    totals as never,
    staff as never,
    mediaStorage as never,
  );

  const posAdmin = {
    id: 'agent-1',
    adminProfileId: 'ap-1',
    sessionId: 's-1',
    email: 'pos@test.com',
    name: 'POS Agent',
    avatarUrl: null,
    role: 'pos',
    permissions: ['closings.read', 'closings.write'],
  };

  const fmAdmin = {
    id: 'fm-1',
    adminProfileId: 'ap-2',
    sessionId: 's-2',
    email: 'fm@test.com',
    name: 'Finance',
    avatarUrl: null,
    role: 'finance-manager',
    permissions: ['closings.read', 'closings.write', 'closings.approve'],
  };

  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.staffAssignment.findMany.mockResolvedValue([{ userId: 'agent-1', eventId: 'event-1' }]);
    prisma.event.findUnique.mockResolvedValue({ id: 'event-1' });
    prisma.mediaAsset.create.mockResolvedValue({ id: 'media-1' });
    prisma.organization.findUnique.mockResolvedValue({ name: 'Alpha', slug: 'alpha' });
    prisma.dailyClosingStatusHistory.create.mockResolvedValue({});
    staff.resolveReportEventIds.mockResolvedValue(['event-1']);
  });

  it('create rejects when no bookings', async () => {
    prisma.dailyClosing.findFirst.mockResolvedValue(null);
    totals.expectedForAgentDate.mockResolvedValue({
      total_cash_sale: 0,
      total_card_sale: 0,
      qty: 0,
      order_count: 0,
      organization_id: null,
      currency: 'QAR',
    });

    await expect(
      service.create(
        {
          closing_for_date: '2026-08-03',
          received_cash_amount: 10,
          received_card_amount: 0,
          signature_data_url: tinyPng,
          event_id: 'event-1',
        },
        posAdmin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('create stores discrepancy and generated status', async () => {
    prisma.dailyClosing.findFirst.mockResolvedValue(null);
    totals.expectedForAgentDate.mockResolvedValue({
      total_cash_sale: 100,
      total_card_sale: 40,
      qty: 2,
      order_count: 1,
      organization_id: 'org-1',
      currency: 'QAR',
    });
    prisma.dailyClosing.create.mockResolvedValue({
      id: 'dc-1',
      closingCode: 'AL-12345',
      agentId: 'agent-1',
      eventId: 'event-1',
      organizationId: 'org-1',
      closingForDate: new Date('2026-08-03T00:00:00.000Z'),
      receivedCashAmount: new Prisma.Decimal(110),
      receivedCardAmount: new Prisma.Decimal(40),
      totalCashSale: new Prisma.Decimal(100),
      totalCardSale: new Prisma.Decimal(40),
      cashFlowBalance: new Prisma.Decimal(10),
      cardFlowBalance: new Prisma.Decimal(0),
      qty: 2,
      note: null,
      rejectReason: null,
      status: 'generated',
      signatureMediaId: 'media-1',
      signedPdfMediaId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      agent: { id: 'agent-1', name: 'POS Agent', email: 'pos@test.com' },
      event: {
        id: 'event-1',
        slug: 'sample-family',
        translations: [{ title: 'Sample Family Experience' }],
      },
      signatureMedia: { id: 'media-1', url: 'http://localhost/media/x.png' },
      signedPdfMedia: null,
    });

    const result = await service.create(
      {
        closing_for_date: '2026-08-03',
        received_cash_amount: 110,
        received_card_amount: 40,
        signature_data_url: tinyPng,
        event_id: 'event-1',
      },
      posAdmin,
    );

    expect(result.success).toBe(true);
    expect(result.data.cash_flow_balance).toBe(10);
    expect(result.data.status).toBe('generated');
    expect(prisma.dailyClosing.create).toHaveBeenCalled();
    expect(prisma.dailyClosingStatusHistory.create).toHaveBeenCalled();
  });

  it('create conflicts when closing already exists', async () => {
    prisma.dailyClosing.findFirst.mockResolvedValue({ id: 'existing' });
    await expect(
      service.create(
        {
          closing_for_date: '2026-08-03',
          received_cash_amount: 1,
          received_card_amount: 0,
          signature_data_url: tinyPng,
          event_id: 'event-1',
        },
        posAdmin,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('approve requires note when discrepancy and approving', async () => {
    prisma.dailyClosing.findFirst.mockResolvedValue({
      id: 'dc-1',
      closingCode: 'AL-1',
      agentId: 'agent-1',
      eventId: 'event-1',
      organizationId: 'org-1',
      closingForDate: new Date('2026-08-03T00:00:00.000Z'),
      receivedCashAmount: new Prisma.Decimal(110),
      receivedCardAmount: new Prisma.Decimal(40),
      totalCashSale: new Prisma.Decimal(100),
      totalCardSale: new Prisma.Decimal(40),
      cashFlowBalance: new Prisma.Decimal(10),
      cardFlowBalance: new Prisma.Decimal(0),
      qty: 2,
      note: null,
      rejectReason: null,
      status: 'generated',
      signatureMediaId: 'media-1',
      signedPdfMediaId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      agent: { id: 'agent-1', name: 'POS', email: 'p@t.com' },
      event: {
        id: 'event-1',
        slug: 'sample-family',
        translations: [{ title: 'Sample Family Experience' }],
      },
      signatureMedia: null,
      signedPdfMedia: null,
    });

    await expect(
      service.approve('dc-1', { status: 'approved' }, fmAdmin),
    ).rejects.toThrow(/note is required/i);
  });

  it('approve rejects without closings.approve permission', async () => {
    await expect(
      service.approve('dc-1', { status: 'approved' }, posAdmin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('remove soft-deletes for finance manager and rejects POS', async () => {
    prisma.dailyClosing.findFirst.mockResolvedValue({
      id: 'dc-1',
      closingCode: 'AL-1',
      agentId: 'agent-1',
      eventId: 'event-1',
      organizationId: 'org-1',
      closingForDate: new Date('2026-08-03T00:00:00.000Z'),
      receivedCashAmount: new Prisma.Decimal(110),
      receivedCardAmount: new Prisma.Decimal(40),
      totalCashSale: new Prisma.Decimal(100),
      totalCardSale: new Prisma.Decimal(40),
      cashFlowBalance: new Prisma.Decimal(10),
      cardFlowBalance: new Prisma.Decimal(0),
      qty: 2,
      note: null,
      rejectReason: null,
      status: 'generated',
      signatureMediaId: 'media-1',
      signedPdfMediaId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      agent: { id: 'agent-1', name: 'POS', email: 'p@t.com', phone: null },
      event: {
        id: 'event-1',
        slug: 'sample-family',
        translations: [{ title: 'Sample Family Experience' }],
      },
      organization: { id: 'org-1', name: 'Alpha' },
      signatureMedia: null,
      signedPdfMedia: null,
    });
    prisma.dailyClosing.update.mockResolvedValue({});
    prisma.dailyClosingStatusHistory.create.mockResolvedValue({});

    await expect(service.remove('dc-1', posAdmin)).rejects.toBeInstanceOf(ForbiddenException);

    const result = await service.remove('dc-1', fmAdmin);
    expect(result.success).toBe(true);
    expect(prisma.dailyClosing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'dc-1' },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
    expect(prisma.dailyClosingStatusHistory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rejectReason: 'Deleted',
          actorId: 'fm-1',
        }),
      }),
    );
  });
});

describe('AdminSettlementsService', () => {
  const prisma = {
    dailyClosing: { findMany: jest.fn() },
    settlement: { findUnique: jest.fn(), create: jest.fn() },
    staffAssignment: { findMany: jest.fn() },
    mediaAsset: { create: jest.fn() },
  };
  const totals = {
    parseClosingDate: jest.fn((d: string) => new Date(`${d}T00:00:00.000Z`)),
  };
  const staff = { resolveReportEventIds: jest.fn().mockResolvedValue(null) };
  const mediaStorage = {
    uploadDataUrl: jest.fn().mockResolvedValue({ id: 'media-1' }),
  };
  const service = new AdminSettlementsService(
    prisma as never,
    totals as never,
    staff as never,
    mediaStorage as never,
  );

  const tinyPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  const admin = {
    id: 'fm-1',
    adminProfileId: 'ap',
    sessionId: 's',
    email: 'fm@test.com',
    name: 'FM',
    avatarUrl: null,
    role: 'finance-manager',
    permissions: ['settlements.read', 'settlements.write'],
  };

  beforeEach(() => jest.clearAllMocks());

  it('blocks settlement when no closings', async () => {
    prisma.staffAssignment.findMany.mockResolvedValue([{ userId: 'a1' }]);
    prisma.dailyClosing.findMany.mockResolvedValue([]);
    await expect(
      service.create(
        { settlement_for_date: '2026-08-03', signature_data_url: tinyPng },
        admin,
      ),
    ).rejects.toThrow(/No daily closings/);
  });

  it('blocks settlement when not all approved', async () => {
    prisma.staffAssignment.findMany.mockResolvedValue([{ userId: 'a1' }]);
    prisma.dailyClosing.findMany.mockResolvedValue([
      { status: 'generated', receivedCashAmount: 1, receivedCardAmount: 0, totalCashSale: 1, totalCardSale: 0, cashFlowBalance: 0, cardFlowBalance: 0, organizationId: null },
      { status: 'approved', receivedCashAmount: 1, receivedCardAmount: 0, totalCashSale: 1, totalCardSale: 0, cashFlowBalance: 0, cardFlowBalance: 0, organizationId: null },
    ]);
    await expect(
      service.create(
        { settlement_for_date: '2026-08-03', signature_data_url: tinyPng },
        admin,
      ),
    ).rejects.toThrow(/approve all daily closings/i);
  });

  it('blocks second settlement for the same date by another user', async () => {
    prisma.staffAssignment.findMany.mockResolvedValue([{ userId: 'a1' }]);
    prisma.dailyClosing.findMany.mockResolvedValue([
      {
        status: 'approved',
        receivedCashAmount: 4,
        receivedCardAmount: 96,
        totalCashSale: 0,
        totalCardSale: 100,
        cashFlowBalance: 4,
        cardFlowBalance: -4,
        organizationId: null,
      },
    ]);
    prisma.settlement.findUnique.mockResolvedValue({
      id: 's1',
      settlementBy: { id: 'admin-1', name: 'BookingQube Admin' },
    });
    await expect(
      service.create(
        { settlement_for_date: '2026-08-03', signature_data_url: tinyPng },
        admin,
      ),
    ).rejects.toThrow(/already created for 2026-08-03 by BookingQube Admin/i);
  });
});
