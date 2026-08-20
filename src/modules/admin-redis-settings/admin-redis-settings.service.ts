import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  TestRedisSettingDto,
  UpsertRedisSettingDto,
} from './dto/admin-redis-settings.dto';

function maskSecret(value: string) {
  if (!value) return '';
  if (value.length <= 12) return '••••••••••••';
  return `${value.slice(0, 8)}••••${value.slice(-4)}`;
}

function isMasked(value: string) {
  return value.includes('••••');
}

@Injectable()
export class AdminRedisSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  async get() {
    const row = await this.ensureRow();
    return this.serialize(row);
  }

  async upsert(body: UpsertRedisSettingDto, adminUserId?: string) {
    const existing = await this.ensureRow();

    let url = existing.url ?? '';
    if (body.url !== undefined) {
      const incoming = body.url.trim();
      if (incoming && !isMasked(incoming)) {
        url = incoming;
      }
    }

    let enabled = body.enabled ?? existing.enabled;
    let lastTestedAt = existing.lastTestedAt;
    let lastTestOk = existing.lastTestOk;
    let lastTestMessage = existing.lastTestMessage;

    if (enabled) {
      if (!url?.trim()) {
        throw new BadRequestException(
          'Add a Redis URL before enabling Redis.',
        );
      }

      const test = await this.redis.testConnection(url);
      lastTestedAt = new Date();
      lastTestOk = test.ok;
      lastTestMessage = test.message;
      if (!test.ok) {
        throw new BadRequestException(
          `Cannot enable Redis: ${test.message}`,
        );
      }
    }

    const updated = await this.prisma.redisSetting.update({
      where: { id: existing.id },
      data: {
        enabled,
        url: url || null,
        lastTestedAt,
        lastTestOk,
        lastTestMessage,
        updatedByUserId: adminUserId ?? null,
      },
    });

    await this.redis.reloadFromDatabase();

    return this.serialize(updated);
  }

  async testConnection(body: TestRedisSettingDto) {
    const existing = await this.ensureRow();
    const url =
      body.url?.trim() && !isMasked(body.url)
        ? body.url.trim()
        : existing.url?.trim() ||
          this.config.get<string>('REDIS_URL')?.trim() ||
          '';

    if (!url) {
      throw new BadRequestException('Redis URL is required to test.');
    }

    const result = await this.redis.testConnection(url);

    const updated = await this.prisma.redisSetting.update({
      where: { id: existing.id },
      data: {
        lastTestedAt: new Date(),
        lastTestOk: result.ok,
        lastTestMessage: result.message,
      },
    });

    return {
      success: result.ok,
      message: result.message,
      settings: this.serialize(updated),
    };
  }

  private async ensureRow() {
    const existing = await this.prisma.redisSetting.findFirst({
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;

    return this.prisma.redisSetting.create({
      data: {
        enabled: false,
        url: this.config.get<string>('REDIS_URL')?.trim() || null,
      },
    });
  }

  private serialize(row: {
    id: string;
    enabled: boolean;
    url: string | null;
    lastTestedAt: Date | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
    updatedAt: Date;
  }) {
    const runtimeReady = this.redis.isReady();
    return {
      id: row.id,
      enabled: row.enabled,
      url: row.url ? maskSecret(row.url) : '',
      url_set: Boolean(row.url?.trim()),
      last_tested_at: row.lastTestedAt?.toISOString() ?? null,
      last_test_ok: row.lastTestOk,
      last_test_message: row.lastTestMessage,
      updated_at: row.updatedAt.toISOString(),
      active: row.enabled && runtimeReady,
      runtime_ready: runtimeReady,
    };
  }
}
