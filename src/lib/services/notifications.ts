import type { Prisma } from '@/generated/prisma/client';
import type { NotificationType } from '@/generated/prisma/enums';
import { db } from '@/lib/db';
import { publish } from '@/lib/realtime/publish';
import type { DbClient } from './audit';

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  href?: string;
  data?: Record<string, unknown>;
}

interface PreparedNotification extends NotifyInput {
  id: string;
}

export async function createNotifications(
  client: DbClient,
  inputs: NotifyInput[],
): Promise<PreparedNotification[]> {
  if (inputs.length === 0) return [];

  const userIds = [...new Set(inputs.map((i) => i.userId))];
  const preferences = await client.notificationPreference.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, emailSimulation: true, mutedTypes: true },
  });
  const prefsByUser = new Map(preferences.map((p) => [p.userId, p]));

  const created: PreparedNotification[] = [];

  for (const input of inputs) {
    const pref = prefsByUser.get(input.userId);
    const muted = (pref?.mutedTypes ?? null) as Record<string, boolean> | null;
    if (muted && muted[input.type] === false) continue;

    const notification = await client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        title: input.title,
        body: input.body,
        href: input.href,
        data: (input.data ?? null) as Prisma.InputJsonValue,
      },
      select: { id: true, user: { select: { email: true } } },
    });

    if (pref?.emailSimulation) {
      await client.emailLog.create({
        data: {
          userId: input.userId,
          notificationId: notification.id,
          toAddress: notification.user.email,
          subject: input.title,
          body: renderEmailBody(input),
        },
      });
    }

    created.push({ ...input, id: notification.id });
  }

  return created;
}

export async function pushNotifications(
  notifications: PreparedNotification[],
  actorId?: string,
): Promise<void> {
  await Promise.allSettled(
    notifications.map((n) =>
      publish({
        type: 'notification.created',
        audience: { userIds: [n.userId] },
        message: n.title,
        payload: {
          notificationId: n.id,
          notificationType: n.type,
          body: n.body,
          href: n.href,
        },
        actorId,
      }),
    ),
  );
}

export async function notify(
  inputs: NotifyInput[],
  actorId?: string,
): Promise<void> {
  const created = await createNotifications(db, inputs);
  await pushNotifications(created, actorId);
}

function renderEmailBody(input: NotifyInput): string {
  const lines = [
    input.body,
    '',
    input.href
      ? `Open ShiftSync: ${process.env.NEXT_PUBLIC_APP_URL ?? ''}${input.href}`
      : '',
    '',
    '— ShiftSync, Coastal Eats',
    '(This is a simulated email. No message was actually sent.)',
  ];
  return lines.filter(Boolean).join('\n');
}

export async function markRead(
  userId: string,
  notificationIds: string[],
): Promise<number> {
  const result = await db.notification.updateMany({
    where: { id: { in: notificationIds }, userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function markAllRead(userId: string): Promise<number> {
  const result = await db.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function unreadCount(userId: string): Promise<number> {
  return db.notification.count({ where: { userId, readAt: null } });
}
