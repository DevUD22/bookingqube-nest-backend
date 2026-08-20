import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { AdminAuthService } from './admin-auth.service';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
  hash: jest.fn().mockResolvedValue('hashed-password'),
  getRounds: jest.fn(() => 12),
}));

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,qr'),
}));

import * as bcrypt from 'bcrypt';

describe('AdminAuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    adminProfile: {
      findUniqueOrThrow: jest.fn(),
      findUnique: jest.fn(),
    },
    adminSession: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    organizerSession: {
      updateMany: jest.fn(),
    },
    customerSession: {
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const jwt = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  };

  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        ADMIN_JWT_REFRESH_SECRET: 'refresh-secret',
        ADMIN_JWT_ACCESS_SECRET: 'access-secret',
        ADMIN_JWT_REFRESH_TTL: '7d',
        ADMIN_JWT_ACCESS_TTL: '15m',
      };
      return values[key];
    }),
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        ADMIN_JWT_ACCESS_SECRET: 'access-secret',
        MFA_ENCRYPTION_KEY: 'mfa-key',
      };
      return values[key];
    }),
  };

  const mediaStorage = {
    uploadDataUrl: jest.fn(),
  };

  const lockout = {
    assertNotLocked: jest.fn().mockResolvedValue(undefined),
    recordFailure: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };

  const service = new AdminAuthService(
    prisma as never,
    jwt as never,
    config as never,
    mediaStorage as never,
    lockout as never,
  );

  const adminProfile = {
    id: 'profile-1',
    status: 'active',
    avatarMedia: null,
    user: {
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      status: 'active',
    },
    role: {
      name: 'admin',
      permissions: [
        { permission: { key: 'panel.access' } },
        { permission: { key: 'admin.access' } },
      ],
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jwt.signAsync.mockImplementation(async (payload: { typ?: string }) =>
      payload.typ === 'admin_refresh' ? 'refresh-token' : 'access-token',
    );
    prisma.adminSession.create.mockResolvedValue({
      id: 'session-1',
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    prisma.adminSession.update.mockResolvedValue({});
    prisma.user.update.mockResolvedValue({});
    prisma.adminSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.organizerSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.customerSession.updateMany.mockResolvedValue({ count: 0 });
    prisma.$queryRaw.mockResolvedValue([]);
    prisma.$executeRaw.mockResolvedValue(1);
    prisma.adminProfile.findUnique.mockResolvedValue(adminProfile);
    prisma.$transaction.mockImplementation(async (callback: (tx: typeof prisma) => unknown) =>
      callback(prisma),
    );
    prisma.adminProfile.findUniqueOrThrow.mockResolvedValue(adminProfile);
  });

  it('login rejects invalid credentials', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'x@y.com', password: 'bad' }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('login rejects accounts without panel.access', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'active',
      passwordHash: 'hash',
      adminProfile: {
        ...adminProfile,
        role: {
          name: 'ops',
          permissions: [{ permission: { key: 'orders.view' } }],
        },
      },
    });

    await expect(
      service.login({ email: 'admin@example.com', password: 'Secret123!' }, {}),
    ).rejects.toThrow(/panel access/);
  });

  it('login updates lastLoginAt and returns tokens', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'active',
      passwordHash: 'hash',
      adminProfile,
    });

    const result = await service.login(
      { email: ' Admin@Example.com ', password: 'Secret123!' },
      { userAgent: 'jest', ipAddress: '127.0.0.1' },
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } }),
    );
    expect('access_token' in result.data).toBe(true);
    if (!('access_token' in result.data)) return;
    expect(result.data.access_token).toBe('access-token');
    expect(result.data.refresh_token).toBe('refresh-token');
    expect(result.data.admin.permissions).toEqual(['panel.access', 'admin.access']);
  });

  it('refresh rejects invalid token type', async () => {
    jwt.verifyAsync.mockResolvedValue({ sub: 'user-1', sid: 'session-1', typ: 'wrong' });
    await expect(service.refresh('token', {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refresh revokes old session and issues a new one', async () => {
    const refreshToken = 'refresh-token';
    const tokenHash = createHash('sha256').update(refreshToken).digest('hex');
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      sid: 'session-1',
      typ: 'admin_refresh',
    });
    prisma.adminSession.findUnique.mockResolvedValue({
      id: 'session-1',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      tokenHash,
      adminProfile,
    });

    const result = await service.refresh(refreshToken, {});

    expect(prisma.adminSession.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1' },
        data: expect.objectContaining({ revokedAt: expect.any(Date) }),
      }),
    );
    expect(result.data.access_token).toBe('access-token');
  });

  it('logout revokes matching sessions and me returns profile fields', async () => {
    prisma.adminSession.updateMany.mockResolvedValue({ count: 1 });
    const logout = await service.logout('refresh-token');
    expect(logout.success).toBe(true);
    expect(prisma.adminSession.updateMany).toHaveBeenCalled();

    const me = service.me({
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
      permissions: ['panel.access'],
      avatarUrl: null,
    } as never);
    expect(me.data).toEqual({
      id: 'user-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
      permissions: ['panel.access'],
      avatar_url: null,
    });
  });

  it('password change revokes other admin sessions and keeps the current one', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      name: 'Admin',
      passwordHash: 'hash',
      adminProfile,
    });

    await service.updateProfile(
      {
        id: 'user-1',
        adminProfileId: 'profile-1',
        sessionId: 'current-session',
        email: 'admin@example.com',
        name: 'Admin',
        role: 'admin',
        permissions: ['panel.access'],
        avatarUrl: null,
      },
      {
        name: 'Admin',
        current_password: 'Secret123!',
        new_password: 'NewSecret123!',
        new_password_confirmation: 'NewSecret123!',
      },
    );

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          tokenVersion: { increment: 1 },
        }),
      }),
    );
    expect(prisma.adminSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          adminProfile: { userId: 'user-1' },
          id: { not: 'current-session' },
        }),
      }),
    );
  });

  it('durationToMs parses units and rejects invalid values', () => {
    const durationToMs = (
      service as unknown as { durationToMs: (value: string) => number }
    ).durationToMs.bind(service);
    expect(durationToMs('15m')).toBe(900_000);
    expect(durationToMs('2h')).toBe(7_200_000);
    expect(() => durationToMs('15x')).toThrow(/Invalid duration/);
  });

  it('login returns a QR enrollment challenge when MFA is required but not enrolled', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'active',
      passwordHash: 'hash',
      adminProfile,
    });
    prisma.$queryRaw
      .mockResolvedValueOnce([
        {
          enabled: true,
          config_json: { admin_mfa_required: '1', admin_mfa_issuer: 'BookingQube Admin' },
        },
      ])
      .mockResolvedValueOnce([{ mfa_secret_enc: null, mfa_enabled_at: null }])
      .mockResolvedValueOnce([
        {
          enabled: true,
          config_json: { admin_mfa_required: '1', admin_mfa_issuer: 'BookingQube Admin' },
        },
      ]);

    const result = await service.login(
      { email: 'admin@example.com', password: 'Secret123!' },
      {},
    );

    expect(result).toEqual(
      expect.objectContaining({
        mfa_enrollment_required: true,
        data: expect.objectContaining({
          challenge_token: 'access-token',
          qr_data_url: 'data:image/png;base64,qr',
          secret: expect.any(String),
        }),
      }),
    );
    expect(prisma.adminSession.create).not.toHaveBeenCalled();
  });
});
