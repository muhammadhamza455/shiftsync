import { describe, expect, it } from 'vitest';
import {
  coversInterval,
  resolveAvailability,
  type AvailabilityExceptionInput,
  type AvailabilityRuleInput,
} from './availability';

const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

const EPOCH = new Date('2020-01-01T00:00:00Z');

function rule(
  overrides: Partial<AvailabilityRuleInput> = {},
): AvailabilityRuleInput {
  return {
    id: 'r1',
    dayOfWeek: 3,
    startTime: '09:00',
    endTime: '17:00',
    spansMidnight: false,
    timezone: null,
    effectiveFrom: EPOCH,
    effectiveTo: null,
    ...overrides,
  };
}

function nineToFive(timezone: string | null): AvailabilityRuleInput[] {
  return [1, 2, 3, 4, 5].map((dayOfWeek) =>
    rule({ id: `r${dayOfWeek}`, dayOfWeek, timezone }),
  );
}

function range(from: string, to: string) {
  return { from: new Date(from), to: new Date(to) };
}

function windowStartingOn(
  windows: { start: Date; end: Date }[],
  isoDate: string,
) {
  const found = windows.find((w) => w.start.toISOString().startsWith(isoDate));
  expect(found, `expected a window starting on ${isoDate}`).toBeDefined();
  return found!;
}

describe('the timezone tangle', () => {

  it('floating availability means 9am local to whichever location is worked', () => {
    const rules = nineToFive(null);

    const inPacific = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    const pacificWednesday = windowStartingOn(inPacific, '2026-03-04');
    expect(pacificWednesday.start.toISOString()).toBe('2026-03-04T17:00:00.000Z');
    expect(pacificWednesday.end.toISOString()).toBe('2026-03-05T01:00:00.000Z');

    const inEastern = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: NY,
    });
    const easternWednesday = windowStartingOn(inEastern, '2026-03-04T14');
    expect(easternWednesday.start.toISOString()).toBe('2026-03-04T14:00:00.000Z');
    expect(easternWednesday.end.toISOString()).toBe('2026-03-04T22:00:00.000Z');
  });

  it('anchored availability keeps the same absolute hours in every zone', () => {
    const rules = nineToFive(LA);

    const evaluatedInEastern = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: NY,
    });
    const wednesday = windowStartingOn(evaluatedInEastern, '2026-03-04');
    expect(wednesday.start.toISOString()).toBe('2026-03-04T17:00:00.000Z');
    expect(wednesday.end.toISOString()).toBe('2026-03-05T01:00:00.000Z');
  });

  it('an anchored 9-5 Pacific rule cannot cover a 9am Eastern shift', () => {
    const windows = resolveAvailability(nineToFive(LA), [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: NY,
    });
    const shiftStart = new Date('2026-03-04T14:00:00Z');
    const shiftEnd = new Date('2026-03-04T22:00:00Z');
    const coverage = coversInterval(windows, shiftStart, shiftEnd);
    expect(coverage.covered).toBe(false);
    expect(coverage.gaps[0].start.toISOString()).toBe(
      '2026-03-04T14:00:00.000Z',
    );
  });

  it('a floating 9-5 rule covers a 9am Eastern shift exactly', () => {
    const windows = resolveAvailability(nineToFive(null), [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: NY,
    });
    const coverage = coversInterval(
      windows,
      new Date('2026-03-04T14:00:00Z'),
      new Date('2026-03-04T22:00:00Z'),
    );
    expect(coverage.covered).toBe(true);
  });
});

describe('daylight saving transitions', () => {
  it('keeps a 9am window at 9am local across spring-forward', () => {
    const rules = [rule({ dayOfWeek: 1, timezone: LA })];

    const before = resolveAvailability(rules, [], {
      ...range('2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z'),
      evaluationZone: LA,
    });
    const after = resolveAvailability(rules, [], {
      ...range('2026-03-09T00:00:00Z', '2026-03-10T00:00:00Z'),
      evaluationZone: LA,
    });

    expect(before[0].start.toISOString()).toBe('2026-03-02T17:00:00.000Z');
    expect(after[0].start.toISOString()).toBe('2026-03-09T16:00:00.000Z');

    const hours = (w: { start: Date; end: Date }) =>
      (w.end.getTime() - w.start.getTime()) / 3_600_000;
    expect(hours(before[0])).toBe(8);
    expect(hours(after[0])).toBe(8);
  });

  it('handles an overnight window across the spring-forward night', () => {
    const rules = [
      rule({
        dayOfWeek: 6,
        startTime: '22:00',
        endTime: '06:00',
        spansMidnight: true,
        timezone: LA,
      }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-07T00:00:00Z', '2026-03-09T12:00:00Z'),
      evaluationZone: LA,
    });
    const overnight = windows.find(
      (w) => w.start.toISOString() === '2026-03-08T06:00:00.000Z',
    )!;
    expect(overnight).toBeDefined();
    const elapsed =
      (overnight.end.getTime() - overnight.start.getTime()) / 3_600_000;
    expect(elapsed).toBe(7);
  });

  it('handles an overnight window across the fall-back night', () => {
    const rules = [
      rule({
        dayOfWeek: 6,
        startTime: '22:00',
        endTime: '06:00',
        spansMidnight: true,
        timezone: LA,
      }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-10-31T00:00:00Z', '2026-11-02T12:00:00Z'),
      evaluationZone: LA,
    });
    const overnight = windows.find((w) =>
      w.start.toISOString().startsWith('2026-11-01T05:00'),
    )!;
    expect(overnight).toBeDefined();
    const elapsed =
      (overnight.end.getTime() - overnight.start.getTime()) / 3_600_000;
    expect(elapsed).toBe(9);
  });
});

describe('overnight windows', () => {
  it('treats an end time before the start time as crossing midnight', () => {
    const rules = [
      rule({
        dayOfWeek: 3,
        startTime: '22:00',
        endTime: '02:00',
        spansMidnight: false,
        timezone: LA,
      }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].start.toISOString()).toBe('2026-03-05T06:00:00.000Z');
    expect(windows[0].end.toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  it('finds a window opened on the previous local day', () => {
    const rules = [
      rule({
        dayOfWeek: 2,
        startTime: '22:00',
        endTime: '06:00',
        spansMidnight: true,
        timezone: LA,
      }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T08:00:00Z', '2026-03-04T13:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].start.toISOString()).toBe('2026-03-04T06:00:00.000Z');
  });
});

describe('exceptions', () => {
  const wednesdayRules = [rule({ timezone: LA })];

  it('a whole-day blackout removes the recurring window entirely', () => {
    const exceptions: AvailabilityExceptionInput[] = [
      {
        type: 'UNAVAILABLE',
        date: '2026-03-04',
        startTime: null,
        endTime: null,
        spansMidnight: false,
        timezone: LA,
        reason: 'Family wedding',
      },
    ];
    const windows = resolveAvailability(wednesdayRules, exceptions, {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(0);
  });

  it('a partial blackout splits the window in two', () => {
    const exceptions: AvailabilityExceptionInput[] = [
      {
        type: 'UNAVAILABLE',
        date: '2026-03-04',
        startTime: '12:00',
        endTime: '13:00',
        spansMidnight: false,
        timezone: LA,
        reason: 'Appointment',
      },
    ];
    const windows = resolveAvailability(wednesdayRules, exceptions, {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(2);
    expect(windows[0].end.toISOString()).toBe('2026-03-04T20:00:00.000Z');
    expect(windows[1].start.toISOString()).toBe('2026-03-04T21:00:00.000Z');
  });

  it('an extra-availability exception adds a window outside the pattern', () => {
    const exceptions: AvailabilityExceptionInput[] = [
      {
        type: 'AVAILABLE',
        date: '2026-03-07',
        startTime: '06:00',
        endTime: '10:00',
        spansMidnight: false,
        timezone: LA,
        reason: 'Happy to open this once',
      },
    ];
    const windows = resolveAvailability(wednesdayRules, exceptions, {
      ...range('2026-03-07T00:00:00Z', '2026-03-08T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].source).toBe('EXCEPTION');
  });
});

describe('effective dates', () => {
  it('ignores a rule that has not started yet', () => {
    const rules = [
      rule({ timezone: LA, effectiveFrom: new Date('2026-06-01T00:00:00Z') }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(0);
  });

  it('ignores a rule that has already ended', () => {
    const rules = [
      rule({ timezone: LA, effectiveTo: new Date('2026-01-01T00:00:00Z') }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(0);
  });
});

describe('merging', () => {
  it('joins touching windows into one', () => {
    const rules = [
      rule({ id: 'a', startTime: '09:00', endTime: '12:00', timezone: LA }),
      rule({ id: 'b', startTime: '12:00', endTime: '17:00', timezone: LA }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(1);
    expect(windows[0].start.toISOString()).toBe('2026-03-04T17:00:00.000Z');
    expect(windows[0].end.toISOString()).toBe('2026-03-05T01:00:00.000Z');
  });

  it('leaves genuinely separate windows apart', () => {
    const rules = [
      rule({ id: 'a', startTime: '09:00', endTime: '12:00', timezone: LA }),
      rule({ id: 'b', startTime: '15:00', endTime: '17:00', timezone: LA }),
    ];
    const windows = resolveAvailability(rules, [], {
      ...range('2026-03-04T00:00:00Z', '2026-03-06T00:00:00Z'),
      evaluationZone: LA,
    });
    expect(windows).toHaveLength(2);
  });
});

describe('coversInterval', () => {
  const windows = [
    {
      start: new Date('2026-03-04T17:00:00Z'),
      end: new Date('2026-03-05T01:00:00Z'),
      source: 'RECURRING' as const,
      timeZone: LA,
      label: '9am-5pm',
    },
  ];

  it('accepts a shift fully inside the window', () => {
    const result = coversInterval(
      windows,
      new Date('2026-03-04T18:00:00Z'),
      new Date('2026-03-04T22:00:00Z'),
    );
    expect(result.covered).toBe(true);
    expect(result.gaps).toHaveLength(0);
  });

  it('accepts a shift exactly matching the window', () => {
    const result = coversInterval(
      windows,
      new Date('2026-03-04T17:00:00Z'),
      new Date('2026-03-05T01:00:00Z'),
    );
    expect(result.covered).toBe(true);
  });

  it('reports a tail gap when the shift runs late', () => {
    const result = coversInterval(
      windows,
      new Date('2026-03-04T18:00:00Z'),
      new Date('2026-03-05T03:00:00Z'),
    );
    expect(result.covered).toBe(false);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].start.toISOString()).toBe('2026-03-05T01:00:00.000Z');
  });

  it('reports a leading gap when the shift starts early', () => {
    const result = coversInterval(
      windows,
      new Date('2026-03-04T15:00:00Z'),
      new Date('2026-03-04T22:00:00Z'),
    );
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].end.toISOString()).toBe('2026-03-04T17:00:00.000Z');
  });
});
