import { redirect } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireViewer } from '@/lib/auth/session';
import { weekKey } from '@/lib/time/zones';
import { complianceIssues, getWeekBoard } from '@/lib/queries/schedule';
import { WeekBoardView } from './week-board';
import { Card, EmptyState, PageHeader } from '@/components/ui';
import { shortLocation } from '@/lib/format';

export const metadata = { title: 'Build schedule — ShiftSync' };

export default async function ManageSchedulePage(
  props: PageProps<'/manage/schedule'>,
) {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/schedule');

  const searchParams = await props.searchParams;
  const requestedLocation =
    typeof searchParams.location === 'string' ? searchParams.location : null;
  const requestedWeek =
    typeof searchParams.week === 'string' ? searchParams.week : null;

  const locations = await db.location.findMany({
    where:
      viewer.role === 'ADMIN'
        ? { isActive: true }
        : { id: { in: viewer.managedLocationIds }, isActive: true },
    select: { id: true, name: true, timezone: true },
    orderBy: { name: 'asc' },
  });

  if (locations.length === 0) {
    return (
      <>
        <PageHeader title="Build schedule" />
        <Card>
          <EmptyState
            title="No locations assigned"
            description="You are not assigned to manage any location yet. An admin can add you from the team page."
          />
        </Card>
      </>
    );
  }

  const location =
    locations.find((l) => l.id === requestedLocation) ?? locations[0];
  const week = requestedWeek ?? weekKey(new Date(), location.timezone);

  const [board, issues, skills] = await Promise.all([
    getWeekBoard(location.id, week),
    complianceIssues(location.id, week),
    db.skill.findMany({
      select: { id: true, name: true, colour: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  if (!board) redirect('/manage/schedule');

  return (
    <>
      <PageHeader
        title="Build schedule"
        description={
          <>
            Times are shown in{' '}
            <strong className="font-medium text-foreground">
              {location.timezone.replace('America/', '').replace('_', ' ')}
            </strong>{' '}
            — this location&rsquo;s own timezone, whatever your own clock says.
          </>
        }
        action={
          locations.length > 1 ? (
            <nav
              aria-label="Location"
              className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1"
            >
              {locations.map((l) => (
                <Link
                  key={l.id}
                  href={`/manage/schedule?location=${l.id}&week=${week}`}
                  aria-current={l.id === location.id ? 'true' : undefined}
                  className={
                    l.id === location.id
                      ? 'rounded-md bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand'
                      : 'rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface-muted'
                  }
                >
                  {shortLocation(l.name)}
                </Link>
              ))}
            </nav>
          ) : null
        }
      />

      <WeekBoardView
        board={board}
        issues={issues}
        skills={skills}
        canManage
      />
    </>
  );
}
