'use client';

import { useState, useTransition } from 'react';
import type { Role } from '@/generated/prisma/enums';
import { saveNotificationPreferencesAction } from './actions';
import { Button, Card, CardBody, CardHeader, cn } from '@/components/ui';
import { useRealtime } from '@/components/realtime-provider';

interface ToggleGroup {
  heading: string;
  roles: Role[];
  types: { value: string; label: string; description: string }[];
}

const GROUPS: ToggleGroup[] = [
  {
    heading: 'Your schedule',
    roles: ['STAFF', 'MANAGER', 'ADMIN'],
    types: [
      {
        value: 'SCHEDULE_PUBLISHED',
        label: 'Schedule published',
        description: 'A new week is posted for a location you work at.',
      },
      {
        value: 'SHIFT_ASSIGNED',
        label: 'Assigned to a shift',
        description: 'You are added to a published shift.',
      },
      {
        value: 'SHIFT_CHANGED',
        label: 'A shift you are on changes',
        description: 'The time or role of one of your shifts is edited.',
      },
      {
        value: 'SHIFT_CANCELLED',
        label: 'A shift is cancelled',
        description: 'A shift you were scheduled for is called off.',
      },
    ],
  },
  {
    heading: 'Swaps and coverage',
    roles: ['STAFF', 'MANAGER', 'ADMIN'],
    types: [
      {
        value: 'SWAP_REQUESTED',
        label: 'Swap requests',
        description: 'Someone asks you to swap, or one needs your approval.',
      },
      {
        value: 'DROP_OFFERED',
        label: 'Shifts up for grabs',
        description: 'A colleague offers up a shift you are qualified for.',
      },
      {
        value: 'SWAP_APPROVED',
        label: 'Decisions on requests',
        description: 'A manager approves or rejects a request you are part of.',
      },
    ],
  },
  {
    heading: 'Management',
    roles: ['MANAGER', 'ADMIN'],
    types: [
      {
        value: 'OVERTIME_WARNING',
        label: 'Overtime warnings',
        description: 'Someone on your team is heading past 40 hours.',
      },
      {
        value: 'AVAILABILITY_CHANGED',
        label: 'Availability changes',
        description:
          'A staff member changes their availability — this can invalidate a schedule you already built.',
      },
    ],
  },
];

export function SettingsForm({
  role,
  emailSimulation: initialEmail,
  mutedTypes: initialMuted,
}: {
  role: Role;
  emailSimulation: boolean;
  mutedTypes: Record<string, boolean>;
}) {
  const { pushToast } = useRealtime();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState(initialEmail);
  const [muted, setMuted] = useState<Record<string, boolean>>(initialMuted);

  const isEnabled = (type: string) => muted[type] !== false;

  const toggle = (type: string) => {
    setMuted((current) => ({ ...current, [type]: !isEnabled(type) }));
  };

  const save = () => {
    startTransition(async () => {
      const res = await saveNotificationPreferencesAction({
        emailSimulation: email,
        mutedTypes: muted,
      });
      pushToast(
        res.ok
          ? { title: 'Preferences saved', tone: 'success' }
          : { title: res.message ?? 'Could not save', tone: 'error' },
      );
    });
  };

  const groups = GROUPS.filter((g) => g.roles.includes(role));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Delivery"
          action={
            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : 'Save preferences'}
            </Button>
          }
        />
        <CardBody className="space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border border-line bg-surface-muted px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">In-app</p>
              <p className="text-xs text-muted">
                Always on. The notification centre is the durable record of what
                happened, so it cannot be switched off.
              </p>
            </div>
            <span className="shrink-0 rounded-md border border-ok/25 bg-ok-soft px-2 py-0.5 text-[11px] font-medium text-ok">
              Always on
            </span>
          </div>

          <label className="flex cursor-pointer items-start justify-between gap-4 rounded-lg border border-line px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Simulated email</p>
              <p className="text-xs text-muted">
                Also write an email record for each notification. Nothing is
                actually sent — messages land in an outbox an admin can read.
              </p>
            </div>
            <input
              type="checkbox"
              checked={email}
              onChange={(event) => setEmail(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
            />
          </label>
        </CardBody>
      </Card>

      {groups.map((group) => (
        <Card key={group.heading}>
          <CardHeader title={group.heading} />
          <CardBody className="space-y-1.5">
            {group.types.map((type) => (
              <label
                key={type.value}
                className={cn(
                  'flex cursor-pointer items-start justify-between gap-4 rounded-lg border px-3 py-2.5 transition-colors',
                  isEnabled(type.value)
                    ? 'border-line'
                    : 'border-line bg-surface-muted opacity-70',
                )}
              >
                <div>
                  <p className="text-sm font-medium">{type.label}</p>
                  <p className="text-xs text-muted">{type.description}</p>
                </div>
                <input
                  type="checkbox"
                  checked={isEnabled(type.value)}
                  onChange={() => toggle(type.value)}
                  className="mt-0.5 size-4 shrink-0 accent-[var(--brand)]"
                />
              </label>
            ))}
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
