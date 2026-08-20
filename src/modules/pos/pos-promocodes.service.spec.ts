import { Prisma } from '@prisma/client';

import { PosPromocodesService } from './pos-promocodes.service';
import { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosPromocodesService', () => {
  const agent: AuthenticatedPosAgent = {
    id: 'agent-id',
    email: 'pos@example.com',
    assignmentId: 'assignment-id',
    eventId: 'event-id',
    organizationId: 'organization-id',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  function createService(options?: { customerLimitReached?: boolean }) {
    const prisma = {
      staffAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          ticketTypeIds: ['ticket-db-id'],
          thirdPartyVendorId: 'vendor-id',
          thirdPartyVendorIds: ['vendor-id'],
          event: {
            id: 'event-id',
            organizationId: 'organization-id',
            status: 'published',
            currency: 'QAR',
          },
        }),
      },
      user: {
        findFirst: jest.fn().mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' }),
      },
      promoCode: {
        findUnique: jest.fn().mockResolvedValue({
          code: 'POS10',
          status: 'active',
          organizationId: 'organization-id',
          discountType: 'percent',
          discountApplication: 'order_total',
          discountValue: new Prisma.Decimal(10),
          currency: 'QAR',
          startsAt: null,
          endsAt: null,
          maxRedemptions: null,
          maxRedemptionsPerCustomer: options?.customerLimitReached ? 1 : 3,
          targets: [{ targetType: 'event', targetId: 'event-id' }],
          redemptions: options?.customerLimitReached
            ? [{ customerId: '11111111-1111-4111-8111-111111111111' }]
            : [],
        }),
      },
      ticketType: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'ticket-db-id',
            externalKey: 'adult-pass',
            basePrice: new Prisma.Decimal(55),
            isCustomizable: false,
            variants: [],
            customizationOptions: [],
          },
        ]),
      },
    };
    return { service: new PosPromocodesService(prisma as never), prisma };
  }

  it('uses authoritative ticket prices for an order discount', async () => {
    const { service } = createService();
    const result = await service.apply(
      agent,
      {
        code: 'pos10',
        customer_id: '11111111-1111-4111-8111-111111111111',
        tickets: [{ ticket_id: 'adult-pass', quantity: 2 }],
      },
      'en',
    );

    expect(result).toMatchObject({
      valid: true,
      code: 'POS10',
      total_discount_amount: 11,
      summary_label: '10% off',
    });
  });

  it('rejects a customer who reached the per-customer limit', async () => {
    const { service, prisma } = createService({ customerLimitReached: true });
    const result = await service.apply(
      agent,
      {
        code: 'POS10',
        customer_id: '11111111-1111-4111-8111-111111111111',
        tickets: [{ ticket_id: 'adult-pass', quantity: 1 }],
      },
      'en',
    );

    expect(result).toMatchObject({
      valid: false,
      message: 'This customer has reached the usage limit for this promo code.',
    });
    expect(prisma.ticketType.findMany).not.toHaveBeenCalled();
  });
});
