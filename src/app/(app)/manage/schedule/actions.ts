'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import {
  AuthorizationError,
  requireManageLocation,
  requireViewer,
} from '@/lib/auth/session';
import {
  SchedulingError,
  assignStaffToShift,
  previewAssignment,
  suggestCandidates,
  unassignStaff,
  type SuggestionDto,
} from '@/lib/services/assignments';
import {
  cancelShift,
  createShift,
  publishWeek,
  shiftInputSchema,
  unpublishWeek,
  updateShift,
} from '@/lib/services/shifts';
import { publish } from '@/lib/realtime/publish';
import type { EvaluationResult, Violation } from '@/lib/scheduling/constraints';
import { wallClockToInstant, toDate } from '@/lib/time/zones';
import { shiftHistory, type ShiftHistoryEntry } from '@/lib/queries/schedule';

export interface ActionError {
  ok: false;
  kind: 'error' | 'blocked' | 'needs-override' | 'conflict';
  message: string;
  violations?: Violation[];
  suggestions?: SuggestionDto[];
}

export interface ActionOk<T = undefined> {
  ok: true;
  data?: T;
  warnings?: Violation[];
}

export type ActionResult<T = undefined> = ActionOk<T> | ActionError;

function fail(
  message: string,
  kind: ActionError['kind'] = 'error',
  extra: Partial<ActionError> = {},
): ActionError {
  return { ok: false, kind, message, ...extra };
}

function toActionError(error: unknown): ActionError {
  if (error instanceof SchedulingError) {
    return fail(
      error.message,
      error.code === 'CONFLICT'
        ? 'conflict'
        : error.code === 'NEEDS_OVERRIDE'
          ? 'needs-override'
          : error.code === 'BLOCKED'
            ? 'blocked'
            : 'error',
    );
  }
  if (error instanceof AuthorizationError) return fail(error.message);
  if (error instanceof z.ZodError) {
    return fail(error.issues[0]?.message ?? 'That input is not valid.');
  }
  console.error('[schedule action]', error);
  return fail('Something went wrong. Please try again.');
}

function revalidateSchedule() {
  revalidatePath('/manage/schedule');
  revalidatePath('/schedule');
  revalidatePath('/dashboard');
  revalidatePath('/manage/overtime');
}

const wallClockShiftSchema = z.object({
  locationId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date.'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter a start time.'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Enter an end time.'),
  requiredSkillId: z.string().min(1, 'Choose a required skill.'),
  headcount: z.coerce.number().int().min(1).max(20),
  notes: z.string().max(500).optional().nullable(),
});

async function toInstants(input: z.infer<typeof wallClockShiftSchema>) {
  const location = await db.location.findUnique({
    where: { id: input.locationId },
    select: { timezone: true },
  });
  if (!location) throw new SchedulingError('Location not found.', 'NOT_FOUND');

  const startUtc = toDate(
    wallClockToInstant(input.date, input.startTime, location.timezone),
  );
  const crossesMidnight = input.endTime <= input.startTime;
  const endDate = crossesMidnight
    ? new Date(`${input.date}T00:00:00Z`)
    : null;
  const endDateString = crossesMidnight
    ? new Date(endDate!.getTime() + 86_400_000).toISOString().slice(0, 10)
    : input.date;
  const endUtc = toDate(
    wallClockToInstant(endDateString, input.endTime, location.timezone),
  );

  return { startUtc, endUtc };
}

export async function createShiftAction(
  raw: unknown,
): Promise<ActionResult<{ shiftId: string }>> {
  try {
    const input = wallClockShiftSchema.parse(raw);
    const viewer = await requireManageLocation(input.locationId);
    const { startUtc, endUtc } = await toInstants(input);

    const parsed = shiftInputSchema.parse({
      locationId: input.locationId,
      startUtc,
      endUtc,
      requiredSkillId: input.requiredSkillId,
      headcount: input.headcount,
      notes: input.notes,
    });

    const shift = await createShift(parsed, viewer);
    revalidateSchedule();
    return { ok: true, data: { shiftId: shift.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function updateShiftAction(
  raw: unknown,
): Promise<ActionResult<{ shiftId: string }>> {
  try {
    const input = wallClockShiftSchema
      .extend({
        shiftId: z.string().min(1),
        expectedVersion: z.coerce.number().int().optional(),
      })
      .parse(raw);
    const viewer = await requireManageLocation(input.locationId);
    const { startUtc, endUtc } = await toInstants(input);

    const parsed = shiftInputSchema.parse({
      locationId: input.locationId,
      startUtc,
      endUtc,
      requiredSkillId: input.requiredSkillId,
      headcount: input.headcount,
      notes: input.notes,
    });

    const shift = await updateShift(
      {
        ...parsed,
        shiftId: input.shiftId,
        expectedVersion: input.expectedVersion,
      },
      viewer,
    );
    revalidateSchedule();
    return { ok: true, data: { shiftId: shift.id } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function cancelShiftAction(
  shiftId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { locationId: true },
    });
    if (!shift) return fail('That shift no longer exists.');
    const viewer = await requireManageLocation(shift.locationId);
    await cancelShift(shiftId, viewer, reason);
    revalidateSchedule();
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export interface PreviewDto {
  evaluation: EvaluationResult;
}

export async function previewAssignmentAction(
  shiftId: string,
  userId: string,
): Promise<ActionResult<PreviewDto>> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { locationId: true },
    });
    if (!shift) return fail('That shift no longer exists.');
    await requireManageLocation(shift.locationId);

    const { evaluation } = await previewAssignment(shiftId, userId);
    return { ok: true, data: { evaluation } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function assignAction(input: {
  shiftId: string;
  userId: string;
  overrideReason?: string;
}): Promise<ActionResult<{ assignmentId: string }>> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: input.shiftId },
      select: { locationId: true },
    });
    if (!shift) return fail('That shift no longer exists.');
    const viewer = await requireManageLocation(shift.locationId);

    const outcome = await assignStaffToShift({
      shiftId: input.shiftId,
      userId: input.userId,
      actor: viewer,
      overrideReason: input.overrideReason,
    });

    if (outcome.status === 'BLOCKED') {
      const conflict = outcome.evaluation.blocking.find(
        (v) => v.code === 'DOUBLE_BOOKING' || v.code === 'SHIFT_FULL',
      );
      if (conflict) {
        await publish({
          type: 'assignment.conflict',
          audience: { userIds: [viewer.id] },
          message: conflict.message,
          payload: { shiftId: input.shiftId, userId: input.userId },
          actorId: viewer.id,
        });
      }
      return fail(
        outcome.evaluation.blocking[0]?.message ??
          'That assignment breaks a scheduling rule.',
        'blocked',
        {
          violations: outcome.evaluation.blocking,
          suggestions: outcome.suggestions,
        },
      );
    }

    if (outcome.status === 'NEEDS_OVERRIDE') {
      return fail(
        outcome.evaluation.overridable[0]?.message ??
          'This assignment needs a documented reason.',
        'needs-override',
        { violations: outcome.evaluation.overridable },
      );
    }

    revalidateSchedule();
    return {
      ok: true,
      data: { assignmentId: outcome.assignmentId! },
      warnings: outcome.evaluation.warnings,
    };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unassignAction(
  assignmentId: string,
  reason?: string,
): Promise<ActionResult> {
  try {
    const assignment = await db.assignment.findUnique({
      where: { id: assignmentId },
      select: { shift: { select: { locationId: true } } },
    });
    if (!assignment) return fail('That assignment no longer exists.');
    const viewer = await requireManageLocation(assignment.shift.locationId);
    await unassignStaff({ assignmentId, actor: viewer, reason });
    revalidateSchedule();
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}

export async function suggestAction(
  shiftId: string,
): Promise<ActionResult<{ suggestions: SuggestionDto[] }>> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { locationId: true },
    });
    if (!shift) return fail('That shift no longer exists.');
    await requireManageLocation(shift.locationId);
    const suggestions = await suggestCandidates(shiftId, { limit: 6 });
    return { ok: true, data: { suggestions } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function publishWeekAction(
  locationId: string,
  weekKey: string,
): Promise<ActionResult<{ count: number }>> {
  try {
    const viewer = await requireManageLocation(locationId);
    const count = await publishWeek(locationId, weekKey, viewer);
    revalidateSchedule();
    return { ok: true, data: { count } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function unpublishWeekAction(
  locationId: string,
  weekKey: string,
): Promise<ActionResult<{ unpublished: number; locked: number }>> {
  try {
    const viewer = await requireManageLocation(locationId);
    const result = await unpublishWeek(locationId, weekKey, viewer);
    revalidateSchedule();
    return { ok: true, data: result };
  } catch (error) {
    return toActionError(error);
  }
}

export async function eligibleStaffAction(shiftId: string): Promise<
  ActionResult<{
    staff: { id: string; name: string; certified: boolean; skilled: boolean }[];
  }>
> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { locationId: true, requiredSkillId: true },
    });
    if (!shift) return fail('That shift no longer exists.');
    await requireManageLocation(shift.locationId);

    const staff = await db.user.findMany({
      where: { role: 'STAFF', isActive: true },
      select: {
        id: true,
        name: true,
        skills: { where: { revokedAt: null }, select: { skillId: true } },
        certifications: {
          where: { revokedAt: null },
          select: { locationId: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return {
      ok: true,
      data: {
        staff: staff
          .map((s) => ({
            id: s.id,
            name: s.name,
            certified: s.certifications.some(
              (c) => c.locationId === shift.locationId,
            ),
            skilled: s.skills.some((k) => k.skillId === shift.requiredSkillId),
          }))
          .sort((a, b) => {
            const rank = (x: typeof a) =>
              x.certified && x.skilled ? 0 : x.certified ? 1 : 2;
            return rank(a) - rank(b) || a.name.localeCompare(b.name);
          }),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

export type { ShiftHistoryEntry };

export async function shiftHistoryAction(
  shiftId: string,
): Promise<ActionResult<{ entries: ShiftHistoryEntry[] }>> {
  try {
    const shift = await db.shift.findUnique({
      where: { id: shiftId },
      select: { locationId: true },
    });
    if (!shift) return fail('That shift no longer exists.');

    const viewer = await requireViewer();
    if (
      viewer.role !== 'ADMIN' &&
      !viewer.managedLocationIds.includes(shift.locationId)
    ) {
      return fail('You can only view history for locations you manage.');
    }

    return { ok: true, data: { entries: await shiftHistory(shiftId) } };
  } catch (error) {
    return toActionError(error);
  }
}

export async function clockAction(
  assignmentId: string,
  direction: 'in' | 'out',
): Promise<ActionResult> {
  try {
    const viewer = await requireViewer();
    const assignment = await db.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        userId: true,
        clockInAt: true,
        clockOutAt: true,
        shift: { select: { locationId: true, location: { select: { name: true } } } },
      },
    });
    if (!assignment) return fail('That assignment no longer exists.');

    const isSelf = assignment.userId === viewer.id;
    const isManager =
      viewer.role === 'ADMIN' ||
      viewer.managedLocationIds.includes(assignment.shift.locationId);
    if (!isSelf && !isManager) {
      return fail('You can only clock yourself in and out.');
    }

    if (direction === 'in' && assignment.clockInAt) {
      return fail('Already clocked in.');
    }
    if (direction === 'out' && !assignment.clockInAt) {
      return fail('Clock in first.');
    }

    await db.assignment.update({
      where: { id: assignmentId },
      data:
        direction === 'in'
          ? { clockInAt: new Date(), clockOutAt: null }
          : { clockOutAt: new Date() },
    });

    await db.auditLog.create({
      data: {
        action: direction === 'in' ? 'CLOCK_IN' : 'CLOCK_OUT',
        actorId: viewer.id,
        actorLabel: `${viewer.name} (${viewer.role})`,
        entityType: 'Assignment',
        entityId: assignmentId,
        locationId: assignment.shift.locationId,
        summary: `${viewer.name} clocked ${direction} at ${assignment.shift.location.name}`,
      },
    });

    await publish({
      type: 'duty.changed',
      audience: { locationIds: [assignment.shift.locationId] },
      payload: { assignmentId, direction },
      actorId: viewer.id,
    });

    revalidatePath('/on-duty');
    revalidatePath('/dashboard');
    revalidatePath('/schedule');
    return { ok: true };
  } catch (error) {
    return toActionError(error);
  }
}
