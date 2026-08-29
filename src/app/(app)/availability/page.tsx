import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { AvailabilityEditor } from './availability-editor';
import { Card, CardBody, CardHeader, PageHeader } from '@/components/ui';
import { shortLocation } from '@/lib/format';

export const metadata = { title: 'My availability — ShiftSync' };

export default async function AvailabilityPage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'STAFF') redirect('/dashboard');

  const [rules, exceptions, certifications] = await Promise.all([
    db.availabilityRule.findMany({
      where: { userId: viewer.id },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      select: {
        id: true,
        dayOfWeek: true,
        startTime: true,
        endTime: true,
        timezone: true,
      },
    }),
    db.availabilityException.findMany({
      where: {
        userId: viewer.id,
        date: { gte: new Date(Date.now() - 7 * 86_400_000) },
      },
      orderBy: { date: 'asc' },
      select: {
        id: true,
        type: true,
        date: true,
        startTime: true,
        endTime: true,
        reason: true,
      },
    }),
    db.locationCertification.findMany({
      where: { userId: viewer.id, revokedAt: null },
      select: { location: { select: { name: true, timezone: true } } },
    }),
  ]);

  const zones = [...new Set(certifications.map((c) => c.location.timezone))];
  const crossZone = zones.length > 1;

  return (
    <>
      <PageHeader
        title="My availability"
        description="Managers can only schedule you inside these windows. Keeping them accurate is the single biggest thing that prevents being rostered when you cannot work."
      />

      {crossZone ? (
        <Card className="mb-4 border-brand/30 bg-brand-soft/30">
          <CardHeader
            title="You work across two timezones"
            description={`You are certified at ${certifications
              .map((c) => shortLocation(c.location.name))
              .join(', ')} — which span ${zones
              .map((z) => z.replace('America/', '').replace('_', ' '))
              .join(' and ')}.`}
          />
          <CardBody className="text-sm text-muted">
            <p>
              That makes &ldquo;9am to 5pm&rdquo; ambiguous, so each window below
              lets you say which you mean:
            </p>
            <ul className="mt-2 space-y-1.5">
              <li>
                <strong className="font-medium text-foreground">
                  Local to the location
                </strong>{' '}
                — 9am wherever you are working that day. Choose this if you
                travel between sites and your day starts when the restaurant
                opens.
              </li>
              <li>
                <strong className="font-medium text-foreground">
                  A fixed timezone
                </strong>{' '}
                — 9am Pacific always, which is midday to 8pm at an Eastern
                location. Choose this if you live in one zone and only ever work
                remotely-scheduled shifts around it.
              </li>
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <AvailabilityEditor
        initialRules={rules.map((r) => ({
          dayOfWeek: r.dayOfWeek,
          startTime: r.startTime,
          endTime: r.endTime,
          timezone: r.timezone,
        }))}
        exceptions={exceptions.map((e) => ({
          id: e.id,
          type: e.type,
          date: e.date.toISOString().slice(0, 10),
          startTime: e.startTime,
          endTime: e.endTime,
          reason: e.reason,
        }))}
        homeTimezone={viewer.timezone}
        availableZones={zones}
      />
    </>
  );
}
