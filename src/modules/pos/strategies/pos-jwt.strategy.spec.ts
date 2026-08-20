import { UnauthorizedException } from '@nestjs/common';

import { PosJwtStrategy } from './pos-jwt.strategy';

describe('PosJwtStrategy', () => {
  const prisma = {
    staffAssignment: {
      findFirst: jest.fn(),
    },
  };
  const config = { getOrThrow: () => 'test-pos-secret' };
  const strategy = new PosJwtStrategy(config as never, prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.staffAssignment.findFirst.mockResolvedValue({
      id: 'assign-1',
      eventId: 'event-1',
      organizationId: 'org-1',
      ticketTypeIds: ['ticket-live'],
      thirdPartyVendorId: 'vendor-legacy',
      thirdPartyVendorIds: ['vendor-live'],
      isCafeAgent: true,
      user: {
        id: 'user-1',
        email: 'agent@example.com',
        status: 'active',
        tokenVersion: 0,
      },
    });
  });

  it('uses live assignment scope instead of stale JWT claims', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'agent@example.com',
        typ: 'pos_access',
        tv: 0,
        aid: 'assign-1',
        eid: 'event-1',
        oid: 'org-1',
        tti: ['ticket-stale'],
        tvi: ['vendor-stale'],
        sem: false,
      }),
    ).resolves.toEqual({
      id: 'user-1',
      email: 'agent@example.com',
      assignmentId: 'assign-1',
      eventId: 'event-1',
      organizationId: 'org-1',
      ticketTypeIds: ['ticket-live'],
      thirdPartyVendorIds: ['vendor-live', 'vendor-legacy'],
      salesEntryMode: true,
    });
  });

  it('rejects invalid POS tokens', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'agent@example.com',
        typ: 'customer_access',
        aid: 'assign-1',
        eid: 'event-1',
        oid: 'org-1',
      } as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
