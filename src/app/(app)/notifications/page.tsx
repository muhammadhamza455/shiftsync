import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { NotificationsList } from './notifications-list';
import { Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Notifications — ShiftSync' };

export default async function NotificationsPage() {
  const viewer = await requireViewer();

  const notifications = await db.notification.findMany({
    where: { userId: viewer.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
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

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Every notification is stored here, so a missed live update is never a lost message."
      />
      {notifications.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing yet"
            description="Schedule changes, swap updates and overtime warnings will appear here."
          />
        </Card>
      ) : (
        <NotificationsList
          items={notifications.map((n) => ({
            id: n.id,
            type: n.type,
            title: n.title,
            body: n.body,
            href: n.href,
            read: n.readAt !== null,
            createdAt: n.createdAt.toISOString(),
          }))}
        />
      )}
    </>
  );
}
