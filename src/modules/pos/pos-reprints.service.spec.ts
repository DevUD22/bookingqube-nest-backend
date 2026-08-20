import { OrderItemType, Prisma } from '@prisma/client';

import { PosReprintsService } from './pos-reprints.service';
import type { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosReprintsService', () => {
  const agent: AuthenticatedPosAgent = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'cashier@example.test',
    assignmentId: '22222222-2222-4222-a222-222222222222',
    eventId: '33333333-3333-4333-a333-333333333333',
    organizationId: '44444444-4444-4444-a444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  it('lists only the assigned event and serializes the complete reprint receipt data', async () => {
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([{
          id: '55555555-5555-4555-a555-555555555555',
          commonOrder: 'BQ-REPRINT-1',
          status: 'paid',
          currency: 'QAR',
          totalAmount: new Prisma.Decimal(90),
          discountAmount: new Prisma.Decimal(10),
          paymentMode: 'offline_card',
          paymentMethodLabel: 'Card',
          customerName: 'Aisha Customer',
          customerEmail: 'aisha@example.test',
          customerPhone: '+97455000000',
          customerAgeGroup: '25-40',
          customerGeographicRegion: 'Qatari',
          eventTitle: 'Family Experience',
          createdAt: new Date('2026-08-13T07:00:00Z'),
          paidAt: new Date('2026-08-13T07:05:00Z'),
          metadata: {
            time_extensions: [{ title: 'Extra 30 minutes', quantity: 1, price: 10, minutes: 30 }],
          },
          bookedByAgent: { name: 'Cashier One' },
          event: { translations: [{ title: 'تجربة عائلية' }] },
          items: [{
            id: '66666666-6666-4666-a666-666666666666',
            itemType: OrderItemType.ticket_type,
            displayName: 'Adult Admission',
            quantity: 2,
            unitPrice: new Prisma.Decimal(45),
            totalAmount: new Prisma.Decimal(90),
            ticketCode: 'BQ-REPRINT-1-A1',
            rfidCodes: [],
            childItems: [],
          }],
        }]),
      },
    };
    const service = new PosReprintsService(prisma as never);

    const result = await service.list(agent, '2026-08-13', 'Aisha');

    expect(prisma.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventId: agent.eventId,
        AND: [expect.objectContaining({
          OR: expect.arrayContaining([
            expect.objectContaining({ bookedByAgentId: agent.id }),
          ]),
        })],
      }),
      take: 200,
    }));
    expect(result.data.orders).toEqual([
      expect.objectContaining({
        common_order: 'BQ-REPRINT-1',
        payment_method: 'card',
        total: 90,
        customer: expect.objectContaining({ name: 'Aisha Customer', phone: '+97455000000' }),
        tickets: [expect.objectContaining({ title: 'Adult Admission', quantity: 2 })],
        time_extensions: [expect.objectContaining({ title: 'Extra 30 minutes', minutes: 30 })],
      }),
    ]);
  });

  it('scopes exact common_order and ticket_code lookups to the logged-in agent', async () => {
    const prisma = { order: { findMany: jest.fn().mockResolvedValue([]) } };
    const service = new PosReprintsService(prisma as never);

    await service.list(agent, '2026-08-13', 'BQ-EXACT-1');

    const where = prisma.order.findMany.mock.calls[0][0].where;
    const searchOr = where.AND[0].OR;
    expect(searchOr).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bookedByAgentId: agent.id,
          commonOrder: { equals: 'BQ-EXACT-1', mode: 'insensitive' },
        }),
        expect.objectContaining({
          bookedByAgentId: agent.id,
          items: {
            some: { ticketCode: { equals: 'BQ-EXACT-1', mode: 'insensitive' } },
          },
        }),
      ]),
    );
  });
});
