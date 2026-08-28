import {
  Temporal,
  hoursBetween,
  intervalsOverlap,
  localDate,
  formatShiftRange,
  formatDate,
  formatTime,
  zoneAbbreviation,
} from '@/lib/time/zones';
import { coversInterval, type AvailabilityInterval } from './availability';
import {
  CONSECUTIVE_OVERRIDE_DAYS,
  CONSECUTIVE_WARN_DAYS,
  DAILY_BLOCK_HOURS,
  DAILY_WARN_HOURS,
  REST_HOURS_MIN,
  RULES,
  SEVERITY_ORDER,
  WEEKLY_OVERTIME_HOURS,
  WEEKLY_WARN_HOURS,
  type RuleCode,
  type Severity,
} from './rules';

export interface ExistingAssignment {
  assignmentId: string;
  shiftId: string;
  locationId: string;
  locationName: string;
  locationTimeZone: string;
  startUtc: Date;
  endUtc: Date;
}

export interface CandidateStaff {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  timezone: string;
  skillIds: string[];
  certifiedLocationIds: string[];
  desiredWeeklyHours: number;
  maxWeeklyHours: number;
  baseHourlyRate: number;
  overtimeMultiplier: number;
}

export interface CandidateContext {
  staff: CandidateStaff;
  availability: AvailabilityInterval[];
  existingAssignments: ExistingAssignment[];
  excludeAssignmentIds?: string[];
}

export interface TargetShift {
  id?: string;
  locationId: string;
  locationName: string;
  locationTimeZone: string;
  startUtc: Date;
  endUtc: Date;
  requiredSkillId: string;
  requiredSkillName: string;
  headcount: number;
  assignedCount: number;
}

export interface Violation {
  code: RuleCode;
  severity: Severity;
  title: string;
  message: string;
  rationale: string;
  remedy?: string;
  data?: Record<string, unknown>;
}

export interface HoursProjection {
  weekKey: string;
  dailyHoursBefore: number;
  dailyHoursAfter: number;
  weeklyHoursBefore: number;
  weeklyHoursAfter: number;
  shiftHours: number;
  consecutiveDays: number;
  overtimeHoursBefore: number;
  overtimeHoursAfter: number;
  addedCost: number;
  addedOvertimeCost: number;
}

export interface EvaluationResult {
  ok: boolean;
  clean: boolean;
  violations: Violation[];
  blocking: Violation[];
  overridable: Violation[];
  warnings: Violation[];
  projection: HoursProjection;
}

function violation(
  code: RuleCode,
  message: string,
  extra: { remedy?: string; data?: Record<string, unknown> } = {},
): Violation {
  const rule = RULES[code];
  return {
    code,
    severity: rule.severity,
    title: rule.title,
    rationale: rule.rationale,
    message,
    remedy: extra.remedy,
    data: extra.data,
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function activeAssignments(context: CandidateContext): ExistingAssignment[] {
  const excluded = new Set(context.excludeAssignmentIds ?? []);
  return context.existingAssignments.filter(
    (a) => !excluded.has(a.assignmentId),
  );
}

function personWeekKey(date: Date, zone: string): string {
  const d = localDate(date, zone);
  const thursday = d.add({ days: 4 - d.dayOfWeek });
  const jan1 = new Temporal.PlainDate(thursday.year, 1, 1);
  const dayOfYear = thursday.since(jan1).days + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return `${thursday.year}-W${String(week).padStart(2, '0')}`;
}

export function consecutiveRunLength(
  workedDates: Set<string>,
  targetDate: Temporal.PlainDate,
): number {
  let length = 1;
  let cursor = targetDate.subtract({ days: 1 });
  while (workedDates.has(cursor.toString())) {
    length += 1;
    cursor = cursor.subtract({ days: 1 });
  }
  cursor = targetDate.add({ days: 1 });
  while (workedDates.has(cursor.toString())) {
    length += 1;
    cursor = cursor.add({ days: 1 });
  }
  return length;
}

export function projectHours(
  target: TargetShift,
  context: CandidateContext,
): HoursProjection {
  const zone = context.staff.timezone;
  const assignments = activeAssignments(context);
  const shiftHours = hoursBetween(target.startUtc, target.endUtc);

  const targetDay = localDate(target.startUtc, zone).toString();
  const targetWeek = personWeekKey(target.startUtc, zone);

  let dailyBefore = 0;
  let weeklyBefore = 0;
  const workedDates = new Set<string>();

  for (const a of assignments) {
    const day = localDate(a.startUtc, zone).toString();
    const hours = hoursBetween(a.startUtc, a.endUtc);
    if (hours > 0) workedDates.add(day);
    if (day === targetDay) dailyBefore += hours;
    if (personWeekKey(a.startUtc, zone) === targetWeek) weeklyBefore += hours;
  }

  workedDates.add(targetDay);
  const consecutiveDays = consecutiveRunLength(
    workedDates,
    localDate(target.startUtc, zone),
  );

  const weeklyAfter = weeklyBefore + shiftHours;
  const otBefore = Math.max(0, weeklyBefore - WEEKLY_OVERTIME_HOURS);
  const otAfter = Math.max(0, weeklyAfter - WEEKLY_OVERTIME_HOURS);
  const otHoursAdded = otAfter - otBefore;
  const straightHoursAdded = shiftHours - otHoursAdded;

  const rate = context.staff.baseHourlyRate;
  const addedOvertimeCost = otHoursAdded * rate * context.staff.overtimeMultiplier;
  const addedCost = straightHoursAdded * rate + addedOvertimeCost;

  return {
    weekKey: targetWeek,
    dailyHoursBefore: round(dailyBefore),
    dailyHoursAfter: round(dailyBefore + shiftHours),
    weeklyHoursBefore: round(weeklyBefore),
    weeklyHoursAfter: round(weeklyAfter),
    shiftHours: round(shiftHours),
    consecutiveDays,
    overtimeHoursBefore: round(otBefore),
    overtimeHoursAfter: round(otAfter),
    addedCost: round(addedCost),
    addedOvertimeCost: round(addedOvertimeCost),
  };
}

export interface EvaluateOptions {
  warningsOnly?: boolean;
  ignoreHeadcount?: boolean;
}

export function evaluateAssignment(
  target: TargetShift,
  context: CandidateContext,
  options: EvaluateOptions = {},
): EvaluationResult {
  const { staff } = context;
  const zone = staff.timezone;
  const locZone = target.locationTimeZone;
  const violations: Violation[] = [];
  const projection = projectHours(target, context);
  const assignments = activeAssignments(context);

  if (!staff.isActive) {
    violations.push(
      violation(
        'STAFF_INACTIVE',
        `${staff.name}'s account is deactivated and cannot be scheduled.`,
        { remedy: 'Reactivate the account from the staff directory.' },
      ),
    );
  }

  if (!staff.certifiedLocationIds.includes(target.locationId)) {
    violations.push(
      violation(
        'NOT_CERTIFIED_AT_LOCATION',
        `${staff.name} is not certified to work at ${target.locationName}.`,
        {
          remedy: `Certify ${staff.name} at ${target.locationName}, or pick someone who already is.`,
          data: { locationId: target.locationId },
        },
      ),
    );
  }

  if (!staff.skillIds.includes(target.requiredSkillId)) {
    violations.push(
      violation(
        'MISSING_SKILL',
        `This shift needs a ${target.requiredSkillName}, and ${staff.name} is not signed off for that role.`,
        {
          remedy: `Add the ${target.requiredSkillName} skill to ${staff.name}, or choose someone who has it.`,
          data: { requiredSkillId: target.requiredSkillId },
        },
      ),
    );
  }

  if (!options.ignoreHeadcount && target.assignedCount >= target.headcount) {
    violations.push(
      violation(
        'SHIFT_FULL',
        `This shift already has all ${target.headcount} of its ${
          target.headcount === 1 ? 'position' : 'positions'
        } filled.`,
        { remedy: 'Increase the headcount if you need an extra person.' },
      ),
    );
  }

  const coverage = coversInterval(
    context.availability,
    target.startUtc,
    target.endUtc,
  );
  if (!coverage.covered) {
    const gap = coverage.gaps[0];
    const gapLabel = `${formatTime(gap.start, locZone)}–${formatTime(
      gap.end,
      locZone,
    )} ${zoneAbbreviation(gap.start, locZone)}`;
    const stated = coverage.matched.length
      ? ` They are available ${coverage.matched
          .map(
            (w) =>
              `${formatTime(w.start, locZone)}–${formatTime(w.end, locZone)}`,
          )
          .join(', ')} ${zoneAbbreviation(target.startUtc, locZone)}.`
      : ' They have no availability set for that day.';
    violations.push(
      violation(
        'OUTSIDE_AVAILABILITY',
        `${staff.name} is not available for ${gapLabel} on ${formatDate(
          target.startUtc,
          locZone,
        )}.${stated}`,
        {
          remedy:
            'Shorten the shift to fit, ask them to update their availability, or pick another person.',
          data: {
            gaps: coverage.gaps.map((g) => ({
              start: g.start.toISOString(),
              end: g.end.toISOString(),
            })),
          },
        },
      ),
    );
  }

  for (const a of assignments) {
    if (target.id && a.shiftId === target.id) {
      violations.push(
        violation(
          'ALREADY_ASSIGNED',
          `${staff.name} is already on this shift.`,
        ),
      );
      continue;
    }
    if (
      intervalsOverlap(target.startUtc, target.endUtc, a.startUtc, a.endUtc)
    ) {
      const sameLocation = a.locationId === target.locationId;
      violations.push(
        violation(
          'DOUBLE_BOOKING',
          `${staff.name} is already working ${formatShiftRange(
            a.startUtc,
            a.endUtc,
            a.locationTimeZone,
          )} at ${a.locationName}${
            sameLocation ? '' : ' — a different location'
          }, which overlaps this shift.`,
          {
            remedy: sameLocation
              ? 'Adjust one of the two shifts so they no longer overlap.'
              : `Someone cannot be at ${a.locationName} and ${target.locationName} at once. Free up the other shift first.`,
            data: { conflictingShiftId: a.shiftId, locationId: a.locationId },
          },
        ),
      );
    }
  }

  for (const a of assignments) {
    if (target.id && a.shiftId === target.id) continue;
    if (intervalsOverlap(target.startUtc, target.endUtc, a.startUtc, a.endUtc)) {
      continue;
    }
    const before = a.endUtc <= target.startUtc;
    const gapHours = before
      ? hoursBetween(a.endUtc, target.startUtc)
      : hoursBetween(target.endUtc, a.startUtc);
    if (gapHours < REST_HOURS_MIN) {
      violations.push(
        violation(
          'REST_PERIOD_10H',
          before
            ? `${staff.name} finishes at ${a.locationName} at ${formatTime(
                a.endUtc,
                a.locationTimeZone,
              )} ${zoneAbbreviation(
                a.endUtc,
                a.locationTimeZone,
              )} — only ${formatHours(
                gapHours,
              )} before this shift starts. ${REST_HOURS_MIN}h rest is required.`
            : `${staff.name} starts at ${a.locationName} at ${formatTime(
                a.startUtc,
                a.locationTimeZone,
              )} ${zoneAbbreviation(
                a.startUtc,
                a.locationTimeZone,
              )} — only ${formatHours(
                gapHours,
              )} after this shift ends. ${REST_HOURS_MIN}h rest is required.`,
          {
            remedy: `Move this shift by ${formatHours(
              REST_HOURS_MIN - gapHours,
            )} or more, or choose someone else.`,
            data: {
              conflictingShiftId: a.shiftId,
              gapHours: round(gapHours),
              shortfallHours: round(REST_HOURS_MIN - gapHours),
            },
          },
        ),
      );
    }
  }

  if (projection.dailyHoursAfter > DAILY_BLOCK_HOURS) {
    violations.push(
      violation(
        'DAILY_HOURS_12',
        `This would put ${staff.name} at ${formatHours(
          projection.dailyHoursAfter,
        )} on ${formatDate(
          target.startUtc,
          zone,
        )}, past the ${DAILY_BLOCK_HOURS}h daily ceiling.`,
        {
          remedy: 'Shorten the shift or split it across two people.',
          data: {
            dailyHoursAfter: projection.dailyHoursAfter,
            limit: DAILY_BLOCK_HOURS,
          },
        },
      ),
    );
  } else if (projection.dailyHoursAfter > DAILY_WARN_HOURS) {
    violations.push(
      violation(
        'DAILY_HOURS_8',
        `${staff.name} would work ${formatHours(
          projection.dailyHoursAfter,
        )} on ${formatDate(target.startUtc, zone)}.`,
        {
          data: {
            dailyHoursAfter: projection.dailyHoursAfter,
            limit: DAILY_WARN_HOURS,
          },
        },
      ),
    );
  }

  if (projection.consecutiveDays >= CONSECUTIVE_OVERRIDE_DAYS) {
    violations.push(
      violation(
        'SEVENTH_CONSECUTIVE_DAY',
        `This would be ${staff.name}'s ${projection.consecutiveDays}th consecutive working day.`,
        {
          remedy:
            'A manager must record a written reason before this can be saved.',
          data: { consecutiveDays: projection.consecutiveDays },
        },
      ),
    );
  } else if (projection.consecutiveDays >= CONSECUTIVE_WARN_DAYS) {
    violations.push(
      violation(
        'SIXTH_CONSECUTIVE_DAY',
        `This would be ${staff.name}'s ${projection.consecutiveDays}th consecutive working day.`,
        { data: { consecutiveDays: projection.consecutiveDays } },
      ),
    );
  }

  if (projection.weeklyHoursAfter > WEEKLY_OVERTIME_HOURS) {
    violations.push(
      violation(
        'WEEKLY_HOURS_40',
        `${staff.name} would reach ${formatHours(
          projection.weeklyHoursAfter,
        )} this week — ${formatHours(
          projection.overtimeHoursAfter,
        )} of overtime, costing an extra $${projection.addedOvertimeCost.toFixed(
          2,
        )}.`,
        {
          data: {
            weeklyHoursAfter: projection.weeklyHoursAfter,
            overtimeHours: projection.overtimeHoursAfter,
            addedOvertimeCost: projection.addedOvertimeCost,
          },
        },
      ),
    );
  } else if (projection.weeklyHoursAfter >= WEEKLY_WARN_HOURS) {
    violations.push(
      violation(
        'WEEKLY_HOURS_35',
        `${staff.name} would be at ${formatHours(
          projection.weeklyHoursAfter,
        )} this week — ${formatHours(
          WEEKLY_OVERTIME_HOURS - projection.weeklyHoursAfter,
        )} before overtime starts.`,
        {
          data: {
            weeklyHoursAfter: projection.weeklyHoursAfter,
            headroom: round(
              WEEKLY_OVERTIME_HOURS - projection.weeklyHoursAfter,
            ),
          },
        },
      ),
    );
  }

  if (projection.weeklyHoursAfter > staff.desiredWeeklyHours) {
    violations.push(
      violation(
        'EXCEEDS_DESIRED_HOURS',
        `${staff.name} asked for about ${staff.desiredWeeklyHours}h a week and would be at ${formatHours(
          projection.weeklyHoursAfter,
        )}.`,
        {
          data: {
            desiredWeeklyHours: staff.desiredWeeklyHours,
            weeklyHoursAfter: projection.weeklyHoursAfter,
          },
        },
      ),
    );
  }

  const filtered = options.warningsOnly
    ? violations
    : violations.filter((v) => !options.warningsOnly || v.severity !== 'WARN');

  filtered.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  const blocking = filtered.filter((v) => v.severity === 'BLOCK');
  const overridable = filtered.filter((v) => v.severity === 'OVERRIDABLE');
  const warnings = filtered.filter((v) => v.severity === 'WARN');

  return {
    ok: blocking.length === 0,
    clean: filtered.length === 0,
    violations: filtered,
    blocking,
    overridable,
    warnings,
    projection,
  };
}

export interface RankedCandidate {
  staff: CandidateStaff;
  result: EvaluationResult;
  score: number;
  reasons: string[];
}

export function scoreCandidate(
  staff: CandidateStaff,
  result: EvaluationResult,
): RankedCandidate {
  const reasons: string[] = [];
  let score = 100;

  const { projection } = result;

  const desiredGap = staff.desiredWeeklyHours - projection.weeklyHoursBefore;
  if (desiredGap > 0) {
    const bonus = Math.min(desiredGap, 20);
    score += bonus;
    reasons.push(
      `${formatHours(desiredGap)} below their ${staff.desiredWeeklyHours}h target`,
    );
  } else {
    score += desiredGap;
  }

  if (projection.overtimeHoursAfter > 0) {
    score -= 30 + projection.overtimeHoursAfter * 2;
    reasons.push(
      `would add ${formatHours(projection.overtimeHoursAfter)} of overtime`,
    );
  } else if (projection.weeklyHoursAfter >= WEEKLY_WARN_HOURS) {
    score -= 10;
    reasons.push('close to the overtime threshold');
  }

  if (projection.consecutiveDays >= CONSECUTIVE_OVERRIDE_DAYS) {
    score -= 40;
    reasons.push(`${projection.consecutiveDays}th day in a row`);
  } else if (projection.consecutiveDays >= CONSECUTIVE_WARN_DAYS) {
    score -= 15;
    reasons.push(`${projection.consecutiveDays}th day in a row`);
  }

  score -= result.warnings.length * 2;

  if (reasons.length === 0) reasons.push('no warnings');

  return { staff, result, score: round(score), reasons };
}

export function rankCandidates(ranked: RankedCandidate[]): RankedCandidate[] {
  return [...ranked].sort((a, b) => {
    const aOverride = a.result.overridable.length > 0 ? 1 : 0;
    const bOverride = b.result.overridable.length > 0 ? 1 : 0;
    if (aOverride !== bOverride) return aOverride - bOverride;
    return b.score - a.score;
  });
}
