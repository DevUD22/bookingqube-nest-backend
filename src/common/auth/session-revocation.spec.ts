import { revokeAuthSessionsForUser, tokenVersionMatches } from './session-revocation';

describe('session revocation', () => {
  it('revokes admin, organizer, and customer sessions', async () => {
    const db = {
      adminSession: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      organizerSession: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      customerSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
    };

    await revokeAuthSessionsForUser(db, 'user-1', {
      exceptAdminSessionId: 'keep-me',
    });

    expect(db.adminSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          adminProfile: { userId: 'user-1' },
          id: { not: 'keep-me' },
          revokedAt: null,
        }),
      }),
    );
    expect(db.organizerSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationMember: { userId: 'user-1' },
          revokedAt: null,
        }),
      }),
    );
    expect(db.customerSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          revokedAt: null,
        }),
      }),
    );
  });

  it('treats a missing JWT tv claim as version 0', () => {
    expect(tokenVersionMatches(undefined, 0)).toBe(true);
    expect(tokenVersionMatches(undefined, 1)).toBe(false);
    expect(tokenVersionMatches(2, 2)).toBe(true);
  });
});
