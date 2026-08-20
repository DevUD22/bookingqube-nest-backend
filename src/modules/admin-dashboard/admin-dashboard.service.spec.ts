import { BadRequestException } from '@nestjs/common';

import { AdminDashboardService } from './admin-dashboard.service';

describe('AdminDashboardService', () => {
  const prisma = {
    event: { findMany: jest.fn(), count: jest.fn() },
    inventoryItem: { aggregate: jest.fn() },
    order: { groupBy: jest.fn(), findMany: jest.fn() },
  };

  const reports = {
    overview: jest.fn(),
    withReportDays: jest.fn(async (filters: unknown) => filters),
    cafeSalesBreakdown: jest.fn(async () => ({ cafe_net: 0, orders: 0, cafes: [] })),
  };

  const reportTz = {
    getTimeZone: jest.fn(async () => 'UTC'),
    presetRange: jest.fn(async (days: number) => {
      const to = new Date('2026-01-10T12:00:00.000Z');
      const from = new Date(to.getTime() - days * 86_400_000);
      return { from, to };
    }),
  };

  const service = new AdminDashboardService(
    prisma as never,
    reports as never,
    reportTz as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.event.findMany.mockResolvedValue([]);
    prisma.event.count.mockResolvedValue(0);
    prisma.inventoryItem.aggregate.mockResolvedValue({ _sum: { totalQuantity: 0, soldQuantity: 0 } });
    prisma.order.groupBy.mockResolvedValue([]);
    prisma.order.findMany.mockResolvedValue([]);
    reports.overview.mockResolvedValue({
      data: {
        metrics: { gross_sales: 100, tickets_sold: 5, total_orders: 2 },
        sales_trend: [],
        sales_by_event: [],
        recent_orders: [],
        meta: { rollup_incomplete: false },
      },
    });
  });

  it('overview ignores event_id without dashboard.filter.event permission', async () => {
    await service.overview(
      { event_id: 'event-1', from: '2026-01-01', to: '2026-01-10' } as never,
      undefined,
      undefined,
      ['dashboard.widget.gross_sales'],
    );

    expect(reports.overview).toHaveBeenCalledWith(
      expect.objectContaining({ eventId: undefined }),
    );
  });

  it('overview uses last-7-days when date filter permission is missing', async () => {
    await service.overview(
      { from: '2020-01-01', to: '2020-06-01' } as never,
      undefined,
      undefined,
      ['dashboard.widget.gross_sales'],
    );

    const call = reports.overview.mock.calls[0][0] as { from: Date; to: Date };
    expect(call.to.getTime() - call.from.getTime()).toBe(7 * 86_400_000);
  });

  it('parseRange rejects invalid and oversized ranges when date filter is allowed', () => {
    const parseRange = (
      service as unknown as {
        parseRange: (
          query: { from?: string; to?: string },
          canDateFilter: boolean,
        ) => { from: Date; to: Date };
      }
    ).parseRange.bind(service);

    expect(() => parseRange({ from: '2026-02-01', to: '2026-01-01' }, true)).toThrow(
      BadRequestException,
    );
    expect(() =>
      parseRange({ from: '2024-01-01', to: '2026-01-10' }, true),
    ).toThrow(/cannot exceed 366 days/);
  });

  it('overview skips reports.overview when widget permissions are missing', async () => {
    await service.overview({} as never, undefined, undefined, []);
    expect(reports.overview).not.toHaveBeenCalled();
  });

  it('metric returns null change_percent when previous is zero', () => {
    const metric = (
      service as unknown as {
        metric: (value: number, previous: number) => {
          value: number;
          previous: number;
          change_percent: number | null;
        };
      }
    ).metric.bind(service);

    expect(metric(10, 0)).toEqual({ value: 10, previous: 0, change_percent: null });
    expect(metric(15, 10).change_percent).toBe(50);
  });

  it('eventTitle prefers English translation then first then slug', () => {
    const eventTitle = (
      service as unknown as {
        eventTitle: (event: {
          slug: string;
          translations: Array<{ locale: string; title: string }>;
        }) => string;
      }
    ).eventTitle.bind(service);

    expect(
      eventTitle({
        slug: 'demo',
        translations: [
          { locale: 'ar', title: 'تجربة' },
          { locale: 'en', title: 'Demo' },
        ],
      }),
    ).toBe('Demo');
    expect(eventTitle({ slug: 'demo', translations: [{ locale: 'ar', title: 'تجربة' }] })).toBe(
      'تجربة',
    );
    expect(eventTitle({ slug: 'demo', translations: [] })).toBe('demo');
  });
});
