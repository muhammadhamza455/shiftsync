import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { SettingsForm } from './settings-form';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';

export const metadata = { title: 'Settings — ShiftSync' };

export default async function SettingsPage() {
  const viewer = await requireViewer();

  const preference = await db.notificationPreference.findUnique({
    where: { userId: viewer.id },
    select: { emailSimulation: true, mutedTypes: true },
  });

  return (
    <>
      <PageHeader
        title="Notification settings"
        description="In-app notifications are always on — they are the record of what happened. Email is simulated: nothing leaves the system, and every message is written to an outbox an admin can read."
      />

      <SettingsForm
        role={viewer.role}
        emailSimulation={preference?.emailSimulation ?? false}
        mutedTypes={(preference?.mutedTypes as Record<string, boolean>) ?? {}}
      />

      <Card className="mt-4">
        <CardHeader title="Your account" />
        <CardBody className="space-y-1 text-sm">
          <p>
            <span className="text-muted">Name</span> · {viewer.name}
          </p>
          <p>
            <span className="text-muted">Email</span> · {viewer.email}
          </p>
          <p>
            <span className="text-muted">Role</span> · {viewer.role}
          </p>
          <p>
            <span className="text-muted">Home timezone</span> ·{' '}
            {viewer.timezone}
          </p>
          <p className="pt-1 text-xs text-muted">
            Your home timezone frames your own days and weeks for the hours
            rules. Shift times are always displayed in the timezone of the
            location being worked, never this one.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
