import { getViewer } from '@/lib/auth/session';
import { db } from '@/lib/db';
import type { Prisma } from '@/generated/prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 10_000;

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

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response('Unauthorized', { status: 401 });
  if (viewer.role !== 'ADMIN') {
    return new Response('Exporting audit logs requires an admin account.', {
      status: 403,
    });
  }

  const url = new URL(request.url);
  const group = url.searchParams.get('group');
  const locationId = url.searchParams.get('location');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  const where: Prisma.AuditLogWhereInput = {};
  if (locationId) where.locationId = locationId;
  if (group && ACTION_GROUPS[group]) {
    where.action = { in: ACTION_GROUPS[group] as never };
  }
  if (from || to) {
    where.createdAt = {
      ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}),
    };
  }

  const entries = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: MAX_ROWS,
    select: {
      id: true,
      createdAt: true,
      action: true,
      actorLabel: true,
      entityType: true,
      entityId: true,
      summary: true,
      before: true,
      after: true,
      location: { select: { name: true } },
    },
  });

  const header = [
    'id',
    'timestamp_utc',
    'action',
    'actor',
    'location',
    'entity_type',
    'entity_id',
    'summary',
    'before',
    'after',
  ];

  const lines = [
    header.join(','),
    ...entries.map((entry) =>
      [
        entry.id,
        entry.createdAt.toISOString(),
        entry.action,
        entry.actorLabel,
        entry.location?.name ?? '',
        entry.entityType,
        entry.entityId,
        entry.summary,
        entry.before,
        entry.after,
      ]
        .map(csvCell)
        .join(','),
    ),
  ];

  const filename = `shiftsync-audit-${from || 'start'}-to-${
    to || new Date().toISOString().slice(0, 10)
  }.csv`;

  return new Response(`﻿${lines.join('\r\n')}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
