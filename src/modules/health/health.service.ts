import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getHealth() {
    const database = await this.checkDatabase();
    const redis = await this.redis.ping();

    return {
      status: database ? 'ok' : 'degraded',
      service: 'bookingqube-backend',
      timestamp: new Date().toISOString(),
      checks: {
        database,
        redis,
      },
    };
  }

  private async checkDatabase() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
