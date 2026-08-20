import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AdvancePaymentStatus } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';

import { PrismaService } from '../../database/prisma.service';
import { InventoryDelta, InventoryService } from '../inventory/inventory.service';
import { holdTtlKey } from '../inventory/inventory.scripts';
import { RedisService } from '../redis/redis.service';
import { ReportingService, ReportSyncPayload } from '../reporting/reporting.service';

export const HOLD_EXPIRE_QUEUE = 'hold-expire';
export const REPORT_SYNC_QUEUE = 'report-sync';

export type HoldExpireJob = {
  holdId: string;
  deltas: InventoryDelta[];
};

const HOLD_TTL_MS = 10 * 60 * 1000;

@Injectable()
export class BookingJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BookingJobsService.name);
  private holdQueue: Queue<HoldExpireJob> | null = null;
  private reportQueue: Queue<ReportSyncPayload> | null = null;
  private holdWorker: Worker<HoldExpireJob> | null = null;
  private reportWorker: Worker<ReportSyncPayload> | null = null;
  private enabled = false;

  constructor(
    private readonly redis: RedisService,
    private readonly inventory: InventoryService,
    private readonly prisma: PrismaService,
    private readonly reporting: ReportingService,
  ) {}

  async onModuleInit() {
    // RedisService.onModuleInit may still be connecting; register then start once.
    this.redis.onSettingsReloaded(() => this.reload());
    await this.reload();
  }

  async onModuleDestroy() {
    await this.shutdown();
  }

  /** Start/stop BullMQ workers based on current admin Redis settings. */
  async reload() {
    await this.shutdown();

    if (process.env.BOOKING_JOBS_ENABLED === 'false') {
      this.logger.warn('Booking jobs disabled (BOOKING_JOBS_ENABLED=false).');
      return;
    }

    const url = this.redis.getConfiguredUrl();
    if (!url) {
      this.logger.warn(
        'Booking jobs disabled (Redis not enabled in settings).',
      );
      return;
    }

    try {
      const connection = { url, maxRetriesPerRequest: null as null };
      this.holdQueue = new Queue(HOLD_EXPIRE_QUEUE, { connection });
      this.reportQueue = new Queue(REPORT_SYNC_QUEUE, { connection });

      this.holdWorker = new Worker(
        HOLD_EXPIRE_QUEUE,
        async (job) => this.processHoldExpire(job),
        { connection },
      );
      this.reportWorker = new Worker(
        REPORT_SYNC_QUEUE,
        async (job) => this.processReportSync(job),
        { connection },
      );

      this.holdWorker.on('failed', (job, error) => {
        this.logger.error(`Hold expire job ${job?.id} failed: ${error.message}`);
      });
      this.reportWorker.on('failed', (job, error) => {
        this.logger.error(`Report sync job ${job?.id} failed: ${error.message}`);
      });

      this.enabled = true;
      this.logger.log('Booking job workers started.');
    } catch (error) {
      this.logger.warn(
        `Booking jobs unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
      await this.shutdown();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  async scheduleHoldExpiry(holdId: string, deltas: InventoryDelta[], delayMs = HOLD_TTL_MS) {
    const client = this.redis.getClient();
    if (client) {
      await client.set(holdTtlKey(holdId), JSON.stringify(deltas), 'PX', delayMs);
    }

    if (this.holdQueue) {
      await this.holdQueue.add(
        'expire',
        { holdId, deltas },
        {
          jobId: `hold-expire-${holdId}`,
          delay: delayMs,
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
      return;
    }

    setTimeout(() => {
      void this.processHoldExpire({
        data: { holdId, deltas },
      } as Job<HoldExpireJob>);
    }, delayMs).unref?.();
  }

  async enqueueReportSync(payload: ReportSyncPayload) {
    if (this.reportQueue) {
      await this.reportQueue.add('sync', payload, {
        removeOnComplete: true,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 500 },
      });
      return;
    }
    try {
      await this.reporting.syncOrder(payload);
    } catch (error) {
      this.logger.error('Inline report sync failed', error);
      await this.prisma.order
        .update({
          where: { id: payload.orderId },
          data: { reportSyncPending: true },
        })
        .catch(() => undefined);
    }
  }

  async cancelHoldExpiry(holdId: string) {
    const client = this.redis.getClient();
    if (client) await client.del(holdTtlKey(holdId));
    if (this.holdQueue) {
      const job = await this.holdQueue.getJob(`hold-expire-${holdId}`);
      if (job) await job.remove().catch(() => undefined);
    }
  }

  private async processHoldExpire(job: Job<HoldExpireJob> | { data: HoldExpireJob }) {
    const { holdId, deltas } = job.data;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const hold = await tx.ticketHold.findUnique({
        where: { id: holdId },
        include: { items: true, orders: true },
      });
      if (!hold || hold.status !== 'active') return null;

      // POS advance deposits must stay reserved until remaining payment is collected.
      const pendingAdvance = await tx.advancePayment.findFirst({
        where: { holdId, status: AdvancePaymentStatus.PENDING },
        select: { id: true },
      });
      if (pendingAdvance) return null;

      await tx.ticketHold.update({
        where: { id: holdId },
        data: { status: 'expired' },
      });
      await tx.order.updateMany({
        where: { holdId, status: 'pending_payment' },
        data: { status: 'expired' },
      });
      return hold;
    });

    if (!claimed) return;

    await this.inventory.release(
      deltas.length > 0
        ? deltas
        : claimed.items.map((item) => ({
            inventoryItemId: item.inventoryItemId,
            quantity: item.quantity,
          })),
    );

    for (const order of claimed.orders) {
      await this.enqueueReportSync({ orderId: order.id, action: 'expire' });
    }
  }

  private async processReportSync(job: Job<ReportSyncPayload>) {
    await this.reporting.syncOrder(job.data);
  }

  private async shutdown() {
    await Promise.allSettled([
      this.holdWorker?.close(),
      this.reportWorker?.close(),
      this.holdQueue?.close(),
      this.reportQueue?.close(),
    ]);
    this.holdWorker = null;
    this.reportWorker = null;
    this.holdQueue = null;
    this.reportQueue = null;
    this.enabled = false;
  }
}
