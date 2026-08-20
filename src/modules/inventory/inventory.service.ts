import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import {
  INVENTORY_CONVERT_LUA,
  INVENTORY_RELEASE_LUA,
  INVENTORY_RELEASE_SOLD_LUA,
  INVENTORY_RESERVE_LUA,
  inventoryKey,
} from './inventory.scripts';

export type InventoryDelta = {
  inventoryItemId: string;
  quantity: number;
};

export type InventorySnapshot = {
  id: string;
  totalQuantity: number | null;
  soldQuantity: number;
  heldQuantity: number;
  status: string;
};

/**
 * Capacity hold/sold tracking applies only when schedule inventory is limited
 * ("Limit tickets per bookable time"). Unlimited rows (`total_quantity` null)
 * are skipped — there is nothing to reserve.
 */
@Injectable()
export class InventoryService {
  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  /** Sort deltas by inventory UUID ascending — required for deadlock-free multi-SKU ops. */
  sortDeltas(deltas: InventoryDelta[]): InventoryDelta[] {
    return [...deltas].sort((a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId));
  }

  /**
   * Keep only capacity-limited inventory rows (`total_quantity` is a finite number).
   * Unlimited / track-inventory-off rows are omitted.
   */
  async filterCapacityLimited(deltas: InventoryDelta[]): Promise<InventoryDelta[]> {
    const merged = this.mergeDeltas(deltas);
    if (merged.length === 0) return [];

    const ids = merged.map((d) => d.inventoryItemId);
    await this.ensureLoaded(ids);

    const limitedIds = new Set<string>();
    const client = this.redis.getClient();
    if (client) {
      for (const id of ids) {
        const totalRaw = await client.hget(inventoryKey(id), 'total');
        if (totalRaw === null || totalRaw === undefined || totalRaw === '') continue;
        const total = Number(totalRaw);
        // Redis stores unlimited as "-1"
        if (Number.isFinite(total) && total >= 0) {
          limitedIds.add(id);
        }
      }
    } else {
      const rows = await this.prisma.inventoryItem.findMany({
        where: { id: { in: ids }, totalQuantity: { not: null } },
        select: { id: true },
      });
      for (const row of rows) limitedIds.add(row.id);
    }

    return this.sortDeltas(merged.filter((d) => limitedIds.has(d.inventoryItemId)));
  }

  async reserve(deltas: InventoryDelta[], mode: 'hold' | 'sold'): Promise<void> {
    const sorted = await this.filterCapacityLimited(deltas);
    if (sorted.length === 0) return;

    await this.ensureLoaded(sorted.map((d) => d.inventoryItemId));

    const client = this.redis.getClient();
    if (client) {
      const keys = sorted.map((d) => inventoryKey(d.inventoryItemId));
      const args = [...sorted.map((d) => String(d.quantity)), mode];
      const result = (await client.eval(
        INVENTORY_RESERVE_LUA,
        keys.length,
        ...keys,
        ...args,
      )) as [number, number?, string?];
      if (!result || result[0] !== 1) {
        throw new BadRequestException('Selected quantity is no longer available.');
      }
      return;
    }

    await this.reserveInPostgres(sorted, mode);
  }

  usesRedis(): boolean {
    return this.redis.isReady();
  }

  async release(deltas: InventoryDelta[]): Promise<void> {
    const sorted = await this.filterCapacityLimited(deltas);
    if (sorted.length === 0) return;
    await this.releaseRedisOnly(sorted);
    await this.releaseInPostgres(sorted);
  }

  async releaseRedisOnly(deltas: InventoryDelta[]): Promise<void> {
    const sorted = await this.filterCapacityLimited(deltas);
    const client = this.redis.getClient();
    if (!client || sorted.length === 0) return;
    await this.ensureLoaded(sorted.map((d) => d.inventoryItemId));
    const keys = sorted.map((d) => inventoryKey(d.inventoryItemId));
    const args = sorted.map((d) => String(d.quantity));
    await client.eval(INVENTORY_RELEASE_LUA, keys.length, ...keys, ...args);
  }

  async convert(deltas: InventoryDelta[]): Promise<void> {
    const sorted = await this.filterCapacityLimited(deltas);
    if (sorted.length === 0) return;

    const client = this.redis.getClient();
    if (client) {
      await this.ensureLoaded(sorted.map((d) => d.inventoryItemId));
      const keys = sorted.map((d) => inventoryKey(d.inventoryItemId));
      const args = sorted.map((d) => String(d.quantity));
      await client.eval(INVENTORY_CONVERT_LUA, keys.length, ...keys, ...args);
    }

    await this.convertInPostgres(sorted);
  }

  /** Undo paid inventory (admin cancel/delete of paid orders). */
  async releaseSold(deltas: InventoryDelta[]): Promise<void> {
    const sorted = await this.filterCapacityLimited(deltas);
    if (sorted.length === 0) return;

    const client = this.redis.getClient();
    if (client) {
      await this.ensureLoaded(sorted.map((d) => d.inventoryItemId));
      const keys = sorted.map((d) => inventoryKey(d.inventoryItemId));
      const args = sorted.map((d) => String(d.quantity));
      await client.eval(INVENTORY_RELEASE_SOLD_LUA, keys.length, ...keys, ...args);
    }

    await this.releaseSoldInPostgres(sorted);
  }

  async getAvailability(inventoryItemIds: string[]): Promise<Map<string, number | null>> {
    const unique = [...new Set(inventoryItemIds)];
    await this.ensureLoaded(unique);
    const result = new Map<string, number | null>();
    const client = this.redis.getClient();

    if (client) {
      for (const id of unique) {
        const data = await client.hgetall(inventoryKey(id));
        if (!data || Object.keys(data).length === 0) {
          result.set(id, null);
          continue;
        }
        const total = data.total === '' || data.total === undefined ? -1 : Number(data.total);
        if (total < 0) {
          result.set(id, null);
          continue;
        }
        const sold = Number(data.sold ?? 0);
        const held = Number(data.held ?? 0);
        result.set(id, Math.max(0, total - sold - held));
      }
      return result;
    }

    const rows = await this.prisma.inventoryItem.findMany({
      where: { id: { in: unique } },
    });
    for (const row of rows) {
      if (row.totalQuantity === null) {
        result.set(row.id, null);
      } else {
        result.set(
          row.id,
          Math.max(0, row.totalQuantity - row.soldQuantity - row.heldQuantity),
        );
      }
    }
    return result;
  }

  async warmFromDb(ids: string[]): Promise<void> {
    await this.ensureLoaded(ids);
  }

  async invalidate(ids: string[]): Promise<void> {
    const client = this.redis.getClient();
    if (!client || ids.length === 0) return;
    await client.del(...ids.map((id) => inventoryKey(id)));
  }

  private mergeDeltas(deltas: InventoryDelta[]): InventoryDelta[] {
    const map = new Map<string, number>();
    for (const delta of deltas) {
      map.set(delta.inventoryItemId, (map.get(delta.inventoryItemId) ?? 0) + delta.quantity);
    }
    return [...map.entries()].map(([inventoryItemId, quantity]) => ({
      inventoryItemId,
      quantity,
    }));
  }

  private async ensureLoaded(ids: string[]): Promise<void> {
    const client = this.redis.getClient();
    if (!client || ids.length === 0) return;

    const missing: string[] = [];
    for (const id of ids) {
      const exists = await client.exists(inventoryKey(id));
      if (!exists) missing.push(id);
    }
    if (missing.length === 0) return;

    const rows = await this.prisma.inventoryItem.findMany({
      where: { id: { in: missing } },
    });
    const pipeline = client.pipeline();
    for (const row of rows) {
      pipeline.hset(inventoryKey(row.id), {
        total: row.totalQuantity === null ? '-1' : String(row.totalQuantity),
        sold: String(row.soldQuantity),
        held: String(row.heldQuantity),
        status: row.status,
      });
    }
    await pipeline.exec();
  }

  private async reserveInPostgres(sorted: InventoryDelta[], mode: 'hold' | 'sold') {
    await this.prisma.$transaction(async (tx) => {
      for (const item of sorted) {
        // Capacity-limited only — unlimited (`total_quantity` null) is never held/sold here.
        const changed = await tx.$executeRaw`
          UPDATE "inventory_items"
          SET
            "held_quantity" = "held_quantity" + ${mode === 'hold' ? item.quantity : 0},
            "sold_quantity" = "sold_quantity" + ${mode === 'sold' ? item.quantity : 0},
            "updated_at" = NOW()
          WHERE "id" = ${item.inventoryItemId}::uuid
            AND "status" = 'active'::"InventoryStatus"
            AND "total_quantity" IS NOT NULL
            AND "total_quantity" - "sold_quantity" - "held_quantity" >= ${item.quantity}
        `;
        if (changed !== 1) {
          throw new BadRequestException('Selected quantity is no longer available.');
        }
      }
    });
  }

  private async releaseInPostgres(sorted: InventoryDelta[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const item of sorted) {
        await tx.$executeRaw`
          UPDATE "inventory_items"
          SET
            "held_quantity" = GREATEST(0, "held_quantity" - ${item.quantity}),
            "updated_at" = NOW()
          WHERE "id" = ${item.inventoryItemId}::uuid
            AND "total_quantity" IS NOT NULL
        `;
      }
    });
  }

  private async convertInPostgres(sorted: InventoryDelta[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const item of sorted) {
        await tx.$executeRaw`
          UPDATE "inventory_items"
          SET
            "held_quantity" = GREATEST(0, "held_quantity" - ${item.quantity}),
            "sold_quantity" = "sold_quantity" + ${item.quantity},
            "updated_at" = NOW()
          WHERE "id" = ${item.inventoryItemId}::uuid
            AND "total_quantity" IS NOT NULL
        `;
      }
    });
  }

  private async releaseSoldInPostgres(sorted: InventoryDelta[]) {
    await this.prisma.$transaction(async (tx) => {
      for (const item of sorted) {
        await tx.$executeRaw`
          UPDATE "inventory_items"
          SET
            "sold_quantity" = GREATEST(0, "sold_quantity" - ${item.quantity}),
            "updated_at" = NOW()
          WHERE "id" = ${item.inventoryItemId}::uuid
            AND "total_quantity" IS NOT NULL
        `;
      }
    });
  }

  /** Persist Redis reservation into PG when Redis was the primary path (sync after reserve). */
  async syncReserveToPostgres(
    tx: Prisma.TransactionClient,
    deltas: InventoryDelta[],
    mode: 'hold' | 'sold',
  ) {
    const sorted = await this.filterCapacityLimited(deltas);
    for (const item of sorted) {
      const changed = await tx.$executeRaw`
        UPDATE "inventory_items"
        SET
          "held_quantity" = "held_quantity" + ${mode === 'hold' ? item.quantity : 0},
          "sold_quantity" = "sold_quantity" + ${mode === 'sold' ? item.quantity : 0},
          "updated_at" = NOW()
        WHERE "id" = ${item.inventoryItemId}::uuid
          AND "status" = 'active'::"InventoryStatus"
          AND "total_quantity" IS NOT NULL
          AND "total_quantity" - "sold_quantity" - "held_quantity" >= ${item.quantity}
      `;
      if (changed !== 1) {
        throw new BadRequestException('Selected quantity is no longer available.');
      }
    }
  }
}
