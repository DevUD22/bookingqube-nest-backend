import type { PrismaClient } from '@prisma/client';
import type { RowDataPacket } from 'mysql2';
import type { ApplyAdminEventTimingDto } from '../../admin-events/dto/apply-admin-event-timing.dto';
import {
  planSessionsFromTiming,
  qatarDateTime,
} from '../../admin-events/timing-planner';
import { legacyDateOnlyQatar } from './mappers';
import { mysqlQuery } from './mysql-client';

export { legacyDateOnlyQatar } from './mappers';

const DAY_NAME_TO_ISO: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

export type LegacyEventTiming = {
  event_id: number;
  prefered_timeing: number;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  repeat_timimg_type: string | null;
  time_sloat_option: string | null;
  calendar_weekdays: unknown;
  calendar_weekends: unknown;
  monthly_weekdays: unknown;
  visible_in_weeks: string | null;
  custom_dates: unknown;
  individual_slots: unknown;
  slots: Array<{
    start_time: string;
    end_time: string;
    visible_on: string | null;
    timing_type: string | null;
    qty: number | null;
  }>;
};

function hhmm(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(value).trim());
  if (!m) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function parseJsonField(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function selectedIsoDays(calendar: unknown): number[] {
  const list = Array.isArray(calendar) ? calendar : [];
  const out: number[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { selected?: boolean; value?: number };
    if (!row.selected) continue;
    const v = Number(row.value);
    if (v >= 1 && v <= 7) out.push(v);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function dayNamesToIso(names: unknown): number[] {
  if (!Array.isArray(names)) return [];
  const out: number[] = [];
  for (const name of names) {
    const key = String(name).toLowerCase().trim();
    const iso = DAY_NAME_TO_ISO[key];
    if (iso) out.push(iso);
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function slotPayload(start: string | null, end: string | null, qty?: number | null) {
  if (!start || !end) return null;
  const capacity =
    qty != null && Number(qty) > 0 ? Math.round(Number(qty)) : undefined;
  return {
    start_time: start,
    end_time: end,
    ...(capacity ? { capacity } : {}),
  };
}

/**
 * Map old BookingQube event_timing (+ preferred flag) into V2 apply-timing DTO.
 * Returns null when there is nothing useful to materialize.
 */
export function mapLegacyTimingToApplyDto(
  legacy: LegacyEventTiming,
): ApplyAdminEventTimingDto | null {
  const start_date = legacy.start_date;
  const end_date = legacy.end_date;
  if (!start_date || !end_date) return null;

  const start_time = hhmm(legacy.start_time) ?? '00:00';
  const end_time = hhmm(legacy.end_time) ?? '23:59';

  if (legacy.prefered_timeing) {
    return {
      mode: 'preferred',
      start_date,
      end_date,
      start_time,
      end_time,
      track_inventory: false,
      replace_existing: true,
    };
  }

  const type = (legacy.repeat_timimg_type || '').trim();
  if (!type) {
    // No timing row — fall back to preferred window from event dates.
    return {
      mode: 'preferred',
      start_date,
      end_date,
      start_time,
      end_time,
      track_inventory: false,
      replace_existing: true,
    };
  }

  const customDatesRaw = parseJsonField(legacy.custom_dates);
  const custom_dates = Array.isArray(customDatesRaw)
    ? customDatesRaw
        .map((d) => legacyDateOnlyQatar(d) || String(d).slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    : [];

  if (type === 'Individual') {
    const groupsFromJson = parseIndividualGroups(legacy.individual_slots);
    const groupsFromSlots = groupSlotsByVisibleOn(legacy.slots);
    const day_groups = groupsFromJson.length ? groupsFromJson : groupsFromSlots;
    if (!day_groups.length) return null;
    const open = Array.from(new Set(day_groups.flatMap((g) => g.days))).sort(
      (a, b) => a - b,
    );
    return {
      mode: 'daily',
      start_date,
      end_date,
      start_time,
      end_time,
      track_inventory: false,
      replace_existing: true,
      daily: {
        style: 'individual',
        weekdays: open,
        weekends: [],
        day_groups,
        ...(custom_dates.length ? { custom_dates } : {}),
      },
    };
  }

  if (type === 'Daily') {
    const weekdays = selectedIsoDays(parseJsonField(legacy.calendar_weekdays));
    const weekends = selectedIsoDays(parseJsonField(legacy.calendar_weekends));
    const option = (legacy.time_sloat_option || 'BASIC').toUpperCase();
    const mappedSlots = legacy.slots
      .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
      .filter((s): s is NonNullable<typeof s> => !!s);

    if (option === 'ADVANCE') {
      const weekday_slots = legacy.slots
        .filter((s) => /weekday/i.test(String(s.visible_on || '')))
        .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
        .filter((s): s is NonNullable<typeof s> => !!s);
      const weekend_slots = legacy.slots
        .filter((s) => /weekend/i.test(String(s.visible_on || '')))
        .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
        .filter((s): s is NonNullable<typeof s> => !!s);
      // Fall back: Alldays slots apply to both buckets
      const allDay = legacy.slots
        .filter((s) => /allday/i.test(String(s.visible_on || '')))
        .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
        .filter((s): s is NonNullable<typeof s> => !!s);
      const wd = weekday_slots.length ? weekday_slots : allDay;
      const we = weekend_slots.length ? weekend_slots : allDay;
      if (!wd.length && !we.length) return null;
      return {
        mode: 'daily',
        start_date,
        end_date,
        start_time,
        end_time,
        track_inventory: false,
        replace_existing: true,
        daily: {
          style: 'advance',
          weekdays: weekdays.length ? weekdays : [7, 1, 2, 3, 4],
          weekends: weekends.length ? weekends : [5, 6],
          weekday_slots: wd,
          weekend_slots: we,
          ...(custom_dates.length ? { custom_dates } : {}),
        },
      };
    }

    if (!mappedSlots.length) {
      // Daily config without slots → preferred window so dates still migrate.
      return {
        mode: 'preferred',
        start_date,
        end_date,
        start_time,
        end_time,
        track_inventory: false,
        replace_existing: true,
      };
    }

    const open =
      weekdays.length || weekends.length
        ? Array.from(new Set([...weekdays, ...weekends])).sort((a, b) => a - b)
        : [7, 1, 2, 3, 4, 5, 6];

    return {
      mode: 'daily',
      start_date,
      end_date,
      start_time,
      end_time,
      track_inventory: false,
      replace_existing: true,
      daily: {
        style: 'basic',
        weekdays: open,
        weekends: [],
        basic_visible_on: 'all',
        slots: mappedSlots,
        ...(custom_dates.length ? { custom_dates } : {}),
      },
    };
  }

  if (type === 'Monthly') {
    const daysRaw = parseJsonField(legacy.monthly_weekdays);
    let days = selectedIsoDays(daysRaw);
    if (!days.length && Array.isArray(daysRaw)) {
      // Sometimes stored as [{title,value,selected}] already handled; else numeric list
      days = daysRaw
        .map((v) => Number(v))
        .filter((v) => v >= 1 && v <= 7);
    }
    const slots = legacy.slots
      .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!days.length || !slots.length) return null;
    const weeks = (legacy.visible_in_weeks || 'EVERY_WEEK') as
      | 'EVERY_WEEK'
      | 'FIRST_WEEK'
      | 'SECOND_WEEK'
      | 'THIRD_WEEK'
      | 'LAST_WEEK';
    return {
      mode: 'monthly',
      start_date,
      end_date,
      start_time,
      end_time,
      track_inventory: false,
      replace_existing: true,
      monthly: {
        visible_in_weeks: weeks,
        days,
        slots,
      },
    };
  }

  return null;
}

function parseIndividualGroups(
  individualSlots: unknown,
): Array<{ days: number[]; slots: Array<{ start_time: string; end_time: string; capacity?: number }> }> {
  const parsed = parseJsonField(individualSlots);
  if (!Array.isArray(parsed) || !parsed.length) return [];

  const groups: Array<{
    days: number[];
    slots: Array<{ start_time: string; end_time: string; capacity?: number }>;
  }> = [];
  const seen = new Set<string>();

  for (const block of parsed) {
    if (!block || typeof block !== 'object') continue;
    const row = block as {
      days?: Array<{ selected?: boolean; value?: number; label?: string }>;
      slots?: Array<{
        start_time?: string;
        end_time?: string;
        qty?: number;
        visible_on?: string[];
      }>;
    };
    let days = (row.days ?? [])
      .filter((d) => d?.selected)
      .map((d) => Number(d.value))
      .filter((v) => v >= 1 && v <= 7);
    if (!days.length && row.slots?.[0]?.visible_on) {
      days = dayNamesToIso(row.slots[0].visible_on);
    }
    const slots = (row.slots ?? [])
      .map((s) => slotPayload(hhmm(s.start_time), hhmm(s.end_time), s.qty))
      .filter((s): s is NonNullable<typeof s> => !!s);
    if (!days.length || !slots.length) continue;
    const key = `${days.join(',')}|${slots.map((s) => `${s.start_time}-${s.end_time}`).join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.push({ days: Array.from(new Set(days)).sort((a, b) => a - b), slots });
  }
  return groups;
}

function groupSlotsByVisibleOn(
  slots: LegacyEventTiming['slots'],
): Array<{ days: number[]; slots: Array<{ start_time: string; end_time: string; capacity?: number }> }> {
  const byDays = new Map<
    string,
    {
      days: number[];
      slots: Array<{ start_time: string; end_time: string; capacity?: number }>;
    }
  >();
  for (const slot of slots) {
    const visible = parseJsonField(slot.visible_on) ?? slot.visible_on;
    const days = dayNamesToIso(visible);
    const mapped = slotPayload(hhmm(slot.start_time), hhmm(slot.end_time), slot.qty);
    if (!days.length || !mapped) continue;
    const key = days.join(',');
    const existing = byDays.get(key);
    if (existing) {
      const dup = existing.slots.some(
        (s) => s.start_time === mapped.start_time && s.end_time === mapped.end_time,
      );
      if (!dup) existing.slots.push(mapped);
    } else {
      byDays.set(key, { days, slots: [mapped] });
    }
  }
  return [...byDays.values()];
}

export async function loadLegacyEventTiming(
  eventId: number,
): Promise<LegacyEventTiming | null> {
  const events = await mysqlQuery<RowDataPacket[]>(
    `SELECT id, start_date, end_date, start_time, end_time, prefered_timeing
     FROM events WHERE id = :id LIMIT 1`,
    { id: eventId },
  );
  const event = events[0];
  if (!event) return null;

  const start_date = legacyDateOnlyQatar(event.start_date);
  const end_date = legacyDateOnlyQatar(event.end_date);
  if (!start_date || !end_date) return null;

  const prefered = Number(event.prefered_timeing ?? 0) ? 1 : 0;

  const timings = await mysqlQuery<RowDataPacket[]>(
    `SELECT * FROM event_timing WHERE event_id = :id ORDER BY id DESC LIMIT 1`,
    { id: eventId },
  );
  const timing = timings[0];

  let slots: LegacyEventTiming['slots'] = [];
  if (timing) {
    const slotRows = await mysqlQuery<RowDataPacket[]>(
      `SELECT start_time, end_time, visible_on, timing_type, qty
       FROM event_timing_slots
       WHERE event_timing_id = :tid
       ORDER BY id ASC`,
      { tid: Number(timing.id) },
    );
    slots = slotRows.map((r) => ({
      start_time: String(r.start_time ?? ''),
      end_time: String(r.end_time ?? ''),
      visible_on: r.visible_on != null ? String(r.visible_on) : null,
      timing_type: r.timing_type != null ? String(r.timing_type) : null,
      qty: r.qty != null ? Number(r.qty) : null,
    }));
  }

  return {
    event_id: eventId,
    prefered_timeing: prefered,
    start_date,
    end_date,
    start_time: event.start_time != null ? String(event.start_time) : null,
    end_time: event.end_time != null ? String(event.end_time) : null,
    repeat_timimg_type: timing?.repeat_timimg_type
      ? String(timing.repeat_timimg_type)
      : null,
    time_sloat_option: timing?.time_sloat_option
      ? String(timing.time_sloat_option)
      : null,
    calendar_weekdays: timing ? parseJsonField(timing.calendar_weekdays) : null,
    calendar_weekends: timing ? parseJsonField(timing.calendar_weekends) : null,
    monthly_weekdays: timing ? parseJsonField(timing.monthly_weekdays) : null,
    visible_in_weeks: timing?.visible_in_weeks
      ? String(timing.visible_in_weeks)
      : null,
    custom_dates: timing ? parseJsonField(timing.custom_dates) : null,
    individual_slots: timing ? parseJsonField(timing.individual_slots) : null,
    slots,
  };
}

function qatarDateOnly(value: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Qatar',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

/**
 * Persist legacy-mapped timing onto a V2 event (timing_config + materialized sessions).
 * Replaces empty sessions; hides sessions that already have orders.
 */
export async function materializeTimingOnEvent(
  prisma: PrismaClient,
  eventId: string,
  input: ApplyAdminEventTimingDto,
): Promise<{ sessionsCreated: number; sessionsRemoved: number; mode: string }> {
  const planned = planSessionsFromTiming(input, null);
  if (planned.length > 5000) {
    throw new Error(
      `Legacy timing would create ${planned.length} sessions (max 5000). Narrow the legacy date range.`,
    );
  }

  const windowStart = qatarDateTime(input.start_date, input.start_time ?? '00:00');
  const windowEnd = qatarDateTime(input.end_date, input.end_time ?? '23:59');

  const timingConfig = {
    mode: input.mode,
    start_date: input.start_date,
    end_date: input.end_date,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    daily: input.daily ?? null,
    monthly: input.monthly ?? null,
    custom: input.custom ?? null,
    track_inventory: false,
    default_capacity: null,
    generated_at: new Date().toISOString(),
    generated_count: planned.length,
    migrated_from: 'legacy_mysql_event_timing',
  };

  let sessionsRemoved = 0;

  await prisma.$transaction(
    async (tx) => {
      const removableWhere = { eventId, orders: { none: {} } } as const;
      const removableCount = await tx.eventSession.count({ where: removableWhere });
      if (removableCount > 0) {
        await tx.ticketHold.deleteMany({ where: { eventSession: removableWhere } });
        await tx.inventoryItem.deleteMany({ where: { eventSession: removableWhere } });
        const deleted = await tx.eventSession.deleteMany({ where: removableWhere });
        sessionsRemoved = deleted.count;
      }
      await tx.eventSession.updateMany({
        where: {
          eventId,
          status: { not: 'hidden' },
          orders: { some: {} },
        },
        data: { status: 'hidden' },
      });
      await tx.eventDate.deleteMany({
        where: { eventId, sessions: { none: {} } },
      });

      // Preferred with no stepped slots: one open window session (same as admin applyTiming).
      const sessions =
        input.mode === 'preferred' &&
        planned.length === 0 &&
        input.start_time &&
        input.end_time
          ? [
              {
                startsAt: qatarDateTime(input.start_date, input.start_time),
                endsAt: qatarDateTime(input.end_date, input.end_time),
                displayTime: new Intl.DateTimeFormat('en-US', {
                  timeZone: 'Asia/Qatar',
                  hour: 'numeric',
                  minute: '2-digit',
                }).format(qatarDateTime(input.start_date, input.start_time)),
                capacity: null as number | null,
              },
            ]
          : planned;

      // Upsert dates in batches, then create sessions
      const dateKeys = Array.from(
        new Set(sessions.map((s) => qatarDateOnly(s.startsAt).toISOString().slice(0, 10))),
      );
      for (let i = 0; i < dateKeys.length; i += 100) {
        const chunk = dateKeys.slice(i, i + 100);
        await tx.eventDate.createMany({
          data: chunk.map((d) => ({
            eventId,
            date: new Date(`${d}T00:00:00.000Z`),
            status: 'active' as const,
          })),
          skipDuplicates: true,
        });
      }

      const eventDates = await tx.eventDate.findMany({
        where: { eventId },
        select: { id: true, date: true },
      });
      const dateIdByKey = new Map(
        eventDates.map((d) => [d.date.toISOString().slice(0, 10), d.id]),
      );

      for (let i = 0; i < sessions.length; i += 200) {
        const chunk = sessions.slice(i, i + 200);
        await tx.eventSession.createMany({
          data: chunk.map((item) => {
            const dateKey = qatarDateOnly(item.startsAt).toISOString().slice(0, 10);
            const eventDateId = dateIdByKey.get(dateKey);
            if (!eventDateId) {
              throw new Error(`Missing event_date for ${dateKey}`);
            }
            return {
              eventId,
              eventDateId,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
              displayTime: item.displayTime,
              capacity: item.capacity,
              status: 'active' as const,
            };
          }),
        });
      }

      await tx.event.update({
        where: { id: eventId },
        data: { startsAt: windowStart, endsAt: windowEnd },
      });
      await tx.$executeRawUnsafe(
        `UPDATE events SET timing_config = $1::jsonb WHERE id = $2::uuid`,
        JSON.stringify(timingConfig),
        eventId,
      );
    },
    { maxWait: 15_000, timeout: 180_000 },
  );

  const sessionsCreated = await prisma.eventSession.count({
    where: { eventId, status: 'active' },
  });

  return {
    sessionsCreated,
    sessionsRemoved,
    mode: input.mode,
  };
}

