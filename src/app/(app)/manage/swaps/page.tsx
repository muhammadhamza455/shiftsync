import { redirect } from 'next/navigation';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { formatShiftRange } from '@/lib/time/zones';
import { SwapRequestRow, type CoverageRow } from '../../swaps/swap-rows';
import {
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
} from '@/components/ui';

export const metadata = { title: 'Approvals — ShiftSync' };

export default async function ApprovalsPage() {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/swaps');

  const requests = await db.coverageRequest.findMany({
    where: { shift: { locationId: { in: viewer.locationIds } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 50,
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
          locationId: true,
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
    isRequester: false,
    isTarget: false,
    isClaimer: false,
    canDecide:
      viewer.role === 'ADMIN' ||
      viewer.managedLocationIds.includes(r.shift.locationId),
  }));

  const awaiting = rows.filter((r) => r.status === 'PENDING_MANAGER');
  const inFlight = rows.filter((r) => r.status === 'OPEN');
  const resolved = rows.filter(
    (r) => r.status !== 'PENDING_MANAGER' && r.status !== 'OPEN',
  );

  return (
    <>
      <PageHeader
        title="Coverage approvals"
        description="Approving re-runs every scheduling rule against the person taking the shift — days may have passed since they agreed to it."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat
          label="Awaiting your decision"
          value={awaiting.length}
          tone={awaiting.length > 0 ? 'warn' : 'ok'}
        />
        <Stat
          label="Between staff"
          value={inFlight.length}
          sub="Not yet your call"
        />
        <Stat label="Resolved" value={resolved.length} />
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader
            title="Needs your approval"
            description="Both people have agreed. Nothing has moved on the roster yet."
          />
          {awaiting.length === 0 ? (
            <EmptyState
              title="Nothing waiting"
              description="Swaps and pickups appear here once staff have agreed between themselves."
            />
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {awaiting.map((row) => (
                <SwapRequestRow key={row.id} row={row} />
              ))}
            </ul>
          )}
        </Card>

        {inFlight.length > 0 ? (
          <Card>
            <CardHeader
              title="In progress between staff"
              description="Waiting on a colleague to accept, or on someone to claim an offered shift."
            />
            <ul className="divide-y divide-[var(--border)]">
              {inFlight.map((row) => (
                <SwapRequestRow key={row.id} row={row} />
              ))}
            </ul>
          </Card>
        ) : null}

        {resolved.length > 0 ? (
          <Card>
            <CardHeader title="Recently resolved" />
            <ul className="divide-y divide-[var(--border)]">
              {resolved.slice(0, 15).map((row) => (
                <SwapRequestRow key={row.id} row={row} />
              ))}
            </ul>
          </Card>
        ) : null}
      </div>
    </>
  );
}
