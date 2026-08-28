import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { assignStaffToShift } from '@/lib/services/assignments';
import { isPremiumShift, weekKey } from '@/lib/time/zones';
import type { Viewer } from '@/lib/auth/session';

const PREFIX = `test-${randomUUID().slice(0, 8)}`;

const LA = 'America/Los_Angeles';
const NY = 'America/New_York';

const BASE = new Date(
  Math.floor((Date.now() + 30 * 86_400_000) / 86_400_000) * 86_400_000,
);

const LONG_STANDING = new Date('2020-01-01T00:00:00Z');

interface Fixtures {
  skillId: string;
  locationAId: string;
  locationBId: string;
  managerA: Viewer;
  managerB: Viewer;
  staffId: string;
  staffTwoId: string;
}

let fx: Fixtures;

async function createShift(
  locationId: string,
  timeZone: string,
  startUtc: Date,
  endUtc: Date,
  headcount = 1,
) {
  return db.shift.create({
    data: {
      locationId,
      startUtc,
      endUtc,
      requiredSkillId: fx.skillId,
      headcount,
      status: 'PUBLISHED',
      isPremium: isPremiumShift(startUtc, timeZone),
      weekKey: weekKey(startUtc, timeZone),
    },
    select: { id: true },
  });
}

function viewer(
  id: string,
  name: string,
  managedLocationIds: string[],
): Viewer {
  return {
    id,
    name,
    email: `${name}@test.local`,
    role: 'MANAGER',
    timezone: LA,
    locationIds: managedLocationIds,
    managedLocationIds,
  };
}

beforeAll(async () => {
  const skill = await db.skill.create({
    data: { name: `${PREFIX} Bartender`, slug: `${PREFIX}-bartender` },
  });

  const locationA = await db.location.create({
    data: { name: `${PREFIX} West`, slug: `${PREFIX}-west`, timezone: LA },
  });
  const locationB = await db.location.create({
    data: { name: `${PREFIX} East`, slug: `${PREFIX}-east`, timezone: NY },
  });

  const managerA = await db.user.create({
    data: {
      email: `${PREFIX}-mgr-a@test.local`,
      name: `${PREFIX} Manager A`,
      passwordHash: 'x',
      role: 'MANAGER',
      managedLocations: { create: [{ locationId: locationA.id }] },
    },
  });
  const managerB = await db.user.create({
    data: {
      email: `${PREFIX}-mgr-b@test.local`,
      name: `${PREFIX} Manager B`,
      passwordHash: 'x',
      role: 'MANAGER',
      managedLocations: { create: [{ locationId: locationB.id }] },
    },
  });

  async function makeStaff(label: string) {
    return db.user.create({
      data: {
        email: `${PREFIX}-${label}@test.local`,
        name: `Staff ${label}`,
        passwordHash: 'x',
        role: 'STAFF',
        timezone: LA,
        staffProfile: { create: { desiredWeeklyHours: 40 } },
        skills: { create: [{ skillId: skill.id }] },
        certifications: {
          create: [{ locationId: locationA.id }, { locationId: locationB.id }],
        },
        availabilityRules: {
          create: [1, 2, 3, 4, 5, 6, 7].map((dayOfWeek) => ({
            dayOfWeek,
            startTime: '00:00',
            endTime: '00:00',
            spansMidnight: true,
            timezone: null,
            effectiveFrom: LONG_STANDING,
          })),
        },
      },
      select: { id: true },
    });
  }

  const staff = await makeStaff('one');
  const staffTwo = await makeStaff('two');

  fx = {
    skillId: skill.id,
    locationAId: locationA.id,
    locationBId: locationB.id,
    managerA: viewer(managerA.id, `${PREFIX} Manager A`, [locationA.id]),
    managerB: viewer(managerB.id, `${PREFIX} Manager B`, [locationB.id]),
    staffId: staff.id,
    staffTwoId: staffTwo.id,
  };
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorLabel: { startsWith: PREFIX } } });
  await db.location.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.skill.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.$disconnect();
});

describe('two managers assigning the same person at the same moment', () => {
  it('lets exactly one win and tells the other precisely why', async () => {
    const shiftWest = await createShift(
      fx.locationAId,
      LA,
      new Date(BASE.getTime()),
      new Date(BASE.getTime() + 6 * 3_600_000),
    );
    const shiftEast = await createShift(
      fx.locationBId,
      NY,
      new Date(BASE.getTime() + 2 * 3_600_000),
      new Date(BASE.getTime() + 8 * 3_600_000),
    );

    const [west, east] = await Promise.all([
      assignStaffToShift({
        shiftId: shiftWest.id,
        userId: fx.staffId,
        actor: fx.managerA,
      }),
      assignStaffToShift({
        shiftId: shiftEast.id,
        userId: fx.staffId,
        actor: fx.managerB,
      }),
    ]);

    const outcomes = [west.status, east.status].sort();
    expect(outcomes).toEqual(['ASSIGNED', 'BLOCKED']);

    const loser = west.status === 'BLOCKED' ? west : east;
    const codes = loser.evaluation.blocking.map((v) => v.code);
    expect(codes).toContain('DOUBLE_BOOKING');

    const message = loser.evaluation.blocking.find(
      (v) => v.code === 'DOUBLE_BOOKING',
    )!.message;
    expect(message).toContain(PREFIX);
    expect(message).toContain('a different location');

    expect(loser.suggestions).toBeDefined();

    const active = await db.assignment.count({
      where: {
        userId: fx.staffId,
        status: 'ASSIGNED',
        shiftId: { in: [shiftWest.id, shiftEast.id] },
      },
    });
    expect(active).toBe(1);
  });

  it('never exceeds headcount when two managers fill the last seat', async () => {
    const shift = await createShift(
      fx.locationAId,
      LA,
      new Date(BASE.getTime() + 30 * 86_400_000),
      new Date(BASE.getTime() + 30 * 86_400_000 + 6 * 3_600_000),
      1,
    );

    const [first, second] = await Promise.all([
      assignStaffToShift({
        shiftId: shift.id,
        userId: fx.staffId,
        actor: fx.managerA,
      }),
      assignStaffToShift({
        shiftId: shift.id,
        userId: fx.staffTwoId,
        actor: fx.managerA,
      }),
    ]);

    expect([first.status, second.status].sort()).toEqual([
      'ASSIGNED',
      'BLOCKED',
    ]);

    const loser = first.status === 'BLOCKED' ? first : second;
    expect(loser.evaluation.blocking.map((v) => v.code)).toContain('SHIFT_FULL');

    const filled = await db.assignment.count({
      where: { shiftId: shift.id, status: 'ASSIGNED' },
    });
    expect(filled).toBe(1);
  });

  it('is idempotent when the same assignment is submitted twice at once', async () => {
    const shift = await createShift(
      fx.locationAId,
      LA,
      new Date(BASE.getTime() + 60 * 86_400_000),
      new Date(BASE.getTime() + 60 * 86_400_000 + 6 * 3_600_000),
      2,
    );

    const results = await Promise.all([
      assignStaffToShift({
        shiftId: shift.id,
        userId: fx.staffId,
        actor: fx.managerA,
      }),
      assignStaffToShift({
        shiftId: shift.id,
        userId: fx.staffId,
        actor: fx.managerA,
      }),
    ]);

    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual(['ASSIGNED', 'BLOCKED']);

    const rows = await db.assignment.count({
      where: { shiftId: shift.id, userId: fx.staffId },
    });
    expect(rows).toBe(1);
  });

  it('enforces the 10-hour rest rule across a concurrent pair', async () => {
    const day = new Date(BASE.getTime() + 90 * 86_400_000);
    const evening = await createShift(
      fx.locationAId,
      LA,
      day,
      new Date(day.getTime() + 6 * 3_600_000),
    );
    const nextMorning = await createShift(
      fx.locationBId,
      NY,
      new Date(day.getTime() + 10 * 3_600_000),
      new Date(day.getTime() + 16 * 3_600_000),
    );

    const results = await Promise.all([
      assignStaffToShift({
        shiftId: evening.id,
        userId: fx.staffId,
        actor: fx.managerA,
      }),
      assignStaffToShift({
        shiftId: nextMorning.id,
        userId: fx.staffId,
        actor: fx.managerB,
      }),
    ]);

    expect(results.map((r) => r.status).sort()).toEqual([
      'ASSIGNED',
      'BLOCKED',
    ]);
    const loser = results.find((r) => r.status === 'BLOCKED')!;
    expect(loser.evaluation.blocking.map((v) => v.code)).toContain(
      'REST_PERIOD_10H',
    );
  });
});

describe('audit trail', () => {
  it('records every successful assignment in the same transaction', async () => {
    const shift = await createShift(
      fx.locationAId,
      LA,
      new Date(BASE.getTime() + 120 * 86_400_000),
      new Date(BASE.getTime() + 120 * 86_400_000 + 5 * 3_600_000),
    );

    const result = await assignStaffToShift({
      shiftId: shift.id,
      userId: fx.staffId,
      actor: fx.managerA,
    });
    expect(result.status).toBe('ASSIGNED');

    const audit = await db.auditLog.findFirst({
      where: {
        entityType: 'Assignment',
        entityId: result.assignmentId,
        action: 'ASSIGNMENT_CREATED',
      },
    });
    expect(audit).not.toBeNull();
    expect(audit!.actorLabel).toContain('Manager A');
    expect(audit!.after).toMatchObject({ status: 'ASSIGNED' });
  });

  it('leaves no audit row behind when an assignment is blocked', async () => {
    const shift = await createShift(
      fx.locationAId,
      LA,
      new Date(BASE.getTime() + 150 * 86_400_000),
      new Date(BASE.getTime() + 150 * 86_400_000 + 5 * 3_600_000),
    );

    const before = await db.auditLog.count({
      where: { action: 'ASSIGNMENT_CREATED' },
    });

    const outsider = await db.user.create({
      data: {
        email: `${PREFIX}-outsider@test.local`,
        name: 'Outsider',
        passwordHash: 'x',
        role: 'STAFF',
        staffProfile: { create: {} },
      },
      select: { id: true },
    });

    const result = await assignStaffToShift({
      shiftId: shift.id,
      userId: outsider.id,
      actor: fx.managerA,
    });
    expect(result.status).toBe('BLOCKED');

    const after = await db.auditLog.count({
      where: { action: 'ASSIGNMENT_CREATED' },
    });
    expect(after).toBe(before);
  });
});
