import { AttendanceStatus, OrderItemType } from '@prisma/client';

import { qatarDateKey } from '../admin-daily-closings/daily-closing-totals.service';
import { PosOnlineTicketsService } from './pos-online-tickets.service';
import type { AuthenticatedPosAgent } from './strategies/pos-jwt.strategy';

describe('PosOnlineTicketsService', () => {
  const agent: AuthenticatedPosAgent = {
    id: '11111111-1111-4111-a111-111111111111',
    email: 'cashier@example.test',
    assignmentId: '22222222-2222-4222-a222-222222222222',
    eventId: '33333333-3333-4333-a333-333333333333',
    organizationId: '44444444-4444-4444-a444-444444444444',
    ticketTypeIds: [],
    thirdPartyVendorIds: [],
  };
  const ticketTypeId = '55555555-5555-4555-a555-555555555555';
  const today = qatarDateKey();
  const ticket = {
    id: '66666666-6666-4666-a666-666666666666',
    eventId: agent.eventId,
    itemId: ticketTypeId,
    itemType: OrderItemType.ticket_type,
    ticketCode: 'BQ-ONLINE-01',
    qrCodePayload: null,
    displayName: 'Online Pass',
    quantity: 1,
    admitCount: 1,
    attendanceStatus: AttendanceStatus.not_checked_in,
    checkedInAt: null,
    checkedInByUserId: null,
    rfidCodes: [],
    createdAt: new Date(),
    order: {
      commonOrder: 'BQ-ONLINE',
      status: 'paid',
      paymentStatus: 'paid',
      source: 'web',
      customerName: 'Online Customer',
      customerPhone: '+97455000009',
      customerEmail: 'online@example.test',
      customer: { phone: '+97455000009' },
    },
    eventSession: {
      startsAt: new Date(`${today}T07:00:00Z`),
      endsAt: new Date(`${today}T08:00:00Z`),
      displayTime: '10:00 AM',
      status: 'active',
      eventDate: { date: new Date(`${today}T00:00:00Z`) },
    },
  };

  function setup(options?: { used?: boolean }) {
    const record = {
      ...ticket,
      attendanceStatus: options?.used
        ? AttendanceStatus.checked_in
        : AttendanceStatus.not_checked_in,
      checkedInAt: options?.used ? new Date() : null,
    };
    const prisma = {
      staffAssignment: {
        findFirst: jest.fn().mockResolvedValue({
          ticketTypeIds: [ticketTypeId],
          thirdPartyVendorId: null,
          thirdPartyVendorIds: [],
          event: {
            moreOpsConfig: {
              entry_access: { pass_type: 'other', scan_length: 10, code_pool: [] },
            },
          },
        }),
      },
      ticketType: {
        findMany: jest.fn().mockResolvedValue([{ id: ticketTypeId, variants: [] }]),
      },
      orderItem: {
        findMany: jest.fn().mockResolvedValue([record]),
        findFirst: jest.fn().mockResolvedValueOnce(record).mockResolvedValueOnce(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const reporting = { syncAttendance: jest.fn().mockResolvedValue(undefined) };
    return {
      prisma,
      reporting,
      service: new PosOnlineTicketsService(prisma as never, reporting as never),
    };
  }

  it('searches only the assigned event and accessible ticket catalog IDs', async () => {
    const { prisma, service } = setup();

    const result = await service.search(agent, '55000009');

    expect(prisma.orderItem.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        eventId: agent.eventId,
        itemId: { in: [ticketTypeId] },
        order: { source: { not: 'pos' } },
      }),
    }));
    expect(result.data.tickets).toEqual([
      expect.objectContaining({ ticket_id: 'BQ-ONLINE-01', valid: true }),
    ]);
  });

  it('assigns an RFID and atomically marks a valid online ticket used', async () => {
    const { prisma, reporting, service } = setup();

    const result = await service.use(agent, ticket.id, ['RFID-ONLINE-1']);

    expect(prisma.orderItem.updateMany).toHaveBeenCalledWith({
      where: { id: ticket.id, attendanceStatus: AttendanceStatus.not_checked_in },
      data: expect.objectContaining({
        attendanceStatus: AttendanceStatus.checked_in,
        checkedInByUserId: agent.id,
        rfidCodes: ['RFID-ONLINE-1'],
      }),
    });
    expect(reporting.syncAttendance).toHaveBeenCalledWith(expect.objectContaining({
      eventId: agent.eventId,
      quantity: 1,
    }));
    expect(result.data.ticket).toEqual(expect.objectContaining({
      status: 'used',
      rfids: ['RFID-ONLINE-1'],
    }));
  });

  it('rejects an already-used ticket before writing', async () => {
    const { prisma, service } = setup({ used: true });

    await expect(service.use(agent, ticket.id, ['RFID-ONLINE-2']))
      .rejects.toThrow('already been used');
    expect(prisma.orderItem.updateMany).not.toHaveBeenCalled();
  });
});
