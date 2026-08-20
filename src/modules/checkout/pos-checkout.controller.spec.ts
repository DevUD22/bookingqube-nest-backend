import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';

import type { AuthenticatedPosAgent } from '../pos/strategies/pos-jwt.strategy';
import { PosCheckoutController } from './pos-checkout.controller';

const agent: AuthenticatedPosAgent = {
  id: 'agent-id',
  email: 'cashier@example.test',
  assignmentId: 'assignment-id',
  eventId: 'event-id',
  organizationId: 'organization-id',
  ticketTypeIds: [],
  thirdPartyVendorIds: [],
};

function makeController(overrides?: {
  dailyClosing?: { closingCode: string } | null;
  checkout?: { bookTicket: jest.Mock; listPendingAdvancePayments: jest.Mock; completeAdvancePayment: jest.Mock };
}) {
  const checkout = overrides?.checkout ?? {
    bookTicket: jest.fn(),
    listPendingAdvancePayments: jest.fn().mockResolvedValue({ success: true, data: [] }),
    completeAdvancePayment: jest.fn(),
  };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue({ id: 'agent-id' }) },
    event: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'event-id',
        slug: 'event-slug',
        organizationId: 'organization-id',
      }),
    },
    staffAssignment: {
      findFirst: jest.fn().mockResolvedValue({ id: 'assignment-id' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    dailyClosing: {
      findFirst: jest.fn().mockResolvedValue(overrides?.dailyClosing ?? null),
    },
  };
  const controller = new PosCheckoutController(
    checkout as never,
    prisma as never,
    {} as never,
  );
  return { controller, checkout, prisma };
}

describe('PosCheckoutController authz', () => {
  it('blocks a sale after the cashier closes the current shift', async () => {
    const { controller, checkout } = makeController({
      dailyClosing: { closingCode: 'POS-CLOSED' },
    });

    await expect(controller.bookTicket(
      agent,
      { offline_payment: { mode: 'cash' } },
      'en',
    )).rejects.toBeInstanceOf(ConflictException);
    expect(checkout.bookTicket).not.toHaveBeenCalled();
  });

  it('rejects selling as a different POS agent', async () => {
    const { controller, checkout } = makeController();
    await expect(controller.bookTicket(
      agent,
      { agent_id: 'other-agent', offline_payment: { mode: 'cash' } },
      'en',
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(checkout.bookTicket).not.toHaveBeenCalled();
  });

  it('rejects listing agents for another event', async () => {
    const { controller } = makeController();
    await expect(controller.listAgents(agent, 'other-event')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lists agents for the assigned POS event', async () => {
    const { controller, prisma } = makeController();
    await controller.listAgents(agent);
    expect(prisma.event.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'event-id' } }),
    );
    expect(prisma.staffAssignment.findMany).toHaveBeenCalled();
  });

  it('scopes pending advance search to the agent event', async () => {
    const { controller, checkout } = makeController();
    await controller.listPendingAdvance(agent, { search: 'ali' });
    expect(checkout.listPendingAdvancePayments).toHaveBeenCalledWith('ali', 'event-id');
  });

  it('completes advances as the logged-in POS agent', async () => {
    const { controller, checkout } = makeController();
    await expect(
      controller.completeAdvance(agent, {
        common_order: 'ORD-1',
        remaining_payment: 'cash',
        agent_id: 'other-agent',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(checkout.completeAdvancePayment).not.toHaveBeenCalled();
  });
});
