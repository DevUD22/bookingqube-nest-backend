import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { CustomerSessionService } from './customer-session.service';

describe('CustomerSessionService', () => {
  const user = {
    id: 'user-1',
    name: 'Ada',
    email: 'ada@example.test',
    phone: null,
    status: 'active' as const,
    tokenVersion: 0,
  };

  function buildService() {
    const prisma = {
      customerSession: {
        create: jest.fn().mockResolvedValue({ id: 'sess-1' }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const jwt = {
      signAsync: jest
        .fn()
        .mockImplementation(async (payload: { typ?: string }) =>
          payload.typ === 'customer_refresh' ? 'refresh-token' : 'access-token',
        ),
      verifyAsync: jest.fn(),
    };
    const config = {
      getOrThrow: (key: string) => {
        const values: Record<string, string> = {
          JWT_ACCESS_SECRET: 'access-secret',
          JWT_REFRESH_SECRET: 'refresh-secret',
          JWT_ACCESS_TTL: '15m',
          JWT_REFRESH_TTL: '30d',
        };
        return values[key];
      },
    };
    return {
      prisma,
      jwt,
      service: new CustomerSessionService(prisma as never, jwt as never, config as never),
    };
  }

  it('issues an access token and hashed refresh session', async () => {
    const { prisma, jwt, service } = buildService();
    const result = await service.issue(user);

    expect(result.token).toBe('access-token');
    expect(result.refresh_token).toBe('refresh-token');
    expect(result.expires_in).toBe(15 * 60);
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ typ: 'customer_access', tv: 0 }),
      expect.objectContaining({ secret: 'access-secret', expiresIn: '15m' }),
    );
    expect(prisma.customerSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          tokenHash: createHash('sha256').update('refresh-token').digest('hex'),
        },
      }),
    );
  });

  it('rotates refresh tokens and rejects reuse', async () => {
    const { prisma, jwt, service } = buildService();
    const refreshToken = 'refresh-token';
    prisma.customerSession.findUnique.mockResolvedValue({
      id: 'sess-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash: createHash('sha256').update(refreshToken).digest('hex'),
      user,
    });
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      sid: 'sess-1',
      typ: 'customer_refresh',
    });

    const rotated = await service.refresh(refreshToken);
    expect(rotated.refresh_token).toBe('refresh-token');
    expect(prisma.customerSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects a refresh token with the wrong typ', async () => {
    const { jwt, service } = buildService();
    jwt.verifyAsync.mockResolvedValue({
      sub: user.id,
      sid: 'sess-1',
      typ: 'customer_access',
    });
    await expect(service.refresh('access-token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('logout revokes the hashed refresh session', async () => {
    const { prisma, service } = buildService();
    await service.logout('refresh-token');
    expect(prisma.customerSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tokenHash: createHash('sha256').update('refresh-token').digest('hex'),
          revokedAt: null,
        },
      }),
    );
  });
});
