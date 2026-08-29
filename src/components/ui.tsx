import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ComponentProps, ReactNode } from 'react';
import type { Severity } from '@/lib/scheduling/rules';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function Card({
  className,
  children,
  ...props
}: ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04)]',
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function CardBody({ className, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={cn('px-5 py-4', className)} {...props}>
      {children}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand text-white hover:bg-brand-strong disabled:bg-brand/50 dark:text-[#08211f]',
  secondary:
    'border border-line-strong bg-surface hover:bg-surface-muted disabled:opacity-50',
  ghost: 'hover:bg-surface-muted disabled:opacity-50',
  danger:
    'border border-block/30 bg-block-soft text-block hover:bg-block/15 disabled:opacity-50',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs',
  md: 'h-9 px-3.5 text-sm',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  ...props
}: ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

type BadgeTone =
  | 'neutral'
  | 'brand'
  | 'block'
  | 'override'
  | 'warn'
  | 'ok'
  | 'premium';

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-muted text-muted border-line',
  brand: 'bg-brand-soft text-brand border-brand/25',
  block: 'bg-block-soft text-block border-block/25',
  override: 'bg-override-soft text-override border-override/25',
  warn: 'bg-warn-soft text-warn border-warn/25',
  ok: 'bg-ok-soft text-ok border-ok/25',
  premium: 'bg-premium-soft text-premium border-premium/25',
};

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        BADGE_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export const SEVERITY_TONE: Record<Severity, BadgeTone> = {
  BLOCK: 'block',
  OVERRIDABLE: 'override',
  WARN: 'warn',
};

export const SEVERITY_LABEL: Record<Severity, string> = {
  BLOCK: 'Blocked',
  OVERRIDABLE: 'Needs a reason',
  WARN: 'Heads up',
};

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && !error ? (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      ) : null}
      {error ? (
        <span className="mt-1 block text-xs text-block">{error}</span>
      ) : null}
    </label>
  );
}

const CONTROL_CLASS =
  'w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-brand disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(CONTROL_CLASS, 'h-[38px]', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(CONTROL_CLASS, className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm text-muted">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="text-sm font-medium">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: BadgeTone;
}) {
  const toneClass =
    tone === 'block'
      ? 'text-block'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : tone === 'override'
            ? 'text-override'
            : 'text-foreground';
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className={cn('mt-1 text-lg font-semibold tabular-nums', toneClass)}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 text-xs text-muted">{sub}</p> : null}
    </div>
  );
}

export function Meter({
  fraction,
  tone = 'brand',
  className,
}: {
  fraction: number;
  tone?: BadgeTone;
  className?: string;
}) {
  const fill =
    tone === 'block'
      ? 'bg-block'
      : tone === 'warn'
        ? 'bg-warn'
        : tone === 'ok'
          ? 'bg-ok'
          : tone === 'premium'
            ? 'bg-premium'
            : 'bg-brand';
  return (
    <div
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
      role="presentation"
    >
      <div
        className={cn('h-full rounded-full transition-[width]', fill)}
        style={{ width: `${Math.min(100, Math.max(0, fraction * 100))}%` }}
      />
    </div>
  );
}
