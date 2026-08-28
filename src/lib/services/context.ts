import { db } from '@/lib/db';
import { resolveAvailability } from '@/lib/scheduling/availability';
import type {
  CandidateContext,
  CandidateStaff,
  ExistingAssignment,
  TargetShift,
} from '@/lib/scheduling/constraints';
import type { DbClient } from './audit';

const CONTEXT_WINDOW_DAYS = 10;
const DAY_MS = 86_400_000;

export const staffSelect = {
  id: true,
  name: true,
  email: true,
  isActive: true,
  timezone: true,
  staffProfile: {
    select: {
      desiredWeeklyHours: true,
      maxWeeklyHours: true,
      baseHourlyRate: true,
      overtimeMultiplier: true,
    },
  },
  skills: {
    where: { revokedAt: null },
    select: { skillId: true },
  },
  certifications: {
    where: { revokedAt: null },
    select: { locationId: true },
  },
} as const;

type StaffRow = {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  timezone: string;
  staffProfile: {
    desiredWeeklyHours: number;
    maxWeeklyHours: number;
    baseHourlyRate: unknown;
    overtimeMultiplier: unknown;
  } | null;
  skills: { skillId: string }[];
  certifications: { locationId: string }[];
};

function toNumber(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toCandidateStaff(row: StaffRow): CandidateStaff {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    isActive: row.isActive,
    timezone: row.timezone,
    skillIds: row.skills.map((s) => s.skillId),
    certifiedLocationIds: row.certifications.map((c) => c.locationId),
    desiredWeeklyHours: row.staffProfile?.desiredWeeklyHours ?? 30,
    maxWeeklyHours: row.staffProfile?.maxWeeklyHours ?? 40,
    baseHourlyRate: toNumber(row.staffProfile?.baseHourlyRate, 18),
    overtimeMultiplier: toNumber(row.staffProfile?.overtimeMultiplier, 1.5),
  };
}

export async function loadCandidateContexts(
  target: Pick<TargetShift, 'startUtc' | 'endUtc' | 'locationTimeZone'>,
  userIds: string[],
  options: { client?: DbClient; excludeAssignmentIds?: string[] } = {},
): Promise<Map<string, CandidateContext>> {
  const client = options.client ?? db;
  if (userIds.length === 0) return new Map();

  const windowStart = new Date(
    target.startUtc.getTime() - CONTEXT_WINDOW_DAYS * DAY_MS,
  );
  const windowEnd = new Date(
    target.endUtc.getTime() + CONTEXT_WINDOW_DAYS * DAY_MS,
  );

  const [staffRows, assignmentRows, rules, exceptions] = await Promise.all([
    client.user.findMany({
      where: { id: { in: userIds } },
      select: staffSelect,
    }),
    client.assignment.findMany({
      where: {
        userId: { in: userIds },
        status: 'ASSIGNED',
        shift: {
          status: { not: 'CANCELLED' },
          startUtc: { lt: windowEnd },
          endUtc: { gt: windowStart },
        },
      },
      select: {
        id: true,
        userId: true,
        shift: {
          select: {
            id: true,
            startUtc: true,
            endUtc: true,
            locationId: true,
            location: { select: { name: true, timezone: true } },
          },
        },
      },
    }),
    client.availabilityRule.findMany({
      where: { userId: { in: userIds } },
      select: {
        id: true,
        userId: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        spansMidnight: true,
        timezone: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
    client.availabilityException.findMany({
      where: {
        userId: { in: userIds },
        date: {
          gte: new Date(target.startUtc.getTime() - 2 * DAY_MS),
          lte: new Date(target.endUtc.getTime() + 2 * DAY_MS),
        },
      },
      select: {
        id: true,
        userId: true,
        type: true,
        date: true,
        startTime: true,
        endTime: true,
        spansMidnight: true,
        timezone: true,
        reason: true,
      },
    }),
  ]);

  const assignmentsByUser = new Map<string, ExistingAssignment[]>();
  for (const row of assignmentRows) {
    const list = assignmentsByUser.get(row.userId) ?? [];
    list.push({
      assignmentId: row.id,
      shiftId: row.shift.id,
      locationId: row.shift.locationId,
      locationName: row.shift.location.name,
      locationTimeZone: row.shift.location.timezone,
      startUtc: row.shift.startUtc,
      endUtc: row.shift.endUtc,
    });
    assignmentsByUser.set(row.userId, list);
  }

  const rulesByUser = new Map<string, typeof rules>();
  for (const rule of rules) {
    const list = rulesByUser.get(rule.userId) ?? [];
    list.push(rule);
    rulesByUser.set(rule.userId, list);
  }

  const exceptionsByUser = new Map<string, typeof exceptions>();
  for (const exception of exceptions) {
    const list = exceptionsByUser.get(exception.userId) ?? [];
    list.push(exception);
    exceptionsByUser.set(exception.userId, list);
  }

  const contexts = new Map<string, CandidateContext>();

  for (const row of staffRows) {
    const availability = resolveAvailability(
      rulesByUser.get(row.id) ?? [],
      exceptionsByUser.get(row.id) ?? [],
      {
        from: new Date(target.startUtc.getTime() - DAY_MS),
        to: new Date(target.endUtc.getTime() + DAY_MS),
        evaluationZone: target.locationTimeZone,
      },
    );

    contexts.set(row.id, {
      staff: toCandidateStaff(row as StaffRow),
      availability,
      existingAssignments: assignmentsByUser.get(row.id) ?? [],
      excludeAssignmentIds: options.excludeAssignmentIds,
    });
  }

  return contexts;
}

export async function loadCandidateContext(
  target: Pick<TargetShift, 'startUtc' | 'endUtc' | 'locationTimeZone'>,
  userId: string,
  options: { client?: DbClient; excludeAssignmentIds?: string[] } = {},
): Promise<CandidateContext | null> {
  const contexts = await loadCandidateContexts(target, [userId], options);
  return contexts.get(userId) ?? null;
}

export async function loadTargetShift(
  shiftId: string,
  client: DbClient = db,
): Promise<TargetShift | null> {
  const shift = await client.shift.findUnique({
    where: { id: shiftId },
    select: {
      id: true,
      locationId: true,
      startUtc: true,
      endUtc: true,
      requiredSkillId: true,
      headcount: true,
      location: { select: { name: true, timezone: true } },
      requiredSkill: { select: { name: true } },
      _count: { select: { assignments: { where: { status: 'ASSIGNED' } } } },
    },
  });
  if (!shift) return null;

  return {
    id: shift.id,
    locationId: shift.locationId,
    locationName: shift.location.name,
    locationTimeZone: shift.location.timezone,
    startUtc: shift.startUtc,
    endUtc: shift.endUtc,
    requiredSkillId: shift.requiredSkillId,
    requiredSkillName: shift.requiredSkill.name,
    headcount: shift.headcount,
    assignedCount: shift._count.assignments,
  };
}
