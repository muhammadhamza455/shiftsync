'use server';

import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/auth/session';
import { markAllRead, markRead } from '@/lib/services/notifications';

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read: boolean;
  createdAt: string;
}

export async function fetchNotifications(limit = 12): Promise<NotificationDto[]> {
  const viewer = await requireViewer();
  const rows = await db.notification.findMany({
    where: { userId: viewer.id },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      href: true,
      readAt: true,
      createdAt: true,
    },
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: n.href,
    read: n.readAt !== null,
    createdAt: n.createdAt.toISOString(),
  }));
}

export async function markNotificationRead(id: string): Promise<number> {
  const viewer = await requireViewer();
  const count = await markRead(viewer.id, [id]);
  revalidatePath('/notifications');
  return count;
}

export async function markAllNotificationsRead(): Promise<number> {
  const viewer = await requireViewer();
  const count = await markAllRead(viewer.id);
  revalidatePath('/notifications');
  return count;
}

export async function getUnreadCount(): Promise<number> {
  const viewer = await requireViewer();
  return db.notification.count({ where: { userId: viewer.id, readAt: null } });
}
