/**
 * Reporting calendar-day helpers.
 * When regional defaults are enabled, report days use that IANA timezone;
 * otherwise UTC.
 */

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function normalizeReportingTimeZone(timeZone?: string | null): string {
  const raw = (timeZone ?? '').trim();
  if (!raw || raw.toUpperCase() === 'UTC' || raw === 'Etc/UTC') return 'UTC';
  return isValidTimeZone(raw) ? raw : 'UTC';
}

/** YYYY-MM-DD for an instant in the given IANA timezone. */
export function calendarDayKey(instant: Date, timeZone = 'UTC'): string {
  const tz = normalizeReportingTimeZone(timeZone);
  if (tz === 'UTC') {
    return instant.toISOString().slice(0, 10);
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  const d = parts.find((p) => p.type === 'day')?.value;
  if (!y || !m || !d) return instant.toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

/** UTC-midnight Date representing the calendar day of `instant` in `timeZone`. */
export function calendarDay(instant: Date, timeZone = 'UTC'): Date {
  const key = calendarDayKey(instant, timeZone);
  return new Date(`${key}T00:00:00.000Z`);
}

/** Offset (ms) such that `utcMs + offset ≈ wall time in timeZone` as UTC components. */
function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(
    dtf
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Instant for local wall time `YYYY-MM-DD` + `HH:mm:ss` in `timeZone`. */
export function zonedLocalToUtc(
  dayKey: string,
  timeHms: string,
  timeZone = 'UTC',
): Date {
  const tz = normalizeReportingTimeZone(timeZone);
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hour, minute, second] = timeHms.split(':').map(Number);
  if (tz === 'UTC') {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0));
  }
  const utcGuess = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second || 0),
  );
  const offset = getTimeZoneOffsetMs(utcGuess, tz);
  const adjusted = new Date(utcGuess.getTime() - offset);
  // Re-adjust once in case of DST boundary skew.
  const offset2 = getTimeZoneOffsetMs(adjusted, tz);
  return new Date(utcGuess.getTime() - offset2);
}

export function addUtcCalendarDays(day: Date, days: number): Date {
  const next = new Date(day);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Inclusive start / exclusive end UTC instants for a calendar day in `timeZone`. */
export function zonedDayUtcBounds(
  dayKeyOrDate: string | Date,
  timeZone = 'UTC',
): { start: Date; endExclusive: Date } {
  const dayKey =
    typeof dayKeyOrDate === 'string'
      ? dayKeyOrDate.slice(0, 10)
      : dayKeyOrDate.toISOString().slice(0, 10);
  const start = zonedLocalToUtc(dayKey, '00:00:00', timeZone);
  const nextKey = addUtcCalendarDays(
    new Date(`${dayKey}T00:00:00.000Z`),
    1,
  )
    .toISOString()
    .slice(0, 10);
  const endExclusive = zonedLocalToUtc(nextKey, '00:00:00', timeZone);
  return { start, endExclusive };
}

/**
 * Build a from/to instant range for presets (today, Nd, all) in reporting TZ.
 * `from` is start-of-day in TZ; `to` is now (or end of custom day).
 */
export function zonedPresetRange(
  range: 'today' | '7d' | '30d' | '90d' | 'all' | number,
  timeZone = 'UTC',
  now = new Date(),
): { from: Date; to: Date } {
  const to = now;
  if (range === 'all') {
    return { from: new Date('2000-01-01T00:00:00.000Z'), to };
  }
  const todayKey = calendarDayKey(now, timeZone);
  const todayStart = zonedLocalToUtc(todayKey, '00:00:00', timeZone);
  if (range === 'today') {
    return { from: todayStart, to };
  }
  const days = typeof range === 'number' ? range : Number(String(range).replace(/\D/g, '')) || 7;
  const fromDay = addUtcCalendarDays(
    new Date(`${todayKey}T00:00:00.000Z`),
    -(days - 1),
  );
  const fromKey = fromDay.toISOString().slice(0, 10);
  return { from: zonedLocalToUtc(fromKey, '00:00:00', timeZone), to };
}

/** Custom inclusive calendar dates (YYYY-MM-DD) in reporting TZ. */
export function zonedCustomRange(
  fromDay: string,
  toDay: string,
  timeZone = 'UTC',
): { from: Date; to: Date } {
  const from = zonedLocalToUtc(fromDay.slice(0, 10), '00:00:00', timeZone);
  const toBounds = zonedDayUtcBounds(toDay.slice(0, 10), timeZone);
  return { from, to: new Date(toBounds.endExclusive.getTime() - 1) };
}
