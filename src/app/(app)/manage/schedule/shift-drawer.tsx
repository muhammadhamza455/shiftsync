'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  ArrowRight,
  CalendarClock,
  Check,
  Loader2,
  Moon,
  Sparkles,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type { ShiftDto } from '@/lib/queries/schedule';
import type { EvaluationResult } from '@/lib/scheduling/constraints';
import type { SuggestionDto } from '@/lib/services/assignments';
import {
  assignAction,
  cancelShiftAction,
  eligibleStaffAction,
  previewAssignmentAction,
  suggestAction,
  unassignAction,
  updateShiftAction,
  shiftHistoryAction,
  type ActionResult,
  type ShiftHistoryEntry,
} from './actions';
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
  cn,
} from '@/components/ui';
import { ViolationList } from '@/components/violation-list';
import { formatCurrencyPrecise, formatHours } from '@/lib/format';
import { useRealtime } from '@/components/realtime-provider';

interface Skill {
  id: string;
  name: string;
  colour: string;
}

interface EligibleStaff {
  id: string;
  name: string;
  certified: boolean;
  skilled: boolean;
}

export function ShiftDrawer({
  shift,
  skills,
  onClose,
}: {
  shift: ShiftDto;
  skills: Skill[];
  onClose: () => void;
}) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [tab, setTab] = useState<'staff' | 'edit' | 'history'>('staff');

  const [staff, setStaff] = useState<EligibleStaff[] | null>(null);
  const [selected, setSelected] = useState<string>('');
  const [preview, setPreview] = useState<EvaluationResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestionDto[] | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const open = shift.headcount - shift.assigned.length;

  useEffect(() => {
    let cancelled = false;
    void eligibleStaffAction(shift.id).then((res) => {
      if (!cancelled && res.ok && res.data) setStaff(res.data.staff);
    });
    return () => {
      cancelled = true;
    };
  }, [shift.id]);

  useEffect(() => {
    if (!selected) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    let cancelled = false;
    void previewAssignmentAction(shift.id, selected).then((res) => {
      if (cancelled) return;
      setPreviewing(false);
      setPreview(res.ok && res.data ? res.data.evaluation : null);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, shift.id]);

  const loadSuggestions = () => {
    startTransition(async () => {
      const res = await suggestAction(shift.id);
      if (res.ok && res.data) setSuggestions(res.data.suggestions);
    });
  };

  const handleAssign = () => {
    if (!selected) return;
    startTransition(async () => {
      const res = await assignAction({
        shiftId: shift.id,
        userId: selected,
        overrideReason: overrideReason.trim() || undefined,
      });
      setResult(res);
      if (res.ok) {
        pushToast({
          title: `${staff?.find((s) => s.id === selected)?.name ?? 'Staff'} added to the shift`,
          tone: 'success',
        });
        setSelected('');
        setOverrideReason('');
        setPreview(null);
        setSuggestions(null);
      } else if (res.suggestions?.length) {
        setSuggestions(res.suggestions);
      }
    });
  };

  const handleUnassign = (assignmentId: string, name: string) => {
    startTransition(async () => {
      const res = await unassignAction(assignmentId, 'Removed by manager');
      if (res.ok) {
        pushToast({ title: `${name} removed from the shift`, tone: 'info' });
      } else {
        pushToast({ title: res.message, tone: 'error' });
      }
    });
  };

  const needsOverride = (preview?.overridable.length ?? 0) > 0;
  const blocked = (preview?.blocking.length ?? 0) > 0;

  return (
    <aside
      role="dialog"
      aria-label={`Shift detail — ${shift.rangeLabel}`}
      className="fixed inset-y-0 right-0 z-40 flex w-[min(30rem,100vw)] flex-col border-l border-line bg-surface shadow-2xl"
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium"
              style={{
                backgroundColor: `${shift.skillColour}1a`,
                color: shift.skillColour,
              }}
            >
              {shift.skillName}
            </span>
            {shift.isPremium ? <Badge tone="premium">Premium</Badge> : null}
            {shift.isOvernight ? (
              <Badge tone="neutral">
                <Moon className="size-3" />
                Overnight
              </Badge>
            ) : null}
            <Badge tone={shift.status === 'PUBLISHED' ? 'ok' : 'neutral'}>
              {shift.status === 'PUBLISHED' ? 'Published' : 'Draft'}
            </Badge>
          </div>
          <h2 className="mt-1.5 text-sm font-semibold">{shift.rangeLabel}</h2>
          <p className="text-xs text-muted">
            {shift.locationName} · {formatHours(shift.hours)} ·{' '}
            {shift.assigned.length}/{shift.headcount} filled
          </p>
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

      {!shift.editable ? (
        <p className="flex items-start gap-2 border-b border-line bg-warn-soft px-5 py-2.5 text-xs text-warn">
          <CalendarClock className="mt-px size-3.5 shrink-0" />
          Locked — published shifts freeze {shift.editCutoffHours}h before they
          start so staff can rely on the posted schedule.
        </p>
      ) : null}

      <div className="flex gap-1 border-b border-line px-3 py-2">
        {(
          [
            ['staff', 'Staffing'],
            ['edit', 'Edit shift'],
            ['history', 'History'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-sm transition-colors',
              tab === value
                ? 'bg-brand-soft font-medium text-brand'
                : 'text-muted hover:bg-surface-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {tab === 'staff' ? (
          <>
            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
                Assigned
              </h3>
              {shift.assigned.length === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong px-3 py-4 text-center text-sm text-muted">
                  Nobody assigned yet.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {shift.assigned.map((assignment) => (
                    <li
                      key={assignment.id}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {assignment.userName}
                        </p>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {assignment.clockedIn ? (
                            <Badge tone="ok">On duty</Badge>
                          ) : null}
                          {assignment.clockedOut ? (
                            <Badge tone="neutral">Clocked out</Badge>
                          ) : null}
                          {assignment.coverage ? (
                            <Badge tone="override">
                              {assignment.coverage.type === 'SWAP'
                                ? 'Swap pending'
                                : 'Drop pending'}
                            </Badge>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={pending || !shift.editable}
                        onClick={() =>
                          handleUnassign(assignment.id, assignment.userName)
                        }
                        aria-label={`Remove ${assignment.userName}`}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {shift.editable ? (
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">
                    Add someone
                  </h3>
                  <Button size="sm" variant="ghost" onClick={loadSuggestions}>
                    <Sparkles className="size-3.5" />
                    Suggest
                  </Button>
                </div>

                {open <= 0 ? (
                  <p className="mb-2 rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs text-muted">
                    All {shift.headcount} positions are filled. Raise the
                    headcount on the Edit tab to add another person.
                  </p>
                ) : null}

                <Select
                  aria-label="Staff member"
                  value={selected}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setPreviewing(Boolean(event.target.value));
                    setResult(null);
                  }}
                >
                  <option value="">Choose a staff member…</option>
                  {staff?.map((person) => {
                    const qualified = person.certified && person.skilled;
                    const why = !person.certified
                      ? 'not certified here'
                      : !person.skilled
                        ? `no ${shift.skillName} skill`
                        : '';
                    return (
                      <option key={person.id} value={person.id}>
                        {person.name}
                        {qualified ? '' : ` — ${why}`}
                      </option>
                    );
                  })}
                </Select>

                {previewing ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-muted">
                    <Loader2 className="size-3.5 animate-spin" />
                    Checking the rules…
                  </p>
                ) : null}

                {preview ? (
                  <div className="mt-3 space-y-3">
                    <ImpactPanel evaluation={preview} />
                    <ViolationList
                      violations={preview.violations}
                      emptyLabel="No issues — this assignment is clean."
                    />
                    {needsOverride ? (
                      <Field
                        label="Documented reason (required)"
                        hint="Kept in the audit trail against your name."
                      >
                        <Textarea
                          rows={2}
                          value={overrideReason}
                          onChange={(event) =>
                            setOverrideReason(event.target.value)
                          }
                          placeholder="e.g. Staff volunteered to cover a call-out; agreed extra rest day on Monday."
                        />
                      </Field>
                    ) : null}
                    <Button
                      variant="primary"
                      className="w-full"
                      disabled={
                        pending ||
                        blocked ||
                        (needsOverride && overrideReason.trim().length < 10)
                      }
                      onClick={handleAssign}
                    >
                      {pending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <UserPlus className="size-3.5" />
                      )}
                      {blocked
                        ? 'Blocked by a rule'
                        : needsOverride
                          ? 'Assign with documented reason'
                          : 'Assign to shift'}
                    </Button>
                  </div>
                ) : null}

                {result && !result.ok ? (
                  <div className="mt-3 space-y-2">
                    <p
                      role="alert"
                      className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block"
                    >
                      {result.message}
                    </p>
                    {result.violations?.length ? (
                      <ViolationList violations={result.violations} />
                    ) : null}
                  </div>
                ) : null}

                {suggestions ? (
                  <SuggestionList
                    suggestions={suggestions}
                    onPick={(userId) => {
                      setSelected(userId);
                      setResult(null);
                    }}
                  />
                ) : null}
              </section>
            ) : null}
          </>
        ) : tab === 'edit' ? (
          <EditShiftForm
            shift={shift}
            skills={skills}
            pending={pending}
            onDone={onClose}
            onToast={pushToast}
            startTransition={startTransition}
          />
        ) : (
          <ShiftHistory shiftId={shift.id} />
        )}
      </div>
    </aside>
  );
}

function ShiftHistory({ shiftId }: { shiftId: string }) {
  const [entries, setEntries] = useState<ShiftHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void shiftHistoryAction(shiftId).then((res) => {
      if (cancelled) return;
      if (res.ok && res.data) setEntries(res.data.entries);
      else setError(res.ok ? 'No history available.' : res.message);
    });
    return () => {
      cancelled = true;
    };
  }, [shiftId]);

  if (error) {
    return (
      <p className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block">
        {error}
      </p>
    );
  }

  if (entries === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Loader2 className="size-3.5 animate-spin" />
        Loading history…
      </p>
    );
  }

  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line-strong px-3 py-6 text-center text-sm text-muted">
        Nothing recorded yet. Every change from here on is logged.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="border-l-2 border-line pl-3">
          <p className="text-sm">{entry.summary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <Badge tone="neutral">
              {entry.action.replaceAll('_', ' ').toLowerCase()}
            </Badge>
            {entry.actorLabel}
            {' · '}
            {new Date(entry.createdAt).toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
            })}
          </p>
          {entry.before || entry.after ? (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                Before / after
              </summary>
              <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-2 text-[11px]">
                  {JSON.stringify(entry.before, null, 2) ?? 'null'}
                </pre>
                <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-2 text-[11px]">
                  {JSON.stringify(entry.after, null, 2) ?? 'null'}
                </pre>
              </div>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

function ImpactPanel({ evaluation }: { evaluation: EvaluationResult }) {
  const p = evaluation.projection;
  const weeklyDelta = p.weeklyHoursAfter - p.weeklyHoursBefore;

  return (
    <div className="rounded-lg border border-line bg-surface-muted px-3 py-2.5">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">
        If you assign this shift
      </p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted">This week</dt>
          <dd className="flex items-center gap-1 font-medium tabular-nums">
            {formatHours(p.weeklyHoursBefore)}
            <ArrowRight className="size-3 text-muted" />
            <span
              className={cn(
                p.overtimeHoursAfter > 0 && 'text-block',
                p.overtimeHoursAfter === 0 &&
                  p.weeklyHoursAfter >= 35 &&
                  'text-warn',
              )}
            >
              {formatHours(p.weeklyHoursAfter)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">That day</dt>
          <dd className="font-medium tabular-nums">
            {formatHours(p.dailyHoursAfter)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Consecutive days</dt>
          <dd
            className={cn(
              'font-medium tabular-nums',
              p.consecutiveDays >= 7 && 'text-override',
              p.consecutiveDays === 6 && 'text-warn',
            )}
          >
            {p.consecutiveDays}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">Added cost</dt>
          <dd className="font-medium tabular-nums">
            {formatCurrencyPrecise(p.addedCost)}
            {p.addedOvertimeCost > 0 ? (
              <span className="ml-1 text-xs font-normal text-block">
                incl. {formatCurrencyPrecise(p.addedOvertimeCost)} OT
              </span>
            ) : null}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted">
        Adds {formatHours(weeklyDelta)} to their week.
      </p>
    </div>
  );
}

function SuggestionList({
  suggestions,
  onPick,
}: {
  suggestions: SuggestionDto[];
  onPick: (userId: string) => void;
}) {
  if (suggestions.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-sm text-muted">
        Nobody else is both qualified and free for this shift. Widening the
        skill requirement or adjusting the times would open up options.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
        Who else could work this
      </p>
      <ul className="space-y-1.5">
        {suggestions.map((suggestion) => (
          <li key={suggestion.userId}>
            <button
              type="button"
              onClick={() => onPick(suggestion.userId)}
              className="flex w-full items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-left transition-colors hover:border-brand hover:bg-brand-soft/40"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{suggestion.name}</p>
                <p className="truncate text-xs text-muted">
                  {suggestion.reasons.join(' · ')}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs tabular-nums text-muted">
                  {formatHours(suggestion.weeklyHoursBefore)} →{' '}
                  {formatHours(suggestion.weeklyHoursAfter)}
                </p>
                {suggestion.needsOverride ? (
                  <Badge tone="override">Needs a reason</Badge>
                ) : (
                  <Badge tone="ok">
                    <Check className="size-3" />
                    Clear
                  </Badge>
                )}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EditShiftForm({
  shift,
  skills,
  pending,
  onDone,
  onToast,
  startTransition,
}: {
  shift: ShiftDto;
  skills: Skill[];
  pending: boolean;
  onDone: () => void;
  onToast: (toast: { title: string; body?: string; tone: 'info' | 'success' | 'warn' | 'error' }) => void;
  startTransition: (fn: () => void) => void;
}) {
  const [date, setDate] = useState(shift.dateValue);
  const [startTime, setStartTime] = useState(shift.startTime);
  const [endTime, setEndTime] = useState(shift.endTime);
  const [skillId, setSkillId] = useState(shift.skillId);
  const [headcount, setHeadcount] = useState(String(shift.headcount));
  const [notes, setNotes] = useState(shift.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  const hasPendingCoverage = shift.assigned.some((a) => a.coverage);
  const crossesMidnight = endTime <= startTime;

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await updateShiftAction({
        shiftId: shift.id,
        locationId: shift.locationId,
        date,
        startTime,
        endTime,
        requiredSkillId: skillId,
        headcount: Number(headcount),
        notes: notes.trim() || null,
        expectedVersion: shift.version,
      });
      if (res.ok) {
        onToast({ title: 'Shift updated', tone: 'success' });
        onDone();
      } else {
        setError(res.message);
      }
    });
  };

  const remove = () => {
    setError(null);
    startTransition(async () => {
      const res = await cancelShiftAction(shift.id, 'Cancelled by manager');
      if (res.ok) {
        onToast({ title: 'Shift cancelled', tone: 'info' });
        onDone();
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <div className="space-y-4">
      {hasPendingCoverage ? (
        <p className="rounded-lg border border-override/25 bg-override-soft px-3 py-2 text-xs text-override">
          There is a pending swap or drop on this shift. Saving a change will
          automatically cancel it and notify everyone involved — the terms they
          agreed to would no longer match.
        </p>
      ) : null}

      <Field label={`Date (${shift.zoneLabel})`}>
        <Input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          disabled={!shift.editable}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts">
          <Input
            type="time"
            value={startTime}
            onChange={(event) => setStartTime(event.target.value)}
            disabled={!shift.editable}
          />
        </Field>
        <Field
          label="Ends"
          hint={crossesMidnight ? 'Runs past midnight — next day' : undefined}
        >
          <Input
            type="time"
            value={endTime}
            onChange={(event) => setEndTime(event.target.value)}
            disabled={!shift.editable}
          />
        </Field>
      </div>

      <Field label="Required skill">
        <Select
          value={skillId}
          onChange={(event) => setSkillId(event.target.value)}
          disabled={!shift.editable}
        >
          {skills.map((skill) => (
            <option key={skill.id} value={skill.id}>
              {skill.name}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="People needed">
        <Input
          type="number"
          min={1}
          max={20}
          value={headcount}
          onChange={(event) => setHeadcount(event.target.value)}
          disabled={!shift.editable}
        />
      </Field>

      <Field label="Notes">
        <Textarea
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          disabled={!shift.editable}
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

      <div className="flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          onClick={save}
          disabled={pending || !shift.editable}
        >
          Save changes
        </Button>
        <Button variant="danger" onClick={remove} disabled={pending || !shift.editable}>
          <Trash2 className="size-3.5" />
          Cancel shift
        </Button>
      </div>
    </div>
  );
}
