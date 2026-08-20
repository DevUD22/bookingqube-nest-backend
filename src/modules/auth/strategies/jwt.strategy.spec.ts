import { UnauthorizedException } from '@nestjs/common';

import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const config = { getOrThrow: () => 'test-customer-secret' };
  const strategy = new JwtStrategy(config as never, prisma as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'a@b.c',
      name: 'Ada',
      status: 'active',
      tokenVersion: 0,
    });
  });

  it('rejects tokens without customer_access typ', async () => {
    await expect(
      strategy.validate({ sub: 'user-1', email: 'a@b.c' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects POS tokens presented as customer JWTs', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.c',
        typ: 'pos_access',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('accepts customer_access tokens for active users', async () => {
    await expect(
      strategy.validate({
        sub: 'user-1',
        email: 'a@b.c',
        typ: 'customer_access',
        tv: 0,
      }),
    ).resolves.toEqual({ id: 'user-1', email: 'a@b.c', name: 'Ada' });
  });
});
