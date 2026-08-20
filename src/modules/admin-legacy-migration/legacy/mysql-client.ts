import { createPool, type Pool, type RowDataPacket } from 'mysql2/promise';

import {
  assertLegacyMysqlConfig,
  loadLegacyMysqlConfig,
  type LegacyMysqlSource,
} from './config';

let pool: Pool | null = null;
let poolSource: LegacyMysqlSource | null = null;
let currentSource: LegacyMysqlSource = 'local';

/** Set the MySQL source used by subsequent mysqlQuery / extract calls. */
export async function useMysqlSource(source: LegacyMysqlSource) {
  currentSource = source;
  if (pool && poolSource !== source) {
    await closeMysql();
  }
}

export function getCurrentMysqlSource(): LegacyMysqlSource {
  return currentSource;
}

export async function getMysqlPool(source: LegacyMysqlSource = currentSource): Promise<Pool> {
  if (pool && poolSource === source) return pool;

  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
    poolSource = null;
  }

  const cfg = loadLegacyMysqlConfig(source);
  assertLegacyMysqlConfig(cfg);

  pool = createPool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    waitForConnections: true,
    connectionLimit: 5,
    namedPlaceholders: true,
    dateStrings: true,
    connectTimeout: 20_000,
    ...(cfg.ssl
      ? {
          // Azure MySQL requires TLS; local/dev CA bundle usually isn't configured.
          ssl: { rejectUnauthorized: false },
        }
      : {}),
  });
  poolSource = source;
  currentSource = source;
  return pool;
}

export async function closeMysql() {
  if (pool) {
    await pool.end().catch(() => undefined);
    pool = null;
    poolSource = null;
  }
}

export async function mysqlQuery<T extends RowDataPacket[]>(
  sql: string,
  params?: Record<string, unknown> | unknown[],
  source: LegacyMysqlSource = currentSource,
): Promise<T> {
  const p = await getMysqlPool(source);
  const [rows] = await p.query<T>(sql, params as never);
  return rows;
}

export function describeMysqlSource(source: LegacyMysqlSource = 'local') {
  const cfg = loadLegacyMysqlConfig(source);
  return {
    source: cfg.source,
    host: cfg.host || null,
    port: cfg.port,
    database: cfg.database || null,
    user: cfg.user || null,
    ssl: cfg.ssl,
    configured: Boolean(cfg.host && cfg.user && cfg.database),
  };
}
