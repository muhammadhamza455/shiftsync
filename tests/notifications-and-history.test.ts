import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { assignStaffToShift, unassignStaff } from '@/lib/services/assignments';
import { shiftHistory } from '@/lib/queries/schedule';
import { isPremiumShift, weekKey } from '@/lib/time/zones';
import type { Viewer } from '@/lib/auth/session';

const PREFIX = `ntest-${randomUUID().slice(0, 8)}`;
const LA = 'America/Los_Angeles';
const LONG_STANDING = new Date('2020-01-01T00:00:00Z');

const MONDAY = (() => {
  const d = new Date(Date.now() + 40 * 86_400_000);
  d.setUTCHours(0, 0, 0, 0);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
})();

let skillId: string;
let locationId: string;
let staffId: string;
let otherManagerId: string;
let actor: Viewer;

async function makeShift(dayIndex: number, hours: number) {
  const startUtc = new Date(MONDAY.getTime() + dayIndex * 86_400_000);
  startUtc.setUTCHours(16, 0, 0, 0);
  const endUtc = new Date(startUtc.getTime() + hours * 3_600_000);
  return db.shift.create({
    data: {
      locationId,
      startUtc,
      endUtc,
      requiredSkillId: skillId,
      headcount: 1,
      status: 'PUBLISHED',
      isPremium: isPremiumShift(startUtc, LA),
      weekKey: weekKey(startUtc, LA),
    },
    select: { id: true },
  });
}

beforeAll(async () => {
  const skill = await db.skill.create({
    data: { name: `${PREFIX} Cook`, slug: `${PREFIX}-cook` },
  });
  skillId = skill.id;

  const location = await db.location.create({
    data: { name: `${PREFIX} Kitchen`, slug: `${PREFIX}-kitchen`, timezone: LA },
  });
  locationId = location.id;

  const acting = await db.user.create({
    data: {
      email: `${PREFIX}-acting@test.local`,
      name: `${PREFIX} Acting Manager`,
      passwordHash: 'x',
      role: 'MANAGER',
      managedLocations: { create: [{ locationId }] },
    },
  });
  const other = await db.user.create({
    data: {
      email: `${PREFIX}-other@test.local`,
      name: `${PREFIX} Other Manager`,
      passwordHash: 'x',
      role: 'MANAGER',
      managedLocations: { create: [{ locationId }] },
    },
  });
  otherManagerId = other.id;

  const staff = await db.user.create({
    data: {
      email: `${PREFIX}-staff@test.local`,
      name: `${PREFIX} Staffer`,
      passwordHash: 'x',
      role: 'STAFF',
      timezone: LA,
      staffProfile: { create: { desiredWeeklyHours: 40, baseHourlyRate: 20 } },
      skills: { create: [{ skillId }] },
      certifications: { create: [{ locationId }] },
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
  staffId = staff.id;

  actor = {
    id: acting.id,
    name: `${PREFIX} Acting Manager`,
    email: acting.email,
    role: 'MANAGER',
    timezone: LA,
    locationIds: [locationId],
    managedLocationIds: [locationId],
  };
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { actorLabel: { startsWith: PREFIX } } });
  await db.location.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await db.skill.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  await db.$disconnect();
});

describe('overtime warnings reach managers', () => {
  it('fires on the assignment that crosses 40 hours, and only that one', async () => {
    for (const day of [0, 1, 2, 3]) {
      const shift = await makeShift(day, 9);
      const result = await assignStaffToShift({
        shiftId: shift.id,
        userId: staffId,
        actor,
      });
      expect(result.status).toBe('ASSIGNED');
    }

    const beforeCrossing = await db.notification.count({
      where: { userId: otherManagerId, type: 'OVERTIME_WARNING' },
    });
    expect(beforeCrossing).toBe(0);

    const crossing = await makeShift(4, 9);
    const crossed = await assignStaffToShift({
      shiftId: crossing.id,
      userId: staffId,
      actor,
    });
    expect(crossed.status).toBe('ASSIGNED');
    expect(crossed.evaluation.projection.weeklyHoursAfter).toBe(45);
    expect(crossed.evaluation.projection.overtimeHoursAfter).toBe(5);

    const warnings = await db.notification.findMany({
      where: { userId: otherManagerId, type: 'OVERTIME_WARNING' },
    });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].body).toContain('45h');
    expect(warnings[0].href).toBe('/manage/overtime');

    const sixth = await makeShift(5, 9);
    await assignStaffToShift({ shiftId: sixth.id, userId: staffId, actor });

    const after = await db.notification.count({
      where: { userId: otherManagerId, type: 'OVERTIME_WARNING' },
    });
    expect(after).toBe(1);
  });

  it('does not notify the manager who made the change', async () => {
    const own = await db.notification.count({
      where: { userId: actor.id, type: 'OVERTIME_WARNING' },
    });
    expect(own).toBe(0);
  });
});

describe('shift history', () => {
  it('gathers audit rows for the shift and its assignments into one timeline', async () => {
    const shift = await makeShift(14, 4);

    const assigned = await assignStaffToShift({
      shiftId: shift.id,
      userId: staffId,
      actor,
    });
    expect(assigned.status).toBe('ASSIGNED');

    await unassignStaff({
      assignmentId: assigned.assignmentId!,
      actor,
      reason: 'Testing the history view',
    });

    const history = await shiftHistory(shift.id);

    const actions = history.map((h) => h.action);
    expect(actions).toContain('ASSIGNMENT_CREATED');
    expect(actions).toContain('ASSIGNMENT_CANCELLED');
    expect(actions.indexOf('ASSIGNMENT_CANCELLED')).toBeLessThan(
      actions.indexOf('ASSIGNMENT_CREATED'),
    );

    const cancellation = history.find(
      (h) => h.action === 'ASSIGNMENT_CANCELLED',
    )!;
    expect(cancellation.actorLabel).toContain('Acting Manager');
    expect(cancellation.summary).toContain('Testing the history view');
    expect(cancellation.after).toMatchObject({ status: 'CANCELLED' });
  });

  it('returns nothing for a shift that does not exist', async () => {
    expect(await shiftHistory('does-not-exist')).toEqual([]);
  });
});
