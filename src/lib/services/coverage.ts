import { db, acquireAdvisoryLock, LOCK_NAMESPACE } from '@/lib/db';
import { formatShiftRange } from '@/lib/time/zones';
import {
  DROP_EXPIRY_HOURS_BEFORE_SHIFT,
  MAX_PENDING_COVERAGE_REQUESTS,
} from '@/lib/scheduling/rules';
import { publish } from '@/lib/realtime/publish';
import {
  createNotifications,
  pushNotifications,
  type NotifyInput,
} from './notifications';
import { recordAudit } from './audit';
import { SchedulingError, assignWithinTx } from './assignments';
import { loadCandidateContexts, loadTargetShift } from './context';
import { evaluateAssignment } from '@/lib/scheduling/constraints';
import type { Viewer } from '@/lib/auth/session';

const HOUR_MS = 3_600_000;

const OPEN_STATUSES = ['OPEN', 'PENDING_MANAGER'] as const;

async function assertUnderPendingLimit(
  tx: Parameters<typeof recordAudit>[0],
  userId: string,
  userName: string,
): Promise<void> {
  const open = await tx.coverageRequest.count({
    where: { requesterId: userId, status: { in: [...OPEN_STATUSES] } },
  });
  if (open >= MAX_PENDING_COVERAGE_REQUESTS) {
    throw new SchedulingError(
      `${userName} already has ${open} open swap/drop requests. The limit is ${MAX_PENDING_COVERAGE_REQUESTS} — resolve or cancel one before raising another.`,
      'FORBIDDEN',
    );
  }
}

function shiftLabel(shift: {
  startUtc: Date;
  endUtc: Date;
  location: { name: string; timezone: string };
}): string {
  return `${shift.location.name} — ${formatShiftRange(
    shift.startUtc,
    shift.endUtc,
    shift.location.timezone,
  )}`;
}

const assignmentDetail = {
  id: true,
  userId: true,
  status: true,
  user: { select: { id: true, name: true } },
  shift: {
    select: {
      id: true,
      startUtc: true,
      endUtc: true,
      status: true,
      version: true,
      locationId: true,
      requiredSkillId: true,
      location: { select: { id: true, name: true, timezone: true } },
    },
  },
} as const;

export interface RequestSwapInput {
  requesterAssignmentId: string;
  targetUserId: string;
  targetAssignmentId?: string;
  note?: string;
  actor: Viewer;
}

export async function requestSwap(input: RequestSwapInput) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    const requesterAssignment = await tx.assignment.findUnique({
      where: { id: input.requesterAssignmentId },
      select: assignmentDetail,
    });
    if (!requesterAssignment || requesterAssignment.status !== 'ASSIGNED') {
      throw new SchedulingError('That shift assignment is no longer active.', 'NOT_FOUND');
    }
    if (requesterAssignment.userId !== actor.id) {
      throw new SchedulingError('You can only swap your own shifts.', 'FORBIDDEN');
    }
    if (requesterAssignment.shift.startUtc.getTime() <= Date.now()) {
      throw new SchedulingError('That shift has already started.', 'FORBIDDEN');
    }
    if (input.targetUserId === actor.id) {
      throw new SchedulingError('You cannot swap a shift with yourself.', 'FORBIDDEN');
    }

    await assertUnderPendingLimit(tx, actor.id, 'You');

    const duplicate = await tx.coverageRequest.findFirst({
      where: {
        requesterAssignmentId: input.requesterAssignmentId,
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new SchedulingError(
        'You already have an open request for this shift.',
        'CONFLICT',
      );
    }

    const target = await tx.user.findUnique({
      where: { id: input.targetUserId },
      select: { id: true, name: true, isActive: true },
    });
    if (!target || !target.isActive) {
      throw new SchedulingError('That staff member is not available.', 'NOT_FOUND');
    }

    let targetAssignment: typeof requesterAssignment | null = null;
    if (input.targetAssignmentId) {
      targetAssignment = await tx.assignment.findUnique({
        where: { id: input.targetAssignmentId },
        select: assignmentDetail,
      });
      if (!targetAssignment || targetAssignment.status !== 'ASSIGNED') {
        throw new SchedulingError('Their shift is no longer active.', 'NOT_FOUND');
      }
      if (targetAssignment.userId !== input.targetUserId) {
        throw new SchedulingError(
          'That shift does not belong to the person you selected.',
          'CONFLICT',
        );
      }
    }

    const engineTarget = await loadTargetShift(requesterAssignment.shift.id, tx);
    if (engineTarget) {
      const contexts = await loadCandidateContexts(
        engineTarget,
        [input.targetUserId],
        { client: tx, excludeAssignmentIds: [input.requesterAssignmentId] },
      );
      const context = contexts.get(input.targetUserId);
      if (context) {
        const evaluation = evaluateAssignment(
          { ...engineTarget, assignedCount: engineTarget.assignedCount - 1 },
          context,
        );
        if (!evaluation.ok) {
          throw new SchedulingError(
            `${target.name} cannot take this shift: ${evaluation.blocking[0].message}`,
            'BLOCKED',
          );
        }
      }
    }

    const request = await tx.coverageRequest.create({
      data: {
        type: 'SWAP',
        status: 'OPEN',
        shiftId: requesterAssignment.shift.id,
        requesterId: actor.id,
        requesterAssignmentId: requesterAssignment.id,
        targetId: input.targetUserId,
        targetAssignmentId: input.targetAssignmentId ?? null,
        note: input.note ?? null,
        shiftVersionAtRequest: requesterAssignment.shift.version,
      },
      select: { id: true },
    });

    const label = shiftLabel(requesterAssignment.shift);

    await recordAudit(tx, {
      action: 'COVERAGE_REQUESTED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: requesterAssignment.shift.locationId,
      summary: `${actor.name} asked ${target.name} to swap ${label}`,
      after: {
        type: 'SWAP',
        targetUserId: input.targetUserId,
        twoWay: Boolean(input.targetAssignmentId),
      },
    });

    const created = await createNotifications(tx, [
      {
        userId: input.targetUserId,
        type: 'SWAP_REQUESTED',
        title: `${actor.name} wants to swap a shift`,
        body: targetAssignment
          ? `They would take ${shiftLabel(targetAssignment.shift)} and you would take ${label}.`
          : `They are asking you to take ${label}.`,
        href: '/swaps',
        data: { coverageRequestId: request.id },
      },
    ]);

    return {
      requestId: request.id,
      created,
      locationId: requesterAssignment.shift.locationId,
      targetUserId: input.targetUserId,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'coverage.requested',
    audience: { userIds: [result.targetUserId], locationIds: [result.locationId] },
    message: `${actor.name} raised a swap request`,
    payload: { coverageRequestId: result.requestId },
    actorId: actor.id,
  });

  return result.requestId;
}

export async function respondToSwap(input: {
  requestId: string;
  accept: boolean;
  actor: Viewer;
}) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    const request = await tx.coverageRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        type: true,
        status: true,
        targetId: true,
        requesterId: true,
        requester: { select: { name: true } },
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
    });
    if (!request) throw new SchedulingError('Request not found.', 'NOT_FOUND');
    if (request.targetId !== actor.id) {
      throw new SchedulingError('This request is not addressed to you.', 'FORBIDDEN');
    }
    if (request.status !== 'OPEN') {
      throw new SchedulingError(
        `This request is already ${request.status.toLowerCase().replace('_', ' ')}.`,
        'CONFLICT',
      );
    }

    await tx.coverageRequest.update({
      where: { id: request.id },
      data: input.accept
        ? { status: 'PENDING_MANAGER' }
        : { status: 'DECLINED', decidedAt: new Date(), decidedById: actor.id },
    });

    const label = shiftLabel(request.shift);

    await recordAudit(tx, {
      action: input.accept ? 'COVERAGE_ACCEPTED' : 'COVERAGE_DECLINED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: request.shift.locationId,
      summary: `${actor.name} ${
        input.accept ? 'accepted' : 'declined'
      } the swap of ${label} from ${request.requester.name}`,
    });

    const notifications: NotifyInput[] = [
      {
        userId: request.requesterId,
        type: input.accept ? 'SWAP_ACCEPTED' : 'SWAP_DECLINED',
        title: input.accept
          ? `${actor.name} accepted your swap`
          : `${actor.name} declined your swap`,
        body: input.accept
          ? `${label} is now waiting for manager approval. You are still on the shift until then.`
          : `You are still scheduled for ${label}.`,
        href: '/swaps',
        data: { coverageRequestId: request.id },
      },
    ];

    if (input.accept) {
      const managers = await tx.managerAssignment.findMany({
        where: { locationId: request.shift.locationId },
        select: { userId: true },
      });
      for (const manager of managers) {
        notifications.push({
          userId: manager.userId,
          type: 'SWAP_REQUESTED',
          title: 'Swap needs your approval',
          body: `${request.requester.name} → ${actor.name} for ${label}.`,
          href: '/manage/swaps',
          data: { coverageRequestId: request.id },
        });
      }
    }

    const created = await createNotifications(tx, notifications);

    return {
      created,
      locationId: request.shift.locationId,
      requesterId: request.requesterId,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: input.accept ? 'coverage.accepted' : 'coverage.declined',
    audience: {
      userIds: [result.requesterId, actor.id],
      locationIds: [result.locationId],
    },
    payload: { coverageRequestId: input.requestId },
    actorId: actor.id,
  });
}

export async function requestDrop(input: {
  assignmentId: string;
  note?: string;
  actor: Viewer;
}) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    const assignment = await tx.assignment.findUnique({
      where: { id: input.assignmentId },
      select: assignmentDetail,
    });
    if (!assignment || assignment.status !== 'ASSIGNED') {
      throw new SchedulingError('That shift assignment is no longer active.', 'NOT_FOUND');
    }
    if (assignment.userId !== actor.id) {
      throw new SchedulingError('You can only drop your own shifts.', 'FORBIDDEN');
    }

    const expiresAt = new Date(
      assignment.shift.startUtc.getTime() -
        DROP_EXPIRY_HOURS_BEFORE_SHIFT * HOUR_MS,
    );
    if (expiresAt.getTime() <= Date.now()) {
      throw new SchedulingError(
        `This shift starts in under ${DROP_EXPIRY_HOURS_BEFORE_SHIFT} hours, so it can no longer be offered up. Contact your manager directly.`,
        'FORBIDDEN',
      );
    }

    await assertUnderPendingLimit(tx, actor.id, 'You');

    const duplicate = await tx.coverageRequest.findFirst({
      where: {
        requesterAssignmentId: input.assignmentId,
        status: { in: [...OPEN_STATUSES] },
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new SchedulingError(
        'You already have an open request for this shift.',
        'CONFLICT',
      );
    }

    const request = await tx.coverageRequest.create({
      data: {
        type: 'DROP',
        status: 'OPEN',
        shiftId: assignment.shift.id,
        requesterId: actor.id,
        requesterAssignmentId: assignment.id,
        note: input.note ?? null,
        expiresAt,
        shiftVersionAtRequest: assignment.shift.version,
      },
      select: { id: true },
    });

    const label = shiftLabel(assignment.shift);

    await recordAudit(tx, {
      action: 'COVERAGE_REQUESTED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: assignment.shift.locationId,
      summary: `${actor.name} offered up ${label}`,
      after: { type: 'DROP', expiresAt: expiresAt.toISOString() },
    });

    const eligible = await tx.user.findMany({
      where: {
        role: 'STAFF',
        isActive: true,
        id: { not: actor.id },
        skills: {
          some: { skillId: assignment.shift.requiredSkillId, revokedAt: null },
        },
        certifications: {
          some: { locationId: assignment.shift.locationId, revokedAt: null },
        },
      },
      select: { id: true },
    });

    const notifications: NotifyInput[] = eligible.map((u) => ({
      userId: u.id,
      type: 'DROP_OFFERED' as const,
      title: 'A shift is up for grabs',
      body: `${label}${input.note ? ` — "${input.note}"` : ''}`,
      href: '/swaps/open',
      data: { coverageRequestId: request.id, shiftId: assignment.shift.id },
    }));

    const created = await createNotifications(tx, notifications);

    return {
      requestId: request.id,
      created,
      locationId: assignment.shift.locationId,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'coverage.requested',
    audience: { locationIds: [result.locationId] },
    message: `${actor.name} offered up a shift`,
    payload: { coverageRequestId: result.requestId },
    actorId: actor.id,
  });

  return result.requestId;
}

export async function claimDrop(input: { requestId: string; actor: Viewer }) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    await acquireAdvisoryLock(
      tx,
      LOCK_NAMESPACE.COVERAGE_REQUEST,
      `coverage:${input.requestId}`,
    );

    const request = await tx.coverageRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        type: true,
        status: true,
        expiresAt: true,
        requesterId: true,
        requesterAssignmentId: true,
        requester: { select: { name: true } },
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
    });
    if (!request) throw new SchedulingError('Request not found.', 'NOT_FOUND');
    if (request.type !== 'DROP') {
      throw new SchedulingError('Only dropped shifts can be picked up.', 'CONFLICT');
    }
    if (request.status !== 'OPEN') {
      throw new SchedulingError(
        'Someone else already picked this up.',
        'CONFLICT',
      );
    }
    if (request.expiresAt && request.expiresAt.getTime() <= Date.now()) {
      throw new SchedulingError('This offer has expired.', 'CONFLICT');
    }
    if (request.requesterId === actor.id) {
      throw new SchedulingError('You cannot pick up your own shift.', 'FORBIDDEN');
    }

    const engineTarget = await loadTargetShift(request.shift.id, tx);
    if (engineTarget) {
      const contexts = await loadCandidateContexts(engineTarget, [actor.id], {
        client: tx,
        excludeAssignmentIds: [request.requesterAssignmentId],
      });
      const context = contexts.get(actor.id);
      if (context) {
        const evaluation = evaluateAssignment(
          { ...engineTarget, assignedCount: engineTarget.assignedCount - 1 },
          context,
        );
        if (!evaluation.ok) {
          throw new SchedulingError(
            `You cannot take this shift: ${evaluation.blocking[0].message}`,
            'BLOCKED',
          );
        }
      }
    }

    await tx.coverageRequest.update({
      where: { id: request.id },
      data: {
        status: 'PENDING_MANAGER',
        claimedById: actor.id,
        claimedAt: new Date(),
      },
    });

    const label = shiftLabel(request.shift);

    await recordAudit(tx, {
      action: 'COVERAGE_CLAIMED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: request.shift.locationId,
      summary: `${actor.name} claimed ${label} dropped by ${request.requester.name}`,
    });

    const managers = await tx.managerAssignment.findMany({
      where: { locationId: request.shift.locationId },
      select: { userId: true },
    });

    const notifications: NotifyInput[] = [
      {
        userId: request.requesterId,
        type: 'DROP_CLAIMED',
        title: `${actor.name} picked up your shift`,
        body: `${label} is now waiting for manager approval. You remain scheduled until then.`,
        href: '/swaps',
        data: { coverageRequestId: request.id },
      },
      ...managers.map((m) => ({
        userId: m.userId,
        type: 'DROP_CLAIMED' as const,
        title: 'Pickup needs your approval',
        body: `${actor.name} wants to take ${label} from ${request.requester.name}.`,
        href: '/manage/swaps',
        data: { coverageRequestId: request.id },
      })),
    ];

    const created = await createNotifications(tx, notifications);

    return {
      created,
      locationId: request.shift.locationId,
      requesterId: request.requesterId,
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'coverage.claimed',
    audience: {
      userIds: [result.requesterId, actor.id],
      locationIds: [result.locationId],
    },
    payload: { coverageRequestId: input.requestId },
    actorId: actor.id,
  });
}

export async function cancelCoverageRequest(input: {
  requestId: string;
  actor: Viewer;
  reason?: string;
}) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    const request = await tx.coverageRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        type: true,
        status: true,
        requesterId: true,
        targetId: true,
        claimedById: true,
        requester: { select: { name: true } },
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
    });
    if (!request) throw new SchedulingError('Request not found.', 'NOT_FOUND');

    const isRequester = request.requesterId === actor.id;
    const isManager =
      actor.role === 'ADMIN' ||
      actor.managedLocationIds.includes(request.shift.locationId);
    if (!isRequester && !isManager) {
      throw new SchedulingError('You cannot cancel this request.', 'FORBIDDEN');
    }
    if (!OPEN_STATUSES.includes(request.status as (typeof OPEN_STATUSES)[number])) {
      throw new SchedulingError(
        `This request is already ${request.status.toLowerCase().replace('_', ' ')} and cannot be cancelled.`,
        'CONFLICT',
      );
    }

    await tx.coverageRequest.update({
      where: { id: request.id },
      data: {
        status: 'CANCELLED',
        decidedAt: new Date(),
        decidedById: actor.id,
        decisionNote: input.reason ?? null,
      },
    });

    const label = shiftLabel(request.shift);

    await recordAudit(tx, {
      action: 'COVERAGE_CANCELLED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: request.shift.locationId,
      summary: `${actor.name} cancelled the ${request.type.toLowerCase()} request for ${label}${
        input.reason ? ` (${input.reason})` : ''
      }`,
    });

    const recipients = new Set<string>();
    if (request.requesterId !== actor.id) recipients.add(request.requesterId);
    if (request.targetId) recipients.add(request.targetId);
    if (request.claimedById) recipients.add(request.claimedById);
    recipients.delete(actor.id);

    if (request.status === 'PENDING_MANAGER') {
      const managers = await tx.managerAssignment.findMany({
        where: { locationId: request.shift.locationId },
        select: { userId: true },
      });
      for (const m of managers) {
        if (m.userId !== actor.id) recipients.add(m.userId);
      }
    }

    const created = await createNotifications(
      tx,
      [...recipients].map((userId) => ({
        userId,
        type: 'SWAP_CANCELLED' as const,
        title: `${request.type === 'SWAP' ? 'Swap' : 'Drop'} request withdrawn`,
        body: `${request.requester.name}'s request for ${label} was cancelled${
          input.reason ? `: ${input.reason}` : ''
        }. The original schedule stands.`,
        href: '/swaps',
        data: { coverageRequestId: request.id },
      })),
    );

    return {
      created,
      locationId: request.shift.locationId,
      recipients: [...recipients],
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'coverage.cancelled',
    audience: {
      userIds: result.recipients,
      locationIds: [result.locationId],
    },
    payload: { coverageRequestId: input.requestId },
    actorId: actor.id,
  });
}

export interface DecideInput {
  requestId: string;
  approve: boolean;
  note?: string;
  overrideReason?: string;
  actor: Viewer;
}

export async function decideCoverageRequest(input: DecideInput) {
  const { actor } = input;

  const result = await db.$transaction(async (tx) => {
    await acquireAdvisoryLock(
      tx,
      LOCK_NAMESPACE.COVERAGE_REQUEST,
      `coverage:${input.requestId}`,
    );

    const request = await tx.coverageRequest.findUnique({
      where: { id: input.requestId },
      select: {
        id: true,
        type: true,
        status: true,
        shiftId: true,
        shiftVersionAtRequest: true,
        requesterId: true,
        requesterAssignmentId: true,
        targetId: true,
        targetAssignmentId: true,
        claimedById: true,
        requester: { select: { id: true, name: true } },
        target: { select: { id: true, name: true } },
        claimedBy: { select: { id: true, name: true } },
        shift: {
          select: {
            id: true,
            startUtc: true,
            endUtc: true,
            version: true,
            locationId: true,
            location: { select: { name: true, timezone: true } },
          },
        },
      },
    });
    if (!request) throw new SchedulingError('Request not found.', 'NOT_FOUND');

    if (
      actor.role !== 'ADMIN' &&
      !actor.managedLocationIds.includes(request.shift.locationId)
    ) {
      throw new SchedulingError(
        'You can only decide requests for locations you manage.',
        'FORBIDDEN',
      );
    }
    if (request.status !== 'PENDING_MANAGER') {
      throw new SchedulingError(
        `This request is ${request.status.toLowerCase().replace('_', ' ')}, not awaiting approval.`,
        'CONFLICT',
      );
    }

    if (request.shift.version !== request.shiftVersionAtRequest) {
      await tx.coverageRequest.update({
        where: { id: request.id },
        data: {
          status: 'AUTO_CANCELLED',
          decidedAt: new Date(),
          decidedById: actor.id,
          decisionNote: 'The shift changed after this request was raised.',
        },
      });
      throw new SchedulingError(
        'This shift was edited after the request was raised, so the request has been cancelled. Ask the staff member to raise a new one.',
        'CONFLICT',
      );
    }

    const label = shiftLabel(request.shift);
    const incomingUser =
      request.type === 'DROP' ? request.claimedBy : request.target;
    if (!incomingUser) {
      throw new SchedulingError(
        'This request has nobody to hand the shift to.',
        'CONFLICT',
      );
    }

    if (!input.approve) {
      await tx.coverageRequest.update({
        where: { id: request.id },
        data: {
          status: 'REJECTED',
          decidedAt: new Date(),
          decidedById: actor.id,
          decisionNote: input.note ?? null,
        },
      });

      await recordAudit(tx, {
        action: 'COVERAGE_REJECTED',
        actorId: actor.id,
        actorLabel: `${actor.name} (${actor.role})`,
        entityType: 'CoverageRequest',
        entityId: request.id,
        locationId: request.shift.locationId,
        summary: `${actor.name} rejected the ${request.type.toLowerCase()} of ${label}${
          input.note ? ` (${input.note})` : ''
        }`,
      });

      const created = await createNotifications(
        tx,
        [request.requesterId, incomingUser.id].map((userId) => ({
          userId,
          type: 'SWAP_REJECTED' as const,
          title: 'Request not approved',
          body: `${actor.name} did not approve the ${request.type.toLowerCase()} of ${label}.${
            input.note ? ` Reason: ${input.note}` : ''
          } The original schedule stands.`,
          href: '/swaps',
          data: { coverageRequestId: request.id },
        })),
      );

      return {
        approved: false,
        created,
        locationId: request.shift.locationId,
        participants: [request.requesterId, incomingUser.id],
      };
    }

    const shiftIds = [request.shiftId];
    if (request.targetAssignmentId) {
      const targetAssignment = await tx.assignment.findUniqueOrThrow({
        where: { id: request.targetAssignmentId },
        select: { shiftId: true },
      });
      shiftIds.push(targetAssignment.shiftId);
    }
    for (const id of [...shiftIds].sort()) {
      await acquireAdvisoryLock(tx, LOCK_NAMESPACE.STAFF_ASSIGNMENT, `shift:${id}`);
    }
    for (const id of [request.requesterId, incomingUser.id].sort()) {
      await acquireAdvisoryLock(tx, LOCK_NAMESPACE.STAFF_ASSIGNMENT, `user:${id}`);
    }

    await tx.assignment.update({
      where: { id: request.requesterAssignmentId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: `${request.type === 'SWAP' ? 'Swap' : 'Drop'} approved by ${actor.name}`,
      },
    });

    const forward = await assignWithinTx(tx, {
      shiftId: request.shiftId,
      userId: incomingUser.id,
      actor,
      overrideReason: input.overrideReason,
      reason: `${request.type.toLowerCase()} approved`,
      silent: true,
    });

    if (forward.kind !== 'assigned') {
      throw new SchedulingError(
        forward.kind === 'needs-override'
          ? `Approving this needs a documented reason: ${forward.evaluation.overridable
              .map((v) => v.message)
              .join(' ')}`
          : `This can no longer be approved. ${forward.evaluation.blocking
              .map((v) => v.message)
              .join(' ')}`,
        forward.kind === 'needs-override' ? 'NEEDS_OVERRIDE' : 'BLOCKED',
      );
    }

    let reverseShiftLabel: string | null = null;
    if (request.targetAssignmentId) {
      const targetAssignment = await tx.assignment.findUniqueOrThrow({
        where: { id: request.targetAssignmentId },
        select: assignmentDetail,
      });

      await tx.assignment.update({
        where: { id: request.targetAssignmentId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: `Swap approved by ${actor.name}`,
        },
      });

      const reverse = await assignWithinTx(tx, {
        shiftId: targetAssignment.shift.id,
        userId: request.requesterId,
        actor,
        overrideReason: input.overrideReason,
        reason: 'swap approved',
        silent: true,
      });

      if (reverse.kind !== 'assigned') {
        throw new SchedulingError(
          `The return leg of this swap cannot be approved. ${reverse.evaluation.blocking
            .concat(reverse.evaluation.overridable)
            .map((v) => v.message)
            .join(' ')}`,
          'BLOCKED',
        );
      }
      reverseShiftLabel = shiftLabel(targetAssignment.shift);
    }

    await tx.coverageRequest.update({
      where: { id: request.id },
      data: {
        status: 'APPROVED',
        decidedAt: new Date(),
        decidedById: actor.id,
        decisionNote: input.note ?? null,
      },
    });

    await recordAudit(tx, {
      action: 'COVERAGE_APPROVED',
      actorId: actor.id,
      actorLabel: `${actor.name} (${actor.role})`,
      entityType: 'CoverageRequest',
      entityId: request.id,
      locationId: request.shift.locationId,
      summary: `${actor.name} approved: ${request.requester.name} → ${incomingUser.name} for ${label}${
        reverseShiftLabel
          ? `, and ${incomingUser.name} → ${request.requester.name} for ${reverseShiftLabel}`
          : ''
      }`,
      after: {
        requestId: request.id,
        outgoing: request.requesterId,
        incoming: incomingUser.id,
      },
    });

    const created = await createNotifications(tx, [
      {
        userId: request.requesterId,
        type: 'SWAP_APPROVED',
        title: 'Your request was approved',
        body: reverseShiftLabel
          ? `You are off ${label} and now on ${reverseShiftLabel}.`
          : `You are no longer scheduled for ${label}. ${incomingUser.name} is covering it.`,
        href: '/schedule',
        data: { coverageRequestId: request.id },
      },
      {
        userId: incomingUser.id,
        type: 'SWAP_APPROVED',
        title: 'Shift confirmed',
        body: reverseShiftLabel
          ? `You are now on ${label}, and ${request.requester.name} takes ${reverseShiftLabel}.`
          : `You are now scheduled for ${label}.`,
        href: '/schedule',
        data: { coverageRequestId: request.id },
      },
    ]);

    return {
      approved: true,
      created,
      locationId: request.shift.locationId,
      participants: [request.requesterId, incomingUser.id],
    };
  });

  await pushNotifications(result.created, actor.id);
  await publish({
    type: 'coverage.resolved',
    audience: {
      userIds: result.participants,
      locationIds: [result.locationId],
    },
    message: result.approved
      ? 'A coverage request was approved'
      : 'A coverage request was rejected',
    payload: { coverageRequestId: input.requestId, approved: result.approved },
    actorId: actor.id,
  });

  return result.approved;
}

export async function expireStaleDrops(): Promise<number> {
  const now = new Date();

  const stale = await db.coverageRequest.findMany({
    where: { type: 'DROP', status: 'OPEN', expiresAt: { lte: now } },
    select: {
      id: true,
      requesterId: true,
      shift: {
        select: {
          startUtc: true,
          endUtc: true,
          locationId: true,
          location: { select: { name: true, timezone: true } },
        },
      },
    },
    take: 100,
  });

  if (stale.length === 0) return 0;

  await db.$transaction(async (tx) => {
    await tx.coverageRequest.updateMany({
      where: { id: { in: stale.map((s) => s.id) } },
      data: {
        status: 'EXPIRED',
        decidedAt: now,
        decisionNote: `Nobody claimed it before the ${DROP_EXPIRY_HOURS_BEFORE_SHIFT}h cutoff.`,
      },
    });

    for (const request of stale) {
      await recordAudit(tx, {
        action: 'COVERAGE_EXPIRED',
        actorId: null,
        actorLabel: 'System',
        entityType: 'CoverageRequest',
        entityId: request.id,
        locationId: request.shift.locationId,
        summary: `Drop request expired unclaimed for ${shiftLabel(request.shift)}`,
      });
    }

    await createNotifications(
      tx,
      stale.map((request) => ({
        userId: request.requesterId,
        type: 'DROP_EXPIRED' as const,
        title: 'Nobody picked up your shift',
        body: `${shiftLabel(request.shift)} was not claimed before the ${DROP_EXPIRY_HOURS_BEFORE_SHIFT}h cutoff. You are still scheduled for it.`,
        href: '/schedule',
        data: { coverageRequestId: request.id },
      })),
    );
  });

  return stale.length;
}
