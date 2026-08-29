'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/auth/session';
import { recordAudit } from '@/lib/services/audit';
import {
  createNotifications,
  pushNotifications,
} from '@/lib/services/notifications';
import { publish } from '@/lib/realtime/publish';
import { isValidTimeZone } from '@/lib/time/zones';

export interface AvailabilityActionResult {
  ok: boolean;
  message?: string;
}

const ruleSchema = z.object({
  dayOfWeek: z.coerce.number().int().min(1).max(7),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  timezone: z.string().nullable(),
});

const exceptionSchema = z.object({
  type: z.enum(['UNAVAILABLE', 'AVAILABLE']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  reason: z.string().max(200).optional().nullable(),
});

async function notifyManagers(
  userId: string,
  userName: string,
  summary: string,
) {
  const certifications = await db.locationCertification.findMany({
    where: { userId, revokedAt: null },
    select: { locationId: true },
  });
  const locationIds = certifications.map((c) => c.locationId);
  if (locationIds.length === 0) return;

  const managers = await db.managerAssignment.findMany({
    where: { locationId: { in: locationIds } },
    select: { userId: true },
    distinct: ['userId'],
  });

  const created = await createNotifications(
    db,
    managers.map((m) => ({
      userId: m.userId,
      type: 'AVAILABILITY_CHANGED' as const,
      title: `${userName} updated their availability`,
      body: summary,
      href: '/manage/schedule',
      data: { staffId: userId },
    })),
  );
  await pushNotifications(created, userId);

  await publish({
    type: 'availability.changed',
    audience: { locationIds },
    payload: { staffId: userId },
    actorId: userId,
  });
}

export async function saveWeeklyAvailabilityAction(
  rules: unknown,
): Promise<AvailabilityActionResult> {
  try {
    const viewer = await requireViewer();
    const parsed = z.array(ruleSchema).max(21).parse(rules);

    for (const rule of parsed) {
      if (rule.timezone && !isValidTimeZone(rule.timezone)) {
        return { ok: false, message: `Unknown timezone "${rule.timezone}".` };
      }
    }

    const before = await db.availabilityRule.findMany({
      where: { userId: viewer.id },
      select: { dayOfWeek: true, startTime: true, endTime: true, timezone: true },
    });

    await db.$transaction(async (tx) => {
      await tx.availabilityRule.deleteMany({ where: { userId: viewer.id } });
      if (parsed.length > 0) {
        await tx.availabilityRule.createMany({
          data: parsed.map((rule) => ({
            userId: viewer.id,
            dayOfWeek: rule.dayOfWeek,
            startTime: rule.startTime,
            endTime: rule.endTime,
            spansMidnight: rule.endTime <= rule.startTime,
            timezone: rule.timezone,
            effectiveFrom: new Date(Date.now() - 365 * 86_400_000),
          })),
        });
      }

      await recordAudit(tx, {
        action: 'AVAILABILITY_UPDATED',
        actorId: viewer.id,
        actorLabel: `${viewer.name} (${viewer.role})`,
        entityType: 'Availability',
        entityId: viewer.id,
        summary: `${viewer.name} updated their weekly availability (${parsed.length} windows)`,
        before,
        after: parsed,
      });
    });

    await notifyManagers(
      viewer.id,
      viewer.name,
      `Their weekly pattern now has ${parsed.length} window${
        parsed.length === 1 ? '' : 's'
      }. Existing assignments are not changed — check the compliance panel on the schedule.`,
    );

    revalidatePath('/availability');
    revalidatePath('/manage/schedule');
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: 'Some of those times are not valid.' };
    }
    console.error('[availability]', error);
    return { ok: false, message: 'Could not save your availability.' };
  }
}

export async function addExceptionAction(
  raw: unknown,
): Promise<AvailabilityActionResult> {
  try {
    const viewer = await requireViewer();
    const input = exceptionSchema.parse(raw);

    if (
      input.type === 'AVAILABLE' &&
      (!input.startTime || !input.endTime)
    ) {
      return {
        ok: false,
        message: 'Extra availability needs a start and end time.',
      };
    }

    await db.availabilityException.create({
      data: {
        userId: viewer.id,
        type: input.type,
        date: new Date(`${input.date}T00:00:00Z`),
        startTime: input.startTime,
        endTime: input.endTime,
        spansMidnight:
          Boolean(input.startTime && input.endTime) &&
          input.endTime! <= input.startTime!,
        timezone: null,
        reason: input.reason ?? null,
      },
    });

    await recordAudit(db, {
      action: 'AVAILABILITY_UPDATED',
      actorId: viewer.id,
      actorLabel: `${viewer.name} (${viewer.role})`,
      entityType: 'Availability',
      entityId: viewer.id,
      summary: `${viewer.name} added a one-off ${
        input.type === 'UNAVAILABLE' ? 'blackout' : 'availability window'
      } on ${input.date}`,
      after: input,
    });

    await notifyManagers(
      viewer.id,
      viewer.name,
      input.type === 'UNAVAILABLE'
        ? `They are unavailable on ${input.date}${
            input.reason ? ` — ${input.reason}` : ''
          }.`
        : `They added extra availability on ${input.date}.`,
    );

    revalidatePath('/availability');
    revalidatePath('/manage/schedule');
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: 'Check the date and times.' };
    }
    console.error('[availability exception]', error);
    return { ok: false, message: 'Could not save that exception.' };
  }
}

export async function deleteExceptionAction(
  id: string,
): Promise<AvailabilityActionResult> {
  try {
    const viewer = await requireViewer();
    const deleted = await db.availabilityException.deleteMany({
      where: { id, userId: viewer.id },
    });
    if (deleted.count === 0) {
      return { ok: false, message: 'That entry no longer exists.' };
    }
    revalidatePath('/availability');
    return { ok: true };
  } catch {
    return { ok: false, message: 'Could not remove that entry.' };
  }
}
