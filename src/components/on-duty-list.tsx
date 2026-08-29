'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CircleDot, TriangleAlert } from 'lucide-react';
import type { OnDutyRow } from '@/lib/services/analytics';
import { Badge, EmptyState, cn } from './ui';
import { shortLocation } from '@/lib/format';
import { useRealtime } from './realtime-provider';

export function OnDutyList({
  rows,
  compact = false,
}: {
  rows: (Omit<OnDutyRow, 'startUtc' | 'endUtc' | 'clockInAt'> & {
    startUtc: Date | string;
    endUtc: Date | string;
    clockInAt: Date | string | null;
  })[];
  compact?: boolean;
}) {
  const router = useRouter();
  const { subscribe } = useRealtime();

  const [now, setNow] = useState<number | null>(null);

  useEffect(
    () =>
      subscribe((event) => {
        if (event.type === 'duty.changed') router.refresh();
      }),
    [subscribe, router],
  );

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nobody on the floor"
        description="No one is currently clocked into a shift."
      />
    );
  }

  return (
    <ul className={cn('space-y-2', compact && 'space-y-1.5')}>
      {rows.map((row) => {
        const clockIn = row.clockInAt ? new Date(row.clockInAt) : null;
        const elapsed =
          clockIn && now !== null
            ? Math.max(0, Math.round((now - clockIn.getTime()) / 60_000))
            : null;
        const hours = elapsed === null ? 0 : Math.floor(elapsed / 60);
        const minutes = elapsed === null ? 0 : elapsed % 60;

        return (
          <li
            key={row.assignmentId}
            className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                {row.state === 'ON_DUTY' ? (
                  <CircleDot className="size-3.5 shrink-0 animate-pulse-dot text-ok" />
                ) : row.state === 'NOT_CLOCKED_IN' ? (
                  <TriangleAlert className="size-3.5 shrink-0 text-warn" />
                ) : (
                  <CircleDot className="size-3.5 shrink-0 text-muted" />
                )}
                {row.userName}
              </p>
              <p className="truncate text-xs text-muted">
                {shortLocation(row.locationName)} · {row.skill}
                {!compact ? ` · ${row.label}` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              {row.state === 'ON_DUTY' ? (
                <span className="text-xs tabular-nums text-muted">
                  {elapsed === null ? (
                    <span className="opacity-0">0m in</span>
                  ) : (
                    <>
                      {hours > 0 ? `${hours}h ` : ''}
                      {minutes}m in
                    </>
                  )}
                </span>
              ) : row.state === 'NOT_CLOCKED_IN' ? (
                <Badge tone="warn">Not clocked in</Badge>
              ) : (
                <Badge tone="override">Running over</Badge>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
