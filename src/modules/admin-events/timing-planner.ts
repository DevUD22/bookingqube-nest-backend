import { BadRequestException } from '@nestjs/common';
import type {
  ApplyAdminEventTimingDto,
  TimingSlotDto,
} from '../admin-events/dto/apply-admin-event-timing.dto';

export type PlannedSession = {
  startsAt: Date;
  endsAt: Date;
  displayTime: string;
  capacity: number | null;
};

export function qatarDateTime(date: string, time: string) {
  const normalized = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${normalized}+03:00`);
}

export function formatDisplayTimeQatar(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Qatar',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

/** ISO weekday: Mon=1 … Sun=7 */
export function isoWeekday(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const day = utc.getUTCDay();
  return day === 0 ? 7 : day;
}

export function eachDate(start: string, end: string) {
  const dates: string[] = [];
  const cursor = new Date(`${start}T12:00:00.000Z`);
  const last = new Date(`${end}T12:00:00.000Z`);
  while (cursor <= last) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function weekBucket(dateStr: string): 'FIRST_WEEK' | 'SECOND_WEEK' | 'THIRD_WEEK' | 'LAST_WEEK' {
  const day = Number(dateStr.slice(8, 10));
  const [y, m] = dateStr.split('-').map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (day > lastDay - 7) return 'LAST_WEEK';
  if (day <= 7) return 'FIRST_WEEK';
  if (day <= 14) return 'SECOND_WEEK';
  if (day <= 21) return 'THIRD_WEEK';
  return 'LAST_WEEK';
}

function assertSlot(slot: TimingSlotDto) {
  if (slot.end_time <= slot.start_time) {
    throw new BadRequestException(
      `Slot ${slot.start_time}–${slot.end_time} must end after it starts.`,
    );
  }
}

export function timingSlotsProvideCapacity(input: ApplyAdminEventTimingDto) {
  const lists: TimingSlotDto[][] = [];
  if (input.daily) {
    if (input.daily.slots?.length) lists.push(input.daily.slots);
    if (input.daily.weekday_slots?.length) lists.push(input.daily.weekday_slots);
    if (input.daily.weekend_slots?.length) lists.push(input.daily.weekend_slots);
    for (const group of input.daily.day_groups ?? []) {
      if (group.slots?.length) lists.push(group.slots);
    }
  }
  if (input.monthly?.slots?.length) lists.push(input.monthly.slots);
  if (input.custom?.slots?.length) lists.push(input.custom.slots);
  return lists.some((slots) =>
    slots.some((slot) => typeof slot.capacity === 'number' && slot.capacity >= 1),
  );
}

/**
 * Materialize bookable sessions from a timing pattern.
 * Preferred mode returns [] (window-only; caller may create a single open session).
 */
export function planSessionsFromTiming(
  input: ApplyAdminEventTimingDto,
  defaultCapacity: number | null,
): PlannedSession[] {
  const out: PlannedSession[] = [];

  const pushSlots = (date: string, slots: TimingSlotDto[]) => {
    for (const slot of slots) {
      assertSlot(slot);
      const startsAt = qatarDateTime(date, slot.start_time);
      const endsAt = qatarDateTime(date, slot.end_time);
      out.push({
        startsAt,
        endsAt,
        displayTime: formatDisplayTimeQatar(startsAt),
        capacity:
          typeof slot.capacity === 'number' ? slot.capacity : defaultCapacity,
      });
    }
  };

  if (input.mode === 'preferred') {
    return out;
  }

  if (input.mode === 'daily') {
    const daily = input.daily;
    if (!daily) throw new BadRequestException('Daily timing details are required.');

    if (daily.style === 'individual') {
      const groups = daily.day_groups ?? [];
      if (!groups.length) {
        throw new BadRequestException('Add at least one day group with bookable times.');
      }
      for (const group of groups) {
        if (!group.days?.length) {
          throw new BadRequestException('Each day group needs at least one weekday.');
        }
        if (!group.slots?.length) {
          throw new BadRequestException('Each day group needs at least one bookable time.');
        }
      }
      const byDow = new Map<number, TimingSlotDto[]>();
      for (const group of groups) {
        for (const dow of group.days) {
          const existing = byDow.get(dow) ?? [];
          byDow.set(dow, existing.concat(group.slots));
        }
      }
      for (const date of eachDate(input.start_date, input.end_date)) {
        const slots = byDow.get(isoWeekday(date));
        if (slots?.length) pushSlots(date, slots);
      }
      for (const extra of daily.custom_dates ?? []) {
        if (extra < input.start_date || extra > input.end_date) continue;
        const slots = byDow.get(isoWeekday(extra));
        if (slots?.length) pushSlots(extra, slots);
      }
      return out;
    }

    const weekdaySet = new Set(daily.weekdays ?? []);
    const weekendSet = new Set(daily.weekends ?? []);
    const dates = eachDate(input.start_date, input.end_date);
    for (const date of dates) {
      const dow = isoWeekday(date);
      const isWeekday = weekdaySet.has(dow);
      const isWeekend = weekendSet.has(dow);
      if (!isWeekday && !isWeekend) continue;
      if (daily.style === 'basic') {
        const slots = daily.slots ?? [];
        if (!slots.length) throw new BadRequestException('Add at least one daily slot.');
        const visible = daily.basic_visible_on ?? 'all';
        if (visible === 'weekdays' && !isWeekday) continue;
        if (visible === 'weekends' && !isWeekend) continue;
        pushSlots(date, slots);
      } else {
        if (isWeekday) pushSlots(date, daily.weekday_slots ?? []);
        if (isWeekend) pushSlots(date, daily.weekend_slots ?? []);
      }
    }
    for (const extra of daily.custom_dates ?? []) {
      if (extra < input.start_date || extra > input.end_date) continue;
      if (daily.style === 'basic') pushSlots(extra, daily.slots ?? []);
      else {
        const dow = isoWeekday(extra);
        if (weekdaySet.has(dow)) pushSlots(extra, daily.weekday_slots ?? []);
        else if (weekendSet.has(dow)) pushSlots(extra, daily.weekend_slots ?? []);
        else {
          pushSlots(
            extra,
            daily.weekday_slots?.length
              ? daily.weekday_slots
              : (daily.weekend_slots ?? []),
          );
        }
      }
    }
    return out;
  }

  if (input.mode === 'monthly') {
    const monthly = input.monthly;
    if (!monthly) throw new BadRequestException('Monthly timing details are required.');
    if (!monthly.days.length) throw new BadRequestException('Select at least one day of the week.');
    if (!monthly.slots.length) throw new BadRequestException('Add at least one monthly slot.');
    const daySet = new Set(monthly.days);
    for (const date of eachDate(input.start_date, input.end_date)) {
      if (!daySet.has(isoWeekday(date))) continue;
      if (
        monthly.visible_in_weeks !== 'EVERY_WEEK' &&
        weekBucket(date) !== monthly.visible_in_weeks
      ) {
        continue;
      }
      pushSlots(date, monthly.slots);
    }
    return out;
  }

  if (input.mode === 'custom') {
    const custom = input.custom;
    if (!custom) throw new BadRequestException('Custom dates are required.');
    if (!custom.dates.length) throw new BadRequestException('Pick at least one custom date.');
    if (!custom.slots.length) {
      throw new BadRequestException('Add at least one slot for custom dates.');
    }
    for (const date of custom.dates) {
      if (date < input.start_date || date > input.end_date) {
        throw new BadRequestException(`Custom date ${date} is outside the event window.`);
      }
      pushSlots(date, custom.slots);
    }
    return out;
  }

  return out;
}
