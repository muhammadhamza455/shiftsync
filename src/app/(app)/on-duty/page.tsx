import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { coverageGaps, onDutyNow } from '@/lib/services/analytics';
import { formatTime, zoneAbbreviation } from '@/lib/time/zones';
import { OnDutyList } from '@/components/on-duty-list';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';
import { shortLocation } from '@/lib/format';

export const metadata = { title: 'On duty now — ShiftSync' };

export const dynamic = 'force-dynamic';

export default async function OnDutyPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/schedule');

  const now = new Date();

  const [locations, duty, gaps] = await Promise.all([
    db.location.findMany({
      where: { id: { in: viewer.locationIds } },
      select: { id: true, name: true, timezone: true },
      orderBy: { name: 'asc' },
    }),
    onDutyNow(viewer.locationIds, now),
    coverageGaps(viewer.locationIds, now, new Date(now.getTime() + 86_400_000)),
  ]);

  const onFloor = duty.filter((d) => d.state === 'ON_DUTY');
  const missing = duty.filter((d) => d.state === 'NOT_CLOCKED_IN');
  const overrunning = duty.filter((d) => d.state === 'OVERRUNNING');

  return (
    <>
      <PageHeader
        title="On duty now"
        description="Driven by clock-in rather than the roster, so someone scheduled but absent shows as a gap instead of quietly reading as present. Updates live."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="On the floor" value={onFloor.length} tone="ok" />
        <Stat
          label="Scheduled, not clocked in"
          value={missing.length}
          tone={missing.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Running over"
          value={overrunning.length}
          tone={overrunning.length > 0 ? 'override' : 'ok'}
        />
        <Stat
          label="Unfilled today"
          value={gaps.reduce((sum, g) => sum + g.needed, 0)}
          tone={gaps.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {locations.map((location) => {
          const rows = duty.filter((d) => d.locationId === location.id);
          const localTime = formatTime(now, location.timezone);
          return (
            <Card key={location.id} className="min-w-0">
              <CardHeader
                title={shortLocation(location.name)}
                description={
                  <>
                    Local time {localTime}{' '}
                    {zoneAbbreviation(now, location.timezone)}
                  </>
                }
                action={
                  <Badge tone={rows.length > 0 ? 'ok' : 'neutral'}>
                    {rows.filter((r) => r.state === 'ON_DUTY').length} on duty
                  </Badge>
                }
              />
              <CardBody>
                <OnDutyList rows={rows} />
              </CardBody>
            </Card>
          );
        })}
      </div>

      {gaps.length > 0 ? (
        <Card className="mt-4">
          <CardHeader
            title="Still short today"
            description="Shifts in the next 24 hours that do not have their full headcount."
          />
          <ul className="divide-y divide-[var(--border)]">
            {gaps.map((gap) => (
              <li
                key={gap.shiftId}
                className="flex items-center justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{gap.label}</p>
                  <p className="truncate text-xs text-muted">
                    {shortLocation(gap.locationName)} · {gap.skill}
                  </p>
                </div>
                <Badge tone="warn">
                  {gap.needed} more needed
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Card className="mt-4">
          <EmptyState
            title="Fully covered for the next 24 hours"
            description="Every shift today has its required headcount."
          />
        </Card>
      )}
    </>
  );
}
