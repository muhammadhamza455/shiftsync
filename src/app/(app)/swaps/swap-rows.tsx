'use client';

import { useState, useTransition } from 'react';
import { Check, Undo2, X } from 'lucide-react';
import {
  cancelCoverageAction,
  decideCoverageAction,
  respondToSwapAction,
} from './actions';
import { Badge, Button, Textarea } from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';
import { relativeTime, shortLocation, timeUntil } from '@/lib/format';

export interface CoverageRow {
  id: string;
  type: 'SWAP' | 'DROP';
  status: string;
  note: string | null;
  decisionNote: string | null;
  createdAtIso: string;
  expiresAtIso: string | null;
  shiftLabel: string;
  locationName: string;
  skillName: string;
  requesterName: string;
  targetName: string | null;
  claimedByName: string | null;
  isRequester: boolean;
  isTarget: boolean;
  isClaimer: boolean;
  canDecide: boolean;
}

const STATUS_TONE: Record<
  string,
  'neutral' | 'ok' | 'warn' | 'block' | 'override' | 'brand'
> = {
  OPEN: 'warn',
  PENDING_MANAGER: 'override',
  APPROVED: 'ok',
  REJECTED: 'block',
  DECLINED: 'block',
  CANCELLED: 'neutral',
  AUTO_CANCELLED: 'neutral',
  EXPIRED: 'neutral',
};

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Open',
  PENDING_MANAGER: 'Awaiting manager',
  APPROVED: 'Approved',
  REJECTED: 'Not approved',
  DECLINED: 'Declined',
  CANCELLED: 'Withdrawn',
  AUTO_CANCELLED: 'Cancelled — shift changed',
  EXPIRED: 'Expired unclaimed',
};

export function SwapRequestRow({ row }: { row: CoverageRow }) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');

  const active = row.status === 'OPEN' || row.status === 'PENDING_MANAGER';

  const run = (
    fn: () => Promise<{ ok: boolean; message?: string }>,
    success: { title: string; body?: string },
  ) => {
    startTransition(async () => {
      const res = await fn();
      pushToast(
        res.ok
          ? { ...success, tone: 'success' }
          : { title: res.message ?? 'That did not work', tone: 'error' },
      );
      if (res.ok) setRejecting(false);
    });
  };

  return (
    <li className="px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <Badge tone={row.type === 'SWAP' ? 'brand' : 'neutral'}>
              {row.type === 'SWAP' ? 'Swap' : 'Drop'}
            </Badge>
            <Badge tone={STATUS_TONE[row.status] ?? 'neutral'}>
              {STATUS_LABEL[row.status] ?? row.status}
            </Badge>
            {row.status === 'OPEN' && row.expiresAtIso ? (
              <span className="text-[11px] text-muted">
                expires {timeUntil(new Date(row.expiresAtIso))}
              </span>
            ) : null}
          </div>

          <p className="text-sm font-medium">{row.shiftLabel}</p>
          <p className="text-xs text-muted">
            {shortLocation(row.locationName)} · {row.skillName}
          </p>

          <p className="mt-1.5 text-xs text-muted">
            {row.type === 'SWAP'
              ? `${row.requesterName} → ${row.targetName ?? 'someone'}`
              : row.claimedByName
                ? `${row.requesterName} → ${row.claimedByName}`
                : `${row.requesterName} offered it up`}
            {' · '}
            {relativeTime(new Date(row.createdAtIso))}
          </p>

          {row.note ? (
            <p className="mt-1.5 rounded-lg border border-line bg-surface-muted px-2.5 py-1.5 text-xs text-muted">
              “{row.note}”
            </p>
          ) : null}

          {active && row.isRequester ? (
            <p className="mt-1.5 text-xs text-muted">
              You are still scheduled for this shift until a manager approves
              the change.
            </p>
          ) : null}
          {active && (row.isTarget || row.isClaimer) ? (
            <p className="mt-1.5 text-xs text-muted">
              This shift is not yours until a manager approves it. Do not plan
              around it yet.
            </p>
          ) : null}
          {row.decisionNote ? (
            <p className="mt-1.5 text-xs text-muted">
              Manager note: {row.decisionNote}
            </p>
          ) : null}
        </div>

        {active ? (
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {row.isTarget && row.status === 'OPEN' ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    run(() => respondToSwapAction(row.id, true), {
                      title: 'Swap accepted',
                      body: 'It now needs manager approval.',
                    })
                  }
                >
                  <Check className="size-3.5" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() =>
                    run(() => respondToSwapAction(row.id, false), {
                      title: 'Swap declined',
                    })
                  }
                >
                  <X className="size-3.5" />
                  Decline
                </Button>
              </>
            ) : null}

            {row.canDecide && row.status === 'PENDING_MANAGER' ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={() =>
                    run(
                      () =>
                        decideCoverageAction({
                          requestId: row.id,
                          approve: true,
                        }),
                      {
                        title: 'Approved',
                        body: 'The roster has been updated and both people notified.',
                      },
                    )
                  }
                >
                  <Check className="size-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => setRejecting((v) => !v)}
                >
                  <X className="size-3.5" />
                  Reject
                </Button>
              </>
            ) : null}

            {row.isRequester ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  run(
                    () => cancelCoverageAction(row.id, 'Changed my mind'),
                    {
                      title: 'Request withdrawn',
                      body: 'You are still scheduled for this shift.',
                    },
                  )
                }
              >
                <Undo2 className="size-3.5" />
                Withdraw
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {rejecting ? (
        <div className="mt-3 space-y-2 rounded-lg border border-line bg-surface-muted px-3 py-2.5">
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why are you not approving this? Both people will see it."
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setRejecting(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={pending}
              onClick={() =>
                run(
                  () =>
                    decideCoverageAction({
                      requestId: row.id,
                      approve: false,
                      note: note.trim() || undefined,
                    }),
                  { title: 'Request rejected', body: 'Both people notified.' },
                )
              }
            >
              Confirm rejection
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
