import {
  Temporal,
  intervalsOverlap,
  localDate,
  wallClockToInstant,
  toDate,
  formatWallClock,
} from '@/lib/time/zones';

export type AvailabilitySource = 'RECURRING' | 'EXCEPTION';

export interface AvailabilityRuleInput {
  id?: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  spansMidnight: boolean;
  timezone: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface AvailabilityExceptionInput {
  id?: string;
  type: 'UNAVAILABLE' | 'AVAILABLE';
  date: Date | string;
  startTime: string | null;
  endTime: string | null;
  spansMidnight: boolean;
  timezone: string | null;
  reason: string | null;
}

export interface AvailabilityInterval {
  start: Date;
  end: Date;
  source: AvailabilitySource;
  timeZone: string;
  ruleId?: string;
  label: string;
}

export interface ResolveOptions {
  from: Date;
  to: Date;
  evaluationZone: string;
}

function toPlainDate(value: Date | string): Temporal.PlainDate {
  if (typeof value === 'string') return Temporal.PlainDate.from(value);
  return Temporal.PlainDate.from({
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  });
}

function windowToInterval(
  date: Temporal.PlainDate,
  startTime: string,
  endTime: string,
  spansMidnight: boolean,
  timeZone: string,
): { start: Date; end: Date } {
  const start = wallClockToInstant(date, startTime, timeZone);
  const crossesMidnight = spansMidnight || endTime <= startTime;
  const endDate = crossesMidnight ? date.add({ days: 1 }) : date;
  const end = wallClockToInstant(endDate, endTime, timeZone);
  return { start: toDate(start), end: toDate(end) };
}

const SEAM_TOLERANCE_MS = 60_000;

function mergeIntervals(
  intervals: AvailabilityInterval[],
): AvailabilityInterval[] {
  if (intervals.length <= 1) return intervals;
  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: AvailabilityInterval[] = [{ ...sorted[0] }];
  for (const next of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (next.start.getTime() - last.end.getTime() <= SEAM_TOLERANCE_MS) {
      if (next.end.getTime() > last.end.getTime()) last.end = next.end;
    } else {
      merged.push({ ...next });
    }
  }
  return merged;
}

function subtractIntervals(
  windows: AvailabilityInterval[],
  blocks: { start: Date; end: Date }[],
): AvailabilityInterval[] {
  let result = windows;
  for (const block of blocks) {
    const next: AvailabilityInterval[] = [];
    for (const window of result) {
      if (!intervalsOverlap(window.start, window.end, block.start, block.end)) {
        next.push(window);
        continue;
      }
      if (window.start.getTime() < block.start.getTime()) {
        next.push({ ...window, end: block.start });
      }
      if (window.end.getTime() > block.end.getTime()) {
        next.push({ ...window, start: block.end });
      }
    }
    result = next;
  }
  return result;
}

export function resolveAvailability(
  rules: AvailabilityRuleInput[],
  exceptions: AvailabilityExceptionInput[],
  { from, to, evaluationZone }: ResolveOptions,
): AvailabilityInterval[] {
  const scanStart = localDate(from, evaluationZone).subtract({ days: 1 });
  const scanEnd = localDate(to, evaluationZone).add({ days: 1 });

  const positives: AvailabilityInterval[] = [];
  const blocks: { start: Date; end: Date }[] = [];

  for (
    let date = scanStart;
    Temporal.PlainDate.compare(date, scanEnd) <= 0;
    date = date.add({ days: 1 })
  ) {
    for (const rule of rules) {
      if (rule.dayOfWeek !== date.dayOfWeek) continue;
      const zone = rule.timezone ?? evaluationZone;
      const { start, end } = windowToInterval(
        date,
        rule.startTime,
        rule.endTime,
        rule.spansMidnight,
        zone,
      );
      if (start < rule.effectiveFrom) continue;
      if (rule.effectiveTo && start > rule.effectiveTo) continue;
      positives.push({
        start,
        end,
        source: 'RECURRING',
        timeZone: zone,
        ruleId: rule.id,
        label: `${formatWallClock(rule.startTime)}–${formatWallClock(
          rule.endTime,
        )}${rule.timezone ? ` ${rule.timezone}` : ' (local to location)'}`,
      });
    }
  }

  for (const exception of exceptions) {
    const date = toPlainDate(exception.date);
    if (
      Temporal.PlainDate.compare(date, scanStart) < 0 ||
      Temporal.PlainDate.compare(date, scanEnd) > 0
    ) {
      continue;
    }
    const zone = exception.timezone ?? evaluationZone;

    if (!exception.startTime || !exception.endTime) {
      if (exception.type === 'UNAVAILABLE') {
        const start = wallClockToInstant(date, '00:00', zone);
        const end = wallClockToInstant(date.add({ days: 1 }), '00:00', zone);
        blocks.push({ start: toDate(start), end: toDate(end) });
      }
      continue;
    }

    const interval = windowToInterval(
      date,
      exception.startTime,
      exception.endTime,
      exception.spansMidnight,
      zone,
    );
    if (exception.type === 'UNAVAILABLE') {
      blocks.push(interval);
    } else {
      positives.push({
        ...interval,
        source: 'EXCEPTION',
        timeZone: zone,
        ruleId: exception.id,
        label: exception.reason
          ? `${formatWallClock(exception.startTime)}–${formatWallClock(
              exception.endTime,
            )} (${exception.reason})`
          : `${formatWallClock(exception.startTime)}–${formatWallClock(
              exception.endTime,
            )}`,
      });
    }
  }

  const merged = mergeIntervals(positives);
  const withBlocks = subtractIntervals(merged, blocks);

  return withBlocks
    .filter((w) => intervalsOverlap(w.start, w.end, from, to))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface CoverageResult {
  covered: boolean;
  gaps: { start: Date; end: Date }[];
  matched: AvailabilityInterval[];
}

export function coversInterval(
  windows: AvailabilityInterval[],
  start: Date,
  end: Date,
): CoverageResult {
  const relevant = windows
    .filter((w) => intervalsOverlap(w.start, w.end, start, end))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const gaps: { start: Date; end: Date }[] = [];
  let cursor = start.getTime();

  for (const window of relevant) {
    if (window.start.getTime() > cursor) {
      gaps.push({ start: new Date(cursor), end: new Date(window.start) });
    }
    cursor = Math.max(cursor, window.end.getTime());
    if (cursor >= end.getTime()) break;
  }
  if (cursor < end.getTime()) {
    gaps.push({ start: new Date(cursor), end: new Date(end) });
  }

  return { covered: gaps.length === 0, gaps, matched: relevant };
}
