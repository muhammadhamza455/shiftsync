import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { formatShiftRange, hoursBetween } from '@/lib/time/zones';
import { evaluateAssignment } from '@/lib/scheduling/constraints';
import { loadCandidateContexts, loadTargetShift } from '@/lib/services/context';
import { ClaimButton } from './claim-button';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui';
import { formatHours, shortLocation, timeUntil } from '@/lib/format';

export const metadata = { title: 'Open shifts — ShiftSync' };

export default async function OpenShiftsPage() {
  const viewer = await requireViewer();
  const now = new Date();

  const drops = await db.coverageRequest.findMany({
    where: {
      type: 'DROP',
      status: 'OPEN',
      requesterId: { not: viewer.id },
      expiresAt: { gt: now },
      shift: {
        status: 'PUBLISHED',
        startUtc: { gt: now },
        locationId: { in: viewer.locationIds },
      },
    },
    orderBy: { shift: { startUtc: 'asc' } },
    take: 25,
    select: {
      id: true,
      note: true,
      expiresAt: true,
      requesterAssignmentId: true,
      requester: { select: { name: true } },
      shift: {
        select: {
          id: true,
          startUtc: true,
          endUtc: true,
          isPremium: true,
          location: { select: { name: true, timezone: true } },
          requiredSkill: { select: { name: true, colour: true } },
        },
      },
    },
  });

  const listings = await Promise.all(
    drops.map(async (drop) => {
      const target = await loadTargetShift(drop.shift.id);
      let blockedReason: string | null = null;

      if (target) {
        const contexts = await loadCandidateContexts(target, [viewer.id], {
          excludeAssignmentIds: [drop.requesterAssignmentId],
        });
        const context = contexts.get(viewer.id);
        if (context) {
          const evaluation = evaluateAssignment(
            { ...target, assignedCount: Math.max(0, target.assignedCount - 1) },
            context,
          );
          blockedReason = evaluation.ok
            ? null
            : evaluation.blocking[0].message;
        }
      }

      return {
        id: drop.id,
        note: drop.note,
        expiresAt: drop.expiresAt,
        requesterName: drop.requester.name,
        label: formatShiftRange(
          drop.shift.startUtc,
          drop.shift.endUtc,
          drop.shift.location.timezone,
        ),
        locationName: drop.shift.location.name,
        skillName: drop.shift.requiredSkill.name,
        skillColour: drop.shift.requiredSkill.colour,
        isPremium: drop.shift.isPremium,
        hours: hoursBetween(drop.shift.startUtc, drop.shift.endUtc),
        blockedReason,
      };
    }),
  );

  const available = listings.filter((l) => !l.blockedReason);
  const unavailable = listings.filter((l) => l.blockedReason);

  return (
    <>
      <PageHeader
        title="Open shifts"
        description="Shifts colleagues have offered up. Claiming one sends it to your manager for approval — it is not yours until they approve."
      />

      {listings.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing available"
            description="When someone offers a shift up at one of your locations, it appears here."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="You can take these"
              description={`${available.length} shift${
                available.length === 1 ? '' : 's'
              } you are qualified and free for.`}
            />
            {available.length === 0 ? (
              <EmptyState
                title="None right now"
                description="Every open shift conflicts with something on your side. The list below explains each one."
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {available.map((listing) => (
                  <li
                    key={listing.id}
                    className="flex flex-wrap items-start justify-between gap-3 px-5 py-4"
                  >
                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span
                          className="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
                          style={{
                            backgroundColor: `${listing.skillColour}1a`,
                            color: listing.skillColour,
                          }}
                        >
                          {listing.skillName}
                        </span>
                        {listing.isPremium ? (
                          <Badge tone="premium">Premium</Badge>
                        ) : null}
                        <span className="text-[11px] text-muted">
                          expires {timeUntil(listing.expiresAt!)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{listing.label}</p>
                      <p className="text-xs text-muted">
                        {shortLocation(listing.locationName)} ·{' '}
                        {formatHours(listing.hours)} · from{' '}
                        {listing.requesterName}
                      </p>
                      {listing.note ? (
                        <p className="mt-1.5 text-xs text-muted">
                          “{listing.note}”
                        </p>
                      ) : null}
                    </div>
                    <ClaimButton requestId={listing.id} />
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {unavailable.length > 0 ? (
            <Card>
              <CardHeader
                title="Not available to you"
                description="Shown with the reason, so you are not left guessing."
              />
              <ul className="divide-y divide-[var(--border)]">
                {unavailable.map((listing) => (
                  <li key={listing.id} className="px-5 py-3.5">
                    <p className="text-sm font-medium text-muted">
                      {listing.label}
                    </p>
                    <p className="text-xs text-muted">
                      {shortLocation(listing.locationName)} ·{' '}
                      {listing.skillName}
                    </p>
                    <p className="mt-1.5 rounded-lg border border-block/25 bg-block-soft px-2.5 py-1.5 text-xs text-block">
                      {listing.blockedReason}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      )}
    </>
  );
}
