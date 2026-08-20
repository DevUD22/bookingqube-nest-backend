import { generateTotp, generateTotpSecret, totpAuthUrl, verifyTotp } from './totp';

describe('totp', () => {
  it('verifies a code for the current time step', () => {
    const secret = generateTotpSecret();
    const now = Date.parse('2026-08-17T10:00:00Z');
    const code = generateTotp(secret, now);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotp(secret, code, now)).toBe(true);
    expect(verifyTotp(secret, '000000', now)).toBe(false);
  });

  it('accepts an adjacent time step', () => {
    const secret = generateTotpSecret();
    const now = Date.parse('2026-08-17T10:00:00Z');
    const previous = generateTotp(secret, now - 30_000);
    expect(verifyTotp(secret, previous, now)).toBe(true);
  });

  it('builds an otpauth URL', () => {
    expect(totpAuthUrl('JBSWY3DPEHPK3PXP', 'admin@example.com')).toContain(
      'otpauth://totp/',
    );
  });
});
