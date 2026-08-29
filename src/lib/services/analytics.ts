import { db } from '@/lib/db';
import {
  hoursBetween,
  weekBoundsUtc,
  localDate,
  formatShiftRange,
} from '@/lib/time/zones';
import {
  WEEKLY_OVERTIME_HOURS,
  WEEKLY_WARN_HOURS,
} from '@/lib/scheduling/rules';

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export interface OvertimeAssignmentRow {
  assignmentId: string;
  shiftId: string;
  locationName: string;
  label: string;
  hours: number;
  overtimeHours: number;
  tipsIntoOvertime: boolean;
}

export interface OvertimeStaffRow {
  userId: string;
  name: string;
  timezone: string;
  totalHours: number;
  regularHours: number;
  overtimeHours: number;
  regularCost: number;
  overtimeCost: number;
  totalCost: number;
  desiredWeeklyHours: number;
  status: 'OVER' | 'APPROACHING' | 'OK';
  assignments: OvertimeAssignmentRow[];
}

export interface OvertimeReport {
  weekKey: string;
  rows: OvertimeStaffRow[];
  totals: {
    staffCount: number;
    totalHours: number;
    overtimeHours: number;
    regularCost: number;
    overtimeCost: number;
    totalCost: number;
  };
}

export async function overtimeReport(
  locationIds: string[],
  weekKey: string,
): Promise<OvertimeReport> {
  if (locationIds.length === 0) {
    return {
      weekKey,
      rows: [],
      totals: {
        staffCount: 0,
        totalHours: 0,
        overtimeHours: 0,
        regularCost: 0,
        overtimeCost: 0,
        totalCost: 0,
      },
    };
  }

  const { start, end } = weekBoundsUtc(weekKey, 'UTC');
  const windowStart = new Date(start.getTime() - 86_400_000);
  const windowEnd = new Date(end.getTime() + 86_400_000);

  const assignments = await db.assignment.findMany({
    where: {
      status: 'ASSIGNED',
      shift: {
        status: { not: 'CANCELLED' },
        locationId: { in: locationIds },
        startUtc: { gte: windowStart, lt: windowEnd },
      },
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          timezone: true,
          staffProfile: {
            select: {
              baseHourlyRate: true,
              overtimeMultiplier: true,
              desiredWeeklyHours: true,
            },
          },
        },
      },
      shift: {
        select: {
          id: true,
          startUtc: true,
          endUtc: true,
          weekKey: true,
          location: { select: { name: true, timezone: true } },
        },
      },
    },
    orderBy: { shift: { startUtc: 'asc' } },
  });

  const byUser = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (a.shift.weekKey !== weekKey) continue;
    const list = byUser.get(a.userId) ?? [];
    list.push(a);
    byUser.set(a.userId, list);
  }

  const rows: OvertimeStaffRow[] = [];

  for (const [userId, list] of byUser) {
    const user = list[0].user;
    const rate = toNumber(user.staffProfile?.baseHourlyRate, 18);
    const multiplier = toNumber(user.staffProfile?.overtimeMultiplier, 1.5);
    const desired = user.staffProfile?.desiredWeeklyHours ?? 30;

    let cumulative = 0;
    const rowAssignments: OvertimeAssignmentRow[] = [];

    for (const a of list) {
      const hours = hoursBetween(a.shift.startUtc, a.shift.endUtc);
      const before = cumulative;
      cumulative += hours;
      const otBefore = Math.max(0, before - WEEKLY_OVERTIME_HOURS);
      const otAfter = Math.max(0, cumulative - WEEKLY_OVERTIME_HOURS);
      const overtimeHours = otAfter - otBefore;

      rowAssignments.push({
        assignmentId: a.id,
        shiftId: a.shift.id,
        locationName: a.shift.location.name,
        label: formatShiftRange(
          a.shift.startUtc,
          a.shift.endUtc,
          a.shift.location.timezone,
        ),
        hours: round(hours),
        overtimeHours: round(overtimeHours),
        tipsIntoOvertime: otBefore === 0 && otAfter > 0,
      });
    }

    const totalHours = cumulative;
    const overtimeHours = Math.max(0, totalHours - WEEKLY_OVERTIME_HOURS);
    const regularHours = totalHours - overtimeHours;

    rows.push({
      userId,
      name: user.name,
      timezone: user.timezone,
      totalHours: round(totalHours),
      regularHours: round(regularHours),
      overtimeHours: round(overtimeHours),
      regularCost: round(regularHours * rate),
      overtimeCost: round(overtimeHours * rate * multiplier),
      totalCost: round(regularHours * rate + overtimeHours * rate * multiplier),
      desiredWeeklyHours: desired,
      status:
        overtimeHours > 0
          ? 'OVER'
          : totalHours >= WEEKLY_WARN_HOURS
            ? 'APPROACHING'
            : 'OK',
      assignments: rowAssignments,
    });
  }

  rows.sort((a, b) => b.totalHours - a.totalHours);

  return {
    weekKey,
    rows,
    totals: {
      staffCount: rows.length,
      totalHours: round(rows.reduce((s, r) => s + r.totalHours, 0)),
      overtimeHours: round(rows.reduce((s, r) => s + r.overtimeHours, 0)),
      regularCost: round(rows.reduce((s, r) => s + r.regularCost, 0)),
      overtimeCost: round(rows.reduce((s, r) => s + r.overtimeCost, 0)),
      totalCost: round(rows.reduce((s, r) => s + r.totalCost, 0)),
    },
  };
}

export interface FairnessStaffRow {
  userId: string;
  name: string;
  totalHours: number;
  shiftCount: number;
  premiumShiftCount: number;
  premiumShare: number;
  expectedPremium: number;
  premiumIndex: number;
  desiredWeeklyHours: number;
  hoursVsDesired: number;
  standing: 'UNDER_SERVED' | 'EVEN' | 'OVER_SERVED';
}

export interface FairnessReport {
  from: Date;
  to: Date;
  weeks: number;
  totalPremiumShifts: number;
  fairnessScore: number;
  rows: FairnessStaffRow[];
}

export function giniCoefficient(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const total = values.reduce((s, v) => s + v, 0);
  if (total === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  let weighted = 0;
  for (let i = 0; i < n; i += 1) {
    weighted += (i + 1) * sorted[i];
  }
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export async function fairnessReport(
  locationIds: string[],
  from: Date,
  to: Date,
): Promise<FairnessReport> {
  const empty: FairnessReport = {
    from,
    to,
    weeks: 0,
    totalPremiumShifts: 0,
    fairnessScore: 100,
    rows: [],
  };
  if (locationIds.length === 0) return empty;

  const assignments = await db.assignment.findMany({
    where: {
      status: 'ASSIGNED',
      shift: {
        status: { not: 'CANCELLED' },
        locationId: { in: locationIds },
        startUtc: { gte: from, lt: to },
      },
    },
    select: {
      id: true,
      userId: true,
      user: {
        select: {
          id: true,
          name: true,
          staffProfile: { select: { desiredWeeklyHours: true } },
        },
      },
      shift: {
        select: { id: true, startUtc: true, endUtc: true, isPremium: true },
      },
    },
  });

  if (assignments.length === 0) return empty;

  const weeks = Math.max(
    1,
    (to.getTime() - from.getTime()) / (7 * 86_400_000),
  );

  interface Acc {
    name: string;
    desired: number;
    hours: number;
    shifts: number;
    premium: number;
  }
  const byUser = new Map<string, Acc>();

  for (const a of assignments) {
    const acc = byUser.get(a.userId) ?? {
      name: a.user.name,
      desired: a.user.staffProfile?.desiredWeeklyHours ?? 30,
      hours: 0,
      shifts: 0,
      premium: 0,
    };
    acc.hours += hoursBetween(a.shift.startUtc, a.shift.endUtc);
    acc.shifts += 1;
    if (a.shift.isPremium) acc.premium += 1;
    byUser.set(a.userId, acc);
  }

  const totalPremiumShifts = [...byUser.values()].reduce(
    (s, a) => s + a.premium,
    0,
  );
  const staffCount = byUser.size;
  const expectedPremium = staffCount > 0 ? totalPremiumShifts / staffCount : 0;

  const rows: FairnessStaffRow[] = [...byUser.entries()].map(
    ([userId, acc]) => {
      const premiumIndex =
        expectedPremium > 0 ? acc.premium / expectedPremium : 1;
      const avgWeekly = acc.hours / weeks;
      return {
        userId,
        name: acc.name,
        totalHours: round(acc.hours),
        shiftCount: acc.shifts,
        premiumShiftCount: acc.premium,
        premiumShare:
          totalPremiumShifts > 0 ? round(acc.premium / totalPremiumShifts, 4) : 0,
        expectedPremium: round(expectedPremium),
        premiumIndex: round(premiumIndex),
        desiredWeeklyHours: acc.desired,
        hoursVsDesired: round(avgWeekly - acc.desired),
        standing:
          premiumIndex < 0.75
            ? 'UNDER_SERVED'
            : premiumIndex > 1.25
              ? 'OVER_SERVED'
              : 'EVEN',
      };
    },
  );

  rows.sort((a, b) => a.premiumIndex - b.premiumIndex);

  const gini = giniCoefficient(rows.map((r) => r.premiumShiftCount));

  return {
    from,
    to,
    weeks: round(weeks, 1),
    totalPremiumShifts,
    fairnessScore: Math.round((1 - gini) * 100),
    rows,
  };
}

export async function premiumShiftLedger(
  locationIds: string[],
  from: Date,
  to: Date,
) {
  const shifts = await db.shift.findMany({
    where: {
      locationId: { in: locationIds },
      isPremium: true,
      status: { not: 'CANCELLED' },
      startUtc: { gte: from, lt: to },
    },
    select: {
      id: true,
      startUtc: true,
      endUtc: true,
      location: { select: { name: true, timezone: true } },
      requiredSkill: { select: { name: true } },
      assignments: {
        where: { status: 'ASSIGNED' },
        select: { user: { select: { id: true, name: true } } },
      },
    },
    orderBy: { startUtc: 'desc' },
  });

  return shifts.map((s) => ({
    shiftId: s.id,
    label: formatShiftRange(s.startUtc, s.endUtc, s.location.timezone),
    locationName: s.location.name,
    skill: s.requiredSkill.name,
    workedBy: s.assignments.map((a) => a.user),
    localDate: localDate(s.startUtc, s.location.timezone).toString(),
  }));
}

export interface OnDutyRow {
  assignmentId: string;
  userId: string;
  userName: string;
  locationId: string;
  locationName: string;
  locationTimeZone: string;
  skill: string;
  startUtc: Date;
  endUtc: Date;
  label: string;
  clockInAt: Date | null;
  state: 'ON_DUTY' | 'NOT_CLOCKED_IN' | 'OVERRUNNING';
}

export async function onDutyNow(
  locationIds: string[],
  now: Date = new Date(),
): Promise<OnDutyRow[]> {
  if (locationIds.length === 0) return [];

  const assignments = await db.assignment.findMany({
    where: {
      status: 'ASSIGNED',
      clockOutAt: null,
      shift: {
        status: 'PUBLISHED',
        locationId: { in: locationIds },
        startUtc: { lte: new Date(now.getTime() + 30 * 60_000) },
        endUtc: { gte: new Date(now.getTime() - 4 * 3_600_000) },
      },
    },
    select: {
      id: true,
      clockInAt: true,
      user: { select: { id: true, name: true } },
      shift: {
        select: {
          startUtc: true,
          endUtc: true,
          locationId: true,
          location: { select: { name: true, timezone: true } },
          requiredSkill: { select: { name: true } },
        },
      },
    },
    orderBy: { shift: { startUtc: 'asc' } },
  });

  return assignments
    .map((a): OnDutyRow => {
      const ended = a.shift.endUtc.getTime() < now.getTime();
      const started = a.shift.startUtc.getTime() <= now.getTime();
      return {
        assignmentId: a.id,
        userId: a.user.id,
        userName: a.user.name,
        locationId: a.shift.locationId,
        locationName: a.shift.location.name,
        locationTimeZone: a.shift.location.timezone,
        skill: a.shift.requiredSkill.name,
        startUtc: a.shift.startUtc,
        endUtc: a.shift.endUtc,
        label: formatShiftRange(
          a.shift.startUtc,
          a.shift.endUtc,
          a.shift.location.timezone,
        ),
        clockInAt: a.clockInAt,
        state: a.clockInAt
          ? ended
            ? 'OVERRUNNING'
            : 'ON_DUTY'
          : started
            ? 'NOT_CLOCKED_IN'
            : 'NOT_CLOCKED_IN',
      };
    })
    .filter((row) => row.state !== 'NOT_CLOCKED_IN' || row.endUtc >= now);
}

export async function coverageGaps(locationIds: string[], from: Date, to: Date) {
  if (locationIds.length === 0) return [];

  const shifts = await db.shift.findMany({
    where: {
      locationId: { in: locationIds },
      status: { not: 'CANCELLED' },
      startUtc: { gte: from, lt: to },
    },
    select: {
      id: true,
      startUtc: true,
      endUtc: true,
      headcount: true,
      status: true,
      isPremium: true,
      location: { select: { id: true, name: true, timezone: true } },
      requiredSkill: { select: { id: true, name: true } },
      _count: { select: { assignments: { where: { status: 'ASSIGNED' } } } },
    },
    orderBy: { startUtc: 'asc' },
  });

  return shifts
    .filter((s) => s._count.assignments < s.headcount)
    .map((s) => ({
      shiftId: s.id,
      label: formatShiftRange(s.startUtc, s.endUtc, s.location.timezone),
      locationId: s.location.id,
      locationName: s.location.name,
      skill: s.requiredSkill.name,
      startUtc: s.startUtc,
      needed: s.headcount - s._count.assignments,
      headcount: s.headcount,
      filled: s._count.assignments,
      isPremium: s.isPremium,
      status: s.status,
    }));
}
