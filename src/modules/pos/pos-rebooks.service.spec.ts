import { OrderItemType, Prisma } from '@prisma/client';

import { PosRebooksService } from './pos-rebooks.service';
import type { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosRebooksService', () => {
  const agent: AuthenticatedPosAgent = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'cashier@example.test',
    assignmentId: '22222222-2222-4222-a222-222222222222',
    eventId: '33333333-3333-4333-a333-333333333333',
    organizationId: '44444444-4444-4444-a444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };

  it('looks up an event ticket and returns only its configured rebook choices', async () => {
    const ticket = {
      id: '55555555-5555-4555-a555-555555555555',
      eventId: agent.eventId,
      eventSessionId: null,
      itemType: OrderItemType.ticket_type,
      itemId: '66666666-6666-4666-a666-666666666666',
      displayName: 'Adult Admission',
      ticketCode: 'BQ-TICKET-1',
      rfidCodes: ['1234567890'],
      attendanceStatus: 'checked_in',
      checkedInAt: new Date('2026-08-13T10:00:00Z'),
      thirdPartyVendorId: null,
      order: {
        id: '77777777-7777-4777-a777-777777777777',
        commonOrder: 'BQ-ORDER-1',
        customerName: 'Aisha Customer',
        customerEmail: 'aisha@example.test',
        customerPhone: '+97455000000',
        currency: 'QAR',
        paidAt: new Date('2026-08-13T09:00:00Z'),
        createdAt: new Date('2026-08-13T08:55:00Z'),
      },
      event: {
        moreOpsConfig: {
          entry_access: { pass_type: 'rfid', scan_length: 10 },
          time_extensions: [
            { id: 'extra-30', title: 'Extra 30 minutes', minutes: 30, price: 35, ticket_ids: ['adult'] },
            { id: 'child-only', title: 'Child extension', minutes: 30, price: 20, ticket_ids: ['child'] },
          ],
        } as Prisma.JsonValue,
        translations: [{ title: 'تجربة عائلية' }],
      },
    };
    const prisma = {
      orderItem: { findFirst: jest.fn().mockResolvedValue(ticket) },
      ticketType: { findFirst: jest.fn().mockResolvedValue({
        id: ticket.itemId,
        externalKey: 'adult',
        customizationOptions: [{
          id: '88888888-8888-4888-a888-888888888888',
          name: 'Climbing wall',
          description: 'One session',
          price: new Prisma.Decimal(15),
          durationMinutes: 20,
          maxQtyPerTicket: 2,
        }],
      }) },
    };
    const service = new PosRebooksService(prisma as never, { syncOrder: jest.fn() } as never);

    const result = await service.lookup(agent, { code: '1234567890' });

    expect(prisma.orderItem.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ eventId: agent.eventId }),
    }));
    expect(result.data).toEqual(expect.objectContaining({
      multiple: false,
      entry_access: expect.objectContaining({ pass_type: 'rfid', scan_length: 10 }),
      time_extensions: [expect.objectContaining({ id: 'extra-30', price: 35 })],
      activities: [expect.objectContaining({ title: 'Climbing wall', max_qty: 2 })],
      ticket: expect.objectContaining({ item_id: ticket.id, rfids: ['1234567890'] }),
    }));
  });
});
