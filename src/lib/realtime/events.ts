import type { Role } from '@/generated/prisma/enums';

export const REALTIME_CHANNEL = 'shiftsync_events';

export type RealtimeEventType =
  | 'schedule.published'
  | 'schedule.unpublished'
  | 'shift.created'
  | 'shift.updated'
  | 'shift.deleted'
  | 'assignment.created'
  | 'assignment.cancelled'
  | 'assignment.conflict'
  | 'coverage.requested'
  | 'coverage.accepted'
  | 'coverage.declined'
  | 'coverage.claimed'
  | 'coverage.resolved'
  | 'coverage.cancelled'
  | 'notification.created'
  | 'duty.changed'
  | 'availability.changed';

export interface RealtimeAudience {
  userIds?: string[];
  locationIds?: string[];
  roles?: Role[];
  everyone?: boolean;
}

export interface RealtimeEvent {
  id: string;
  type: RealtimeEventType;
  audience: RealtimeAudience;
  message?: string;
  payload?: Record<string, unknown>;
  actorId?: string;
  at: string;
}

export interface SubscriberIdentity {
  userId: string;
  role: Role;
  locationIds: string[];
}

export function matchesAudience(
  event: RealtimeEvent,
  identity: SubscriberIdentity,
): boolean {
  const { audience } = event;
  if (audience.everyone) return true;
  if (identity.role === 'ADMIN') return true;
  if (audience.userIds?.includes(identity.userId)) return true;
  if (audience.roles?.includes(identity.role)) return true;
  if (audience.locationIds?.some((id) => identity.locationIds.includes(id))) {
    return true;
  }
  return false;
}
