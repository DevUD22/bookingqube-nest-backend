import { Injectable } from '@nestjs/common';
import { AppSettingGroup } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import {
  calendarDay,
  calendarDayKey,
  normalizeReportingTimeZone,
  zonedCustomRange,
  zonedDayUtcBounds,
  zonedPresetRange,
} from './report-timezone.util';

@Injectable()
export class ReportTimezoneService {
  private cache: { timeZone: string; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  invalidate() {
    this.cache = null;
  }

  /**
   * Regional defaults enabled + timezone_default → that IANA zone.
   * Otherwise UTC.
   */
  async getTimeZone(): Promise<string> {
    if (this.cache && this.cache.expiresAt > Date.now()) {
      return this.cache.timeZone;
    }
    let timeZone = 'UTC';
    try {
      const row = await this.prisma.appSetting.findUnique({
        where: { group: AppSettingGroup.regional },
        select: { enabled: true, configJson: true },
      });
      if (row?.enabled && row.configJson && typeof row.configJson === 'object') {
        const raw = (row.configJson as Record<string, unknown>)
          .timezone_default;
        if (typeof raw === 'string') {
          timeZone = normalizeReportingTimeZone(raw);
        }
      }
    } catch {
      // Missing/empty regional settings (or transient DB errors) → UTC.
      timeZone = 'UTC';
    }
    this.cache = { timeZone, expiresAt: Date.now() + 30_000 };
    return timeZone;
  }

  async day(instant: Date): Promise<Date> {
    return calendarDay(instant, await this.getTimeZone());
  }

  async dayKey(instant: Date): Promise<string> {
    return calendarDayKey(instant, await this.getTimeZone());
  }

  async dayBounds(from: Date, to: Date): Promise<{ gte: Date; lte: Date }> {
    const tz = await this.getTimeZone();
    return { gte: calendarDay(from, tz), lte: calendarDay(to, tz) };
  }

  async zonedDayUtcBounds(dayKeyOrDate: string | Date) {
    return zonedDayUtcBounds(dayKeyOrDate, await this.getTimeZone());
  }

  async presetRange(
    range: 'today' | '7d' | '30d' | '90d' | 'all' | number,
    now = new Date(),
  ) {
    return zonedPresetRange(range, await this.getTimeZone(), now);
  }

  async customRange(fromDay: string, toDay: string) {
    return zonedCustomRange(fromDay, toDay, await this.getTimeZone());
  }
}
