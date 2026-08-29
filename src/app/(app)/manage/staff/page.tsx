import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { hoursBetween, weekKey, formatWallClock } from '@/lib/time/zones';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';
import { formatHours, shortLocation } from '@/lib/format';

export const metadata = { title: 'Team — ShiftSync' };

const WEEKDAY_SHORT = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function TeamPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/dashboard');

  const now = new Date();

  const staff = await db.user.findMany({
    where: {
      role: 'STAFF',
      certifications: {
        some: { locationId: { in: viewer.locationIds }, revokedAt: null },
      },
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      timezone: true,
      staffProfile: {
        select: { desiredWeeklyHours: true, baseHourlyRate: true },
      },
      skills: {
        where: { revokedAt: null },
        select: { skill: { select: { name: true, colour: true } } },
      },
      certifications: {
        select: {
          revokedAt: true,
          revokedReason: true,
          location: { select: { name: true, timezone: true } },
        },
      },
      availabilityRules: {
        orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
        select: {
          dayOfWeek: true,
          startTime: true,
          endTime: true,
          timezone: true,
        },
      },
      assignments: {
        where: {
          status: 'ASSIGNED',
          shift: { status: { not: 'CANCELLED' } },
        },
        select: { shift: { select: { startUtc: true, endUtc: true } } },
      },
    },
  });

  const rows = staff.map((person) => {
    const thisWeek = weekKey(now, person.timezone);
    const weeklyHours = person.assignments
      .filter((a) => weekKey(a.shift.startUtc, person.timezone) === thisWeek)
      .reduce(
        (sum, a) => sum + hoursBetween(a.shift.startUtc, a.shift.endUtc),
        0,
      );
    const zones = [
      ...new Set(
        person.certifications
          .filter((c) => !c.revokedAt)
          .map((c) => c.location.timezone),
      ),
    ];
    return { person, weeklyHours, zones };
  });

  const crossZoneCount = rows.filter((r) => r.zones.length > 1).length;

  return (
    <>
      <PageHeader
        title="Team"
        description="Everyone certified at a location you manage, with the skills, certifications and stated availability the scheduling rules are checked against."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Staff" value={rows.length} />
        <Stat
          label="Active"
          value={rows.filter((r) => r.person.isActive).length}
        />
        <Stat
          label="Work across two zones"
          value={crossZoneCount}
          sub={crossZoneCount ? 'Availability needs care' : 'All single-zone'}
        />
        <Stat
          label="Under their target"
          value={
            rows.filter(
              (r) =>
                r.weeklyHours <
                (r.person.staffProfile?.desiredWeeklyHours ?? 30) - 5,
            ).length
          }
          sub="This week"
        />
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No staff certified here yet"
            description="Staff appear once they are certified at a location you manage."
          />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {rows.map(({ person, weeklyHours, zones }) => {
            const desired = person.staffProfile?.desiredWeeklyHours ?? 30;
            const revoked = person.certifications.filter((c) => c.revokedAt);
            return (
              <Card key={person.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-1.5">
                      {person.name}
                      {!person.isActive ? (
                        <Badge tone="block">Deactivated</Badge>
                      ) : null}
                      {zones.length > 1 ? (
                        <Badge tone="brand">Two timezones</Badge>
                      ) : null}
                    </span>
                  }
                  description={person.email}
                  action={
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {formatHours(weeklyHours)}
                      </p>
                      <p className="text-xs text-muted">
                        wants ~{desired}h
                      </p>
                    </div>
                  }
                />
                <div className="space-y-3 px-5 py-4">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                      Skills
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {person.skills.length === 0 ? (
                        <span className="text-sm text-muted">None</span>
                      ) : (
                        person.skills.map((s) => (
                          <span
                            key={s.skill.name}
                            className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                            style={{
                              backgroundColor: `${s.skill.colour}1a`,
                              color: s.skill.colour,
                            }}
                          >
                            {s.skill.name}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                      Certified at
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {person.certifications
                        .filter((c) => !c.revokedAt)
                        .map((c) => (
                          <Badge key={c.location.name} tone="ok">
                            {shortLocation(c.location.name)}
                          </Badge>
                        ))}
                      {revoked.map((c) => (
                        <Badge
                          key={c.location.name}
                          tone="neutral"
                          title={c.revokedReason ?? undefined}
                        >
                          {shortLocation(c.location.name)} — revoked
                        </Badge>
                      ))}
                    </div>
                    {revoked.length > 0 ? (
                      <p className="mt-1 text-xs text-muted">
                        Past shifts at revoked locations are kept for history
                        and reporting; they simply cannot be scheduled there
                        again.
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
                      Stated availability
                    </p>
                    {person.availabilityRules.length === 0 ? (
                      <p className="text-sm text-muted">
                        None set — they cannot be scheduled until they add some.
                      </p>
                    ) : (
                      <ul className="space-y-0.5 text-xs text-muted">
                        {person.availabilityRules.map((rule, index) => (
                          <li key={index}>
                            <span className="inline-block w-9 font-medium text-foreground">
                              {WEEKDAY_SHORT[rule.dayOfWeek]}
                            </span>
                            {formatWallClock(rule.startTime)} –{' '}
                            {formatWallClock(rule.endTime)}
                            {rule.timezone ? (
                              <span className="ml-1 text-[11px]">
                                (
                                {rule.timezone
                                  .replace('America/', '')
                                  .replace('_', ' ')}{' '}
                                time)
                              </span>
                            ) : (
                              <span className="ml-1 text-[11px]">
                                (local to the location)
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
