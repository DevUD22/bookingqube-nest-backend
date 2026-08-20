import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/bookingqube',
  JWT_ACCESS_SECRET: 'customer-access',
  JWT_REFRESH_SECRET: 'customer-refresh',
  POS_JWT_ACCESS_SECRET: 'pos-access',
  CAFE_POS_JWT_ACCESS_SECRET: 'cafe-pos-access',
  ADMIN_JWT_ACCESS_SECRET: 'admin-access',
  ADMIN_JWT_REFRESH_SECRET: 'admin-refresh',
  GOOGLE_OAUTH_CLIENT_ID: 'google-client',
  APPLE_OAUTH_CLIENT_ID: 'apple-client',
};

describe('validateEnv', () => {
  it('requires distinct POS, cafe POS, and admin JWT secrets', () => {
    const env = validateEnv(baseEnv);
    expect(env.POS_JWT_ACCESS_SECRET).toBe('pos-access');
    expect(env.CAFE_POS_JWT_ACCESS_SECRET).toBe('cafe-pos-access');
    expect(env.ADMIN_JWT_ACCESS_SECRET).toBe('admin-access');
    expect(env.JWT_ACCESS_TTL).toBe('15m');
  });

  it('does not fall back to JWT_ACCESS_SECRET when POS_JWT_ACCESS_SECRET is missing', () => {
    expect(() =>
      validateEnv({ ...baseEnv, POS_JWT_ACCESS_SECRET: undefined }),
    ).toThrow('Missing required environment variable: POS_JWT_ACCESS_SECRET');
  });

  it('rejects a POS secret that matches the customer access secret', () => {
    expect(() =>
      validateEnv({ ...baseEnv, POS_JWT_ACCESS_SECRET: 'customer-access' }),
    ).toThrow('POS_JWT_ACCESS_SECRET must be distinct from JWT_ACCESS_SECRET');
  });

  it('rejects an admin access secret that matches the customer access secret', () => {
    expect(() =>
      validateEnv({ ...baseEnv, ADMIN_JWT_ACCESS_SECRET: 'customer-access' }),
    ).toThrow('ADMIN_JWT_ACCESS_SECRET must be distinct from JWT_ACCESS_SECRET');
  });
});
