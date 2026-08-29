'use client';

import { useEffect, useState, useTransition } from 'react';
import { LogIn, LogOut, Repeat, Undo2, UserMinus, X } from 'lucide-react';
import type { MyShift } from './page';
import {
  cancelCoverageAction,
  requestDropAction,
  requestSwapAction,
  swapCandidatesAction,
} from '../swaps/actions';
import { clockAction } from '../manage/schedule/actions';
import { Button, Field, Select, Textarea } from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';

type Mode = 'swap' | 'drop' | null;

export function MyShiftActions({ shift }: { shift: MyShift }) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(null);
  const [error, setError] = useState<string | null>(null);

  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const start = new Date(shift.startIso);
  const withinClockWindow =
    now !== null &&
    now > start.getTime() - 30 * 60_000 &&
    !shift.clockedOut;

  const clock = (direction: 'in' | 'out') => {
    startTransition(async () => {
      const res = await clockAction(shift.assignmentId, direction);
      pushToast(
        res.ok
          ? {
              title: direction === 'in' ? 'Clocked in' : 'Clocked out',
              tone: 'success',
            }
          : { title: res.message, tone: 'error' },
      );
    });
  };

  const cancelRequest = () => {
    if (!shift.coverage) return;
    startTransition(async () => {
      const res = await cancelCoverageAction(
        shift.coverage!.id,
        'Changed my mind',
      );
      pushToast(
        res.ok
          ? {
              title: 'Request withdrawn',
              body: 'You are still scheduled for this shift.',
              tone: 'info',
            }
          : { title: res.message ?? 'Could not cancel', tone: 'error' },
      );
    });
  };

  return (
    <div className="flex shrink-0 flex-col items-end gap-2">
      <div className="flex flex-wrap gap-1.5">
        {withinClockWindow ? (
          shift.clockedIn ? (
            <Button size="sm" variant="secondary" onClick={() => clock('out')} disabled={pending}>
              <LogOut className="size-3.5" />
              Clock out
            </Button>
          ) : (
            <Button size="sm" variant="primary" onClick={() => clock('in')} disabled={pending}>
              <LogIn className="size-3.5" />
              Clock in
            </Button>
          )
        ) : null}

        {shift.coverage ? (
          <Button size="sm" variant="secondary" onClick={cancelRequest} disabled={pending}>
            <Undo2 className="size-3.5" />
            Withdraw request
          </Button>
        ) : shift.canRequestCoverage ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => setMode('swap')}>
              <Repeat className="size-3.5" />
              Swap
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode('drop')}>
              <UserMinus className="size-3.5" />
              Offer up
            </Button>
          </>
        ) : null}
      </div>

      {shift.coverage ? (
        <p className="max-w-64 text-right text-xs text-muted">
          You are still scheduled for this shift until a manager approves the
          change.
        </p>
      ) : null}

      {mode ? (
        <CoverageDialog
          shift={shift}
          mode={mode}
          pending={pending}
          error={error}
          setError={setError}
          onClose={() => {
            setMode(null);
            setError(null);
          }}
          startTransition={startTransition}
        />
      ) : null}
    </div>
  );
}

function CoverageDialog({
  shift,
  mode,
  pending,
  error,
  setError,
  onClose,
  startTransition,
}: {
  shift: MyShift;
  mode: Exclude<Mode, null>;
  pending: boolean;
  error: string | null;
  setError: (value: string | null) => void;
  onClose: () => void;
  startTransition: (fn: () => void) => void;
}) {
  const { pushToast } = useRealtime();
  const [candidates, setCandidates] = useState<{ id: string; name: string }[]>([]);
  const [targetUserId, setTargetUserId] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (mode !== 'swap') return;
    let cancelled = false;
    void swapCandidatesAction(shift.assignmentId).then((res) => {
      if (!cancelled) setCandidates(res.candidates);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, shift.assignmentId]);

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res =
        mode === 'swap'
          ? await requestSwapAction({
              requesterAssignmentId: shift.assignmentId,
              targetUserId,
              note: note.trim() || undefined,
            })
          : await requestDropAction({
              assignmentId: shift.assignmentId,
              note: note.trim() || undefined,
            });

      if (res.ok) {
        pushToast({
          title:
            mode === 'swap' ? 'Swap request sent' : 'Shift offered up',
          body: 'You stay on the shift until a manager approves the change.',
          tone: 'success',
        });
        onClose();
      } else {
        setError(res.message ?? 'Could not raise the request.');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'swap' ? 'Request a swap' : 'Offer up this shift'}
        className="animate-slide-in w-full max-w-md rounded-xl border border-line bg-surface text-left shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">
              {mode === 'swap' ? 'Ask someone to swap' : 'Offer this shift up'}
            </h2>
            <p className="text-xs text-muted">{shift.rangeLabel}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted hover:bg-surface-muted hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4 px-5 py-4">
          <p className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-muted">
            {mode === 'swap'
              ? 'They have to accept, and then your manager has to approve. Until both happen, this shift is still yours.'
              : `Anyone qualified at this location can claim it. Your manager still has to approve, and if nobody takes it ${DROP_EXPIRY_LABEL} before the shift, it stays yours.`}
          </p>

          {mode === 'swap' ? (
            <Field
              label="Who are you asking?"
              hint="Only people with the right skill and certification for this location are listed."
            >
              <Select
                value={targetUserId}
                onChange={(event) => setTargetUserId(event.target.value)}
              >
                <option value="">Choose a colleague…</option>
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          <Field label="Note" hint="Optional — helps your manager decide.">
            <Textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={
                mode === 'swap'
                  ? 'e.g. I have a dentist appointment I could not move.'
                  : 'e.g. Midterm exam — happy for anyone to take it.'
              }
            />
          </Field>

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block"
            >
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={pending || (mode === 'swap' && !targetUserId)}
          >
            {pending
              ? 'Sending…'
              : mode === 'swap'
                ? 'Send swap request'
                : 'Offer it up'}
          </Button>
        </footer>
      </div>
    </div>
  );
}

const DROP_EXPIRY_LABEL = '24 hours';
