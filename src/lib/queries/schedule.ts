import { db } from '@/lib/db';
import {
  Temporal,
  formatShiftRange,
  formatTime,
  hoursBetween,
  isOvernight,
  localDate,
  weekBoundsUtc,
  weekKeyToMonday,
  zoneAbbreviation,
} from '@/lib/time/zones';
import {
  evaluateAssignment,
  type Violation,
} from '@/lib/scheduling/constraints';
import { loadCandidateContexts } from '@/lib/services/context';
import { isWithinEditCutoff } from '@/lib/services/shifts';

export interface AssignmentDto {
  id: string;
  userId: string;
  userName: string;
  clockedIn: boolean;
  clockedOut: boolean;
  coverage: { id: string; type: 'SWAP' | 'DROP'; status: string } | null;
}

export interface ShiftDto {
  id: string;
  locationId: string;
  locationName: string;
  timeZone: string;
  dayKey: string;
  startIso: string;
  endIso: string;
  startLabel: string;
  endLabel: string;
  rangeLabel: string;
  zoneLabel: string;
  startTime: string;
  endTime: string;
  dateValue: string;
  hours: number;
  skillId: string;
  skillName: string;
  skillColour: string;
  headcount: number;
  assigned: AssignmentDto[];
  status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED';
  isPremium: boolean;
  isOvernight: boolean;
  notes: string | null;
  version: number;
  editable: boolean;
  editCutoffHours: number;
}

export interface DayColumn {
  key: string;
  weekday: string;
  dayLabel: string;
  isToday: boolean;
  shifts: ShiftDto[];
}

export interface WeekBoard {
  weekKey: string;
  locationId: string;
  locationName: string;
  timeZone: string;
  timezoneNote: string | null;
  rangeLabel: string;
  days: DayColumn[];
  draftCount: number;
  publishedCount: number;
  openSlots: number;
  totalHours: number;
  publication: { publishedAt: string; publishedBy: string } | null;
  prevWeek: string;
  nextWeek: string;
}

function shiftWallClock(
  startUtc: Date,
  endUtc: Date,
  timeZone: string,
): { date: string; start: string; end: string } {
  const start = localDate(startUtc, timeZone);
  const startZdt = Temporal.Instant.fromEpochMilliseconds(
    startUtc.getTime(),
  ).toZonedDateTimeISO(timeZone);
  const endZdt = Temporal.Instant.fromEpochMilliseconds(
    endUtc.getTime(),
  ).toZonedDateTimeISO(timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: start.toString(),
    start: `${pad(startZdt.hour)}:${pad(startZdt.minute)}`,
    end: `${pad(endZdt.hour)}:${pad(endZdt.minute)}`,
  };
}

function shiftKeyOffset(weekKeyValue: string, weeks: number): string {
  const monday = weekKeyToMonday(weekKeyValue).add({ weeks });
  const thursday = monday.add({ days: 3 });
  const jan1 = new Temporal.PlainDate(thursday.year, 1, 1);
  const dayOfYear = thursday.since(jan1).days + 1;
  const week = Math.floor((dayOfYear - 1) / 7) + 1;
  return `${thursday.year}-W${String(week).padStart(2, '0')}`;
}

export async function getWeekBoard(
  locationId: string,
  weekKeyValue: string,
): Promise<WeekBoard | null> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: {
      id: true,
      name: true,
      timezone: true,
      timezoneNote: true,
      editCutoffHours: true,
    },
  });
  if (!location) return null;

  const { start, end } = weekBoundsUtc(weekKeyValue, location.timezone);

  const [shifts, publication] = await Promise.all([
    db.shift.findMany({
      where: {
        locationId,
        startUtc: { gte: start, lt: end },
        status: { not: 'CANCELLED' },
      },
      orderBy: { startUtc: 'asc' },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        headcount: true,
        status: true,
        isPremium: true,
        notes: true,
        version: true,
        locationId: true,
        requiredSkill: { select: { id: true, name: true, colour: true } },
        assignments: {
          where: { status: 'ASSIGNED' },
          select: {
            id: true,
            userId: true,
            clockInAt: true,
            clockOutAt: true,
            user: { select: { name: true } },
          },
          orderBy: { assignedAt: 'asc' },
        },
        coverageRequests: {
          where: { status: { in: ['OPEN', 'PENDING_MANAGER'] } },
          select: {
            id: true,
            type: true,
            status: true,
            requesterAssignmentId: true,
          },
        },
      },
    }),
    db.schedulePublication.findFirst({
      where: { locationId, weekKey: weekKeyValue, unpublishedAt: null },
      select: {
        publishedAt: true,
        publishedBy: { select: { name: true } },
      },
    }),
  ]);

  const now = new Date();
  const monday = weekKeyToMonday(weekKeyValue);
  const todayKey = localDate(now, location.timezone).toString();

  const days: DayColumn[] = Array.from({ length: 7 }, (_, i) => {
    const date = monday.add({ days: i });
    const key = date.toString();
    return {
      key,
      weekday: date.toLocaleString('en-US', { weekday: 'short' }),
      dayLabel: date.toLocaleString('en-US', { month: 'short', day: 'numeric' }),
      isToday: key === todayKey,
      shifts: [],
    };
  });
  const dayIndex = new Map(days.map((d) => [d.key, d]));

  let totalHours = 0;
  let openSlots = 0;
  let draftCount = 0;
  let publishedCount = 0;

  for (const shift of shifts) {
    const wall = shiftWallClock(shift.startUtc, shift.endUtc, location.timezone);
    const hours = hoursBetween(shift.startUtc, shift.endUtc);
    const coverageByAssignment = new Map(
      shift.coverageRequests.map((c) => [c.requesterAssignmentId, c]),
    );

    const dto: ShiftDto = {
      id: shift.id,
      locationId: shift.locationId,
      locationName: location.name,
      timeZone: location.timezone,
      dayKey: wall.date,
      startIso: shift.startUtc.toISOString(),
      endIso: shift.endUtc.toISOString(),
      startLabel: formatTime(shift.startUtc, location.timezone),
      endLabel: formatTime(shift.endUtc, location.timezone),
      rangeLabel: formatShiftRange(
        shift.startUtc,
        shift.endUtc,
        location.timezone,
      ),
      zoneLabel: zoneAbbreviation(shift.startUtc, location.timezone),
      startTime: wall.start,
      endTime: wall.end,
      dateValue: wall.date,
      hours,
      skillId: shift.requiredSkill.id,
      skillName: shift.requiredSkill.name,
      skillColour: shift.requiredSkill.colour,
      headcount: shift.headcount,
      assigned: shift.assignments.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user.name,
        clockedIn: a.clockInAt !== null && a.clockOutAt === null,
        clockedOut: a.clockOutAt !== null,
        coverage: coverageByAssignment.get(a.id)
          ? {
              id: coverageByAssignment.get(a.id)!.id,
              type: coverageByAssignment.get(a.id)!.type,
              status: coverageByAssignment.get(a.id)!.status,
            }
          : null,
      })),
      status: shift.status,
      isPremium: shift.isPremium,
      isOvernight: isOvernight(shift.startUtc, shift.endUtc, location.timezone),
      notes: shift.notes,
      version: shift.version,
      editable:
        shift.status !== 'PUBLISHED' ||
        isWithinEditCutoff(shift.startUtc, location.editCutoffHours, now),
      editCutoffHours: location.editCutoffHours,
    };

    totalHours += hours * shift.assignments.length;
    openSlots += Math.max(0, shift.headcount - shift.assignments.length);
    if (shift.status === 'DRAFT') draftCount += 1;
    if (shift.status === 'PUBLISHED') publishedCount += 1;

    dayIndex.get(wall.date)?.shifts.push(dto);
  }

  const sunday = monday.add({ days: 6 });

  return {
    weekKey: weekKeyValue,
    locationId: location.id,
    locationName: location.name,
    timeZone: location.timezone,
    timezoneNote: location.timezoneNote,
    rangeLabel: `${monday.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
    })} – ${sunday.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`,
    days,
    draftCount,
    publishedCount,
    openSlots,
    totalHours: Math.round(totalHours * 10) / 10,
    publication: publication
      ? {
          publishedAt: publication.publishedAt.toISOString(),
          publishedBy: publication.publishedBy.name,
        }
      : null,
    prevWeek: shiftKeyOffset(weekKeyValue, -1),
    nextWeek: shiftKeyOffset(weekKeyValue, 1),
  };
}

export interface ShiftHistoryEntry {
  id: string;
  action: string;
  actorLabel: string;
  summary: string;
  createdAt: string;
  before: unknown;
  after: unknown;
}

export async function shiftHistory(
  shiftId: string,
  limit = 60,
): Promise<ShiftHistoryEntry[]> {
  const shift = await db.shift.findUnique({
    where: { id: shiftId },
    select: {
      assignments: { select: { id: true } },
      coverageRequests: { select: { id: true } },
    },
  });
  if (!shift) return [];

  const relatedIds = [
    shiftId,
    ...shift.assignments.map((a) => a.id),
    ...shift.coverageRequests.map((c) => c.id),
  ];

  const entries = await db.auditLog.findMany({
    where: { entityId: { in: relatedIds } },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      action: true,
      actorLabel: true,
      summary: true,
      createdAt: true,
      before: true,
      after: true,
    },
  });

  return entries.map((e) => ({
    id: e.id,
    action: e.action,
    actorLabel: e.actorLabel,
    summary: e.summary,
    createdAt: e.createdAt.toISOString(),
    before: e.before,
    after: e.after,
  }));
}

export interface ComplianceIssue {
  shiftId: string;
  shiftLabel: string;
  userId: string;
  userName: string;
  violation: Violation;
}

export async function complianceIssues(
  locationId: string,
  weekKeyValue: string,
): Promise<ComplianceIssue[]> {
  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { timezone: true },
  });
  if (!location) return [];

  const { start, end } = weekBoundsUtc(weekKeyValue, location.timezone);

  const shifts = await db.shift.findMany({
    where: {
      locationId,
      startUtc: { gte: start, lt: end },
      status: { not: 'CANCELLED' },
      assignments: { some: { status: 'ASSIGNED' } },
    },
    select: {
      id: true,
      startUtc: true,
      endUtc: true,
      headcount: true,
      locationId: true,
      requiredSkillId: true,
      location: { select: { name: true, timezone: true } },
      requiredSkill: { select: { name: true } },
      assignments: {
        where: { status: 'ASSIGNED' },
        select: { id: true, userId: true },
      },
    },
    orderBy: { startUtc: 'asc' },
  });

  const issues: ComplianceIssue[] = [];

  for (const shift of shifts) {
    const target = {
      id: shift.id,
      locationId: shift.locationId,
      locationName: shift.location.name,
      locationTimeZone: shift.location.timezone,
      startUtc: shift.startUtc,
      endUtc: shift.endUtc,
      requiredSkillId: shift.requiredSkillId,
      requiredSkillName: shift.requiredSkill.name,
      headcount: shift.headcount,
      assignedCount: shift.assignments.length,
    };

    const userIds = shift.assignments.map((a) => a.userId);
    const contexts = await loadCandidateContexts(target, userIds);

    for (const assignment of shift.assignments) {
      const context = contexts.get(assignment.userId);
      if (!context) continue;

      const evaluation = evaluateAssignment(
        target,
        { ...context, excludeAssignmentIds: [assignment.id] },
        { ignoreHeadcount: true },
      );

      for (const violation of [
        ...evaluation.blocking,
        ...evaluation.overridable,
      ]) {
        issues.push({
          shiftId: shift.id,
          shiftLabel: formatShiftRange(
            shift.startUtc,
            shift.endUtc,
            shift.location.timezone,
          ),
          userId: assignment.userId,
          userName: context.staff.name,
          violation,
        });
      }
    }
  }

  return issues;
}
