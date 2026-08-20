import { BadRequestException } from '@nestjs/common';

/** POS / cafe POS keep the original min-8 policy and skip admin MFA. */
export const RELAXED_STAFF_ROLES = new Set(['pos', 'cafe_pos']);

export const ADMIN_PASSWORD_MIN_LENGTH = 12;
export const BASIC_PASSWORD_MIN_LENGTH = 8;

export const ADMIN_PASSWORD_HINT =
  'Use at least 12 characters with uppercase, lowercase, a number, and a symbol.';

const COMMON_PASSWORDS = new Set(
  [
    'password',
    'password1',
    'password123',
    'password123!',
    'passw0rd',
    'admin123',
    'admin123!',
    'adminpass123!',
    'secret123',
    'secret123!',
    'qwerty123',
    'qwerty123!',
    '12345678',
    '1234567890',
    'letmein1',
    'welcome1',
    'welcome123',
    'changeme',
    'changeme1',
    'bookingqube',
    'bookingqube1',
    'bookingqube123',
  ].map((value) => value.toLowerCase()),
);

export function roleUsesRelaxedPassword(role?: string | null): boolean {
  return RELAXED_STAFF_ROLES.has((role ?? '').trim().toLowerCase());
}

export function assertBasicPassword(password: string): void {
  if (password.length < BASIC_PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${BASIC_PASSWORD_MIN_LENGTH} characters.`,
    );
  }
  if (password.length > 128) {
    throw new BadRequestException('Password must be at most 128 characters.');
  }
}

export function assertAdminPassword(password: string, email?: string): void {
  assertBasicPassword(password);
  if (password.length < ADMIN_PASSWORD_MIN_LENGTH) {
    throw new BadRequestException(ADMIN_PASSWORD_HINT);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    throw new BadRequestException(ADMIN_PASSWORD_HINT);
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    throw new BadRequestException('Choose a less common password.');
  }
  const localPart = email?.split('@')[0]?.trim().toLowerCase();
  if (localPart && localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    throw new BadRequestException('Password must not contain your email name.');
  }
}

export function assertPasswordForRole(
  password: string,
  role?: string | null,
  email?: string,
): void {
  if (roleUsesRelaxedPassword(role)) {
    assertBasicPassword(password);
    return;
  }
  assertAdminPassword(password, email);
}
