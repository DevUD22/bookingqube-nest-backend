import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { PrismaService } from '../../database/prisma.service';

export type ResolvedRedisConfig = {
  enabled: boolean;
  url: string | null;
  source: 'database' | 'env' | 'none';
};

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private ready = false;
  private configuredUrl: string | null = null;
  private connectedUrl: string | null = null;
  private settingsEnabled = false;
  private readonly reloadListeners: Array<() => Promise<void>> = [];

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** Register a listener invoked after settings-driven connect/disconnect. */
  onSettingsReloaded(listener: () => Promise<void>) {
    this.reloadListeners.push(listener);
  }

  async onModuleInit() {
    await this.reloadFromDatabase();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  /**
   * Load admin Redis settings and connect only when enabled with a URL.
   * Env REDIS_URL is used as a seed/fallback URL for the form — never auto-enables.
   */
  async reloadFromDatabase(): Promise<ResolvedRedisConfig> {
    const resolved = await this.resolveConfig();
    this.settingsEnabled = resolved.enabled;
    this.configuredUrl = resolved.url;

    if (!resolved.enabled) {
      await this.disconnect();
      this.logger.warn(
        'Redis disabled in settings — inventory/cache will use PostgreSQL fallback.',
      );
      await this.notifyReloadListeners();
      return resolved;
    }

    if (!resolved.url?.trim()) {
      await this.disconnect();
      this.logger.warn(
        'Redis enabled but no URL configured — inventory/cache will use PostgreSQL fallback.',
      );
      await this.notifyReloadListeners();
      return resolved;
    }

    await this.connect(resolved.url.trim());
    await this.notifyReloadListeners();
    return resolved;
  }

  private async notifyReloadListeners() {
    for (const listener of this.reloadListeners) {
      try {
        await listener();
      } catch (error) {
        this.logger.warn(
          `Redis reload listener failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  async resolveConfig(): Promise<ResolvedRedisConfig> {
    try {
      const row = await this.prisma.redisSetting.findFirst({
        orderBy: { createdAt: 'asc' },
      });

      if (row) {
        return {
          enabled: row.enabled,
          url: row.url?.trim() || null,
          source: 'database',
        };
      }
    } catch (error) {
      this.logger.warn(
        `Could not read redis_settings (${error instanceof Error ? error.message : String(error)}) — falling back to env.`,
      );
    }

    const envUrl = this.config.get<string>('REDIS_URL')?.trim() || null;
    if (envUrl) {
      return {
        enabled: false,
        url: envUrl,
        source: 'env',
      };
    }

    return { enabled: false, url: null, source: 'none' };
  }

  async testConnection(
    url: string,
  ): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
    const trimmed = url?.trim();
    if (!trimmed) {
      return { ok: false, message: 'Redis URL is required.' };
    }

    let probe: Redis | null = null;
    try {
      probe = new Redis(trimmed, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 3_000,
        retryStrategy: () => null,
      });
      await probe.connect();
      const pong = await probe.ping();
      if (pong !== 'PONG') {
        return { ok: false, message: `Unexpected PING response: ${pong}` };
      }
      return { ok: true, message: 'Connected — PING returned PONG.' };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Redis connection failed.';
      this.logger.warn(`Redis test failed: ${message}`);
      return { ok: false, message };
    } finally {
      if (probe) {
        try {
          await probe.quit();
        } catch {
          try {
            probe.disconnect();
          } catch {
            /* ignore */
          }
        }
      }
    }
  }

  /** URL used when Redis is enabled (for BullMQ etc.). */
  getConfiguredUrl(): string | null {
    return this.settingsEnabled && this.configuredUrl
      ? this.configuredUrl
      : null;
  }

  isSettingsEnabled() {
    return this.settingsEnabled;
  }

  isReady() {
    return this.settingsEnabled && this.ready && this.client !== null;
  }

  getClient(): Redis | null {
    return this.isReady() ? this.client : null;
  }

  async ping(): Promise<boolean> {
    const client = this.getClient();
    if (!client) return false;
    try {
      return (await client.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  private async connect(url: string) {
    if (this.client && this.connectedUrl === url && this.ready) {
      return;
    }

    await this.disconnect();

    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 2,
        enableReadyCheck: true,
        lazyConnect: true,
        connectTimeout: 3_000,
        retryStrategy: () => null,
      });
      this.client.on('error', (error) => {
        this.ready = false;
        this.logger.warn(`Redis error: ${error.message}`);
      });
      this.client.on('ready', () => {
        this.ready = true;
      });
      await this.client.connect();
      const pong = await this.client.ping();
      this.ready = pong === 'PONG';
      if (this.ready) {
        this.connectedUrl = url;
        this.logger.log('Redis connected.');
      }
    } catch (error) {
      this.ready = false;
      this.connectedUrl = null;
      this.logger.warn(
        `Redis unavailable (${error instanceof Error ? error.message : String(error)}) — using PostgreSQL fallback.`,
      );
      if (this.client) {
        try {
          this.client.disconnect();
        } catch {
          /* ignore */
        }
        this.client = null;
      }
    }
  }

  private async disconnect() {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        try {
          this.client.disconnect();
        } catch {
          /* ignore */
        }
      }
      this.client = null;
    }
    this.ready = false;
    this.connectedUrl = null;
  }
}
