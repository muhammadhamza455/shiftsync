import type { Prisma } from '@/generated/prisma/client';
import { db, acquireAdvisoryLock, LOCK_NAMESPACE } from '@/lib/db';
import {
  evaluateAssignment,
  formatHours,
  rankCandidates,
  scoreCandidate,
  type EvaluationResult,
  type TargetShift,
} from '@/lib/scheduling/constraints';
import { formatShiftRange } from '@/lib/time/zones';
import { publish } from '@/lib/realtime/publish';
import {
  createNotifications,
  pushNotifications,
  type NotifyInput,
} from './notifications';
import { recordAudit, assignmentSnapshot } from './audit';
import {
  loadCandidateContexts,
  loadTargetShift,
  staffSelect,
  toCandidateStaff,
} from './context';
import type { Viewer } from '@/lib/auth/session';

export class SchedulingError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'NOT_FOUND'
      | 'CONFLICT'
      | 'BLOCKED'
      | 'NEEDS_OVERRIDE'
      | 'FORBIDDEN',
  ) {
    super(message);
    this.name = 'SchedulingError';
  }
}

export interface SuggestionDto {
  userId: string;
  name: string;
  score: number;
  reasons: string[];
  weeklyHoursBefore: number;
  weeklyHoursAfter: number;
  needsOverride: boolean;
  overrideReason?: string;
}

export interface AssignOutcome {
  status: 'ASSIGNED' | 'BLOCKED' | 'NEEDS_OVERRIDE';
  assignmentId?: string;
  evaluation: EvaluationResult;
  suggestions?: SuggestionDto[];
}

export async function previewAssignment(
  shiftId: string,
  userId: string,
): Promise<{ evaluation: EvaluationResult; target: TargetShift }> {
  const target = await loadTargetShift(shiftId);
  if (!target) throw new SchedulingError('Shift not found.', 'NOT_FOUND');

  const contexts = await loadCandidateContexts(target, [userId]);
  const context = contexts.get(userId);
  if (!context) throw new SchedulingError('Staff member not found.', 'NOT_FOUND');

  return { evaluation: evaluateAssignment(target, context), target };
}

export async function suggestCandidates(
  shiftId: string,
  options: { limit?: number; excludeUserIds?: string[] } = {},
): Promise<SuggestionDto[]> {
  const target = await loadTargetShift(shiftId);
  if (!target) throw new SchedulingError('Shift not found.', 'NOT_FOUND');
  return suggestForTarget(target, options);
}

export async function suggestForTarget(
  target: TargetShift,
  options: { limit?: number; excludeUserIds?: string[] } = {},
): Promise<SuggestionDto[]> {
  const limit = options.limit ?? 5;
  const exclude = new Set(options.excludeUserIds ?? []);

  const eligible = await db.user.findMany({
    where: {
      role: 'STAFF',
      isActive: true,
      id: { notIn: options.excludeUserIds?.length ? options.excludeUserIds : undefined },
      skills: { some: { skillId: target.requiredSkillId, revokedAt: null } },
      certifications: { some: { locationId: target.locationId, revokedAt: null } },
    },
    select: staffSelect,
    take: 60,
  });

  const candidateIds = eligible.map((u) => u.id).filter((id) => !exclude.has(id));
  if (candidateIds.length === 0) return [];

  const contexts = await loadCandidateContexts(target, candidateIds);

  const ranked = eligible
    .filter((u) => contexts.has(u.id))
    .map((row) => {
      const context = contexts.get(row.id)!;
      const evaluation = evaluateAssignment(target, context, {
        ignoreHeadcount: true,
      });
      return scoreCandidate(toCandidateStaff(row), evaluation);
    })
    .filter((c) => c.result.ok);

  return rankCandidates(ranked)
    .slice(0, limit)
    .map((c) => ({
      userId: c.staff.id,
      name: c.staff.name,
      score: c.score,
      reasons: c.reasons,
      weeklyHoursBefore: c.result.projection.weeklyHoursBefore,
      weeklyHoursAfter: c.result.projection.weeklyHoursAfter,
      needsOverride: c.result.overridable.length > 0,
      overrideReason: c.result.overridable[0]?.title,
    }));
}

export interface AssignInput {
  shiftId: string;
  userId: string;
  actor: Viewer;
  overrideReason?: string;
  reason?: string;
  excludeAssignmentIds?: string[];
  silent?: boolean;
}

export type AssignWithinTxResult =
  | { kind: 'blocked'; evaluation: EvaluationResult; target: TargetShift }
  | { kind: 'needs-override'; evaluation: EvaluationResult; target: TargetShift }
  | {
      kind: 'assigned';
      assignmentId: string;
      evaluation: EvaluationResult;
      target: TargetShift;
      created: Awaited<ReturnType<typeof createNotifications>>;
      locationId: string;
      staffName: string;
    };

export async function assignWithinTx(
  tx: Prisma.TransactionClient,
  input: AssignInput,
): Promise<AssignWithinTxResult> {
  const { shiftId, userId, actor } = input;

  const target = await loadTargetShift(shiftId, tx);
  if (!target) throw new SchedulingError('Shift not found.', 'NOT_FOUND');

  const shift = await tx.shift.findUniqueOrThrow({
    where: { id: shiftId },
    select: { id: true, locationId: true, status: true, version: true },
  });

  const contexts = await loadCandidateContexts(target, [userId], {
    client: tx,
    excludeAssignmentIds: input.excludeAssignmentIds,
  });
  const context = contexts.get(userId);
  if (!context) {
    throw new SchedulingError('Staff member not found.', 'NOT_FOUND');
  }

  const evaluation = evaluateAssignment(target, context);

  if (!evaluation.ok) {
    return { kind: 'blocked', evaluation, target };
  }
  if (evaluation.overridable.length > 0 && !input.overrideReason?.trim()) {
    return { kind: 'needs-override', evaluation, target };
  }

  const assignment = await tx.assignment.upsert({
    where: { shiftId_userId: { shiftId, userId } },
    create: {
      shiftId,
      userId,
      assignedById: actor.id,
      status: 'ASSIGNED',
    },
    update: {
      status: 'ASSIGNED',
      assignedById: actor.id,
      assignedAt: new Date(),
      cancelledAt: null,
      cancelReason: null,
    },
    select: { id: true, status: true, userId: true, shiftId: true },
  });

  for (const violation of evaluation.overridable) {
    await tx.constraintOverride.create({
      data: {
        shiftId,
        assignmentId: assignment.id,
        subjectId: userId,
        approvedById: actor.id,
        ruleCode: violation.code,
        reason: input.overrideReason!.trim(),
      },
    });
  }

  await recordAudit(tx, {
    action: 'ASSIGNMENT_CREATED',
    actorId: actor.id,
    actorLabel: `${actor.name} (${actor.role})`,
    entityType: 'Assignment',
    entityId: assignment.id,
    locationId: shift.locationId,
    summary: `Assigned ${context.staff.name} to ${formatShiftRange(
      target.startUtc,
      target.endUtc,
      target.locationTimeZone,
    )} at ${target.locationName}${input.reason ? ` (${input.reason})` : ''}`,
    before: null,
    after: assignmentSnapshot(assignment),
  });

  if (evaluation.overridable.length > 0) {
    await recordAudit(tx, {
      action: 'OVERRIDE_RECORDED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Assignment',
      entityId: assignment.id,
      locationId: shift.locationId,
      summary: `Override for ${evaluation.overridable
        .map((v) => v.title)
        .join(', ')}: ${input.overrideReason!.trim()}`,
      after: { ruleCodes: evaluation.overridable.map((v) => v.code) },
    });
  }

  const notifications: NotifyInput[] =
    shift.status === 'PUBLISHED' && !input.silent
      ? [
          {
            userId,
            type: 'SHIFT_ASSIGNED',
            title: 'New shift assigned',
            body: `${target.locationName} — ${formatShiftRange(
              target.startUtc,
              target.endUtc,
              target.locationTimeZone,
            )}`,
            href: `/schedule?shift=${shiftId}`,
            data: { shiftId },
          },
        ]
      : [];

  const { projection } = evaluation;
  if (projection.overtimeHoursBefore === 0 && projection.overtimeHoursAfter > 0) {
    const managers = await tx.managerAssignment.findMany({
      where: { locationId: shift.locationId, userId: { not: actor.id } },
      select: { userId: true },
    });
    for (const manager of managers) {
      notifications.push({
        userId: manager.userId,
        type: 'OVERTIME_WARNING',
        title: `${context.staff.name} is now into overtime`,
        body: `${formatShiftRange(
          target.startUtc,
          target.endUtc,
          target.locationTimeZone,
        )} at ${target.locationName} takes them to ${formatHours(
          projection.weeklyHoursAfter,
        )} this week — ${formatHours(
          projection.overtimeHoursAfter,
        )} of overtime, costing an extra $${projection.addedOvertimeCost.toFixed(2)}.`,
        href: '/manage/overtime',
        data: {
          shiftId,
          staffId: userId,
          weeklyHours: projection.weeklyHoursAfter,
          overtimeHours: projection.overtimeHoursAfter,
        },
      });
    }
  }

  const created = await createNotifications(tx, notifications);

  return {
    kind: 'assigned',
    assignmentId: assignment.id,
    evaluation,
    target,
    created,
    locationId: shift.locationId,
    staffName: context.staff.name,
  };
}

export async function assignStaffToShift(
  input: AssignInput,
): Promise<AssignOutcome> {
  const { shiftId, userId, actor } = input;

  const outcome = await db.$transaction(async (tx) => {
    await acquireAdvisoryLock(tx, LOCK_NAMESPACE.STAFF_ASSIGNMENT, `shift:${shiftId}`);
    await acquireAdvisoryLock(tx, LOCK_NAMESPACE.STAFF_ASSIGNMENT, `user:${userId}`);
    return assignWithinTx(tx, input);
  });

  if (outcome.kind === 'blocked') {
    const suggestions = await suggestForTarget(outcome.target, {
      excludeUserIds: [userId],
    });
    return { status: 'BLOCKED', evaluation: outcome.evaluation, suggestions };
  }

  if (outcome.kind === 'needs-override') {
    return { status: 'NEEDS_OVERRIDE', evaluation: outcome.evaluation };
  }

  await pushNotifications(outcome.created, actor.id);
  await publish({
    type: 'assignment.created',
    audience: {
      userIds: [userId],
      locationIds: [outcome.locationId],
    },
    message: `${outcome.staffName} assigned to a shift at ${outcome.target.locationName}`,
    payload: { shiftId, userId, assignmentId: outcome.assignmentId },
    actorId: actor.id,
  });

  return {
    status: 'ASSIGNED',
    assignmentId: outcome.assignmentId,
    evaluation: outcome.evaluation,
  };
}

export async function unassignStaff(input: {
  assignmentId: string;
  actor: Viewer;
  reason?: string;
  silent?: boolean;
}): Promise<void> {
  const { assignmentId, actor } = input;

  const result = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.findUnique({
      where: { id: assignmentId },
      select: {
        id: true,
        userId: true,
        shiftId: true,
        status: true,
        assignedById: true,
        user: { select: { name: true } },
        shift: {
          select: {
            id: true,
            startUtc: true,
            endUtc: true,
            status: true,
            locationId: true,
            location: { select: { name: true, timezone: true } },
          },
        },
      },
    });
    if (!assignment) {
      throw new SchedulingError('Assignment not found.', 'NOT_FOUND');
    }
    if (assignment.status !== 'ASSIGNED') {
      return null;
    }

    await acquireAdvisoryLock(
      tx,
      LOCK_NAMESPACE.STAFF_ASSIGNMENT,
      `shift:${assignment.shiftId}`,
    );

    await tx.assignment.update({
      where: { id: assignmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: input.reason ?? null,
      },
    });

    const orphaned = await tx.coverageRequest.findMany({
      where: {
        OR: [
          { requesterAssignmentId: assignmentId },
          { targetAssignmentId: assignmentId },
        ],
        status: { in: ['OPEN', 'PENDING_MANAGER'] },
      },
      select: { id: true, requesterId: true, targetId: true, claimedById: true },
    });
    if (orphaned.length > 0) {
      await tx.coverageRequest.updateMany({
        where: { id: { in: orphaned.map((o) => o.id) } },
        data: {
          status: 'AUTO_CANCELLED',
          decidedAt: new Date(),
          decisionNote: 'The underlying assignment was removed.',
        },
      });
    }

    const shiftLabel = formatShiftRange(
      assignment.shift.startUtc,
      assignment.shift.endUtc,
      assignment.shift.location.timezone,
    );

    await recordAudit(tx, {
      action: 'ASSIGNMENT_CANCELLED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'Assignment',
      entityId: assignmentId,
      locationId: assignment.shift.locationId,
      summary: `Removed ${assignment.user.name} from ${shiftLabel} at ${assignment.shift.location.name}${
        input.reason ? ` (${input.reason})` : ''
      }`,
      before: assignmentSnapshot(assignment),
      after: { ...assignmentSnapshot(assignment), status: 'CANCELLED' },
    });

    const notifications: NotifyInput[] = [];
    if (!input.silent && assignment.shift.status === 'PUBLISHED') {
      notifications.push({
        userId: assignment.userId,
        type: 'SHIFT_UNASSIGNED',
        title: 'Shift removed',
        body: `You are no longer scheduled for ${shiftLabel} at ${assignment.shift.location.name}.`,
        href: '/schedule',
        data: { shiftId: assignment.shiftId },
      });
    }
    for (const request of orphaned) {
      for (const affected of [
        request.requesterId,
        request.targetId,
        request.claimedById,
      ]) {
        if (!affected) continue;
        notifications.push({
          userId: affected,
          type: 'SWAP_CANCELLED',
          title: 'Coverage request cancelled',
          body: `A request for ${shiftLabel} was cancelled because the assignment behind it was removed.`,
          href: '/swaps',
          data: { coverageRequestId: request.id },
        });
      }
    }

    const created = await createNotifications(tx, notifications);

    return {
      created,
      userId: assignment.userId,
      shiftId: assignment.shiftId,
      locationId: assignment.shift.locationId,
      staffName: assignment.user.name,
    };
  });

  if (!result) return;

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'assignment.cancelled',
    audience: { userIds: [result.userId], locationIds: [result.locationId] },
    message: `${result.staffName} was removed from a shift`,
    payload: { shiftId: result.shiftId, userId: result.userId },
    actorId: actor.id,
  });
}
