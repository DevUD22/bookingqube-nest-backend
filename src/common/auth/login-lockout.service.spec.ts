import { UnauthorizedException } from '@nestjs/common';

import { LoginLockoutService } from './login-lockout.service';

describe('LoginLockoutService', () => {
  const redis = { getClient: jest.fn().mockReturnValue(null) };
  const lockout = new LoginLockoutService(redis as never);

  it('locks after five failed password attempts and uses a generic error', async () => {
    const identity = `lockout-${Date.now()}@example.test`;
    for (let i = 0; i < 5; i += 1) {
      await lockout.recordFailure('customer', identity);
    }
    await expect(
      lockout.assertNotLocked('customer', identity, 'Invalid email or password.'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('clears failures after a successful login', async () => {
    const identity = `clear-${Date.now()}@example.test`;
    await lockout.recordFailure('customer', identity);
    await lockout.clear('customer', identity);
    await expect(
      lockout.assertNotLocked('customer', identity, 'Invalid email or password.'),
    ).resolves.toBeUndefined();
  });
});
