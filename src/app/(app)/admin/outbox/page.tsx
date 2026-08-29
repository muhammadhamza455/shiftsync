import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';

export const metadata = { title: 'Email outbox — ShiftSync' };

export default async function OutboxPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'ADMIN') redirect('/dashboard');

  const [emails, total, optedIn] = await Promise.all([
    db.emailLog.findMany({
      orderBy: { sentAt: 'desc' },
      take: 60,
      select: {
        id: true,
        toAddress: true,
        subject: true,
        body: true,
        sentAt: true,
        user: { select: { name: true } },
      },
    }),
    db.emailLog.count(),
    db.notificationPreference.count({ where: { emailSimulation: true } }),
  ]);

  return (
    <>
      <PageHeader
        title="Email outbox"
        description="Nothing is actually sent. Every message a recipient opted into is recorded here so the email path is verifiable rather than assumed."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Messages recorded" value={total} />
        <Stat label="Opted into email" value={optedIn} sub="Users" />
        <Stat label="Actually delivered" value="0" sub="By design" />
      </div>

      <Card>
        <CardHeader
          title="Recent messages"
          description={total > 60 ? 'Showing the 60 most recent.' : undefined}
        />
        {emails.length === 0 ? (
          <EmptyState
            title="Outbox is empty"
            description="Users who enable simulated email in their settings will have their notifications recorded here."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {emails.map((email) => (
              <li key={email.id} className="px-5 py-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-medium">{email.subject}</p>
                      <Badge tone="neutral">simulated</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      To {email.user.name} &lt;{email.toAddress}&gt;
                    </p>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-muted">
{email.body}
                    </pre>
                  </div>
                  <time
                    dateTime={email.sentAt.toISOString()}
                    className="shrink-0 text-xs text-muted"
                  >
                    {relativeTime(email.sentAt)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
