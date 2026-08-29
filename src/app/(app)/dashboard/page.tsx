import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  Scale,
} from 'lucide-react';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  coverageGaps,
  fairnessReport,
  onDutyNow,
  overtimeReport,
} from '@/lib/services/analytics';
import { weekKey, formatShiftRange, hoursBetween } from '@/lib/time/zones';
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  Stat,
} from '@/components/ui';
import { OnDutyList } from '@/components/on-duty-list';
import { formatCurrency, formatHours, shortLocation } from '@/lib/format';

export const metadata = { title: 'Dashboard — ShiftSync' };

export default async function DashboardPage() {
  const viewer = await requireViewer();
  return viewer.role === 'STAFF' ? (
    <StaffDashboard />
  ) : (
    <ManagerDashboard />
  );
}

async function StaffDashboard() {
  const viewer = await requireViewer();
  const now = new Date();
  const thisWeek = weekKey(now, viewer.timezone);

  const [assignments, profile, requests, openDrops] = await Promise.all([
    db.assignment.findMany({
      where: {
        userId: viewer.id,
        status: 'ASSIGNED',
        shift: { status: 'PUBLISHED', endUtc: { gte: now } },
      },
      orderBy: { shift: { startUtc: 'asc' } },
      take: 6,
      select: {
        id: true,
        clockInAt: true,
        clockOutAt: true,
        shift: {
          select: {
            id: true,
            startUtc: true,
            endUtc: true,
            isPremium: true,
            weekKey: true,
            location: { select: { name: true, timezone: true } },
            requiredSkill: { select: { name: true, colour: true } },
          },
        },
      },
    }),
    db.staffProfile.findUnique({
      where: { userId: viewer.id },
      select: { desiredWeeklyHours: true },
    }),
    db.coverageRequest.count({
      where: {
        OR: [{ requesterId: viewer.id }, { targetId: viewer.id }],
        status: { in: ['OPEN', 'PENDING_MANAGER'] },
      },
    }),
    db.coverageRequest.count({
      where: {
        type: 'DROP',
        status: 'OPEN',
        requesterId: { not: viewer.id },
        expiresAt: { gt: now },
        shift: { locationId: { in: viewer.locationIds } },
      },
    }),
  ]);

  const weekAssignments = await db.assignment.findMany({
    where: {
      userId: viewer.id,
      status: 'ASSIGNED',
      shift: { status: { not: 'CANCELLED' } },
    },
    select: { shift: { select: { startUtc: true, endUtc: true } } },
  });
  const weeklyHours = weekAssignments
    .filter((a) => weekKey(a.shift.startUtc, viewer.timezone) === thisWeek)
    .reduce((sum, a) => sum + hoursBetween(a.shift.startUtc, a.shift.endUtc), 0);

  const desired = profile?.desiredWeeklyHours ?? 30;

  return (
    <>
      <PageHeader
        title={`Hello, ${viewer.name.split(' ')[0]}`}
        description="Your upcoming shifts, shown in each location's own timezone."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="This week"
          value={formatHours(weeklyHours)}
          sub={`You asked for about ${desired}h`}
          tone={
            weeklyHours > 40 ? 'block' : weeklyHours >= 35 ? 'warn' : 'ok'
          }
        />
        <Stat label="Upcoming shifts" value={assignments.length} />
        <Stat
          label="Open requests"
          value={requests}
          sub="Limit is 3 at a time"
          tone={requests >= 3 ? 'warn' : 'neutral'}
        />
        <Stat
          label="Shifts up for grabs"
          value={openDrops}
          sub={openDrops ? 'You may qualify' : 'None right now'}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Your next shifts"
            action={
              <Link
                href="/schedule"
                className="text-xs font-medium text-brand hover:underline"
              >
                Full schedule
              </Link>
            }
          />
          {assignments.length === 0 ? (
            <EmptyState
              title="Nothing scheduled"
              description="When your manager publishes a schedule you will be notified and it will appear here."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {assignments.map((assignment) => (
                <li
                  key={assignment.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatShiftRange(
                        assignment.shift.startUtc,
                        assignment.shift.endUtc,
                        assignment.shift.location.timezone,
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {shortLocation(assignment.shift.location.name)} ·{' '}
                      {assignment.shift.requiredSkill.name}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {assignment.shift.isPremium ? (
                      <Badge tone="premium">Premium</Badge>
                    ) : null}
                    {assignment.clockInAt && !assignment.clockOutAt ? (
                      <Badge tone="ok">On duty</Badge>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Hours against your target" />
            <CardBody>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium tabular-nums">
                  {formatHours(weeklyHours)}
                </span>
                <span className="text-xs text-muted">target {desired}h</span>
              </div>
              <Meter
                fraction={desired > 0 ? weeklyHours / desired : 0}
                tone={
                  weeklyHours > 40
                    ? 'block'
                    : weeklyHours >= 35
                      ? 'warn'
                      : 'ok'
                }
              />
              <p className="mt-2 text-xs text-muted">
                {weeklyHours < desired
                  ? `${formatHours(desired - weeklyHours)} below your stated target. Picking up an open shift would close the gap.`
                  : weeklyHours > 40
                    ? 'You are into overtime this week.'
                    : 'You are at or above your stated target.'}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Quick actions" />
            <CardBody className="space-y-1.5">
              {[
                { href: '/swaps/open', label: 'Pick up an open shift', icon: ClipboardCheck },
                { href: '/swaps', label: 'Swap or drop a shift', icon: CalendarClock },
                { href: '/availability', label: 'Update my availability', icon: Scale },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm hover:bg-surface-muted"
                >
                  <span className="flex items-center gap-2">
                    <item.icon className="size-4 text-muted" />
                    {item.label}
                  </span>
                  <ArrowRight className="size-3.5 text-muted" />
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

async function ManagerDashboard() {
  const viewer = await requireViewer();
  const now = new Date();
  const locationIds = viewer.locationIds;

  const primaryZone =
    (
      await db.location.findFirst({
        where: { id: { in: locationIds } },
        select: { timezone: true },
      })
    )?.timezone ?? viewer.timezone;

  const thisWeek = weekKey(now, primaryZone);

  const [gaps, overtime, fairness, duty, approvals] = await Promise.all([
    coverageGaps(locationIds, now, new Date(now.getTime() + 3 * 86_400_000)),
    overtimeReport(locationIds, thisWeek),
    fairnessReport(
      locationIds,
      new Date(now.getTime() - 28 * 86_400_000),
      new Date(now.getTime() + 7 * 86_400_000),
    ),
    onDutyNow(locationIds, now),
    db.coverageRequest.count({
      where: {
        status: 'PENDING_MANAGER',
        shift: { locationId: { in: locationIds } },
      },
    }),
  ]);

  const overStaff = overtime.rows.filter((r) => r.status === 'OVER');
  const approachingStaff = overtime.rows.filter(
    (r) => r.status === 'APPROACHING',
  );
  const underServed = fairness.rows.filter((r) => r.standing === 'UNDER_SERVED');

  return (
    <>
      <PageHeader
        title={viewer.role === 'ADMIN' ? 'All locations' : 'Your locations'}
        description={`${locationIds.length} location${
          locationIds.length === 1 ? '' : 's'
        } · week ${thisWeek}`}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Unfilled positions"
          value={gaps.reduce((sum, g) => sum + g.needed, 0)}
          sub="Next 72 hours"
          tone={gaps.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Projected overtime"
          value={formatHours(overtime.totals.overtimeHours)}
          sub={`${formatCurrency(overtime.totals.overtimeCost)} extra`}
          tone={overtime.totals.overtimeHours > 0 ? 'block' : 'ok'}
        />
        <Stat
          label="Awaiting approval"
          value={approvals}
          sub="Swaps and pickups"
          tone={approvals > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Fairness score"
          value={`${fairness.fairnessScore}/100`}
          sub="Premium shift spread, 4 weeks"
          tone={
            fairness.fairnessScore < 60
              ? 'block'
              : fairness.fairnessScore < 80
                ? 'warn'
                : 'ok'
          }
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Coverage gaps"
            description="Shifts in the next 72 hours that are still short."
            action={
              <Link
                href="/manage/schedule"
                className="text-xs font-medium text-brand hover:underline"
              >
                Open builder
              </Link>
            }
          />
          {gaps.length === 0 ? (
            <EmptyState
              title="Everything is covered"
              description="No unfilled positions in the next three days."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {gaps.slice(0, 6).map((gap) => (
                <li key={gap.shiftId} className="px-5 py-3">
                  <Link
                    href={`/manage/schedule?location=${gap.locationId}`}
                    className="flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{gap.label}</p>
                      <p className="truncate text-xs text-muted">
                        {shortLocation(gap.locationName)} · {gap.skill}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {gap.isPremium ? <Badge tone="premium">Premium</Badge> : null}
                      <Badge tone="warn">
                        {gap.filled}/{gap.headcount} filled
                      </Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="On duty now"
            description="Live — updates without refreshing."
            action={
              <Link
                href="/on-duty"
                className="text-xs font-medium text-brand hover:underline"
              >
                Board
              </Link>
            }
          />
          <CardBody>
            <OnDutyList rows={duty} compact />
          </CardBody>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Overtime watch"
            description="This week, across every location you manage."
            action={
              <Link
                href="/manage/overtime"
                className="text-xs font-medium text-brand hover:underline"
              >
                Full report
              </Link>
            }
          />
          {overStaff.length === 0 && approachingStaff.length === 0 ? (
            <EmptyState
              title="Nobody is near overtime"
              description="Every person is comfortably under 35 hours this week."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {[...overStaff, ...approachingStaff].slice(0, 6).map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{row.name}</p>
                    <Meter
                      className="mt-1.5 max-w-56"
                      fraction={row.totalHours / 52}
                      tone={row.status === 'OVER' ? 'block' : 'warn'}
                    />
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-medium tabular-nums">
                      {formatHours(row.totalHours)}
                    </p>
                    {row.overtimeHours > 0 ? (
                      <p className="text-xs text-block">
                        +{formatHours(row.overtimeHours)} OT
                      </p>
                    ) : (
                      <p className="text-xs text-muted">
                        {formatHours(40 - row.totalHours)} left
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Under-served on premium shifts"
            description="Fri/Sat evenings, last 4 weeks."
            action={
              <Link
                href="/manage/fairness"
                className="text-xs font-medium text-brand hover:underline"
              >
                Report
              </Link>
            }
          />
          {underServed.length === 0 ? (
            <EmptyState
              title="Evenly distributed"
              description="Nobody is meaningfully below an even share."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {underServed.slice(0, 5).map((row) => (
                <li
                  key={row.userId}
                  className="flex items-center justify-between gap-2 px-5 py-2.5"
                >
                  <p className="truncate text-sm">{row.name}</p>
                  <Badge tone={row.premiumShiftCount === 0 ? 'block' : 'warn'}>
                    {row.premiumShiftCount} of {row.expectedPremium} expected
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {overStaff.length > 0 ? (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-block/25 bg-block-soft px-3 py-2.5 text-sm text-block">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            {overStaff.length === 1
              ? `${overStaff[0].name} is`
              : `${overStaff.length} people are`}{' '}
            projected into overtime this week, adding{' '}
            {formatCurrency(overtime.totals.overtimeCost)} to the wage bill.{' '}
            <Link href="/manage/overtime" className="underline">
              See which shifts caused it
            </Link>
            .
          </span>
        </p>
      ) : null}
    </>
  );
}
