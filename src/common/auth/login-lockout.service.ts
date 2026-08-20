import { Injectable, UnauthorizedException } from '@nestjs/common';

import { RedisService } from '../../modules/redis/redis.service';

const MAX_FAILURES = 5;
const WINDOW_SECONDS = 15 * 60;

type MemorySlot = { failures: number; lockedUntil: number };

@Injectable()
export class LoginLockoutService {
  private readonly memory = new Map<string, MemorySlot>();

  constructor(private readonly redis: RedisService) {}

  async assertNotLocked(
    scope: string,
    identity: string,
    message: string,
  ): Promise<void> {
    const key = this.key(scope, identity);
    if (!key) return;
    if (await this.isLocked(key)) {
      throw new UnauthorizedException(message);
    }
  }

  async recordFailure(scope: string, identity: string): Promise<void> {
    const key = this.key(scope, identity);
    if (!key) return;
    const client = this.redis.getClient();
    if (client) {
      try {
        const failKey = `login-fail:${key}`;
        const failures = await client.incr(failKey);
        if (failures === 1) {
          await client.expire(failKey, WINDOW_SECONDS);
        }
        if (failures >= MAX_FAILURES) {
          await client.set(`login-lock:${key}`, '1', 'EX', WINDOW_SECONDS);
        }
        return;
      } catch {
        // Fall through to process memory if Redis errors.
      }
    }

    const now = Date.now();
    const existing = this.memory.get(key);
    const slot =
      existing && (!existing.lockedUntil || existing.lockedUntil > now)
        ? existing
        : { failures: 0, lockedUntil: 0 };
    const failures = slot.failures + 1;
    this.memory.set(key, {
      failures,
      lockedUntil: failures >= MAX_FAILURES ? now + WINDOW_SECONDS * 1000 : 0,
    });
  }

  async clear(scope: string, identity: string): Promise<void> {
    const key = this.key(scope, identity);
    if (!key) return;
    this.memory.delete(key);
    const client = this.redis.getClient();
    if (!client) return;
    try {
      await client.del(`login-fail:${key}`, `login-lock:${key}`);
    } catch {
      // Ignore Redis errors on successful login.
    }
  }

  private async isLocked(key: string): Promise<boolean> {
    const client = this.redis.getClient();
    if (client) {
      try {
        return (await client.exists(`login-lock:${key}`)) === 1;
      } catch {
        // Fall through to memory.
      }
    }
    const slot = this.memory.get(key);
    if (!slot) return false;
    if (slot.lockedUntil > Date.now()) return true;
    if (slot.lockedUntil) this.memory.delete(key);
    return false;
  }

  private key(scope: string, identity: string): string | null {
    const normalized = identity.trim().toLowerCase();
    if (!normalized) return null;
    return `${scope}:${normalized}`;
  }
}
