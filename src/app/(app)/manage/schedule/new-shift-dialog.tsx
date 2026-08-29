'use client';

import { useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { createShiftAction } from './actions';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';

interface Skill {
  id: string;
  name: string;
  colour: string;
}

export function NewShiftDialog({
  locationId,
  zoneLabel,
  date,
  skills,
  onClose,
}: {
  locationId: string;
  zoneLabel: string;
  date: string;
  skills: Skill[];
  onClose: () => void;
}) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('23:00');
  const [skillId, setSkillId] = useState(skills[0]?.id ?? '');
  const [headcount, setHeadcount] = useState('1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const crossesMidnight = endTime <= startTime;

  const submit = () => {
    setError(null);
    startTransition(async () => {
      const res = await createShiftAction({
        locationId,
        date,
        startTime,
        endTime,
        requiredSkillId: skillId,
        headcount: Number(headcount),
        notes: notes.trim() || null,
      });
      if (res.ok) {
        pushToast({
          title: 'Shift created',
          body: 'It stays a draft until you publish the week.',
          tone: 'success',
        });
        onClose();
      } else {
        setError(res.message);
      }
    });
  };

  return (
    <div className="fixed inset-0 z-40 grid place-items-center bg-black/30 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New shift"
        className="animate-slide-in w-full max-w-md rounded-xl border border-line bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-sm font-semibold">New shift</h2>
            <p className="text-xs text-muted">
              {new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}{' '}
              · times in {zoneLabel.replace('America/', '').replace('_', ' ')}
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

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">
              <Input
                type="time"
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </Field>
            <Field
              label="Ends"
              hint={
                crossesMidnight
                  ? 'Runs past midnight — kept as one shift'
                  : undefined
              }
            >
              <Input
                type="time"
                value={endTime}
                onChange={(event) => setEndTime(event.target.value)}
              />
            </Field>
          </div>

          <Field label="Required skill">
            <Select
              value={skillId}
              onChange={(event) => setSkillId(event.target.value)}
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
            />
          </Field>

          <Field label="Notes" hint="Optional — visible to staff once published.">
            <Textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
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
          <Button variant="primary" onClick={submit} disabled={pending}>
            {pending ? 'Creating…' : 'Create draft shift'}
          </Button>
        </footer>
      </div>
    </div>
  );
}
