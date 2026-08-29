import { redirect } from 'next/navigation';
import Link from 'next/link';
import { AlertTriangle, ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { overtimeReport } from '@/lib/services/analytics';
import { weekKey, weekKeyToMonday, weekKeyFromPlainDate } from '@/lib/time/zones';
import {
  WEEKLY_OVERTIME_HOURS,
  WEEKLY_WARN_HOURS,
} from '@/lib/scheduling/rules';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Meter,
  PageHeader,
  Stat,
} from '@/components/ui';
import { formatCurrency, formatHours, shortLocation } from '@/lib/format';

export const metadata = { title: 'Overtime — ShiftSync' };

export default async function OvertimePage(
  props: PageProps<'/manage/overtime'>,
) {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/dashboard');

  const searchParams = await props.searchParams;
  const primary = await db.location.findFirst({
    where: { id: { in: viewer.locationIds } },
    select: { timezone: true },
  });
  const zone = primary?.timezone ?? viewer.timezone;

  const week =
    typeof searchParams.week === 'string'
      ? searchParams.week
      : weekKey(new Date(), zone);

  const report = await overtimeReport(viewer.locationIds, week);

  const monday = weekKeyToMonday(week);
  const prevWeek = weekKeyFromPlainDate(monday.subtract({ weeks: 1 }));
  const nextWeek = weekKeyFromPlainDate(monday.add({ weeks: 1 }));
  const rangeLabel = `${monday.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
  })} – ${monday.add({ days: 6 }).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
  })}`;

  const over = report.rows.filter((r) => r.status === 'OVER');
  const approaching = report.rows.filter((r) => r.status === 'APPROACHING');

  return (
    <>
      <PageHeader
        title="Overtime and labour cost"
        description="Hours accumulate in the order the shifts happen, so the report can name the exact assignment that pushed someone past 40."
        action={
          <div className="flex items-center gap-1">
            <Link href={`/manage/overtime?week=${prevWeek}`} aria-label="Previous week">
              <Button size="sm" variant="secondary">
                <ChevronLeft className="size-4" />
              </Button>
            </Link>
            <div className="px-2 text-center">
              <p className="text-sm font-semibold">{rangeLabel}</p>
              <p className="text-xs text-muted">{week}</p>
            </div>
            <Link href={`/manage/overtime?week=${nextWeek}`} aria-label="Next week">
              <Button size="sm" variant="secondary">
                <ChevronRight className="size-4" />
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Scheduled hours"
          value={formatHours(report.totals.totalHours)}
          sub={`${report.totals.staffCount} people`}
        />
        <Stat
          label="Overtime hours"
          value={formatHours(report.totals.overtimeHours)}
          tone={report.totals.overtimeHours > 0 ? 'block' : 'ok'}
          sub={over.length ? `${over.length} in overtime` : 'Nobody over 40h'}
        />
        <Stat
          label="Overtime cost"
          value={formatCurrency(report.totals.overtimeCost)}
          tone={report.totals.overtimeCost > 0 ? 'block' : 'ok'}
          sub="On top of straight time"
        />
        <Stat
          label="Total wage bill"
          value={formatCurrency(report.totals.totalCost)}
          sub="Projected for the week"
        />
      </div>

      {over.length > 0 ? (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-block/25 bg-block-soft px-4 py-3 text-sm text-block">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            <p className="font-medium">
              {over.length === 1
                ? `${over[0].name} is over 40 hours`
                : `${over.length} people are over 40 hours`}
            </p>
            <p className="mt-0.5">
              Together they add {formatHours(report.totals.overtimeHours)} of
              overtime, costing {formatCurrency(report.totals.overtimeCost)}{' '}
              extra. The shift that tipped each person over is marked below —
              moving one of those to someone under their target is usually the
              cheapest fix.
            </p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Per person"
          description="Weeks are counted in each person's own timezone, so hours worked across two locations still add up to one coherent week."
        />
        {report.rows.length === 0 ? (
          <EmptyState
            title="Nothing scheduled this week"
            description="Assign some shifts and the projection will appear here."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {report.rows.map((row) => {
              const tipping = row.assignments.find((a) => a.tipsIntoOvertime);
              return (
                <li key={row.userId} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-medium">{row.name}</p>
                        {row.status === 'OVER' ? (
                          <Badge tone="block">Overtime</Badge>
                        ) : row.status === 'APPROACHING' ? (
                          <Badge tone="warn">Approaching</Badge>
                        ) : null}
                        {row.totalHours > row.desiredWeeklyHours ? (
                          <Badge tone="neutral">
                            wants ~{row.desiredWeeklyHours}h
                          </Badge>
                        ) : null}
                      </div>

                      <Meter
                        className="mt-2 max-w-md"
                        fraction={row.totalHours / 52}
                        tone={
                          row.status === 'OVER'
                            ? 'block'
                            : row.status === 'APPROACHING'
                              ? 'warn'
                              : 'ok'
                        }
                      />
                      <p className="mt-1 text-xs text-muted">
                        {formatHours(row.regularHours)} straight
                        {row.overtimeHours > 0
                          ? ` + ${formatHours(row.overtimeHours)} overtime`
                          : ` · ${formatHours(
                              Math.max(0, WEEKLY_OVERTIME_HOURS - row.totalHours),
                            )} before overtime`}
                      </p>

                      {tipping ? (
                        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-block/25 bg-block-soft px-2.5 py-1.5 text-xs text-block">
                          <Zap className="mt-px size-3.5 shrink-0" />
                          <span>
                            <strong className="font-medium">
                              {tipping.label}
                            </strong>{' '}
                            at {shortLocation(tipping.locationName)} is the shift
                            that crosses the {WEEKLY_OVERTIME_HOURS}h line.
                          </span>
                        </p>
                      ) : null}

                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                          {row.assignments.length} shift
                          {row.assignments.length === 1 ? '' : 's'} this week
                        </summary>
                        <ul className="mt-1.5 space-y-1">
                          {row.assignments.map((assignment) => (
                            <li
                              key={assignment.assignmentId}
                              className="flex items-center justify-between gap-3 text-xs"
                            >
                              <span className="truncate text-muted">
                                {assignment.label} ·{' '}
                                {shortLocation(assignment.locationName)}
                              </span>
                              <span className="shrink-0 tabular-nums">
                                {formatHours(assignment.hours)}
                                {assignment.overtimeHours > 0 ? (
                                  <span className="ml-1 text-block">
                                    ({formatHours(assignment.overtimeHours)} OT)
                                  </span>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-base font-semibold tabular-nums">
                        {formatHours(row.totalHours)}
                      </p>
                      <p className="text-xs text-muted">
                        {formatCurrency(row.totalCost)}
                      </p>
                      {row.overtimeCost > 0 ? (
                        <p className="text-xs text-block">
                          +{formatCurrency(row.overtimeCost)} OT
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {approaching.length > 0 && over.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {approaching.length} {approaching.length === 1 ? 'person is' : 'people are'}{' '}
          past {WEEKLY_WARN_HOURS}h. Adding another shift to any of them is
          likely to cross into overtime.
        </p>
      ) : null}
    </>
  );
}
