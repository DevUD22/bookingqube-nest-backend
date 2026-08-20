import { BadRequestException } from '@nestjs/common';

import {
  assertAdminPassword,
  assertPasswordForRole,
  roleUsesRelaxedPassword,
} from './password-policy';

describe('password-policy', () => {
  it('keeps POS and cafe POS on the relaxed policy', () => {
    expect(roleUsesRelaxedPassword('pos')).toBe(true);
    expect(roleUsesRelaxedPassword('cafe_pos')).toBe(true);
    expect(roleUsesRelaxedPassword('admin')).toBe(false);
    expect(() => assertPasswordForRole('Secret12', 'pos')).not.toThrow();
  });

  it('requires length and complexity for admin roles', () => {
    expect(() => assertAdminPassword('Secret123!')).toThrow(BadRequestException);
    expect(() => assertAdminPassword('adminpassword')).toThrow(BadRequestException);
    expect(() => assertAdminPassword('StrongPassw0rd!')).not.toThrow();
  });

  it('rejects common passwords and email local-part reuse', () => {
    expect(() => assertAdminPassword('Password123!')).toThrow(/less common/);
    expect(() =>
      assertAdminPassword('AishaKhan1!xx', 'aisha@example.com'),
    ).toThrow(/email name/);
  });
});
