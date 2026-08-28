import { cache } from 'react';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import type { Role } from '@/generated/prisma/enums';

export interface Viewer {
  id: string;
  name: string;
  email: string;
  role: Role;
  timezone: string;
  locationIds: string[];
  managedLocationIds: string[];
}

export class AuthorizationError extends Error {
  constructor(message = 'You do not have access to that.') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      timezone: true,
      isActive: true,
      managedLocations: { select: { locationId: true } },
      certifications: {
        where: { revokedAt: null },
        select: { locationId: true },
      },
    },
  });

  if (!user || !user.isActive) return null;

  const managedLocationIds = user.managedLocations.map((m) => m.locationId);

  let locationIds: string[];
  if (user.role === 'ADMIN') {
    const all = await db.location.findMany({ select: { id: true } });
    locationIds = all.map((l) => l.id);
  } else if (user.role === 'MANAGER') {
    locationIds = managedLocationIds;
  } else {
    locationIds = user.certifications.map((c) => c.locationId);
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    timezone: user.timezone,
    locationIds,
    managedLocationIds,
  };
});

export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new AuthorizationError('You must be signed in.');
  return viewer;
}

export async function requireRole(...roles: Role[]): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!roles.includes(viewer.role)) {
    throw new AuthorizationError(
      `This action requires the ${roles.join(' or ')} role.`,
    );
  }
  return viewer;
}

export function canManageLocation(viewer: Viewer, locationId: string): boolean {
  if (viewer.role === 'ADMIN') return true;
  return viewer.managedLocationIds.includes(locationId);
}

export function canViewLocation(viewer: Viewer, locationId: string): boolean {
  if (viewer.role === 'ADMIN') return true;
  return viewer.locationIds.includes(locationId);
}

export async function requireManageLocation(
  locationId: string,
): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!canManageLocation(viewer, locationId)) {
    throw new AuthorizationError(
      'You can only manage locations you are assigned to.',
    );
  }
  return viewer;
}

export async function requireViewLocation(locationId: string): Promise<Viewer> {
  const viewer = await requireViewer();
  if (!canViewLocation(viewer, locationId)) {
    throw new AuthorizationError('You do not have access to that location.');
  }
  return viewer;
}
