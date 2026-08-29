import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
} from '@/components/ui';
import { relativeTime, shortLocation } from '@/lib/format';

export const metadata = { title: 'Audit trail — ShiftSync' };

const PAGE_SIZE = 60;

const ACTION_GROUPS: Record<string, string[]> = {
  'Shift changes': [
    'SHIFT_CREATED',
    'SHIFT_UPDATED',
    'SHIFT_DELETED',
    'SHIFT_PUBLISHED',
    'SHIFT_UNPUBLISHED',
  ],
  Assignments: ['ASSIGNMENT_CREATED', 'ASSIGNMENT_CANCELLED'],
  'Swaps and drops': [
    'COVERAGE_REQUESTED',
    'COVERAGE_ACCEPTED',
    'COVERAGE_DECLINED',
    'COVERAGE_CLAIMED',
    'COVERAGE_APPROVED',
    'COVERAGE_REJECTED',
    'COVERAGE_CANCELLED',
    'COVERAGE_EXPIRED',
  ],
  Overrides: ['OVERRIDE_RECORDED'],
  'Clock in/out': ['CLOCK_IN', 'CLOCK_OUT'],
  'People and availability': [
    'AVAILABILITY_UPDATED',
    'CERTIFICATION_GRANTED',
    'CERTIFICATION_REVOKED',
    'SKILL_GRANTED',
    'SKILL_REVOKED',
    'USER_UPDATED',
  ],
};

export default async function AuditPage(props: PageProps<'/audit'>) {
  const viewer = await requireViewer();
  if (viewer.role === 'STAFF') redirect('/dashboard');

  const searchParams = await props.searchParams;
  const group =
    typeof searchParams.group === 'string' ? searchParams.group : 'all';
  const locationId =
    typeof searchParams.location === 'string' ? searchParams.location : 'all';
  const from = typeof searchParams.from === 'string' ? searchParams.from : '';
  const to = typeof searchParams.to === 'string' ? searchParams.to : '';

  const where: Prisma.AuditLogWhereInput = {};

  if (viewer.role !== 'ADMIN') {
    where.locationId = { in: viewer.managedLocationIds };
  }

  if (locationId !== 'all') where.locationId = locationId;
  if (group !== 'all' && ACTION_GROUPS[group]) {
    where.action = { in: ACTION_GROUPS[group] as never };
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}),
    };
  }

  const [entries, total, locations] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        action: true,
        actorLabel: true,
        entityType: true,
        entityId: true,
        summary: true,
        before: true,
        after: true,
        createdAt: true,
        location: { select: { name: true } },
      },
    }),
    db.auditLog.count({ where }),
    db.location.findMany({
      where:
        viewer.role === 'ADMIN'
          ? {}
          : { id: { in: viewer.managedLocationIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  const exportQuery = new URLSearchParams({
    ...(group !== 'all' ? { group } : {}),
    ...(locationId !== 'all' ? { location: locationId } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }).toString();

  return (
    <>
      <PageHeader
        title="Audit trail"
        description="Every schedule-affecting change, written in the same transaction as the change itself — so a change can never exist without its record."
        action={
          viewer.role === 'ADMIN' ? (
            <a
              href={`/api/audit/export${exportQuery ? `?${exportQuery}` : ''}`}
              download
            >
              <Button variant="secondary">
                <Download className="size-3.5" />
                Export CSV
              </Button>
            </a>
          ) : null
        }
      />

      <Card className="mb-4">
        <CardBody>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Field label="Activity">
              <Select name="group" defaultValue={group}>
                <option value="all">Everything</option>
                {Object.keys(ACTION_GROUPS).map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Location">
              <Select name="location" defaultValue={locationId}>
                <option value="all">All locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {shortLocation(location.name)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From">
              <Input type="date" name="from" defaultValue={from} />
            </Field>
            <Field label="To">
              <Input type="date" name="to" defaultValue={to} />
            </Field>
            <div className="flex items-end gap-2">
              <Button type="submit" variant="primary">
                Apply
              </Button>
              <Link href="/audit">
                <Button type="button" variant="ghost">
                  Reset
                </Button>
              </Link>
            </div>
          </form>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`${total} entr${total === 1 ? 'y' : 'ies'}`}
          description={
            total > PAGE_SIZE
              ? `Showing the most recent ${PAGE_SIZE}. Export for the full range.`
              : undefined
          }
        />
        {entries.length === 0 ? (
          <EmptyState
            title="Nothing matches those filters"
            description="Try widening the date range or choosing a different activity."
          />
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {entries.map((entry) => (
              <li key={entry.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{entry.summary}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                      <Badge tone="neutral">
                        {entry.action.replaceAll('_', ' ').toLowerCase()}
                      </Badge>
                      <span>{entry.actorLabel}</span>
                      {entry.location ? (
                        <span>· {shortLocation(entry.location.name)}</span>
                      ) : null}
                      <span>· {relativeTime(entry.createdAt)}</span>
                    </div>
                    {entry.before || entry.after ? (
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-xs text-muted hover:text-foreground">
                          Before / after
                        </summary>
                        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                          <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-2 text-[11px]">
                            {JSON.stringify(entry.before, null, 2) ?? 'null'}
                          </pre>
                          <pre className="overflow-x-auto rounded-lg border border-line bg-surface-muted p-2 text-[11px]">
                            {JSON.stringify(entry.after, null, 2) ?? 'null'}
                          </pre>
                        </div>
                      </details>
                    ) : null}
                  </div>
                  <time
                    dateTime={entry.createdAt.toISOString()}
                    className="shrink-0 text-xs tabular-nums text-muted"
                  >
                    {entry.createdAt.toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
