'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useRealtime } from './realtime-provider';
import { cn } from './ui';

const TONE_CLASS = {
  info: 'border-line bg-surface',
  success: 'border-ok/30 bg-ok-soft',
  warn: 'border-warn/30 bg-warn-soft',
  error: 'border-block/30 bg-block-soft',
} as const;

const TONE_DOT = {
  info: 'bg-brand',
  success: 'bg-ok',
  warn: 'bg-warn',
  error: 'bg-block',
} as const;

export function Toaster() {
  const { toasts, dismissToast } = useRealtime();

  return (
    <div
      aria-live="polite"
      aria-label="Live updates"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'animate-slide-in pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-3 shadow-lg backdrop-blur',
            TONE_CLASS[toast.tone],
          )}
        >
          <span
            className={cn(
              'mt-1.5 size-1.5 shrink-0 rounded-full',
              TONE_DOT[toast.tone],
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{toast.title}</p>
            {toast.body ? (
              <p className="mt-0.5 text-xs text-muted">{toast.body}</p>
            ) : null}
            {toast.href ? (
              <Link
                href={toast.href}
                className="mt-1 inline-block text-xs font-medium text-brand underline underline-offset-2"
                onClick={() => dismissToast(toast.id)}
              >
                View
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="rounded p-0.5 text-muted hover:text-foreground"
            aria-label="Dismiss notification"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}

export function ConnectionDot() {
  const { connection } = useRealtime();

  const label =
    connection === 'live'
      ? 'Live'
      : connection === 'connecting'
        ? 'Connecting'
        : 'Reconnecting';

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted"
      title={
        connection === 'live'
          ? 'Connected — changes from other people appear automatically.'
          : 'Reconnecting to the live feed. Your data is still safe; the page will catch up.'
      }
    >
      <span
        className={cn(
          'size-1.5 rounded-full',
          connection === 'live'
            ? 'animate-pulse-dot bg-ok'
            : connection === 'connecting'
              ? 'bg-warn'
              : 'bg-block',
        )}
      />
      {label}
    </span>
  );
}
