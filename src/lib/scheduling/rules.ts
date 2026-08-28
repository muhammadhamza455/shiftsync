export type Severity = 'BLOCK' | 'OVERRIDABLE' | 'WARN';

export type RuleCode =
  | 'STAFF_INACTIVE'
  | 'NOT_CERTIFIED_AT_LOCATION'
  | 'MISSING_SKILL'
  | 'OUTSIDE_AVAILABILITY'
  | 'DOUBLE_BOOKING'
  | 'REST_PERIOD_10H'
  | 'DAILY_HOURS_12'
  | 'SHIFT_FULL'
  | 'ALREADY_ASSIGNED'
  | 'EDIT_CUTOFF_PASSED'
  | 'SEVENTH_CONSECUTIVE_DAY'
  | 'DAILY_HOURS_8'
  | 'SIXTH_CONSECUTIVE_DAY'
  | 'WEEKLY_HOURS_35'
  | 'WEEKLY_HOURS_40'
  | 'EXCEEDS_DESIRED_HOURS'
  | 'BELOW_DESIRED_HOURS';

export interface RuleDefinition {
  code: RuleCode;
  severity: Severity;
  title: string;
  rationale: string;
}

export const REST_HOURS_MIN = 10;
export const DAILY_WARN_HOURS = 8;
export const DAILY_BLOCK_HOURS = 12;
export const WEEKLY_WARN_HOURS = 35;
export const WEEKLY_OVERTIME_HOURS = 40;
export const CONSECUTIVE_WARN_DAYS = 6;
export const CONSECUTIVE_OVERRIDE_DAYS = 7;
export const DEFAULT_EDIT_CUTOFF_HOURS = 48;
export const MAX_PENDING_COVERAGE_REQUESTS = 3;
export const DROP_EXPIRY_HOURS_BEFORE_SHIFT = 24;

export const RULES: Record<RuleCode, RuleDefinition> = {
  STAFF_INACTIVE: {
    code: 'STAFF_INACTIVE',
    severity: 'BLOCK',
    title: 'Staff member is inactive',
    rationale:
      'Deactivated staff cannot be scheduled. Reactivate the account first.',
  },
  NOT_CERTIFIED_AT_LOCATION: {
    code: 'NOT_CERTIFIED_AT_LOCATION',
    severity: 'BLOCK',
    title: 'Not certified at this location',
    rationale:
      'Every location has its own layout, POS and health-code sign-off. Staff work only where they have been signed off.',
  },
  MISSING_SKILL: {
    code: 'MISSING_SKILL',
    severity: 'BLOCK',
    title: 'Missing the required skill',
    rationale:
      'The shift specifies a role. Assigning someone without it leaves the position effectively unfilled.',
  },
  OUTSIDE_AVAILABILITY: {
    code: 'OUTSIDE_AVAILABILITY',
    severity: 'BLOCK',
    title: 'Outside stated availability',
    rationale:
      'Staff set their own availability. Scheduling against it is the single largest driver of call-outs.',
  },
  DOUBLE_BOOKING: {
    code: 'DOUBLE_BOOKING',
    severity: 'BLOCK',
    title: 'Already booked at that time',
    rationale:
      'One person cannot be in two places at once — including at two different locations.',
  },
  REST_PERIOD_10H: {
    code: 'REST_PERIOD_10H',
    severity: 'BLOCK',
    title: `Less than ${REST_HOURS_MIN}h rest`,
    rationale: `Staff need at least ${REST_HOURS_MIN} hours between the end of one shift and the start of the next.`,
  },
  DAILY_HOURS_12: {
    code: 'DAILY_HOURS_12',
    severity: 'BLOCK',
    title: `Over ${DAILY_BLOCK_HOURS}h in a day`,
    rationale: `${DAILY_BLOCK_HOURS} hours in a single day is a hard legal ceiling and cannot be overridden.`,
  },
  SHIFT_FULL: {
    code: 'SHIFT_FULL',
    severity: 'BLOCK',
    title: 'Shift is already fully staffed',
    rationale:
      'The shift has its required headcount. Raise the headcount to add another person.',
  },
  ALREADY_ASSIGNED: {
    code: 'ALREADY_ASSIGNED',
    severity: 'BLOCK',
    title: 'Already on this shift',
    rationale: 'This person is already assigned to this shift.',
  },
  EDIT_CUTOFF_PASSED: {
    code: 'EDIT_CUTOFF_PASSED',
    severity: 'BLOCK',
    title: 'Past the edit cutoff',
    rationale:
      'Published shifts lock shortly before they start so staff can rely on the posted schedule.',
  },
  SEVENTH_CONSECUTIVE_DAY: {
    code: 'SEVENTH_CONSECUTIVE_DAY',
    severity: 'OVERRIDABLE',
    title: '7th consecutive day',
    rationale:
      'A 7th straight working day requires a manager to record a written reason, which is kept in the audit log.',
  },
  DAILY_HOURS_8: {
    code: 'DAILY_HOURS_8',
    severity: 'WARN',
    title: `Over ${DAILY_WARN_HOURS}h in a day`,
    rationale: `Beyond ${DAILY_WARN_HOURS} hours in a day, daily overtime rules may apply depending on jurisdiction.`,
  },
  SIXTH_CONSECUTIVE_DAY: {
    code: 'SIXTH_CONSECUTIVE_DAY',
    severity: 'WARN',
    title: '6th consecutive day',
    rationale:
      'Six days in a row is a strong predictor of a call-out on day seven.',
  },
  WEEKLY_HOURS_35: {
    code: 'WEEKLY_HOURS_35',
    severity: 'WARN',
    title: 'Approaching overtime',
    rationale: `At ${WEEKLY_WARN_HOURS}+ hours there is little headroom left before overtime starts at ${WEEKLY_OVERTIME_HOURS}.`,
  },
  WEEKLY_HOURS_40: {
    code: 'WEEKLY_HOURS_40',
    severity: 'WARN',
    title: 'Into overtime',
    rationale: `Hours past ${WEEKLY_OVERTIME_HOURS} in the workweek are billed at the overtime multiplier.`,
  },
  EXCEEDS_DESIRED_HOURS: {
    code: 'EXCEEDS_DESIRED_HOURS',
    severity: 'WARN',
    title: 'Over their desired hours',
    rationale:
      'This person asked for fewer hours than they are now scheduled for. Advisory only — it never blocks.',
  },
  BELOW_DESIRED_HOURS: {
    code: 'BELOW_DESIRED_HOURS',
    severity: 'WARN',
    title: 'Under their desired hours',
    rationale:
      'This person wants more hours than they have been given this week.',
  },
};

export const SEVERITY_ORDER: Record<Severity, number> = {
  BLOCK: 0,
  OVERRIDABLE: 1,
  WARN: 2,
};

export function isBlocking(code: RuleCode): boolean {
  return RULES[code].severity === 'BLOCK';
}

export function requiresOverride(code: RuleCode): boolean {
  return RULES[code].severity === 'OVERRIDABLE';
}
