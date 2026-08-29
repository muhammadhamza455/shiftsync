import { z } from 'zod';
import { db, acquireAdvisoryLock, LOCK_NAMESPACE } from '@/lib/db';
import {
  formatShiftRange,
  hoursBetween,
  isPremiumShift,
  weekKey,
} from '@/lib/time/zones';
import { publish } from '@/lib/realtime/publish';
import {
  createNotifications,
  pushNotifications,
  type NotifyInput,
} from './notifications';
import { recordAudit, shiftSnapshot } from './audit';
import { SchedulingError } from './assignments';
import type { Viewer } from '@/lib/auth/session';

const MAX_SHIFT_HOURS = 16;

export const shiftInputSchema = z
  .object({
    locationId: z.string().min(1),
    startUtc: z.coerce.date(),
    endUtc: z.coerce.date(),
    requiredSkillId: z.string().min(1),
    headcount: z.number().int().min(1).max(20),
    notes: z.string().max(500).optional().nullable(),
  })
  .refine((v) => v.endUtc.getTime() > v.startUtc.getTime(), {
    message: 'The shift must end after it starts.',
    path: ['endUtc'],
  })
  .refine((v) => hoursBetween(v.startUtc, v.endUtc) <= MAX_SHIFT_HOURS, {
    message: `A single shift cannot be longer than ${MAX_SHIFT_HOURS} hours.`,
    path: ['endUtc'],
  });

export type ShiftInput = z.infer<typeof shiftInputSchema>;

export function isWithinEditCutoff(
  startUtc: Date,
  editCutoffHours: number,
  now: Date = new Date(),
): boolean {
  return hoursBetween(now, startUtc) >= editCutoffHours;
}

export function cutoffMessage(
  startUtc: Date,
  editCutoffHours: number,
  timeZone: string,
  now: Date = new Date(),
): string {
  const remaining = hoursBetween(now, startUtc);
  if (remaining < 0) {
    return 'This shift has already started and can no longer be edited.';
  }
  return (
    `Published shifts lock ${editCutoffHours}h before they start. ` +
    `This one begins ${formatShiftRange(startUtc, startUtc, timeZone)}, ` +
    `in ${Math.floor(remaining)}h. Unpublish the week first if the change is unavoidable.`
  );
}

export async function createShift(input: ShiftInput, actor: Viewer) {
  const location = await db.location.findUnique({
    where: { id: input.locationId },
    select: { id: true, name: true, timezone: true },
  });
  if (!location) throw new SchedulingError('Location not found.', 'NOT_FOUND');

  const shift = await db.$transaction(async (tx) => {
    const created = await tx.shift.create({
      data: {
        locationId: input.locationId,
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        requiredSkillId: input.requiredSkillId,
        headcount: input.headcount,
        notes: input.notes ?? null,
        status: 'DRAFT',
        isPremium: isPremiumShift(input.startUtc, location.timezone),
        weekKey: weekKey(input.startUtc, location.timezone),
        createdById: actor.id,
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        headcount: true,
        requiredSkillId: true,
        status: true,
        notes: true,
        locationId: true,
        version: true,
        weekKey: true,
      },
    });

    await recordAudit(tx, {
      action: 'SHIFT_CREATED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Shift',
      entityId: created.id,
      locationId: location.id,
      summary: `Created ${formatShiftRange(
        created.startUtc,
        created.endUtc,
        location.timezone,
      )} at ${location.name}`,
      after: shiftSnapshot(created),
    });

    return created;
  });

  await publish({
    type: 'shift.created',
    audience: { locationIds: [location.id] },
    payload: { shiftId: shift.id, weekKey: shift.weekKey },
    actorId: actor.id,
  });

  return shift;
}

export interface UpdateShiftInput extends ShiftInput {
  shiftId: string;
  expectedVersion?: number;
}

export async function updateShift(input: UpdateShiftInput, actor: Viewer) {
  const result = await db.$transaction(async (tx) => {
    await acquireAdvisoryLock(
      tx,
      LOCK_NAMESPACE.STAFF_ASSIGNMENT,
      `shift:${input.shiftId}`,
    );

    const existing = await tx.shift.findUnique({
      where: { id: input.shiftId },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        headcount: true,
        requiredSkillId: true,
        status: true,
        notes: true,
        locationId: true,
        version: true,
        location: {
          select: { name: true, timezone: true, editCutoffHours: true },
        },
        assignments: {
          where: { status: 'ASSIGNED' },
          select: { id: true, userId: true },
        },
      },
    });
    if (!existing) throw new SchedulingError('Shift not found.', 'NOT_FOUND');

    if (
      input.expectedVersion !== undefined &&
      input.expectedVersion !== existing.version
    ) {
      throw new SchedulingError(
        'Someone else changed this shift while you were editing. Reload to see the current version.',
        'CONFLICT',
      );
    }

    if (
      existing.status === 'PUBLISHED' &&
      !isWithinEditCutoff(existing.startUtc, existing.location.editCutoffHours)
    ) {
      throw new SchedulingError(
        cutoffMessage(
          existing.startUtc,
          existing.location.editCutoffHours,
          existing.location.timezone,
        ),
        'FORBIDDEN',
      );
    }

    const timingChanged =
      existing.startUtc.getTime() !== input.startUtc.getTime() ||
      existing.endUtc.getTime() !== input.endUtc.getTime();
    const skillChanged = existing.requiredSkillId !== input.requiredSkillId;

    const updated = await tx.shift.update({
      where: { id: input.shiftId },
      data: {
        startUtc: input.startUtc,
        endUtc: input.endUtc,
        requiredSkillId: input.requiredSkillId,
        headcount: input.headcount,
        notes: input.notes ?? null,
        isPremium: isPremiumShift(input.startUtc, existing.location.timezone),
        weekKey: weekKey(input.startUtc, existing.location.timezone),
        version: { increment: 1 },
      },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        headcount: true,
        requiredSkillId: true,
        status: true,
        notes: true,
        locationId: true,
        version: true,
        weekKey: true,
      },
    });

    const pending = await tx.coverageRequest.findMany({
      where: { shiftId: input.shiftId, status: { in: ['OPEN', 'PENDING_MANAGER'] } },
      select: {
        id: true,
        type: true,
        requesterId: true,
        targetId: true,
        claimedById: true,
      },
    });

    if (pending.length > 0) {
      await tx.coverageRequest.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: {
          status: 'AUTO_CANCELLED',
          decidedAt: new Date(),
          decidedById: actor.id,
          decisionNote:
            'The shift was edited after this request was raised, so the terms no longer match.',
        },
      });
    }

    const label = formatShiftRange(
      updated.startUtc,
      updated.endUtc,
      existing.location.timezone,
    );

    await recordAudit(tx, {
      action: 'SHIFT_UPDATED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Shift',
      entityId: updated.id,
      locationId: existing.locationId,
      summary: `Edited shift at ${existing.location.name} — now ${label}${
        pending.length
          ? ` (auto-cancelled ${pending.length} pending coverage request${
              pending.length === 1 ? '' : 's'
            })`
          : ''
      }`,
      before: shiftSnapshot({ ...existing, locationId: existing.locationId }),
      after: shiftSnapshot(updated),
    });

    const notifications: NotifyInput[] = [];

    if (existing.status === 'PUBLISHED' && (timingChanged || skillChanged)) {
      for (const assignment of existing.assignments) {
        notifications.push({
          userId: assignment.userId,
          type: 'SHIFT_CHANGED',
          title: 'A shift you are on has changed',
          body: `${existing.location.name} — now ${label}.`,
          href: `/schedule?shift=${updated.id}`,
          data: { shiftId: updated.id },
        });
      }
    }

    for (const request of pending) {
      for (const affected of [
        request.requesterId,
        request.targetId,
        request.claimedById,
      ]) {
        if (!affected) continue;
        notifications.push({
          userId: affected,
          type: 'SWAP_CANCELLED',
          title: `${request.type === 'SWAP' ? 'Swap' : 'Drop'} request cancelled`,
          body: `The manager edited the ${existing.location.name} shift, so your request was cancelled. The shift is now ${label} — you can raise a new request if you still need cover.`,
          href: '/swaps',
          data: { coverageRequestId: request.id, shiftId: updated.id },
        });
      }
    }

    const created = await createNotifications(tx, notifications);

    return {
      shift: updated,
      created,
      locationId: existing.locationId,
      locationName: existing.location.name,
      cancelledCoverage: pending.length,
      label,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'shift.updated',
    audience: { locationIds: [result.locationId] },
    message: `Shift at ${result.locationName} changed to ${result.label}`,
    payload: {
      shiftId: result.shift.id,
      weekKey: result.shift.weekKey,
      version: result.shift.version,
      cancelledCoverage: result.cancelledCoverage,
    },
    actorId: actor.id,
  });

  return result.shift;
}

export async function cancelShift(
  shiftId: string,
  actor: Viewer,
  reason?: string,
) {
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.shift.findUnique({
      where: { id: shiftId },
      select: {
        id: true,
        startUtc: true,
        endUtc: true,
        status: true,
        headcount: true,
        requiredSkillId: true,
        notes: true,
        locationId: true,
        version: true,
        location: {
          select: { name: true, timezone: true, editCutoffHours: true },
        },
        assignments: {
          where: { status: 'ASSIGNED' },
          select: { id: true, userId: true },
        },
      },
    });
    if (!existing) throw new SchedulingError('Shift not found.', 'NOT_FOUND');

    if (
      existing.status === 'PUBLISHED' &&
      !isWithinEditCutoff(existing.startUtc, existing.location.editCutoffHours)
    ) {
      throw new SchedulingError(
        cutoffMessage(
          existing.startUtc,
          existing.location.editCutoffHours,
          existing.location.timezone,
        ),
        'FORBIDDEN',
      );
    }

    const updated = await tx.shift.update({
      where: { id: shiftId },
      data: { status: 'CANCELLED', version: { increment: 1 } },
      select: { id: true, weekKey: true, version: true },
    });

    await tx.assignment.updateMany({
      where: { shiftId, status: 'ASSIGNED' },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: reason ?? 'Shift cancelled',
      },
    });

    await tx.coverageRequest.updateMany({
      where: { shiftId, status: { in: ['OPEN', 'PENDING_MANAGER'] } },
      data: {
        status: 'AUTO_CANCELLED',
        decidedAt: new Date(),
        decidedById: actor.id,
        decisionNote: 'The shift itself was cancelled.',
      },
    });

    const label = formatShiftRange(
      existing.startUtc,
      existing.endUtc,
      existing.location.timezone,
    );

    await recordAudit(tx, {
      action: 'SHIFT_DELETED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Shift',
      entityId: shiftId,
      locationId: existing.locationId,
      summary: `Cancelled ${label} at ${existing.location.name}${
        reason ? ` (${reason})` : ''
      }`,
      before: shiftSnapshot({ ...existing, locationId: existing.locationId }),
      after: { ...shiftSnapshot({ ...existing, locationId: existing.locationId }), status: 'CANCELLED' },
    });

    const notifications: NotifyInput[] =
      existing.status === 'PUBLISHED'
        ? existing.assignments.map((a) => ({
            userId: a.userId,
            type: 'SHIFT_CANCELLED' as const,
            title: 'Shift cancelled',
            body: `${existing.location.name} — ${label} is no longer happening.${
              reason ? ` Reason: ${reason}` : ''
            }`,
            href: '/schedule',
            data: { shiftId },
          }))
        : [];

    const created = await createNotifications(tx, notifications);

    return {
      created,
      locationId: existing.locationId,
      weekKey: updated.weekKey,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'shift.deleted',
    audience: { locationIds: [result.locationId] },
    payload: { shiftId, weekKey: result.weekKey },
    actorId: actor.id,
  });
}

export async function publishWeek(
  locationId: string,
  week: string,
  actor: Viewer,
) {
  const result = await db.$transaction(async (tx) => {
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { id: true, name: true, timezone: true },
    });

    const drafts = await tx.shift.findMany({
      where: { locationId, weekKey: week, status: 'DRAFT' },
      select: {
        id: true,
        assignments: {
          where: { status: 'ASSIGNED' },
          select: { userId: true },
        },
      },
    });

    if (drafts.length === 0) {
      throw new SchedulingError(
        'There are no draft shifts to publish for this week.',
        'NOT_FOUND',
      );
    }

    const now = new Date();
    await tx.shift.updateMany({
      where: { id: { in: drafts.map((d) => d.id) } },
      data: { status: 'PUBLISHED', publishedAt: now },
    });

    await tx.schedulePublication.upsert({
      where: { locationId_weekKey: { locationId, weekKey: week } },
      create: {
        locationId,
        weekKey: week,
        publishedById: actor.id,
        shiftCount: drafts.length,
      },
      update: {
        publishedById: actor.id,
        publishedAt: now,
        unpublishedAt: null,
        shiftCount: drafts.length,
      },
    });

    await recordAudit(tx, {
      action: 'SHIFT_PUBLISHED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Location',
      entityId: locationId,
      locationId,
      summary: `Published ${drafts.length} shift${
        drafts.length === 1 ? '' : 's'
      } for ${week} at ${location.name}`,
      after: { weekKey: week, shiftCount: drafts.length },
    });

    const affectedUserIds = [
      ...new Set(drafts.flatMap((d) => d.assignments.map((a) => a.userId))),
    ];

    const created = await createNotifications(
      tx,
      affectedUserIds.map((userId) => ({
        userId,
        type: 'SCHEDULE_PUBLISHED' as const,
        title: 'Schedule published',
        body: `Your ${week} schedule for ${location.name} is now available.`,
        href: `/schedule?week=${week}`,
        data: { locationId, weekKey: week },
      })),
    );

    return {
      created,
      locationId,
      locationName: location.name,
      count: drafts.length,
      affectedUserIds,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'schedule.published',
    audience: {
      locationIds: [result.locationId],
      userIds: result.affectedUserIds,
    },
    message: `${result.locationName}: the ${week} schedule is now published`,
    payload: { locationId: result.locationId, weekKey: week, count: result.count },
    actorId: actor.id,
  });

  return result.count;
}

export async function unpublishWeek(
  locationId: string,
  week: string,
  actor: Viewer,
) {
  const result = await db.$transaction(async (tx) => {
    const location = await tx.location.findUniqueOrThrow({
      where: { id: locationId },
      select: { id: true, name: true, timezone: true, editCutoffHours: true },
    });

    const published = await tx.shift.findMany({
      where: { locationId, weekKey: week, status: 'PUBLISHED' },
      select: {
        id: true,
        startUtc: true,
        assignments: {
          where: { status: 'ASSIGNED' },
          select: { userId: true },
        },
      },
    });

    if (published.length === 0) {
      throw new SchedulingError(
        'There is nothing published for this week.',
        'NOT_FOUND',
      );
    }

    const editable = published.filter((s) =>
      isWithinEditCutoff(s.startUtc, location.editCutoffHours),
    );
    const locked = published.length - editable.length;

    if (editable.length === 0) {
      throw new SchedulingError(
        `Every shift in ${week} is already within the ${location.editCutoffHours}h cutoff and cannot be unpublished.`,
        'FORBIDDEN',
      );
    }

    await tx.shift.updateMany({
      where: { id: { in: editable.map((s) => s.id) } },
      data: { status: 'DRAFT', publishedAt: null },
    });

    await tx.schedulePublication.updateMany({
      where: { locationId, weekKey: week },
      data: { unpublishedAt: new Date() },
    });

    await recordAudit(tx, {
      action: 'SHIFT_UNPUBLISHED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Location',
      entityId: locationId,
      locationId,
      summary: `Unpublished ${editable.length} shift${
        editable.length === 1 ? '' : 's'
      } for ${week} at ${location.name}${
        locked ? ` (${locked} left published — inside the edit cutoff)` : ''
      }`,
      after: { weekKey: week, unpublished: editable.length, locked },
    });

    const affectedUserIds = [
      ...new Set(editable.flatMap((s) => s.assignments.map((a) => a.userId))),
    ];

    const created = await createNotifications(
      tx,
      affectedUserIds.map((userId) => ({
        userId,
        type: 'SCHEDULE_UNPUBLISHED' as const,
        title: 'Schedule taken down for changes',
        body: `The ${week} schedule at ${location.name} is being revised. You will be notified when it is republished.`,
        href: `/schedule?week=${week}`,
        data: { locationId, weekKey: week },
      })),
    );

    return {
      created,
      locationId,
      locationName: location.name,
      count: editable.length,
      locked,
      affectedUserIds,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'schedule.unpublished',
    audience: {
      locationIds: [result.locationId],
      userIds: result.affectedUserIds,
    },
    message: `${result.locationName}: the ${week} schedule was taken down for changes`,
    payload: { locationId: result.locationId, weekKey: week },
    actorId: actor.id,
  });

  return { unpublished: result.count, locked: result.locked };
}
