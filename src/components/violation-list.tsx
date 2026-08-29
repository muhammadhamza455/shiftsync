'use client';

import { AlertOctagon, AlertTriangle, Info, Lightbulb } from 'lucide-react';
import type { Violation } from '@/lib/scheduling/constraints';
import type { Severity } from '@/lib/scheduling/rules';
import { Badge, SEVERITY_LABEL, SEVERITY_TONE, cn } from './ui';

const ICON: Record<Severity, typeof Info> = {
  BLOCK: AlertOctagon,
  OVERRIDABLE: AlertTriangle,
  WARN: Info,
};

const SURFACE: Record<Severity, string> = {
  BLOCK: 'border-block/25 bg-block-soft',
  OVERRIDABLE: 'border-override/25 bg-override-soft',
  WARN: 'border-warn/25 bg-warn-soft',
};

const TEXT: Record<Severity, string> = {
  BLOCK: 'text-block',
  OVERRIDABLE: 'text-override',
  WARN: 'text-warn',
};

export function ViolationCard({ violation }: { violation: Violation }) {
  const Icon = ICON[violation.severity];
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2.5',
        SURFACE[violation.severity],
      )}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn('mt-0.5 size-4 shrink-0', TEXT[violation.severity])} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="text-sm font-medium">{violation.title}</p>
            <Badge tone={SEVERITY_TONE[violation.severity]}>
              {SEVERITY_LABEL[violation.severity]}
            </Badge>
          </div>
          <p className="mt-1 text-sm leading-snug">{violation.message}</p>
          <p className="mt-1.5 text-xs text-muted">{violation.rationale}</p>
          {violation.remedy ? (
            <p
              className={cn(
                'mt-1.5 flex items-start gap-1.5 text-xs font-medium',
                TEXT[violation.severity],
              )}
            >
              <Lightbulb className="mt-px size-3.5 shrink-0" />
              {violation.remedy}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ViolationList({
  violations,
  emptyLabel,
}: {
  violations: Violation[];
  emptyLabel?: string;
}) {
  if (violations.length === 0) {
    return emptyLabel ? (
      <p className="rounded-lg border border-ok/25 bg-ok-soft px-3 py-2 text-sm text-ok">
        {emptyLabel}
      </p>
    ) : null;
  }
  return (
    <div className="space-y-2">
      {violations.map((violation, index) => (
        <ViolationCard key={`${violation.code}-${index}`} violation={violation} />
      ))}
    </div>
  );
}
