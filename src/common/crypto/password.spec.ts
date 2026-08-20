import * as bcrypt from 'bcrypt';

import {
  BCRYPT_COST,
  hashPassword,
  needsRehash,
  upgradeHashIfNeeded,
  verifyPassword,
} from './password';

describe('password hashing', () => {
  it('hashes at bcrypt cost 12 and verifies the plaintext', async () => {
    const hash = await hashPassword('Secret123!');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(bcrypt.getRounds(hash)).toBe(BCRYPT_COST);
    await expect(verifyPassword('Secret123!', hash)).resolves.toBe(true);
    await expect(verifyPassword('wrong', hash)).resolves.toBe(false);
  });

  it('detects cost-10 hashes and upgrades them after a successful verify', async () => {
    const stale = await bcrypt.hash('Secret123!', 10);
    expect(needsRehash(stale)).toBe(true);

    const upgraded = await upgradeHashIfNeeded('Secret123!', stale);
    expect(upgraded).toBeDefined();
    expect(bcrypt.getRounds(upgraded!)).toBe(BCRYPT_COST);
    await expect(verifyPassword('Secret123!', upgraded!)).resolves.toBe(true);
  });

  it('does not upgrade a current-cost hash', async () => {
    const current = await hashPassword('Secret123!');
    expect(needsRehash(current)).toBe(false);
    await expect(upgradeHashIfNeeded('Secret123!', current)).resolves.toBeUndefined();
  });
});
