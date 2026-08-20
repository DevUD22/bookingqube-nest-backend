import { ForbiddenException } from '@nestjs/common';

import { PosSalesEntryService } from './pos-sales-entry.service';

describe('PosSalesEntryService', () => {
  const agent = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'cafe@example.com',
    assignmentId: '22222222-2222-4222-8222-222222222222',
    eventId: '33333333-3333-4333-8333-333333333333',
    organizationId: '44444444-4444-4444-8444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
    salesEntryMode: true,
  };

  it('stores externally reported cash/card totals as a balanced daily closing', async () => {
    const report = {
      id: '55555555-5555-4555-8555-555555555555',
      closingCode: 'EXT-20260815-111111',
      agentId: agent.id,
      eventId: agent.eventId,
      organizationId: agent.organizationId,
      closingForDate: new Date('2026-08-15T00:00:00.000Z'),
      receivedCashAmount: 125,
      receivedCardAmount: 375,
      totalCashSale: 125,
      totalCardSale: 375,
      cashFlowBalance: 0,
      cardFlowBalance: 0,
      qty: 18,
      note: null,
      rejectReason: null,
      status: 'generated',
      signatureMediaId: null,
      signedPdfMediaId: null,
      createdAt: new Date('2026-08-15T20:00:00.000Z'),
      updatedAt: new Date('2026-08-15T20:00:00.000Z'),
      deletedAt: null,
    };
    const tx = {
      dailyClosing: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(report),
      },
      dailyClosingStatusHistory: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      dailyClosing: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { findUnique: jest.fn().mockResolvedValue({ name: 'Cafe Agent' }) },
      event: {
        findUnique: jest.fn().mockResolvedValue({
          currency: 'QAR',
          translations: [{ locale: 'en', title: 'Demo Event' }],
        }),
      },
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const totals = { parseClosingDate: jest.fn((date: string) => new Date(`${date}T00:00:00.000Z`)) };
    const service = new PosSalesEntryService(prisma as never, totals as never);

    const result = await service.save(agent, {
      date: '2026-08-15',
      cash_sales: 125,
      card_sales: 375,
      total_transactions: 18,
    });

    expect(tx.dailyClosing.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        receivedCashAmount: 125,
        receivedCardAmount: 375,
        totalCashSale: 125,
        totalCardSale: 375,
        cashFlowBalance: 0,
        cardFlowBalance: 0,
        qty: 18,
      }),
    });
    expect(result.data.report).toEqual(expect.objectContaining({ total_sales: 500, total_transactions: 18 }));
  });

  it('rejects normal POS sessions', async () => {
    const service = new PosSalesEntryService({} as never, {} as never);
    await expect(service.get({ ...agent, salesEntryMode: false }, '2026-08-15'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
});
