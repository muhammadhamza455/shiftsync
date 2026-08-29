'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  ChevronLeft,
  ChevronRight,
  Info,
  Moon,
  Plus,
  Send,
  Undo2,
  Users,
} from 'lucide-react';
import type {
  ComplianceIssue,
  DayColumn,
  ShiftDto,
  WeekBoard,
} from '@/lib/queries/schedule';
import {
  publishWeekAction,
  unpublishWeekAction,
} from './actions';
import { ShiftDrawer } from './shift-drawer';
import { NewShiftDialog } from './new-shift-dialog';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Stat,
  cn,
} from '@/components/ui';
import { ViolationCard } from '@/components/violation-list';
import { formatHours } from '@/lib/format';
import { useRealtime } from '@/components/realtime-provider';

interface Skill {
  id: string;
  name: string;
  colour: string;
}

export function WeekBoardView({
  board,
  issues,
  skills,
  canManage,
}: {
  board: WeekBoard;
  issues: ComplianceIssue[];
  skills: Skill[];
  canManage: boolean;
}) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [openShiftId, setOpenShiftId] = useState<string | null>(null);
  const [newShiftDay, setNewShiftDay] = useState<string | null>(null);

  const allShifts = board.days.flatMap((d) => d.shifts);
  const openShift = allShifts.find((s) => s.id === openShiftId) ?? null;

  const blockingIssues = issues.filter(
    (i) => i.violation.severity === 'BLOCK',
  );

  const publish = () => {
    startTransition(async () => {
      const res = await publishWeekAction(board.locationId, board.weekKey);
      pushToast(
        res.ok
          ? {
              title: `Published ${res.data?.count ?? 0} shifts`,
              body: 'Everyone scheduled has been notified.',
              tone: 'success',
            }
          : { title: res.message, tone: 'error' },
      );
    });
  };

  const unpublish = () => {
    startTransition(async () => {
      const res = await unpublishWeekAction(board.locationId, board.weekKey);
      pushToast(
        res.ok
          ? {
              title: `Unpublished ${res.data?.unpublished ?? 0} shifts`,
              body: res.data?.locked
                ? `${res.data.locked} stayed published — already inside the edit cutoff.`
                : undefined,
              tone: 'warn',
            }
          : { title: res.message, tone: 'error' },
      );
    });
  };

  const weekHref = (week: string) =>
    `/manage/schedule?location=${board.locationId}&week=${week}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link href={weekHref(board.prevWeek)} aria-label="Previous week">
            <Button variant="secondary" size="sm">
              <ChevronLeft className="size-4" />
            </Button>
          </Link>
          <div className="px-2 text-center">
            <p className="text-sm font-semibold">{board.rangeLabel}</p>
            <p className="text-xs text-muted">{board.weekKey}</p>
          </div>
          <Link href={weekHref(board.nextWeek)} aria-label="Next week">
            <Button variant="secondary" size="sm">
              <ChevronRight className="size-4" />
            </Button>
          </Link>
        </div>

        {canManage ? (
          <div className="flex flex-wrap items-center gap-2">
            {board.publication ? (
              <Button variant="secondary" onClick={unpublish} disabled={pending}>
                <Undo2 className="size-3.5" />
                Unpublish week
              </Button>
            ) : null}
            <Button
              variant="primary"
              onClick={publish}
              disabled={pending || board.draftCount === 0}
              title={
                board.draftCount === 0
                  ? 'There are no draft shifts to publish.'
                  : undefined
              }
            >
              <Send className="size-3.5" />
              Publish {board.draftCount > 0 ? `${board.draftCount} ` : ''}
              {board.draftCount === 1 ? 'shift' : 'shifts'}
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Scheduled hours"
          value={formatHours(board.totalHours)}
          sub={`${allShifts.length} shifts`}
        />
        <Stat
          label="Open positions"
          value={board.openSlots}
          tone={board.openSlots > 0 ? 'warn' : 'ok'}
          sub={board.openSlots > 0 ? 'Still to fill' : 'Fully staffed'}
        />
        <Stat
          label="Draft"
          value={board.draftCount}
          sub={board.draftCount ? 'Not visible to staff' : 'Nothing pending'}
        />
        <Stat
          label="Rule issues"
          value={issues.length}
          tone={blockingIssues.length > 0 ? 'block' : issues.length ? 'warn' : 'ok'}
          sub={
            blockingIssues.length
              ? `${blockingIssues.length} blocking`
              : 'On existing assignments'
          }
        />
      </div>

      {board.publication ? (
        <p className="text-xs text-muted">
          Published by {board.publication.publishedBy} on{' '}
          {new Date(board.publication.publishedAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })}
          .
        </p>
      ) : null}

      {board.timezoneNote ? (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-3 py-2.5 text-xs text-muted">
          <Info className="mt-px size-3.5 shrink-0" />
          <p>{board.timezoneNote}</p>
        </div>
      ) : null}

      {issues.length > 0 ? (
        <Card>
          <CardHeader
            title="Existing assignments that break a rule"
            description="Re-checked against today's rules and today's availability. A schedule that was fine when it was written can stop being fine."
          />
          <CardBody className="space-y-2">
            {issues.slice(0, 6).map((issue, index) => (
              <div key={`${issue.shiftId}-${issue.userId}-${index}`}>
                <button
                  type="button"
                  onClick={() => setOpenShiftId(issue.shiftId)}
                  aria-label={`Open shift for ${issue.userName}, ${issue.shiftLabel}`}
                  className="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand hover:underline"
                >
                  <Users className="size-3" />
                  {issue.userName} · {issue.shiftLabel}
                </button>
                <ViolationCard violation={issue.violation} />
              </div>
            ))}
            {issues.length > 6 ? (
              <p className="text-xs text-muted">
                …and {issues.length - 6} more.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <div className="pb-2 lg:overflow-x-auto">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3 lg:min-w-[64rem] lg:grid-cols-7">
          {board.days.map((day) => (
            <DayCell
              key={day.key}
              day={day}
              canManage={canManage}
              onOpenShift={setOpenShiftId}
              onAddShift={() => setNewShiftDay(day.key)}
            />
          ))}
        </div>
      </div>

      {openShift ? (
        <>
          <button
            type="button"
            aria-label="Close panel"
            className="fixed inset-0 z-30 bg-black/20"
            onClick={() => setOpenShiftId(null)}
          />
          <ShiftDrawer
            shift={openShift}
            skills={skills}
            onClose={() => setOpenShiftId(null)}
          />
        </>
      ) : null}

      {newShiftDay && canManage ? (
        <NewShiftDialog
          locationId={board.locationId}
          zoneLabel={board.timeZone}
          date={newShiftDay}
          skills={skills}
          onClose={() => setNewShiftDay(null)}
        />
      ) : null}
    </div>
  );
}

function DayCell({
  day,
  canManage,
  onOpenShift,
  onAddShift,
}: {
  day: DayColumn;
  canManage: boolean;
  onOpenShift: (id: string) => void;
  onAddShift: () => void;
}) {
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border bg-surface lg:min-h-48',
        day.isToday ? 'border-brand/50' : 'border-line',
      )}
    >
      <div
        className={cn(
          'flex items-baseline justify-between border-b px-2.5 py-2',
          day.isToday ? 'border-brand/30 bg-brand-soft/50' : 'border-line',
        )}
      >
        <div>
          <p className="text-xs font-semibold">{day.weekday}</p>
          <p className="text-[11px] text-muted">{day.dayLabel}</p>
        </div>
        {day.isToday ? <Badge tone="brand">Today</Badge> : null}
      </div>

      <div className="flex-1 space-y-1.5 p-1.5">
        {day.shifts.map((shift) => (
          <ShiftCard key={shift.id} shift={shift} onOpen={onOpenShift} />
        ))}
      </div>

      {canManage ? (
        <button
          type="button"
          onClick={onAddShift}
          className="m-1.5 mt-0 flex items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong py-1.5 text-xs text-muted transition-colors hover:border-brand hover:text-brand"
        >
          <Plus className="size-3.5" />
          Add shift
        </button>
      ) : null}
    </div>
  );
}

function ShiftCard({
  shift,
  onOpen,
}: {
  shift: ShiftDto;
  onOpen: (id: string) => void;
}) {
  const understaffed = shift.assigned.length < shift.headcount;
  const hasPendingCoverage = shift.assigned.some((a) => a.coverage);

  return (
    <button
      type="button"
      onClick={() => onOpen(shift.id)}
      aria-label={`Shift: ${shift.rangeLabel}, ${shift.skillName}, ${
        shift.assigned.length
      } of ${shift.headcount} filled${
        understaffed ? ', understaffed' : ''
      }${shift.status === 'DRAFT' ? ', draft' : ''}`}
      className={cn(
        'w-full rounded-lg border px-2 py-1.5 text-left transition-colors hover:border-brand',
        shift.status === 'DRAFT'
          ? 'border-dashed border-line-strong bg-surface-muted/60'
          : 'border-line bg-surface',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span
          className="inline-block h-full w-1 shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: shift.skillColour }}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-semibold tabular-nums">
            {shift.startLabel} – {shift.endLabel}
            {shift.isOvernight ? (
              <Moon className="ml-1 inline size-3 text-muted" aria-label="overnight" />
            ) : null}
          </p>
          <p
            className="truncate text-[11px] font-medium"
            style={{ color: shift.skillColour }}
          >
            {shift.skillName}
          </p>

          <div className="mt-1 space-y-0.5">
            {shift.assigned.map((assignment) => (
              <p
                key={assignment.id}
                className="flex items-center gap-1 truncate text-[11px] text-muted"
              >
                {assignment.clockedIn ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-ok" />
                ) : null}
                {assignment.userName}
              </p>
            ))}
            {understaffed ? (
              <p className="text-[11px] font-medium text-warn">
                {shift.headcount - shift.assigned.length} still needed
              </p>
            ) : null}
          </div>

          <div className="mt-1 flex flex-wrap gap-1">
            {shift.isPremium ? <Badge tone="premium">Premium</Badge> : null}
            {shift.status === 'DRAFT' ? <Badge tone="neutral">Draft</Badge> : null}
            {hasPendingCoverage ? (
              <Badge tone="override">Swap pending</Badge>
            ) : null}
            {!shift.editable ? (
              <Badge tone="neutral">
                <AlertOctagon className="size-3" />
                Locked
              </Badge>
            ) : null}
          </div>
        </div>
      </div>
    </button>
  );
}
