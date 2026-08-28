import { describe, expect, it } from 'vitest';
import {
  consecutiveRunLength,
  evaluateAssignment,
  projectHours,
  rankCandidates,
  scoreCandidate,
  type CandidateContext,
  type CandidateStaff,
  type ExistingAssignment,
  type TargetShift,
} from './constraints';
import type { AvailabilityInterval } from './availability';
import { Temporal } from '@/lib/time/zones';

const SKILL_BARTENDER = 'skill-bartender';
const SKILL_COOK = 'skill-cook';
const LOC_LA = 'loc-la';
const LOC_NY = 'loc-ny';

function utc(iso: string): Date {
  return new Date(iso);
}

function staff(overrides: Partial<CandidateStaff> = {}): CandidateStaff {
  return {
    id: 'u1',
    name: 'Sarah Chen',
    email: 'sarah@example.com',
    isActive: true,
    timezone: 'America/Los_Angeles',
    skillIds: [SKILL_BARTENDER],
    certifiedLocationIds: [LOC_LA],
    desiredWeeklyHours: 30,
    maxWeeklyHours: 40,
    baseHourlyRate: 20,
    overtimeMultiplier: 1.5,
    ...overrides,
  };
}

function alwaysAvailable(start: string, end: string): AvailabilityInterval[] {
  return [
    {
      start: utc(start),
      end: utc(end),
      source: 'RECURRING',
      timeZone: 'America/Los_Angeles',
      label: 'test window',
    },
  ];
}

function target(overrides: Partial<TargetShift> = {}): TargetShift {
  return {
    id: 'shift-1',
    locationId: LOC_LA,
    locationName: 'Santa Monica',
    locationTimeZone: 'America/Los_Angeles',
    startUtc: utc('2026-03-05T00:00:00Z'),
    endUtc: utc('2026-03-05T06:00:00Z'),
    requiredSkillId: SKILL_BARTENDER,
    requiredSkillName: 'Bartender',
    headcount: 1,
    assignedCount: 0,
    ...overrides,
  };
}

function context(overrides: Partial<CandidateContext> = {}): CandidateContext {
  return {
    staff: staff(),
    availability: alwaysAvailable(
      '2026-03-01T00:00:00Z',
      '2026-03-20T00:00:00Z',
    ),
    existingAssignments: [],
    ...overrides,
  };
}

function existing(
  start: string,
  end: string,
  overrides: Partial<ExistingAssignment> = {},
): ExistingAssignment {
  return {
    assignmentId: `a-${start}`,
    shiftId: `s-${start}`,
    locationId: LOC_LA,
    locationName: 'Santa Monica',
    locationTimeZone: 'America/Los_Angeles',
    startUtc: utc(start),
    endUtc: utc(end),
    ...overrides,
  };
}

function codes(result: ReturnType<typeof evaluateAssignment>): string[] {
  return result.violations.map((v) => v.code);
}

describe('a clean assignment', () => {
  it('passes with no violations at all', () => {
    const result = evaluateAssignment(target(), context());
    expect(result.ok).toBe(true);
    expect(result.clean).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('certification', () => {
  it('blocks a location the staff member is not certified for', () => {
    const result = evaluateAssignment(
      target({ locationId: LOC_NY, locationName: 'Charleston' }),
      context(),
    );
    expect(result.ok).toBe(false);
    expect(codes(result)).toContain('NOT_CERTIFIED_AT_LOCATION');
    expect(result.blocking[0].message).toContain('Charleston');
    expect(result.blocking[0].message).toContain('Sarah Chen');
  });
});

describe('skill', () => {
  it('blocks a shift requiring a skill the staff member lacks', () => {
    const result = evaluateAssignment(
      target({ requiredSkillId: SKILL_COOK, requiredSkillName: 'Line Cook' }),
      context(),
    );
    expect(codes(result)).toContain('MISSING_SKILL');
    expect(result.blocking[0].message).toContain('Line Cook');
  });
});

describe('headcount', () => {
  it('blocks when every position is already filled', () => {
    const result = evaluateAssignment(
      target({ headcount: 2, assignedCount: 2 }),
      context(),
    );
    expect(codes(result)).toContain('SHIFT_FULL');
  });

  it('allows the check to be skipped when previewing an unsaved shift', () => {
    const result = evaluateAssignment(
      target({ headcount: 1, assignedCount: 1 }),
      context(),
      { ignoreHeadcount: true },
    );
    expect(codes(result)).not.toContain('SHIFT_FULL');
  });
});

describe('availability', () => {
  it('blocks a shift that runs past the end of the stated window', () => {
    const result = evaluateAssignment(
      target(),
      context({
        availability: alwaysAvailable(
          '2026-03-04T20:00:00Z',
          '2026-03-05T04:00:00Z',
        ),
      }),
    );
    expect(codes(result)).toContain('OUTSIDE_AVAILABILITY');
    const violation = result.blocking.find(
      (v) => v.code === 'OUTSIDE_AVAILABILITY',
    )!;
    expect(violation.data?.gaps).toHaveLength(1);
  });

  it('blocks when no availability exists at all, and says so', () => {
    const result = evaluateAssignment(
      target(),
      context({ availability: [] }),
    );
    const violation = result.blocking.find(
      (v) => v.code === 'OUTSIDE_AVAILABILITY',
    )!;
    expect(violation.message).toContain('no availability set');
  });

  it('requires contiguous cover — two windows with a hole do not count', () => {
    const result = evaluateAssignment(
      target(),
      context({
        availability: [
          ...alwaysAvailable('2026-03-05T00:00:00Z', '2026-03-05T02:00:00Z'),
          ...alwaysAvailable('2026-03-05T04:00:00Z', '2026-03-05T06:00:00Z'),
        ],
      }),
    );
    expect(codes(result)).toContain('OUTSIDE_AVAILABILITY');
  });
});

describe('double booking', () => {
  it('blocks an overlap at the same location', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-05T02:00:00Z', '2026-03-05T08:00:00Z'),
        ],
      }),
    );
    expect(codes(result)).toContain('DOUBLE_BOOKING');
  });

  it('blocks an overlap at a different location and says which', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-05T02:00:00Z', '2026-03-05T08:00:00Z', {
            locationId: LOC_NY,
            locationName: 'Charleston Battery',
            locationTimeZone: 'America/New_York',
          }),
        ],
      }),
    );
    const violation = result.blocking.find((v) => v.code === 'DOUBLE_BOOKING')!;
    expect(violation.message).toContain('Charleston Battery');
    expect(violation.message).toContain('a different location');
  });

  it('treats back-to-back shifts as touching, not overlapping', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-04T18:00:00Z', '2026-03-05T00:00:00Z'),
        ],
      }),
    );
    expect(codes(result)).not.toContain('DOUBLE_BOOKING');
    expect(codes(result)).toContain('REST_PERIOD_10H');
  });
});

describe('10-hour rest period', () => {
  it('blocks a gap shorter than 10 hours before the shift', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-04T09:00:00Z', '2026-03-04T15:00:00Z'),
        ],
      }),
    );
    const violation = result.blocking.find(
      (v) => v.code === 'REST_PERIOD_10H',
    )!;
    expect(violation).toBeDefined();
    expect(violation.data?.gapHours).toBe(9);
    expect(violation.data?.shortfallHours).toBe(1);
  });

  it('blocks a gap shorter than 10 hours after the shift', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-05T14:00:00Z', '2026-03-05T20:00:00Z'),
        ],
      }),
    );
    const violation = result.blocking.find(
      (v) => v.code === 'REST_PERIOD_10H',
    )!;
    expect(violation.data?.gapHours).toBe(8);
  });

  it('allows exactly 10 hours', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-04T08:00:00Z', '2026-03-04T14:00:00Z'),
        ],
      }),
    );
    expect(codes(result)).not.toContain('REST_PERIOD_10H');
  });

  it('measures rest across locations in different zones', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-04T12:00:00Z', '2026-03-04T18:00:00Z', {
            locationId: LOC_NY,
            locationName: 'Charleston Battery',
            locationTimeZone: 'America/New_York',
          }),
        ],
      }),
    );
    expect(codes(result)).toContain('REST_PERIOD_10H');
  });
});

describe('daily hours', () => {
  it('warns past 8 hours in a day', () => {
    const result = evaluateAssignment(
      target({
        startUtc: utc('2026-03-04T17:00:00Z'),
        endUtc: utc('2026-03-05T03:00:00Z'),
      }),
      context(),
    );
    expect(codes(result)).toContain('DAILY_HOURS_8');
    expect(result.ok).toBe(true);
  });

  it('blocks past 12 hours in a day', () => {
    const result = evaluateAssignment(
      target({
        startUtc: utc('2026-03-04T16:00:00Z'),
        endUtc: utc('2026-03-05T05:00:00Z'),
      }),
      context(),
    );
    expect(codes(result)).toContain('DAILY_HOURS_12');
    expect(result.ok).toBe(false);
  });

  it('sums multiple shifts on the same local day', () => {
    const result = evaluateAssignment(
      target(),
      context({
        existingAssignments: [
          existing('2026-03-04T15:00:00Z', '2026-03-04T22:00:00Z'),
        ],
      }),
    );
    expect(codes(result)).toContain('DAILY_HOURS_12');
  });
});

const TARGET_PACIFIC_DATE = '2026-03-04';

function pacificDayShift(date: string, hours = 4): ExistingAssignment {
  const start = new Date(`${date}T18:00:00Z`);
  const end = new Date(start.getTime() + hours * 3_600_000);
  return existing(start.toISOString(), end.toISOString());
}

describe('consecutive days', () => {
  function runOfDays(count: number, hours = 4): ExistingAssignment[] {
    return Array.from({ length: count }, (_, i) =>
      pacificDayShift(
        Temporal.PlainDate.from(TARGET_PACIFIC_DATE)
          .subtract({ days: i + 1 })
          .toString(),
        hours,
      ),
    );
  }

  it('warns on the 6th consecutive day', () => {
    const result = evaluateAssignment(target(), context({
      existingAssignments: runOfDays(5),
    }));
    expect(codes(result)).toContain('SIXTH_CONSECUTIVE_DAY');
    expect(result.ok).toBe(true);
  });

  it('requires a documented override on the 7th', () => {
    const result = evaluateAssignment(target(), context({
      existingAssignments: runOfDays(6),
    }));
    expect(codes(result)).toContain('SEVENTH_CONSECUTIVE_DAY');
    expect(result.ok).toBe(true);
    expect(result.clean).toBe(false);
    expect(result.overridable).toHaveLength(1);
  });

  it('counts a 1-hour shift the same as an 11-hour one', () => {
    const result = evaluateAssignment(
      target(),
      context({ existingAssignments: runOfDays(5, 1) }),
    );
    expect(codes(result)).toContain('SIXTH_CONSECUTIVE_DAY');
  });

  it('bridges two runs when the new shift fills the gap between them', () => {
    const before = new Set(['2026-03-02', '2026-03-03']);
    const after = new Set(['2026-03-05', '2026-03-06']);
    const worked = new Set([...before, ...after]);
    const length = consecutiveRunLength(
      worked,
      Temporal.PlainDate.from('2026-03-04'),
    );
    expect(length).toBe(5);
  });

  it('treats an overnight shift as one working day, not two', () => {
    const overnight = target({
      startUtc: utc('2026-03-05T07:00:00Z'),
      endUtc: utc('2026-03-05T11:00:00Z'),
    });
    const projection = projectHours(overnight, context());
    expect(projection.consecutiveDays).toBe(1);
    expect(projection.shiftHours).toBe(4);
  });
});

const SAME_WEEK_DAYS = [
  '2026-03-02',
  '2026-03-03',
  '2026-03-05',
  '2026-03-06',
  '2026-03-07',
];

describe('weekly hours and overtime', () => {
  function week(hoursPerDay: number, days: number): ExistingAssignment[] {
    return SAME_WEEK_DAYS.slice(0, days).map((date) =>
      pacificDayShift(date, hoursPerDay),
    );
  }

  it('warns when the week reaches 35 hours', () => {
    const result = evaluateAssignment(target(), context({
      existingAssignments: week(8, 4),
    }));
    expect(codes(result)).toContain('WEEKLY_HOURS_35');
    expect(codes(result)).not.toContain('WEEKLY_HOURS_40');
  });

  it('reports overtime hours and cost past 40', () => {
    const result = evaluateAssignment(target(), context({
      existingAssignments: week(8, 5),
    }));
    expect(codes(result)).toContain('WEEKLY_HOURS_40');
    expect(result.projection.weeklyHoursAfter).toBe(46);
    expect(result.projection.overtimeHoursAfter).toBe(6);
    expect(result.projection.addedOvertimeCost).toBe(180);
  });

  it('splits marginal cost between straight time and overtime', () => {
    const result = evaluateAssignment(target(), context({
      existingAssignments: week(9, 4),
    }));
    expect(result.projection.weeklyHoursBefore).toBe(36);
    expect(result.projection.overtimeHoursAfter).toBe(2);
    expect(result.projection.addedCost).toBe(140);
    expect(result.projection.addedOvertimeCost).toBe(60);
  });

  it('warns when the assignment exceeds stated desired hours', () => {
    const result = evaluateAssignment(
      target(),
      context({
        staff: staff({ desiredWeeklyHours: 4 }),
      }),
    );
    expect(codes(result)).toContain('EXCEEDS_DESIRED_HOURS');
    expect(result.ok).toBe(true);
  });
});

describe('inactive staff', () => {
  it('blocks a deactivated account', () => {
    const result = evaluateAssignment(
      target(),
      context({ staff: staff({ isActive: false }) }),
    );
    expect(codes(result)).toContain('STAFF_INACTIVE');
  });
});

describe('excluded assignments', () => {
  it('ignores the assignment being replaced during a swap', () => {
    const conflicting = existing(
      '2026-03-05T02:00:00Z',
      '2026-03-05T08:00:00Z',
    );
    const withConflict = evaluateAssignment(
      target(),
      context({ existingAssignments: [conflicting] }),
    );
    expect(codes(withConflict)).toContain('DOUBLE_BOOKING');

    const excluded = evaluateAssignment(
      target(),
      context({
        existingAssignments: [conflicting],
        excludeAssignmentIds: [conflicting.assignmentId],
      }),
    );
    expect(codes(excluded)).not.toContain('DOUBLE_BOOKING');
  });
});

describe('candidate ranking', () => {
  it('prefers someone below their desired hours over someone in overtime', () => {
    const hungry = staff({ id: 'hungry', name: 'Wants Hours', desiredWeeklyHours: 40 });
    const loaded = staff({ id: 'loaded', name: 'Already Full', desiredWeeklyHours: 40 });

    const hungryResult = evaluateAssignment(target(), context({ staff: hungry }));
    const loadedResult = evaluateAssignment(
      target(),
      context({
        staff: loaded,
        existingAssignments: SAME_WEEK_DAYS.map((d) => pacificDayShift(d, 8)),
      }),
    );

    const ranked = rankCandidates([
      scoreCandidate(loaded, loadedResult),
      scoreCandidate(hungry, hungryResult),
    ]);
    expect(ranked[0].staff.id).toBe('hungry');
  });

  it('sorts anyone needing an override below anyone who does not', () => {
    const clean = staff({ id: 'clean', name: 'Clean' });
    const seventhDay = staff({ id: 'seventh', name: 'Seventh Day' });

    const cleanResult = evaluateAssignment(target(), context({ staff: clean }));
    const seventhResult = evaluateAssignment(
      target(),
      context({
        staff: seventhDay,
        existingAssignments: Array.from({ length: 6 }, (_, i) =>
          pacificDayShift(
            Temporal.PlainDate.from(TARGET_PACIFIC_DATE)
              .subtract({ days: i + 1 })
              .toString(),
          ),
        ),
      }),
    );

    const ranked = rankCandidates([
      scoreCandidate(seventhDay, seventhResult),
      scoreCandidate(clean, cleanResult),
    ]);
    expect(ranked[0].staff.id).toBe('clean');
  });
});

describe('violation quality', () => {
  it('gives every violation a rationale and most of them a remedy', () => {
    const result = evaluateAssignment(
      target({ locationId: LOC_NY, locationName: 'Charleston' }),
      context(),
    );
    for (const violation of result.violations) {
      expect(violation.rationale.length).toBeGreaterThan(20);
      expect(violation.message.length).toBeGreaterThan(20);
    }
    expect(result.blocking[0].remedy).toBeTruthy();
  });

  it('sorts blocking violations before warnings', () => {
    const result = evaluateAssignment(
      target({ requiredSkillId: SKILL_COOK, requiredSkillName: 'Line Cook' }),
      context({ staff: staff({ desiredWeeklyHours: 1 }) }),
    );
    expect(result.violations[0].severity).toBe('BLOCK');
    expect(result.violations.at(-1)!.severity).toBe('WARN');
  });
});
