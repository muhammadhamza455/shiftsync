'use client';

import { useState, useTransition } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  addExceptionAction,
  deleteExceptionAction,
  saveWeeklyAvailabilityAction,
} from './actions';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Select,
} from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';

const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
];

interface Rule {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string | null;
}

interface Exception {
  id: string;
  type: 'UNAVAILABLE' | 'AVAILABLE';
  date: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export function AvailabilityEditor({
  initialRules,
  exceptions,
  homeTimezone,
  availableZones,
}: {
  initialRules: Rule[];
  exceptions: Exception[];
  homeTimezone: string;
  availableZones: string[];
}) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [rules, setRules] = useState<Rule[]>(initialRules);
  const [error, setError] = useState<string | null>(null);

  const zoneOptions = [...new Set([homeTimezone, ...availableZones])];

  const addRule = (dayOfWeek: number) => {
    setRules((current) => [
      ...current,
      { dayOfWeek, startTime: '09:00', endTime: '17:00', timezone: null },
    ]);
  };

  const updateRule = (index: number, patch: Partial<Rule>) => {
    setRules((current) =>
      current.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );
  };

  const removeRule = (index: number) => {
    setRules((current) => current.filter((_, i) => i !== index));
  };

  const save = () => {
    setError(null);
    startTransition(async () => {
      const res = await saveWeeklyAvailabilityAction(rules);
      if (res.ok) {
        pushToast({
          title: 'Availability saved',
          body: 'Your managers have been notified.',
          tone: 'success',
        });
      } else {
        setError(res.message ?? 'Could not save.');
      }
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Weekly pattern"
          description="Repeats every week. Daylight saving is handled for you — 9am stays 9am."
          action={
            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save pattern'}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          {WEEKDAYS.map((day) => {
            const dayRules = rules
              .map((rule, index) => ({ rule, index }))
              .filter(({ rule }) => rule.dayOfWeek === day.value);

            return (
              <div
                key={day.value}
                className="flex flex-col gap-2 border-b border-line pb-3 last:border-0 last:pb-0 sm:flex-row sm:flex-wrap sm:items-start sm:gap-3"
              >
                <p className="text-sm font-medium sm:w-24 sm:shrink-0 sm:pt-2">
                  {day.label}
                </p>

                <div className="min-w-0 flex-1 space-y-2">
                  {dayRules.length === 0 ? (
                    <p className="pt-2 text-sm text-muted">Not available</p>
                  ) : (
                    dayRules.map(({ rule, index }) => {
                      const overnight = rule.endTime <= rule.startTime;
                      return (
                        <div
                          key={index}
                          className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:flex sm:flex-wrap"
                        >
                          <Input
                            type="time"
                            aria-label={`${day.label} start`}
                            className="w-full sm:w-32"
                            value={rule.startTime}
                            onChange={(event) =>
                              updateRule(index, { startTime: event.target.value })
                            }
                          />
                          <span className="text-sm text-muted">to</span>
                          <Input
                            type="time"
                            aria-label={`${day.label} end`}
                            className="w-full sm:w-32"
                            value={rule.endTime}
                            onChange={(event) =>
                              updateRule(index, { endTime: event.target.value })
                            }
                          />
                          <Select
                            aria-label={`${day.label} timezone`}
                            className="col-span-3 w-full sm:col-span-1 sm:w-56"
                            value={rule.timezone ?? ''}
                            onChange={(event) =>
                              updateRule(index, {
                                timezone: event.target.value || null,
                              })
                            }
                          >
                            <option value="">Local to the location</option>
                            {zoneOptions.map((zone) => (
                              <option key={zone} value={zone}>
                                {zone.replace('America/', '').replace('_', ' ')}{' '}
                                time
                              </option>
                            ))}
                          </Select>
                          {overnight ? (
                            <Badge tone="neutral">overnight</Badge>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => removeRule(index)}
                            aria-label={`Remove ${day.label} window`}
                            className="col-span-3 justify-self-start sm:col-span-1"
                          >
                            <Trash2 className="size-3.5" />
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>

                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => addRule(day.value)}
                >
                  <Plus className="size-3.5" />
                  Add
                </Button>
              </div>
            );
          })}

          {error ? (
            <p
              role="alert"
              className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block"
            >
              {error}
            </p>
          ) : null}
        </CardBody>
      </Card>

      <ExceptionsCard exceptions={exceptions} />
    </div>
  );
}

function ExceptionsCard({ exceptions }: { exceptions: Exception[] }) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [type, setType] = useState<'UNAVAILABLE' | 'AVAILABLE'>('UNAVAILABLE');
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const wholeDay = type === 'UNAVAILABLE' && !startTime && !endTime;

  const add = () => {
    setError(null);
    startTransition(async () => {
      const res = await addExceptionAction({
        type,
        date,
        startTime: startTime || null,
        endTime: endTime || null,
        reason: reason.trim() || null,
      });
      if (res.ok) {
        pushToast({ title: 'Exception added', tone: 'success' });
        setDate('');
        setStartTime('');
        setEndTime('');
        setReason('');
      } else {
        setError(res.message ?? 'Could not save.');
      }
    });
  };

  const remove = (id: string) => {
    startTransition(async () => {
      const res = await deleteExceptionAction(id);
      if (!res.ok) {
        pushToast({ title: res.message ?? 'Could not remove', tone: 'error' });
      }
    });
  };

  return (
    <Card>
      <CardHeader
        title="One-off exceptions"
        description="Overrides the weekly pattern for a specific date — a holiday, or a day you can work outside your usual hours."
      />
      <CardBody className="space-y-4">
        {exceptions.length > 0 ? (
          <ul className="space-y-1.5">
            {exceptions.map((exception) => (
              <li
                key={exception.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge
                      tone={exception.type === 'UNAVAILABLE' ? 'block' : 'ok'}
                    >
                      {exception.type === 'UNAVAILABLE'
                        ? 'Unavailable'
                        : 'Extra availability'}
                    </Badge>
                    <p className="text-sm font-medium">
                      {new Date(`${exception.date}T12:00:00Z`).toLocaleDateString(
                        'en-US',
                        { weekday: 'short', month: 'short', day: 'numeric' },
                      )}
                    </p>
                  </div>
                  <p className="text-xs text-muted">
                    {exception.startTime && exception.endTime
                      ? `${exception.startTime} – ${exception.endTime}`
                      : 'All day'}
                    {exception.reason ? ` · ${exception.reason}` : ''}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => remove(exception.id)}
                  disabled={pending}
                  aria-label="Remove exception"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="Type">
            <Select
              value={type}
              onChange={(event) =>
                setType(event.target.value as 'UNAVAILABLE' | 'AVAILABLE')
              }
            >
              <option value="UNAVAILABLE">Unavailable</option>
              <option value="AVAILABLE">Extra availability</option>
            </Select>
          </Field>
          <Field label="Date">
            <Input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field
            label="From"
            hint={wholeDay ? 'Leave blank for all day' : undefined}
          >
            <Input
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />
          </Field>
          <Field label="To">
            <Input
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />
          </Field>
          <Field label="Reason">
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional"
            />
          </Field>
        </div>

        {error ? (
          <p
            role="alert"
            className="rounded-lg border border-block/25 bg-block-soft px-3 py-2 text-sm text-block"
          >
            {error}
          </p>
        ) : null}

        <Button variant="secondary" onClick={add} disabled={pending || !date}>
          <Plus className="size-3.5" />
          Add exception
        </Button>
      </CardBody>
    </Card>
  );
}
