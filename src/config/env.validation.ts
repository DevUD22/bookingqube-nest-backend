type RawEnv = Record<string, string | undefined>;

interface ValidatedEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  API_PREFIX: string;
  API_VERSION: string;
  DATABASE_URL: string;
  REDIS_URL?: string;
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_TTL: string;
  JWT_REFRESH_TTL: string;
  POS_JWT_ACCESS_SECRET: string;
  POS_JWT_ACCESS_TTL: string;
  CAFE_POS_JWT_ACCESS_SECRET: string;
  CAFE_POS_JWT_ACCESS_TTL: string;
  ADMIN_JWT_ACCESS_SECRET: string;
  ADMIN_JWT_REFRESH_SECRET: string;
  ADMIN_JWT_ACCESS_TTL: string;
  ADMIN_JWT_REFRESH_TTL: string;
  CORS_ORIGINS: string[];
  GOOGLE_OAUTH_CLIENT_ID: string;
  APPLE_OAUTH_CLIENT_ID: string;
  BACKEND_PUBLIC_URL: string;
  ENABLE_SWAGGER?: string;
}

function required(env: RawEnv, key: keyof ValidatedEnv): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function assertDistinct(leftName: string, left: string, rightName: string, right: string) {
  if (left === right) {
    throw new Error(`${leftName} must be distinct from ${rightName}`);
  }
}

export function validateEnv(env: RawEnv): ValidatedEnv {
  const nodeEnv = (env.NODE_ENV ?? 'development') as ValidatedEnv['NODE_ENV'];
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production');
  }

  const port = Number(env.PORT ?? 4000);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error('PORT must be a positive integer');
  }

  const jwtAccessSecret = required(env, 'JWT_ACCESS_SECRET');
  const jwtRefreshSecret = required(env, 'JWT_REFRESH_SECRET');
  const posJwtAccessSecret = required(env, 'POS_JWT_ACCESS_SECRET');
  const cafePosJwtAccessSecret = required(env, 'CAFE_POS_JWT_ACCESS_SECRET');
  const adminJwtAccessSecret = required(env, 'ADMIN_JWT_ACCESS_SECRET');
  const adminJwtRefreshSecret = required(env, 'ADMIN_JWT_REFRESH_SECRET');

  assertDistinct('JWT_REFRESH_SECRET', jwtRefreshSecret, 'JWT_ACCESS_SECRET', jwtAccessSecret);
  assertDistinct('POS_JWT_ACCESS_SECRET', posJwtAccessSecret, 'JWT_ACCESS_SECRET', jwtAccessSecret);
  assertDistinct(
    'CAFE_POS_JWT_ACCESS_SECRET',
    cafePosJwtAccessSecret,
    'JWT_ACCESS_SECRET',
    jwtAccessSecret,
  );
  assertDistinct(
    'CAFE_POS_JWT_ACCESS_SECRET',
    cafePosJwtAccessSecret,
    'POS_JWT_ACCESS_SECRET',
    posJwtAccessSecret,
  );
  assertDistinct(
    'ADMIN_JWT_ACCESS_SECRET',
    adminJwtAccessSecret,
    'JWT_ACCESS_SECRET',
    jwtAccessSecret,
  );
  assertDistinct(
    'ADMIN_JWT_ACCESS_SECRET',
    adminJwtAccessSecret,
    'POS_JWT_ACCESS_SECRET',
    posJwtAccessSecret,
  );
  assertDistinct(
    'ADMIN_JWT_ACCESS_SECRET',
    adminJwtAccessSecret,
    'CAFE_POS_JWT_ACCESS_SECRET',
    cafePosJwtAccessSecret,
  );
  assertDistinct(
    'ADMIN_JWT_REFRESH_SECRET',
    adminJwtRefreshSecret,
    'JWT_REFRESH_SECRET',
    jwtRefreshSecret,
  );
  assertDistinct(
    'ADMIN_JWT_REFRESH_SECRET',
    adminJwtRefreshSecret,
    'ADMIN_JWT_ACCESS_SECRET',
    adminJwtAccessSecret,
  );

  return {
    NODE_ENV: nodeEnv,
    PORT: port,
    API_PREFIX: env.API_PREFIX ?? 'api',
    API_VERSION: env.API_VERSION ?? 'v2',
    DATABASE_URL: required(env, 'DATABASE_URL'),
    REDIS_URL: env.REDIS_URL,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_REFRESH_SECRET: jwtRefreshSecret,
    JWT_ACCESS_TTL: env.JWT_ACCESS_TTL ?? '15m',
    JWT_REFRESH_TTL: env.JWT_REFRESH_TTL ?? '30d',
    POS_JWT_ACCESS_SECRET: posJwtAccessSecret,
    POS_JWT_ACCESS_TTL: env.POS_JWT_ACCESS_TTL ?? '12h',
    CAFE_POS_JWT_ACCESS_SECRET: cafePosJwtAccessSecret,
    CAFE_POS_JWT_ACCESS_TTL: env.CAFE_POS_JWT_ACCESS_TTL ?? '12h',
    ADMIN_JWT_ACCESS_SECRET: adminJwtAccessSecret,
    ADMIN_JWT_REFRESH_SECRET: adminJwtRefreshSecret,
    ADMIN_JWT_ACCESS_TTL: env.ADMIN_JWT_ACCESS_TTL ?? '15m',
    ADMIN_JWT_REFRESH_TTL: env.ADMIN_JWT_REFRESH_TTL ?? '7d',
    CORS_ORIGINS: (env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    GOOGLE_OAUTH_CLIENT_ID: required(env, 'GOOGLE_OAUTH_CLIENT_ID'),
    APPLE_OAUTH_CLIENT_ID: required(env, 'APPLE_OAUTH_CLIENT_ID'),
    BACKEND_PUBLIC_URL: env.BACKEND_PUBLIC_URL ?? `http://localhost:${port}`,
    ENABLE_SWAGGER: env.ENABLE_SWAGGER,
  };
}
