import type { Prisma } from '@/generated/prisma/client';
import type { AuditAction } from '@/generated/prisma/enums';
import { db } from '@/lib/db';

export type DbClient = Prisma.TransactionClient | typeof db;

export interface AuditInput {
  action: AuditAction;
  actorId: string | null;
  actorLabel: string;
  entityType: 'Shift' | 'Assignment' | 'CoverageRequest' | 'User' | 'Availability' | 'Location';
  entityId: string;
  locationId?: string | null;
  summary: string;
  before?: unknown;
  after?: unknown;
}

export async function recordAudit(
  client: DbClient,
  input: AuditInput,
): Promise<void> {
  await client.auditLog.create({
    data: {
      action: input.action,
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      entityType: input.entityType,
      entityId: input.entityId,
      locationId: input.locationId ?? null,
      summary: input.summary,
      before: (input.before ?? null) as Prisma.InputJsonValue,
      after: (input.after ?? null) as Prisma.InputJsonValue,
    },
  });
}

export function shiftSnapshot(shift: {
  startUtc: Date;
  endUtc: Date;
  headcount: number;
  requiredSkillId: string;
  status: string;
  notes?: string | null;
  locationId: string;
  version: number;
}) {
  return {
    startUtc: shift.startUtc.toISOString(),
    endUtc: shift.endUtc.toISOString(),
    headcount: shift.headcount,
    requiredSkillId: shift.requiredSkillId,
    status: shift.status,
    notes: shift.notes ?? null,
    locationId: shift.locationId,
    version: shift.version,
  };
}

export function assignmentSnapshot(assignment: {
  userId: string;
  shiftId: string;
  status: string;
  assignedById?: string | null;
}) {
  return {
    userId: assignment.userId,
    shiftId: assignment.shiftId,
    status: assignment.status,
    assignedById: assignment.assignedById ?? null,
  };
}
