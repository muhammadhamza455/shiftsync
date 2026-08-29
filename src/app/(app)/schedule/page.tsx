import { redirect } from 'next/navigation';
import { Moon } from 'lucide-react';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import {
  formatShiftRange,
  hoursBetween,
  localDate,
  weekKey,
} from '@/lib/time/zones';
import { DROP_EXPIRY_HOURS_BEFORE_SHIFT } from '@/lib/scheduling/rules';
import { MyShiftActions } from './my-shift-actions';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';
import { formatHours, shortLocation } from '@/lib/format';

export const metadata = { title: 'My schedule — ShiftSync' };

export interface MyShift {
  assignmentId: string;
  shiftId: string;
  locationName: string;
  timeZone: string;
  skillName: string;
  skillColour: string;
  rangeLabel: string;
  dayLabel: string;
  startIso: string;
  hours: number;
  isPremium: boolean;
  isOvernight: boolean;
  notes: string | null;
  clockedIn: boolean;
  clockedOut: boolean;
  canRequestCoverage: boolean;
  coverage: { id: string; type: 'SWAP' | 'DROP'; status: string } | null;
}

export default async function MySchedulePage() {
  const viewer = await requireViewer();
  if (viewer.role !== 'STAFF') redirect('/manage/schedule');

  const now = new Date();
  const horizon = new Date(now.getTime() + 45 * 86_400_000);

  const assignments = await db.assignment.findMany({
    where: {
      userId: viewer.id,
      status: 'ASSIGNED',
      shift: {
        status: 'PUBLISHED',
        endUtc: { gte: new Date(now.getTime() - 12 * 3_600_000) },
        startUtc: { lte: horizon },
      },
    },
    orderBy: { shift: { startUtc: 'asc' } },
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
          notes: true,
          location: { select: { name: true, timezone: true } },
          requiredSkill: { select: { name: true, colour: true } },
          coverageRequests: {
            where: { status: { in: ['OPEN', 'PENDING_MANAGER'] } },
            select: {
              id: true,
              type: true,
              status: true,
              requesterAssignmentId: true,
            },
          },
        },
      },
    },
  });

  const shifts: MyShift[] = assignments.map((a) => {
    const tz = a.shift.location.timezone;
    const coverage = a.shift.coverageRequests.find(
      (c) => c.requesterAssignmentId === a.id,
    );
    const hoursUntil = hoursBetween(now, a.shift.startUtc);
    return {
      assignmentId: a.id,
      shiftId: a.shift.id,
      locationName: a.shift.location.name,
      timeZone: tz,
      skillName: a.shift.requiredSkill.name,
      skillColour: a.shift.requiredSkill.colour,
      rangeLabel: formatShiftRange(a.shift.startUtc, a.shift.endUtc, tz),
      dayLabel: localDate(a.shift.startUtc, tz).toLocaleString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      }),
      startIso: a.shift.startUtc.toISOString(),
      hours: hoursBetween(a.shift.startUtc, a.shift.endUtc),
      isPremium: a.shift.isPremium,
      isOvernight:
        localDate(a.shift.endUtc, tz).toString() !==
        localDate(a.shift.startUtc, tz).toString(),
      notes: a.shift.notes,
      clockedIn: a.clockInAt !== null && a.clockOutAt === null,
      clockedOut: a.clockOutAt !== null,
      canRequestCoverage:
        !coverage && hoursUntil > DROP_EXPIRY_HOURS_BEFORE_SHIFT,
      coverage: coverage
        ? { id: coverage.id, type: coverage.type, status: coverage.status }
        : null,
    };
  });

  const thisWeek = weekKey(now, viewer.timezone);
  const weekHours = assignments
    .filter((a) => weekKey(a.shift.startUtc, viewer.timezone) === thisWeek)
    .reduce((sum, a) => sum + hoursBetween(a.shift.startUtc, a.shift.endUtc), 0);

  const upcoming = shifts.filter((s) => new Date(s.startIso) >= now);
  const premiumCount = shifts.filter((s) => s.isPremium).length;

  const groups = new Map<string, MyShift[]>();
  for (const shift of upcoming) {
    const list = groups.get(shift.dayLabel) ?? [];
    list.push(shift);
    groups.set(shift.dayLabel, list);
  }

  return (
    <>
      <PageHeader
        title="My schedule"
        description="Every shift is shown in the timezone of the location you are working, with the zone spelled out."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="This week"
          value={formatHours(weekHours)}
          tone={weekHours > 40 ? 'block' : weekHours >= 35 ? 'warn' : 'ok'}
        />
        <Stat label="Upcoming shifts" value={upcoming.length} />
        <Stat label="Premium shifts" value={premiumCount} sub="Fri/Sat evenings" />
        <Stat
          label="Locations"
          value={new Set(shifts.map((s) => s.locationName)).size}
        />
      </div>

      {upcoming.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing scheduled yet"
            description="Published shifts appear here. You will be notified as soon as your manager posts the week."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {[...groups.entries()].map(([day, dayShifts]) => (
            <Card key={day}>
              <CardHeader
                title={day}
                description={`${dayShifts.length} shift${
                  dayShifts.length === 1 ? '' : 's'
                } · ${formatHours(
                  dayShifts.reduce((s, x) => s + x.hours, 0),
                )}`}
              />
              <ul className="divide-y divide-[var(--border)]">
                {dayShifts.map((shift) => (
                  <li key={shift.assignmentId} className="px-5 py-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                            style={{
                              backgroundColor: `${shift.skillColour}1a`,
                              color: shift.skillColour,
                            }}
                          >
                            {shift.skillName}
                          </span>
                          {shift.isPremium ? (
                            <Badge tone="premium">Premium</Badge>
                          ) : null}
                          {shift.isOvernight ? (
                            <Badge tone="neutral">
                              <Moon className="size-3" />
                              Overnight
                            </Badge>
                          ) : null}
                          {shift.clockedIn ? (
                            <Badge tone="ok">On duty</Badge>
                          ) : null}
                          {shift.coverage ? (
                            <Badge tone="override">
                              {shift.coverage.type === 'SWAP'
                                ? 'Swap requested'
                                : 'Offered up'}
                              {shift.coverage.status === 'PENDING_MANAGER'
                                ? ' — awaiting manager'
                                : ''}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-sm font-medium">{shift.rangeLabel}</p>
                        <p className="text-xs text-muted">
                          {shortLocation(shift.locationName)} ·{' '}
                          {formatHours(shift.hours)}
                        </p>
                        {shift.notes ? (
                          <p className="mt-1 text-xs text-muted">
                            {shift.notes}
                          </p>
                        ) : null}
                      </div>

                      <MyShiftActions shift={shift} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
