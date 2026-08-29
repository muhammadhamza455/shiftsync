import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireViewer } from '@/lib/auth/session';
import {
  fairnessReport,
  premiumShiftLedger,
} from '@/lib/services/analytics';
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
import { formatHours, shortLocation } from '@/lib/format';

export const metadata = { title: 'Fairness — ShiftSync' };

const RANGES = [
  { days: 28, label: '4 weeks' },
  { days: 56, label: '8 weeks' },
  { days: 90, label: '3 months' },
];

export default async function FairnessPage(
  props: PageProps<'/manage/fairness'>,
) {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/dashboard');

  const searchParams = await props.searchParams;
  const days = Number(
    typeof searchParams.days === 'string' ? searchParams.days : 28,
  );
  const range = RANGES.find((r) => r.days === days) ?? RANGES[0];

  const now = new Date();
  const from = new Date(now.getTime() - range.days * 86_400_000);
  const to = new Date(now.getTime() + 14 * 86_400_000);

  const [report, ledger] = await Promise.all([
    fairnessReport(viewer.locationIds, from, to),
    premiumShiftLedger(viewer.locationIds, from, to),
  ]);

  const maxHours = Math.max(1, ...report.rows.map((r) => r.totalHours));

  return (
    <>
      <PageHeader
        title="Schedule fairness"
        description="Premium shifts are Friday and Saturday evenings, from 5pm in each location's own timezone."
        action={
          <nav
            aria-label="Period"
            className="flex gap-1 rounded-lg border border-line bg-surface p-1"
          >
            {RANGES.map((r) => (
              <Link
                key={r.days}
                href={`/manage/fairness?days=${r.days}`}
                aria-current={r.days === range.days ? 'true' : undefined}
                className={
                  r.days === range.days
                    ? 'rounded-md bg-brand-soft px-2.5 py-1 text-xs font-medium text-brand'
                    : 'rounded-md px-2.5 py-1 text-xs text-muted hover:bg-surface-muted'
                }
              >
                {r.label}
              </Link>
            ))}
          </nav>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Fairness score"
          value={`${report.fairnessScore}/100`}
          sub="100 = premium shifts split evenly"
          tone={
            report.fairnessScore < 60
              ? 'block'
              : report.fairnessScore < 80
                ? 'warn'
                : 'ok'
          }
        />
        <Stat label="Premium shifts" value={report.totalPremiumShifts} />
        <Stat
          label="Under-served"
          value={report.rows.filter((r) => r.standing === 'UNDER_SERVED').length}
          tone={
            report.rows.some((r) => r.standing === 'UNDER_SERVED')
              ? 'warn'
              : 'ok'
          }
        />
        <Stat label="People scheduled" value={report.rows.length} />
      </div>

      {report.rows.length === 0 ? (
        <Card>
          <EmptyState
            title="No data for this period"
            description="Once shifts are assigned, the distribution appears here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Premium shift distribution"
              description={`An even split would give each person ${report.rows[0]?.expectedPremium ?? 0} of the ${report.totalPremiumShifts} premium shifts in this period. A ±25% band around that is treated as noise — with whole shifts and a small team, exact parity is not achievable.`}
            />
            <ul className="divide-y divide-[var(--border)]">
              {report.rows.map((row) => (
                <li key={row.userId} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-medium">{row.name}</p>
                        {row.standing === 'UNDER_SERVED' ? (
                          <Badge tone={row.premiumShiftCount === 0 ? 'block' : 'warn'}>
                            Under-served
                          </Badge>
                        ) : row.standing === 'OVER_SERVED' ? (
                          <Badge tone="premium">Over-served</Badge>
                        ) : (
                          <Badge tone="ok">Even</Badge>
                        )}
                      </div>
                      <Meter
                        className="mt-2 max-w-md"
                        fraction={
                          report.totalPremiumShifts > 0
                            ? row.premiumShiftCount /
                              Math.max(
                                1,
                                ...report.rows.map((r) => r.premiumShiftCount),
                              )
                            : 0
                        }
                        tone={
                          row.standing === 'UNDER_SERVED'
                            ? 'warn'
                            : row.standing === 'OVER_SERVED'
                              ? 'premium'
                              : 'ok'
                        }
                      />
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {row.premiumShiftCount}
                        <span className="text-xs font-normal text-muted">
                          {' '}
                          / {row.expectedPremium} expected
                        </span>
                      </p>
                      <p className="text-xs text-muted">
                        {Math.round(row.premiumShare * 100)}% of all premium
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Total hours and stated preference"
              description="Whether people are getting the amount of work they asked for — a different question from whether the good shifts are shared."
            />
            <ul className="divide-y divide-[var(--border)]">
              {[...report.rows]
                .sort((a, b) => a.hoursVsDesired - b.hoursVsDesired)
                .map((row) => (
                  <li
                    key={row.userId}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{row.name}</p>
                      <Meter
                        className="mt-1.5 max-w-md"
                        fraction={row.totalHours / maxHours}
                        tone={
                          row.hoursVsDesired < -5
                            ? 'warn'
                            : row.hoursVsDesired > 5
                              ? 'block'
                              : 'ok'
                        }
                      />
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm tabular-nums">
                        {formatHours(row.totalHours)}
                        <span className="text-xs text-muted">
                          {' '}
                          over {report.weeks} weeks
                        </span>
                      </p>
                      <p
                        className={
                          row.hoursVsDesired < -5
                            ? 'text-xs text-warn'
                            : row.hoursVsDesired > 5
                              ? 'text-xs text-block'
                              : 'text-xs text-muted'
                        }
                      >
                        {row.hoursVsDesired >= 0 ? '+' : ''}
                        {row.hoursVsDesired.toFixed(1)}h/week vs their{' '}
                        {row.desiredWeeklyHours}h target
                      </p>
                    </div>
                  </li>
                ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Every premium shift in this period"
              description="The evidence behind the numbers — who actually worked each Friday and Saturday evening."
            />
            {ledger.length === 0 ? (
              <EmptyState title="No premium shifts in this period" />
            ) : (
              <CardBody className="max-h-96 overflow-y-auto p-0">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface-muted text-left text-xs text-muted">
                    <tr>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Shift
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Location
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Role
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Worked by
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {ledger.map((entry) => (
                      <tr key={entry.shiftId}>
                        <td className="px-5 py-2">{entry.label}</td>
                        <td className="px-3 py-2 text-muted">
                          {shortLocation(entry.locationName)}
                        </td>
                        <td className="px-3 py-2 text-muted">{entry.skill}</td>
                        <td className="px-5 py-2">
                          {entry.workedBy.length === 0 ? (
                            <span className="text-muted">unfilled</span>
                          ) : (
                            entry.workedBy.map((w) => w.name).join(', ')
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
