import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import { verifyPassword } from '../../common/crypto/password';
import { AuthService } from './auth.service';

jest.mock('../../common/crypto/password', () => ({
  hashPassword: jest.fn(async (plain: string) => `hashed:${plain}`),
  verifyPassword: jest.fn(),
  upgradeHashIfNeeded: jest.fn(),
}));

describe('AuthService', () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const update = jest.fn();
  const mailService = { queueUserRegistrationEmail: jest.fn() };
  const appleVerifier = { verify: jest.fn() };
  const sessions = { issue: jest.fn() };

  const lockout = {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  function service() {
    return new AuthService(
      { user: { findUnique, create, update } } as never,
      sessions as never,
      {} as never,
      {} as never,
      appleVerifier as never,
      mailService as never,
      lockout as never,
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    sessions.issue.mockResolvedValue({ token: 'jwt' });
  });

  it('issues a customer session on password login', async () => {
    (verifyPassword as jest.Mock).mockResolvedValue(true);
    findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      name: 'Ada',
      phone: null,
      passwordHash: 'hash',
      status: 'active',
      tokenVersion: 0,
    });
    update.mockResolvedValue({});

    const result = await service().login(
      { email: 'ada@example.com', password: 'Secret123!' },
      { userAgent: 'jest', ipAddress: '127.0.0.1' },
    );

    expect(result.token).toBe('jwt');
    expect(sessions.issue).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'user-1', email: 'ada@example.com' }),
      { userAgent: 'jest', ipAddress: '127.0.0.1' },
    );
  });

  it('returns the same register message for new and already-registered emails', async () => {
    findUnique.mockResolvedValueOnce({
      id: 'user-1',
      email: 'taken@example.com',
      passwordHash: 'existing-hash',
    });

    const duplicate = await service().register({
      name: 'A',
      email: 'taken@example.com',
      password: 'NewPass123!',
      password_confirmation: 'NewPass123!',
      accept: true,
    });

    findUnique.mockResolvedValueOnce(null);
    create.mockResolvedValue({});

    const created = await service().register({
      name: 'B',
      email: 'new@example.com',
      password: 'NewPass123!',
      password_confirmation: 'NewPass123!',
      accept: true,
    });

    expect(duplicate.message).toBe('Registration successful.');
    expect(created.message).toBe(duplicate.message);
    expect(update).not.toHaveBeenCalled();
    expect(mailService.queueUserRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalled();
  });

  it('does not use client other_data.email when Apple omits email', async () => {
    appleVerifier.verify.mockResolvedValue({ sub: 'apple-sub-1', email: '' });
    findUnique.mockResolvedValueOnce(null);

    await expect(
      service().socialLogin({
        provider: 'apple',
        access_token: 'id-token',
        other_data: JSON.stringify({ email: 'victim@example.com', name: 'X' }),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findUnique).toHaveBeenCalledWith({ where: { appleSub: 'apple-sub-1' } });
    expect(update).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });

  it('does not attach Apple to an existing password account by email', async () => {
    appleVerifier.verify.mockResolvedValue({
      sub: 'apple-sub-2',
      email: 'owner@example.com',
    });
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'user-2',
        email: 'owner@example.com',
        passwordHash: 'existing-hash',
        appleSub: null,
        status: 'active',
      });

    await expect(
      service().socialLogin({
        provider: 'apple',
        access_token: 'id-token',
        other_data: '{}',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(update).not.toHaveBeenCalled();
    expect(sessions.issue).not.toHaveBeenCalled();
  });
});
