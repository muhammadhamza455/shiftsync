import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { formatShiftRange } from '@/lib/time/zones';
import { MAX_PENDING_COVERAGE_REQUESTS } from '@/lib/scheduling/rules';
import { SwapRequestRow, type CoverageRow } from './swap-rows';
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';

export const metadata = { title: 'My requests — ShiftSync' };

const ACTIVE = ['OPEN', 'PENDING_MANAGER'] as const;

export default async function MyRequestsPage() {
  const viewer = await requireViewer();

  const requests = await db.coverageRequest.findMany({
    where: {
      OR: [
        { requesterId: viewer.id },
        { targetId: viewer.id },
        { claimedById: viewer.id },
      ],
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 40,
    select: {
      id: true,
      type: true,
      status: true,
      note: true,
      decisionNote: true,
      createdAt: true,
      expiresAt: true,
      requesterId: true,
      targetId: true,
      claimedById: true,
      requester: { select: { name: true } },
      target: { select: { name: true } },
      claimedBy: { select: { name: true } },
      shift: {
        select: {
          startUtc: true,
          endUtc: true,
          location: { select: { name: true, timezone: true } },
          requiredSkill: { select: { name: true } },
        },
      },
    },
  });

  const rows: CoverageRow[] = requests.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    note: r.note,
    decisionNote: r.decisionNote,
    createdAtIso: r.createdAt.toISOString(),
    expiresAtIso: r.expiresAt?.toISOString() ?? null,
    shiftLabel: formatShiftRange(
      r.shift.startUtc,
      r.shift.endUtc,
      r.shift.location.timezone,
    ),
    locationName: r.shift.location.name,
    skillName: r.shift.requiredSkill.name,
    requesterName: r.requester.name,
    targetName: r.target?.name ?? null,
    claimedByName: r.claimedBy?.name ?? null,
    isRequester: r.requesterId === viewer.id,
    isTarget: r.targetId === viewer.id,
    isClaimer: r.claimedById === viewer.id,
    canDecide: false,
  }));

  const active = rows.filter((r) =>
    ACTIVE.includes(r.status as (typeof ACTIVE)[number]),
  );
  const history = rows.filter(
    (r) => !ACTIVE.includes(r.status as (typeof ACTIVE)[number]),
  );

  const myOpen = active.filter((r) => r.isRequester).length;
  const awaitingMe = active.filter(
    (r) => r.isTarget && r.status === 'OPEN',
  ).length;

  return (
    <>
      <PageHeader
        title="Swaps and drops"
        description="Nothing on your schedule changes until a manager approves. Until then, every shift here is still yours."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Your open requests"
          value={`${myOpen} / ${MAX_PENDING_COVERAGE_REQUESTS}`}
          sub={
            myOpen >= MAX_PENDING_COVERAGE_REQUESTS
              ? 'At the limit — resolve one first'
              : 'Limit is 3 at a time'
          }
          tone={myOpen >= MAX_PENDING_COVERAGE_REQUESTS ? 'warn' : 'neutral'}
        />
        <Stat
          label="Waiting on you"
          value={awaitingMe}
          tone={awaitingMe > 0 ? 'warn' : 'ok'}
          sub={awaitingMe > 0 ? 'Colleagues asked to swap' : 'Nothing to answer'}
        />
        <Stat label="Resolved" value={history.length} />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Active"
            description="In progress — waiting on a colleague or on a manager."
          />
          {active.length === 0 ? (
            <EmptyState
              title="Nothing in flight"
              description="Raise a swap or offer a shift up from your schedule."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {active.map((row) => (
                <SwapRequestRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Card>

        {history.length > 0 ? (
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y divide-[var(--border)]">
              {history.slice(0, 15).map((row) => (
                <SwapRequestRow key={row.id} row={row} />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
