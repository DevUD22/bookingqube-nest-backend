import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  parseLegacyMysqlSource,
  type LegacyMysqlSource,
} from './legacy/config';
import {
  getLegacyMetrics,
  listLegacyEvents,
  resolveLegacyEventIds,
} from './legacy/extract';
import {
  closeMysql,
  describeMysqlSource,
  useMysqlSource,
} from './legacy/mysql-client';
import {
  migrateEvent,
  verifyMigratedEvent,
} from './legacy/migrate-event';

@Injectable()
export class AdminLegacyMigrationService {
  constructor(private readonly prisma: PrismaService) {}

  sources() {
    return {
      local: describeMysqlSource('local'),
      live: describeMysqlSource('live'),
    };
  }

  private async withSource<T>(
    sourceRaw: string | undefined,
    fn: (source: LegacyMysqlSource) => Promise<T>,
  ): Promise<T> {
    const source = parseLegacyMysqlSource(sourceRaw);
    await useMysqlSource(source);
    try {
      return await fn(source);
    } finally {
      await closeMysql();
    }
  }

  listEvents(sourceRaw?: string) {
    return this.withSource(sourceRaw, async (source) => {
      const events = await listLegacyEvents(200);
      return {
        source,
        connection: describeMysqlSource(source),
        events: events.map((e) => ({
          id: e.id,
          title: e.title,
          slug: e.slug,
          common_event_id: e.common_event_id,
          orders: e.orders,
          tickets: e.tickets,
          admits: e.admits,
          revenue: Number(e.revenue),
        })),
      };
    });
  }

  inspect(oldEvent: string, sourceRaw?: string) {
    return this.withSource(sourceRaw, async (source) => {
      const { primary, eventIds, commonEventId } = await resolveLegacyEventIds(oldEvent);
      const metrics = await getLegacyMetrics(eventIds, commonEventId);
      const v2Events = await this.prisma.event.findMany({
        where: { status: { not: 'archived' } },
        select: {
          id: true,
          slug: true,
          translations: { where: { locale: 'en' }, select: { title: true }, take: 1 },
          _count: { select: { orders: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
      });

      return {
        source,
        connection: describeMysqlSource(source),
        event: {
          id: primary.id,
          title: primary.title,
          slug: primary.slug,
          common_event_id: commonEventId,
          event_ids_in_scope: eventIds,
        },
        metrics: {
          booking_rows: metrics.booking_rows,
          orders: metrics.orders,
          tickets: metrics.tickets,
          admits: metrics.admits,
          revenue: Number(metrics.revenue),
          addon_revenue: Number(metrics.addon_revenue),
          addon_revenue_first_row: Number(metrics.addon_revenue_first_row),
          separate_addon_revenue: Number(metrics.separate_addon_revenue),
          cafe_sales: Number(metrics.cafe_sales),
          cafe_transactions: Number(metrics.cafe_transactions),
          cafe_tickets: metrics.cafe_tickets,
          cafe_admits: metrics.cafe_admits,
          time_extension_revenue: Number(metrics.time_extension_revenue),
          time_extension_orders: metrics.time_extension_orders,
          e3_tickets: metrics.e3_tickets,
          e3_admits: metrics.e3_admits,
          e3_revenue: Number(metrics.e3_revenue),
          parity: {
            orders: metrics.parity.orders,
            tickets: metrics.parity.tickets,
            admits: metrics.parity.admits,
            revenue: Number(metrics.parity.revenue),
          },
          by_ticket: metrics.by_ticket,
        },
        v2_events: v2Events.map((e) => ({
          id: e.id,
          slug: e.slug,
          title: e.translations[0]?.title || e.slug,
          orderCount: e._count.orders,
        })),
      };
    });
  }

  migrate(body: {
    oldEvent?: string;
    source?: string;
    newEventSlug?: string;
    createEvent?: boolean;
    organizationSlug?: string;
    dryRun?: boolean;
    force?: boolean;
    skipRollups?: boolean;
    includeAddons?: boolean;
    includeSeparateAddons?: boolean;
    includeCafeClosings?: boolean;
    includeE3?: boolean;
    includeTimeExtensions?: boolean;
    createMissingTickets?: boolean;
    ticketMap?: Record<string, string>;
  }) {
    if (!body.oldEvent) {
      throw new BadRequestException('oldEvent is required');
    }
    if (!body.createEvent && !body.newEventSlug) {
      throw new BadRequestException('Pass createEvent=true or newEventSlug');
    }
    return this.withSource(body.source, async (source) => {
      const result = await migrateEvent(this.prisma, {
        oldEvent: body.oldEvent!,
        newEventSlug: body.newEventSlug,
        createEvent: !!body.createEvent,
        organizationSlug: body.organizationSlug,
        dryRun: !!body.dryRun,
        force: !!body.force,
        skipRollups: !!body.skipRollups,
        includeAddons: body.includeAddons !== false,
        includeSeparateAddons: body.includeSeparateAddons !== false,
        includeCafeClosings: body.includeCafeClosings !== false,
        includeE3: body.includeE3 !== false,
        includeTimeExtensions: body.includeTimeExtensions !== false,
        createMissingTickets: body.createMissingTickets !== false,
        ticketMap: body.ticketMap,
      });
      return { source, connection: describeMysqlSource(source), ...result };
    });
  }

  async verify(body: { oldEvent?: string; newEventSlug?: string; source?: string }) {
    if (!body.oldEvent || !body.newEventSlug) {
      throw new BadRequestException('oldEvent and newEventSlug are required');
    }
    try {
      return await this.withSource(body.source, async (source) => {
        const result = await verifyMigratedEvent(
          this.prisma,
          body.oldEvent!,
          body.newEventSlug!,
        );
        return { source, connection: describeMysqlSource(source), ...result };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith('New event not found:')) {
        throw new NotFoundException(
          `${message}. Migrate into an existing V2 event, or run a real (non dry-run) create migrate first.`,
        );
      }
      throw err;
    }
  }
}
