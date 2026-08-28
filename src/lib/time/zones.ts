import { Temporal } from 'temporal-polyfill';

export { Temporal };

export const MONDAY = 1;
export const FRIDAY = 5;
export const SATURDAY = 6;
export const SUNDAY = 7;

export const WEEKDAY_NAMES = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const PREMIUM_START_HOUR = 17;

export function toInstant(date: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime());
}

export function toDate(instant: Temporal.Instant): Date {
  return new Date(instant.epochMilliseconds);
}

export function inZone(date: Date, timeZone: string): Temporal.ZonedDateTime {
  return toInstant(date).toZonedDateTimeISO(timeZone);
}

export function localDate(date: Date, timeZone: string): Temporal.PlainDate {
  return inZone(date, timeZone).toPlainDate();
}

export function wallClockToInstant(
  date: Temporal.PlainDate | string,
  time: string,
  timeZone: string,
): Temporal.Instant {
  const plainDate =
    typeof date === 'string' ? Temporal.PlainDate.from(date) : date;
  const plainTime = parseTimeOfDay(time);
  return plainDate
    .toPlainDateTime(plainTime)
    .toZonedDateTime(timeZone, { disambiguation: 'compatible' })
    .toInstant();
}

export function parseTimeOfDay(time: string): Temporal.PlainTime {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(time.trim());
  if (!match) {
    throw new Error(`Invalid time-of-day "${time}", expected HH:MM`);
  }
  const [, h, m, s] = match;
  const hour = Number(h);
  const minute = Number(m);
  const second = s ? Number(s) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error(`Time-of-day "${time}" is out of range`);
  }
  return new Temporal.PlainTime(hour, minute, second);
}

export function minutesOfDay(time: string): number {
  const t = parseTimeOfDay(time);
  return t.hour * 60 + t.minute;
}

export function weekKey(date: Date, timeZone: string): string {
  return weekKeyFromPlainDate(localDate(date, timeZone));
}

export function weekKeyFromPlainDate(date: Temporal.PlainDate): string {
  const { year, week } = isoWeekOfYear(date);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

export function isoWeekOfYear(date: Temporal.PlainDate): {
  year: number;
  week: number;
} {
  const thursday = date.add({ days: 4 - date.dayOfWeek });
  const jan1 = new Temporal.PlainDate(thursday.year, 1, 1);
  const dayOfYear = thursday.since(jan1).days + 1;
  return { year: thursday.year, week: Math.floor((dayOfYear - 1) / 7) + 1 };
}

export function startOfWeek(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.subtract({ days: date.dayOfWeek - MONDAY });
}

export function weekKeyToMonday(key: string): Temporal.PlainDate {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(key);
  if (!match) throw new Error(`Invalid week key "${key}"`);
  const year = Number(match[1]);
  const week = Number(match[2]);
  const jan4 = new Temporal.PlainDate(year, 1, 4);
  return startOfWeek(jan4).add({ weeks: week - 1 });
}

export function weekBoundsUtc(
  key: string,
  timeZone: string,
): { start: Date; end: Date } {
  const monday = weekKeyToMonday(key);
  const start = monday
    .toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(0, 0) })
    .toInstant();
  const end = monday
    .add({ days: 7 })
    .toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(0, 0) })
    .toInstant();
  return { start: toDate(start), end: toDate(end) };
}

export function dayBoundsUtc(
  date: Temporal.PlainDate,
  timeZone: string,
): { start: Date; end: Date } {
  const start = date
    .toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(0, 0) })
    .toInstant();
  const end = date
    .add({ days: 1 })
    .toZonedDateTime({ timeZone, plainTime: new Temporal.PlainTime(0, 0) })
    .toInstant();
  return { start: toDate(start), end: toDate(end) };
}

export function hoursBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 3_600_000;
}

export function minutesBetween(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / 60_000;
}

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

export function overlapMinutes(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return end <= start ? 0 : (end - start) / 60_000;
}

export function isPremiumShift(startUtc: Date, timeZone: string): boolean {
  const local = inZone(startUtc, timeZone);
  return (
    (local.dayOfWeek === FRIDAY || local.dayOfWeek === SATURDAY) &&
    local.hour >= PREMIUM_START_HOUR
  );
}

export function isOvernight(
  startUtc: Date,
  endUtc: Date,
  timeZone: string,
): boolean {
  return (
    Temporal.PlainDate.compare(
      localDate(endUtc, timeZone),
      localDate(startUtc, timeZone),
    ) > 0
  );
}

const zoneAbbrevCache = new Map<string, string>();

export function zoneAbbreviation(date: Date, timeZone: string): string {
  const key = `${timeZone}|${Math.floor(date.getTime() / 86_400_000)}`;
  const cached = zoneAbbrevCache.get(key);
  if (cached) return cached;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'short',
  }).formatToParts(date);
  const abbrev =
    parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  zoneAbbrevCache.set(key, abbrev);
  return abbrev;
}

export function formatTime(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function formatDate(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function formatDateTime(date: Date, timeZone: string): string {
  return `${formatDate(date, timeZone)}, ${formatTime(date, timeZone)}`;
}

export function formatShiftRange(
  startUtc: Date,
  endUtc: Date,
  timeZone: string,
): string {
  const overnight = isOvernight(startUtc, endUtc, timeZone);
  const base = `${formatDate(startUtc, timeZone)}, ${formatTime(
    startUtc,
    timeZone,
  )} – ${formatTime(endUtc, timeZone)} ${zoneAbbreviation(endUtc, timeZone)}`;
  return overnight ? `${base} (+1 day)` : base;
}

export function formatWallClock(time: string): string {
  const t = parseTimeOfDay(time);
  const hour12 = t.hour % 12 === 0 ? 12 : t.hour % 12;
  const suffix = t.hour < 12 ? 'AM' : 'PM';
  return `${hour12}:${String(t.minute).padStart(2, '0')} ${suffix}`;
}

export function offsetLabel(date: Date, timeZone: string): string {
  return inZone(date, timeZone).offset;
}

export const SUPPORTED_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
] as const;

export function isValidTimeZone(tz: string): boolean {
  try {
    return Boolean(new Intl.DateTimeFormat('en-US', { timeZone: tz }));
  } catch {
    return false;
  }
}
