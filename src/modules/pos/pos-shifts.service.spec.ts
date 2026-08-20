import { Prisma } from '@prisma/client';

import type { DailyClosingTotalsService } from '../admin-daily-closings/daily-closing-totals.service';
import { PosShiftsService } from './pos-shifts.service';
import type { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosShiftsService', () => {
  const agent: AuthenticatedPosAgent = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'cashier@example.test',
    assignmentId: '22222222-2222-4222-a222-222222222222',
    eventId: '33333333-3333-4333-a333-333333333333',
    organizationId: '44444444-4444-4444-a444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  it('returns a closed shift with stored declared totals and variances', async () => {
    const closing = {
      id: '55555555-5555-4555-a555-555555555555',
      closingCode: 'POS-20260811-111111',
      status: 'generated',
      receivedCashAmount: new Prisma.Decimal(110),
      receivedCardAmount: new Prisma.Decimal(48),
      totalCashSale: new Prisma.Decimal(100),
      totalCardSale: new Prisma.Decimal(50),
      cashFlowBalance: new Prisma.Decimal(10),
      cardFlowBalance: new Prisma.Decimal(-2),
      note: null,
      createdAt: new Date('2026-08-11T18:00:00Z'),
    };
    const prisma = {
      dailyClosing: { findFirst: jest.fn().mockResolvedValue(closing) },
    };
    const totals = {
      parseClosingDate: jest.fn((date: string) => new Date(`${date}T00:00:00Z`)),
      expectedForAgentDate: jest.fn().mockResolvedValue({
        total_cash_sale: 100,
        total_card_sale: 50,
        total_ticket_sale: 120,
        total_addon_sale: 20,
        total_time_extension_sale: 10,
        total_discount_sale: 5,
        total_sale: 150,
        qty: 4,
        order_count: 2,
        organization_id: agent.organizationId,
        currency: 'QAR',
      }),
    };
    const service = new PosShiftsService(
      prisma as never,
      totals as unknown as DailyClosingTotalsService,
    );

    const result = await service.get(agent, '2026-08-11');

    expect(result.data).toEqual(expect.objectContaining({
      is_closed: true,
      can_close: false,
      sales: expect.objectContaining({
        total: 150,
        addons: 20,
        time_extensions: 10,
        discounts: 5,
      }),
      closing: expect.objectContaining({
        declared_cash: 110,
        cash_variance: 10,
        card_variance: -2,
      }),
    }));
  });
});
