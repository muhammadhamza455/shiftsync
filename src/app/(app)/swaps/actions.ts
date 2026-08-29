'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { AuthorizationError, requireViewer } from '@/lib/auth/session';
import { SchedulingError } from '@/lib/services/assignments';
import {
  cancelCoverageRequest,
  claimDrop,
  decideCoverageRequest,
  requestDrop,
  requestSwap,
  respondToSwap,
} from '@/lib/services/coverage';

export interface CoverageActionResult {
  ok: boolean;
  message?: string;
}

function handle(error: unknown): CoverageActionResult {
  if (error instanceof SchedulingError || error instanceof AuthorizationError) {
    return { ok: false, message: error.message };
  }
  if (error instanceof z.ZodError) {
    return { ok: false, message: error.issues[0]?.message ?? 'Invalid input.' };
  }
  console.error('[coverage action]', error);
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

function revalidateCoverage() {
  revalidatePath('/swaps');
  revalidatePath('/swaps/open');
  revalidatePath('/manage/swaps');
  revalidatePath('/schedule');
  revalidatePath('/manage/schedule');
  revalidatePath('/dashboard');
}

export async function requestSwapAction(input: {
  requesterAssignmentId: string;
  targetUserId: string;
  targetAssignmentId?: string;
  note?: string;
}): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    await requestSwap({ ...input, actor });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function requestDropAction(input: {
  assignmentId: string;
  note?: string;
}): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    await requestDrop({ ...input, actor });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function respondToSwapAction(
  requestId: string,
  accept: boolean,
): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    await respondToSwap({ requestId, accept, actor });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function claimDropAction(
  requestId: string,
): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    await claimDrop({ requestId, actor });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function cancelCoverageAction(
  requestId: string,
  reason?: string,
): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    await cancelCoverageRequest({ requestId, actor, reason });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function decideCoverageAction(input: {
  requestId: string;
  approve: boolean;
  note?: string;
  overrideReason?: string;
}): Promise<CoverageActionResult> {
  try {
    const actor = await requireViewer();
    if (actor.role === 'STAFF') {
      return { ok: false, message: 'Only managers can approve coverage.' };
    }
    await decideCoverageRequest({ ...input, actor });
    revalidateCoverage();
    return { ok: true };
  } catch (error) {
    return handle(error);
  }
}

export async function swapCandidatesAction(assignmentId: string): Promise<{
  candidates: { id: string; name: string }[];
}> {
  const viewer = await requireViewer();
  const assignment = await db.assignment.findFirst({
    where: { id: assignmentId, userId: viewer.id, status: 'ASSIGNED' },
    select: {
      shift: { select: { locationId: true, requiredSkillId: true } },
    },
  });
  if (!assignment) return { candidates: [] };

  const candidates = await db.user.findMany({
    where: {
      role: 'STAFF',
      isActive: true,
      id: { not: viewer.id },
      skills: {
        some: { skillId: assignment.shift.requiredSkillId, revokedAt: null },
      },
      certifications: {
        some: { locationId: assignment.shift.locationId, revokedAt: null },
      },
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });

  return { candidates };
}
