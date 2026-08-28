import { describe, expect, it } from 'vitest';
import {
  Temporal,
  formatShiftRange,
  hoursBetween,
  isoWeekOfYear,
  isOvernight,
  isPremiumShift,
  overlapMinutes,
  weekBoundsUtc,
  weekKey,
  weekKeyToMonday,
  wallClockToInstant,
  toDate,
} from './zones';

const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

describe('ISO week numbering', () => {
  it('puts 1 January 2027 in the last week of 2026', () => {
    const { year, week } = isoWeekOfYear(Temporal.PlainDate.from('2027-01-01'));
    expect(year).toBe(2026);
    expect(week).toBe(53);
  });

  it('puts 31 December 2024 in the first week of 2025', () => {
    const { year, week } = isoWeekOfYear(Temporal.PlainDate.from('2024-12-31'));
    expect(year).toBe(2025);
    expect(week).toBe(1);
  });

  it('round-trips a week key back to its Monday', () => {
    expect(weekKeyToMonday('2026-W10').toString()).toBe('2026-03-02');
    expect(weekKeyToMonday('2026-W01').toString()).toBe('2025-12-29');
  });

  it('assigns the same instant to different weeks in different zones', () => {
    const instant = new Date('2026-03-02T05:30:00Z');
    expect(weekKey(instant, NY)).toBe('2026-W10');
    expect(weekKey(instant, LA)).toBe('2026-W09');
  });
});

describe('week bounds', () => {
  it('spans exactly seven days in a zone with no transition', () => {
    const { start, end } = weekBoundsUtc('2026-W12', NY);
    expect(hoursBetween(start, end)).toBe(168);
  });

  it('is 167 hours long across the spring-forward week', () => {
    const { start, end } = weekBoundsUtc('2026-W10', LA);
    expect(hoursBetween(start, end)).toBe(167);
  });

  it('is 169 hours long across the fall-back week', () => {
    const { start, end } = weekBoundsUtc('2026-W44', LA);
    expect(hoursBetween(start, end)).toBe(169);
  });
});

describe('wall clock to instant', () => {
  it('resolves an ordinary time', () => {
    const instant = wallClockToInstant('2026-03-04', '09:00', LA);
    expect(toDate(instant).toISOString()).toBe('2026-03-04T17:00:00.000Z');
  });

  it('shifts a time that does not exist on the spring-forward morning', () => {
    const instant = wallClockToInstant('2026-03-08', '02:30', LA);
    expect(toDate(instant).toISOString()).toBe('2026-03-08T10:30:00.000Z');
  });

  it('picks the first occurrence of a repeated fall-back time', () => {
    const instant = wallClockToInstant('2026-11-01', '01:30', LA);
    expect(toDate(instant).toISOString()).toBe('2026-11-01T08:30:00.000Z');
  });

  it('rejects malformed input rather than guessing', () => {
    expect(() => wallClockToInstant('2026-03-04', '25:00', LA)).toThrow();
    expect(() => wallClockToInstant('2026-03-04', 'nine', LA)).toThrow();
  });
});

describe('premium shift tagging', () => {
  it('tags a Friday evening shift', () => {
    expect(isPremiumShift(new Date('2026-03-07T02:00:00Z'), LA)).toBe(true);
  });

  it('tags a Saturday evening shift', () => {
    expect(isPremiumShift(new Date('2026-03-08T02:00:00Z'), LA)).toBe(true);
  });

  it('does not tag a Friday lunch shift', () => {
    expect(isPremiumShift(new Date('2026-03-06T19:00:00Z'), LA)).toBe(false);
  });

  it('does not tag a Thursday evening shift', () => {
    expect(isPremiumShift(new Date('2026-03-06T02:00:00Z'), LA)).toBe(false);
  });

  it('is evaluated in the location zone, not UTC', () => {
    const instant = new Date('2026-03-07T01:00:00Z');
    expect(isPremiumShift(instant, LA)).toBe(true);
    expect(isPremiumShift(instant, NY)).toBe(true);
  });

  it('keeps a Friday 11pm shift a Friday premium shift', () => {
    const start = new Date('2026-03-07T07:00:00Z');
    expect(isPremiumShift(start, LA)).toBe(true);
  });
});

describe('overnight handling', () => {
  const start = new Date('2026-03-07T07:00:00Z');
  const end = new Date('2026-03-07T11:00:00Z');

  it('detects that a shift crosses a local calendar day', () => {
    expect(isOvernight(start, end, LA)).toBe(true);
  });

  it('does not flag a same-day shift', () => {
    expect(
      isOvernight(
        new Date('2026-03-06T19:00:00Z'),
        new Date('2026-03-07T01:00:00Z'),
        LA,
      ),
    ).toBe(false);
  });

  it('labels the range with an explicit +1 day and zone', () => {
    const label = formatShiftRange(start, end, LA);
    expect(label).toContain('11:00 PM');
    expect(label).toContain('3:00 AM');
    expect(label).toContain('+1 day');
    expect(label).toContain('PST');
  });

  it('treats it as a single four-hour shift', () => {
    expect(hoursBetween(start, end)).toBe(4);
  });
});

describe('interval arithmetic', () => {
  it('reports overlap in minutes', () => {
    expect(
      overlapMinutes(
        new Date('2026-03-04T10:00:00Z'),
        new Date('2026-03-04T14:00:00Z'),
        new Date('2026-03-04T13:00:00Z'),
        new Date('2026-03-04T18:00:00Z'),
      ),
    ).toBe(60);
  });

  it('reports zero for back-to-back intervals', () => {
    expect(
      overlapMinutes(
        new Date('2026-03-04T10:00:00Z'),
        new Date('2026-03-04T14:00:00Z'),
        new Date('2026-03-04T14:00:00Z'),
        new Date('2026-03-04T18:00:00Z'),
      ),
    ).toBe(0);
  });
});
