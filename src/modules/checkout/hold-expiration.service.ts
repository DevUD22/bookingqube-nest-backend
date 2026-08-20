import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { InventoryService } from '../inventory/inventory.service';
import { BookingJobsService } from '../queues/booking-jobs.service';
import { PaymentRecoveryService } from './payment-recovery.service';

const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const DEFAULT_BATCH_SIZE = 100;

/**
 * Backup sweeper for expired holds. Primary expiry is BullMQ delayed jobs;
 * this catches anything missed when Redis/queue was unavailable.
 */
@Injectable()
export class HoldExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldExpirationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryService,
    private readonly jobs: BookingJobsService,
    private readonly paymentRecovery: PaymentRecoveryService,
  ) {}

  onModuleInit() {
    if (process.env.HOLD_EXPIRATION_WORKER_ENABLED === 'false') return;
    const configured = Number(process.env.HOLD_EXPIRATION_INTERVAL_MS);
    const interval =
      Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_SWEEP_INTERVAL_MS;
    this.timer = setInterval(() => void this.runSweep(), interval);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async releaseExpiredHolds(batchSize = DEFAULT_BATCH_SIZE): Promise<number> {
    const claimed = await this.prisma.$transaction(async (tx) => {
      // Skip POS advance deposits — they stay open until remaining payment is collected.
      const holds = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT th."id"
        FROM "ticket_holds" th
        WHERE th."status" = 'active'::"HoldStatus"
          AND th."expires_at" <= NOW()
          AND NOT EXISTS (
            SELECT 1
            FROM "advance_payments" ap
            WHERE ap."hold_id" = th."id"
              AND ap."status" = 'PENDING'::"AdvancePaymentStatus"
          )
        ORDER BY th."expires_at" ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      `);
      if (holds.length === 0) return [] as string[];

      const holdIds = holds.map((hold) => hold.id);
      await tx.ticketHold.updateMany({
        where: { id: { in: holdIds }, status: 'active' },
        data: { status: 'expired' },
      });
      await tx.order.updateMany({
        where: { holdId: { in: holdIds }, status: 'pending_payment' },
        data: { status: 'expired' },
      });
      return holdIds;
    });

    if (claimed.length === 0) return 0;

    const holdItems = await this.prisma.ticketHoldItem.findMany({
      where: { holdId: { in: claimed } },
      select: { inventoryItemId: true, quantity: true },
    });
    const deltas = this.inventory.sortDeltas(
      holdItems.map((item) => ({
        inventoryItemId: item.inventoryItemId,
        quantity: item.quantity,
      })),
    );
    await this.inventory.release(deltas);

    const orders = await this.prisma.order.findMany({
      where: { holdId: { in: claimed }, status: 'expired' },
      select: { id: true },
    });

    if (orders.length) {
      await this.prisma.payment.updateMany({
        where: {
          orderId: { in: orders.map((order) => order.id) },
          status: 'pending',
        },
        data: {
          status: 'cancelled',
          failedAt: new Date(),
          failureMessage: 'Hold expired before payment confirmation.',
        },
      });
    }

    for (const holdId of claimed) {
      await this.jobs.cancelHoldExpiry(holdId);
    }
    for (const order of orders) {
      await this.jobs.enqueueReportSync({ orderId: order.id, action: 'expire' });
    }

    await this.paymentRecovery.markConfirmNeverCalled(orders.map((order) => order.id));

    return claimed.length;
  }

  private async runSweep() {
    if (this.running) return;
    this.running = true;
    try {
      let released: number;
      do {
        released = await this.releaseExpiredHolds();
      } while (released === DEFAULT_BATCH_SIZE);
    } catch (error) {
      this.logger.error('Failed to release expired ticket holds', error);
    } finally {
      this.running = false;
    }
  }
}
