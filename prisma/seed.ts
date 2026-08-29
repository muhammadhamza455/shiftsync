import 'dotenv/config';
import { hash } from 'bcryptjs';
import { db } from '../src/lib/db';
import {
  inZone,
  isPremiumShift,
  localDate,
  weekKey,
  wallClockToInstant,
  toDate,
} from '../src/lib/time/zones';
import {
  coversInterval,
  resolveAvailability,
} from '../src/lib/scheduling/availability';
import type { AvailabilityExceptionType } from '../src/generated/prisma/enums';

const PASSWORD = 'Coastal2026!';

const NOW = new Date();

function localShift(
  timeZone: string,
  dayOffset: number,
  startTime: string,
  endTime: string,
): { startUtc: Date; endUtc: Date } {
  const today = localDate(NOW, timeZone);
  const day = today.add({ days: dayOffset });
  const startUtc = toDate(wallClockToInstant(day, startTime, timeZone));
  const crossesMidnight = endTime <= startTime;
  const endDay = crossesMidnight ? day.add({ days: 1 }) : day;
  const endUtc = toDate(wallClockToInstant(endDay, endTime, timeZone));
  return { startUtc, endUtc };
}

function offsetToWeekday(timeZone: string, isoWeekday: number, weeks = 0): number {
  const today = localDate(NOW, timeZone);
  const delta = (isoWeekday - today.dayOfWeek + 7) % 7;
  return delta + weeks * 7;
}

function nextWeekMondayOffset(timeZone: string): number {
  return 8 - localDate(NOW, timeZone).dayOfWeek;
}

async function clearDatabase() {
  await db.emailLog.deleteMany();
  await db.notification.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.auditLog.deleteMany();
  await db.coverageRequest.deleteMany();
  await db.constraintOverride.deleteMany();
  await db.assignment.deleteMany();
  await db.schedulePublication.deleteMany();
  await db.shift.deleteMany();
  await db.availabilityException.deleteMany();
  await db.availabilityRule.deleteMany();
  await db.staffSkill.deleteMany();
  await db.locationCertification.deleteMany();
  await db.managerAssignment.deleteMany();
  await db.staffProfile.deleteMany();
  await db.skill.deleteMany();
  await db.location.deleteMany();
  await db.user.deleteMany();
}

async function main() {
  console.log('Clearing existing data …');
  await clearDatabase();

  const passwordHash = await hash(PASSWORD, 10);

  console.log('Creating skills …');
  const skillSeeds = [
    { name: 'Bartender', slug: 'bartender', colour: '#8b5cf6' },
    { name: 'Line Cook', slug: 'line-cook', colour: '#ef4444' },
    { name: 'Server', slug: 'server', colour: '#0ea5e9' },
    { name: 'Host', slug: 'host', colour: '#10b981' },
    { name: 'Dishwasher', slug: 'dishwasher', colour: '#64748b' },
    { name: 'Shift Lead', slug: 'shift-lead', colour: '#f59e0b' },
  ];
  const skills = Object.fromEntries(
    await Promise.all(
      skillSeeds.map(async (s) => [s.slug, await db.skill.create({ data: s })] as const),
    ),
  );

  console.log('Creating locations …');
  const santaMonica = await db.location.create({
    data: {
      name: 'Coastal Eats — Santa Monica',
      slug: 'santa-monica',
      timezone: 'America/Los_Angeles',
      address: '1400 Ocean Ave',
      city: 'Santa Monica',
      state: 'CA',
      editCutoffHours: 48,
    },
  });
  const portland = await db.location.create({
    data: {
      name: 'Coastal Eats — Portland Pearl',
      slug: 'portland-pearl',
      timezone: 'America/Los_Angeles',
      address: '1130 NW Everett St',
      city: 'Portland',
      state: 'OR',
      editCutoffHours: 24,
    },
  });
  const charleston = await db.location.create({
    data: {
      name: 'Coastal Eats — Charleston Battery',
      slug: 'charleston-battery',
      timezone: 'America/New_York',
      address: '2 Murray Blvd',
      city: 'Charleston',
      state: 'SC',
      editCutoffHours: 48,
    },
  });
  const columbus = await db.location.create({
    data: {
      name: 'Coastal Eats — Columbus Riverwalk',
      slug: 'columbus-riverwalk',
      timezone: 'America/New_York',
      address: '1000 Bay Ave',
      city: 'Columbus',
      state: 'GA',
      timezoneNote:
        'Sits on the Chattahoochee, one bridge from Phenix City, Alabama, which is Central. ' +
        'The restaurant operates on Eastern time: all shifts, payroll and reporting use ' +
        'America/New_York. Staff commuting from Alabama see an hour difference on their own ' +
        'clocks, so the UI always shows the zone abbreviation next to every time.',
      editCutoffHours: 48,
    },
  });

  const locations = { santaMonica, portland, charleston, columbus };

  console.log('Creating users …');

  const admin = await db.user.create({
    data: {
      email: 'dana.reyes@coastaleats.com',
      name: 'Dana Reyes',
      passwordHash,
      role: 'ADMIN',
      timezone: 'America/New_York',
      notificationPreference: { create: { emailSimulation: true } },
    },
  });

  const marcus = await db.user.create({
    data: {
      email: 'marcus.hale@coastaleats.com',
      name: 'Marcus Hale',
      passwordHash,
      role: 'MANAGER',
      timezone: 'America/Los_Angeles',
      managedLocations: {
        create: [{ locationId: santaMonica.id }, { locationId: portland.id }],
      },
      notificationPreference: { create: { emailSimulation: true } },
    },
  });

  const priya = await db.user.create({
    data: {
      email: 'priya.nadkarni@coastaleats.com',
      name: 'Priya Nadkarni',
      passwordHash,
      role: 'MANAGER',
      timezone: 'America/New_York',
      managedLocations: {
        create: [{ locationId: charleston.id }, { locationId: columbus.id }],
      },
      notificationPreference: { create: { emailSimulation: false } },
    },
  });

  interface StaffSeed {
    key: string;
    email: string;
    name: string;
    timezone: string;
    desiredWeeklyHours: number;
    rate: number;
    skills: string[];
    locations: string[];
    availability: {
      days: number[];
      start: string;
      end: string;
      zone?: string | null;
    }[];
    note?: string;
  }

  const staffSeeds: StaffSeed[] = [
    {
      key: 'sarah',
      email: 'sarah.chen@coastaleats.com',
      name: 'Sarah Chen',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 32,
      rate: 24,
      skills: ['bartender', 'server'],
      locations: ['santaMonica', 'charleston'],
      availability: [
        { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', zone: null },
      ],
      note: 'Cross-timezone certification with floating availability.',
    },
    {
      key: 'elena',
      email: 'elena.vasquez@coastaleats.com',
      name: 'Elena Vasquez',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 30,
      rate: 23,
      skills: ['bartender', 'shift-lead'],
      locations: ['santaMonica', 'charleston'],
      availability: [
        {
          days: [1, 2, 3, 4, 5],
          start: '09:00',
          end: '17:00',
          zone: 'America/Los_Angeles',
        },
      ],
      note: 'Same stated hours as Sarah, but anchored to Pacific.',
    },
    {
      key: 'marco',
      email: 'marco.ruiz@coastaleats.com',
      name: 'Marco Ruiz',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 40,
      rate: 26,
      skills: ['line-cook', 'shift-lead'],
      locations: ['santaMonica', 'portland'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '00:00', zone: null },
      ],
      note: 'Scenario 2: seeded into 52 hours next week.',
    },
    {
      key: 'jordan',
      email: 'jordan.blake@coastaleats.com',
      name: 'Jordan Blake',
      timezone: 'America/New_York',
      desiredWeeklyHours: 30,
      rate: 19,
      skills: ['server', 'host'],
      locations: ['charleston', 'columbus'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '10:00', end: '23:59', zone: null },
      ],
      note: 'Scenario 5: available every Saturday night, never given one.',
    },
    {
      key: 'nina',
      email: 'nina.alvarez@coastaleats.com',
      name: 'Nina Alvarez',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 25,
      rate: 25,
      skills: ['bartender'],
      locations: ['portland', 'santaMonica'],
      availability: [
        { days: [3, 4, 5, 6, 7], start: '15:00', end: '23:59', zone: null },
      ],
      note: 'Scenario 4: the bartender two managers both want.',
    },
    {
      key: 'tom',
      email: 'tom.okafor@coastaleats.com',
      name: 'Tom Okafor',
      timezone: 'America/New_York',
      desiredWeeklyHours: 35,
      rate: 21,
      skills: ['line-cook'],
      locations: ['charleston'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '08:00', end: '22:00', zone: null },
      ],
    },
    {
      key: 'alicia',
      email: 'alicia.moreau@coastaleats.com',
      name: 'Alicia Moreau',
      timezone: 'America/New_York',
      desiredWeeklyHours: 28,
      rate: 22,
      skills: ['line-cook', 'server'],
      locations: ['charleston', 'columbus'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '09:00', end: '23:00', zone: null },
      ],
    },
    {
      key: 'devon',
      email: 'devon.pierce@coastaleats.com',
      name: 'Devon Pierce',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 20,
      rate: 18,
      skills: ['server', 'host'],
      locations: ['santaMonica'],
      availability: [
        { days: [4, 5, 6, 7], start: '16:00', end: '23:59', zone: null },
      ],
    },
    {
      key: 'kaito',
      email: 'kaito.mori@coastaleats.com',
      name: 'Kaito Mori',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 35,
      rate: 20,
      skills: ['server', 'bartender'],
      locations: ['portland'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6], start: '11:00', end: '23:00', zone: null },
      ],
    },
    {
      key: 'rosa',
      email: 'rosa.delgado@coastaleats.com',
      name: 'Rosa Delgado',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 30,
      rate: 19,
      skills: ['host', 'server'],
      locations: ['portland', 'santaMonica'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '10:00', end: '22:00', zone: null },
      ],
    },
    {
      key: 'ben',
      email: 'ben.harlow@coastaleats.com',
      name: 'Ben Harlow',
      timezone: 'America/New_York',
      desiredWeeklyHours: 24,
      rate: 18,
      skills: ['dishwasher', 'line-cook'],
      locations: ['columbus'],
      availability: [
        { days: [2, 3, 4, 5, 6], start: '12:00', end: '23:59', zone: null },
      ],
    },
    {
      key: 'maya',
      email: 'maya.johnson@coastaleats.com',
      name: 'Maya Johnson',
      timezone: 'America/New_York',
      desiredWeeklyHours: 38,
      rate: 23,
      skills: ['server', 'shift-lead', 'host'],
      locations: ['columbus', 'charleston'],
      availability: [
        { days: [1, 2, 3, 4, 5, 6, 7], start: '09:00', end: '23:59', zone: null },
      ],
    },
    {
      key: 'ollie',
      email: 'ollie.brennan@coastaleats.com',
      name: 'Ollie Brennan',
      timezone: 'America/New_York',
      desiredWeeklyHours: 16,
      rate: 18,
      skills: ['dishwasher'],
      locations: ['charleston'],
      availability: [
        { days: [5, 6, 7], start: '17:00', end: '23:59', zone: null },
      ],
    },
    {
      key: 'wes',
      email: 'wes.tanaka@coastaleats.com',
      name: 'Wes Tanaka',
      timezone: 'America/Los_Angeles',
      desiredWeeklyHours: 30,
      rate: 21,
      skills: ['line-cook', 'dishwasher'],
      locations: ['santaMonica', 'portland'],
      availability: [
        { days: [1, 2, 3, 4, 5], start: '07:00', end: '19:00', zone: null },
      ],
    },
  ];

  const staff: Record<string, { id: string; name: string }> = {};

  for (const seed of staffSeeds) {
    const user = await db.user.create({
      data: {
        email: seed.email,
        name: seed.name,
        passwordHash,
        role: 'STAFF',
        timezone: seed.timezone,
        staffProfile: {
          create: {
            desiredWeeklyHours: seed.desiredWeeklyHours,
            baseHourlyRate: seed.rate,
            maxWeeklyHours: 40,
          },
        },
        notificationPreference: {
          create: { emailSimulation: seed.key === 'sarah' || seed.key === 'marco' },
        },
        skills: {
          create: seed.skills.map((slug) => ({ skillId: skills[slug].id })),
        },
        certifications: {
          create: seed.locations.map((key) => ({
            locationId: locations[key as keyof typeof locations].id,
          })),
        },
        availabilityRules: {
          create: seed.availability.flatMap((window) =>
            window.days.map((dayOfWeek) => ({
              dayOfWeek,
              startTime: window.start,
              endTime: window.end,
              spansMidnight: window.end <= window.start,
              timezone: window.zone ?? null,
              effectiveFrom: new Date(NOW.getTime() - 180 * 86_400_000),
            })),
          ),
        },
      },
      select: { id: true, name: true },
    });
    staff[seed.key] = user;
  }

  await db.locationCertification.update({
    where: {
      userId_locationId: { userId: staff.wes.id, locationId: portland.id },
    },
    data: {
      revokedAt: new Date(NOW.getTime() - 30 * 86_400_000),
      revokedReason: 'Transferred to Santa Monica; Portland sign-off lapsed.',
    },
  });

  await db.availabilityException.createMany({
    data: [
      {
        userId: staff.sarah.id,
        type: 'UNAVAILABLE' as AvailabilityExceptionType,
        date: new Date(
          Date.UTC(
            localDate(NOW, 'America/Los_Angeles').add({ days: 9 }).year,
            localDate(NOW, 'America/Los_Angeles').add({ days: 9 }).month - 1,
            localDate(NOW, 'America/Los_Angeles').add({ days: 9 }).day,
          ),
        ),
        reason: 'Family wedding — unavailable all day',
      },
      {
        userId: staff.jordan.id,
        type: 'AVAILABLE' as AvailabilityExceptionType,
        date: new Date(
          Date.UTC(
            localDate(NOW, 'America/New_York').add({ days: 2 }).year,
            localDate(NOW, 'America/New_York').add({ days: 2 }).month - 1,
            localDate(NOW, 'America/New_York').add({ days: 2 }).day,
          ),
        ),
        startTime: '06:00',
        endTime: '10:00',
        reason: 'Happy to open this once',
      },
    ],
  });

  console.log('Creating shifts and assignments …');

  interface ShiftPlan {
    location: keyof typeof locations;
    dayOffset: number;
    start: string;
    end: string;
    skill: string;
    headcount: number;
    status: 'DRAFT' | 'PUBLISHED';
    assign?: string[];
    notes?: string;
    intentionalViolation?: boolean;
  }

  const plans: ShiftPlan[] = [];

  const daysLeftThisWeek = 7 - localDate(NOW, 'America/New_York').dayOfWeek;

  for (const weeksAgo of [1, 2]) {
    const friday = offsetToWeekday('America/New_York', 5, 0) - weeksAgo * 7;
    const saturday = offsetToWeekday('America/New_York', 6, 0) - weeksAgo * 7;

    plans.push(
      {
        location: 'charleston',
        dayOffset: friday,
        start: '17:00',
        end: '23:00',
        skill: 'server',
        headcount: 2,
        status: 'PUBLISHED',
        assign: ['maya', 'alicia'],
      },
      {
        location: 'charleston',
        dayOffset: saturday,
        start: '17:00',
        end: '23:00',
        skill: 'server',
        headcount: 2,
        status: 'PUBLISHED',
        assign: ['maya', 'alicia'],
      },
      {
        location: 'charleston',
        dayOffset: friday - 3,
        start: '11:00',
        end: '16:00',
        skill: 'server',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['jordan'],
      },
      {
        location: 'charleston',
        dayOffset: friday - 2,
        start: '11:00',
        end: '16:00',
        skill: 'server',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['jordan'],
      },
      {
        location: 'santaMonica',
        dayOffset: offsetToWeekday('America/Los_Angeles', 5, 0) - weeksAgo * 7,
        start: '17:00',
        end: '23:00',
        skill: 'bartender',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['nina'],
      },
    );
  }

  const callOutOffset =
    inZone(NOW, charleston.timezone).hour >= 18 ? 1 : 0;
  plans.push({
    location: 'charleston',
    dayOffset: callOutOffset,
    start: '19:00',
    end: '23:00',
    skill: 'server',
    headcount: 2,
    status: 'PUBLISHED',
    assign: ['alicia'],
    notes: 'Short one server — Tom called out at short notice.',
  });

  plans.push(
    {
      location: 'charleston',
      dayOffset: 0,
      start: '11:00',
      end: '19:00',
      skill: 'line-cook',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['tom'],
    },
    {
      location: 'santaMonica',
      dayOffset: 0,
      start: '16:00',
      end: '23:00',
      skill: 'bartender',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['nina'],
    },
    {
      location: 'santaMonica',
      dayOffset: 0,
      start: '10:00',
      end: '18:00',
      skill: 'line-cook',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['wes'],
    },
    {
      location: 'portland',
      dayOffset: 0,
      start: '11:00',
      end: '19:00',
      skill: 'server',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['kaito'],
    },
    {
      location: 'columbus',
      dayOffset: 0,
      start: '12:00',
      end: '20:00',
      skill: 'server',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['maya'],
    },
    {
      location: 'columbus',
      dayOffset: 0,
      start: '15:00',
      end: '22:00',
      skill: 'dishwasher',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['ben'],
    },
  );

  plans.push({
    location: 'santaMonica',
    dayOffset: 1,
    start: '23:00',
    end: '03:00',
    skill: 'line-cook',
    headcount: 1,
    status: 'PUBLISHED',
    assign: ['marco'],
    notes: 'Overnight prep — runs to 3am the following day.',
  });

  const legacyDay = -5;
  plans.push(
    {
      location: 'portland',
      dayOffset: legacyDay,
      start: '16:00',
      end: '22:00',
      skill: 'line-cook',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['marco'],
      notes: 'Close.',
      intentionalViolation: true,
    },
    {
      location: 'portland',
      dayOffset: legacyDay + 1,
      start: '07:00',
      end: '13:00',
      skill: 'line-cook',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['marco'],
      notes: 'Open — only 9h after last night close. A legacy roster mistake.',
      intentionalViolation: true,
    },
  );

  for (let d = 1; d <= daysLeftThisWeek; d += 1) {
    plans.push(
      {
        location: 'charleston',
        dayOffset: d,
        start: '11:00',
        end: '19:00',
        skill: 'line-cook',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['tom'],
      },
      {
        location: 'charleston',
        dayOffset: d,
        start: '11:00',
        end: '16:00',
        skill: 'server',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['jordan'],
      },
      {
        location: 'santaMonica',
        dayOffset: d,
        start: '11:00',
        end: '17:00',
        skill: 'server',
        headcount: 1,
        status: 'PUBLISHED',
        assign: ['rosa'],
      },
      {
        location: 'portland',
        dayOffset: d,
        start: '16:00',
        end: '22:00',
        skill: 'bartender',
        headcount: 1,
        status: 'PUBLISHED',
        assign:
          localDate(NOW, 'America/Los_Angeles').add({ days: d }).dayOfWeek === 7
            ? ['nina']
            : ['kaito'],
      },
    );
  }

  for (let d = 1; d <= daysLeftThisWeek; d += 1) {
    const weekday = localDate(NOW, 'America/Los_Angeles')
      .add({ days: d })
      .dayOfWeek;
    if (weekday < 4) continue;
    plans.push({
      location: 'santaMonica',
      dayOffset: d,
      start: '17:00',
      end: '22:00',
      skill: 'server',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['devon'],
    });
  }

  plans.push(
    {
      location: 'charleston',
      dayOffset: offsetToWeekday('America/New_York', 5),
      start: '17:00',
      end: '23:00',
      skill: 'server',
      headcount: 2,
      status: 'PUBLISHED',
      assign: ['maya', 'alicia'],
    },
    {
      location: 'charleston',
      dayOffset: offsetToWeekday('America/New_York', 6),
      start: '17:00',
      end: '23:00',
      skill: 'server',
      headcount: 2,
      status: 'PUBLISHED',
      assign: ['maya', 'alicia'],
    },
    {
      location: 'santaMonica',
      dayOffset: offsetToWeekday('America/Los_Angeles', 6),
      start: '17:00',
      end: '23:00',
      skill: 'bartender',
      headcount: 1,
      status: 'PUBLISHED',
      assign: ['nina'],
    },
  );

  const nextMonday = nextWeekMondayOffset('America/Los_Angeles');
  const marcoDays = [0, 1, 2, 3, 4, 5].map((d) => nextMonday + d);
  marcoDays.forEach((dayOffset, index) => {
    plans.push({
      location: index % 2 === 0 ? 'santaMonica' : 'portland',
      dayOffset,
      start: '10:00',
      end: index < 4 ? '19:00' : '18:00',
      skill: 'line-cook',
      headcount: 1,
      status: 'DRAFT',
      assign: ['marco'],
      notes:
        index === 5
          ? 'Sixth straight day, and the shift that tips him into overtime.'
          : undefined,
    });
  });

  const draftWeekStart = nextWeekMondayOffset('America/New_York');
  for (let i = 0; i < 7; i += 1) {
    const d = draftWeekStart + i;
    plans.push(
      {
        location: 'charleston',
        dayOffset: d,
        start: '11:00',
        end: '19:00',
        skill: 'server',
        headcount: 1,
        status: 'DRAFT',
        assign: d % 2 === 0 ? ['jordan'] : ['maya'],
      },
      {
        location: 'columbus',
        dayOffset: d,
        start: '16:00',
        end: '22:00',
        skill: 'server',
        headcount: 1,
        status: 'DRAFT',
        assign: i < 5 ? ['alicia'] : [],
      },
      {
        location: 'portland',
        dayOffset: d,
        start: '17:00',
        end: '23:00',
        skill: 'bartender',
        headcount: 1,
        status: 'DRAFT',
        assign: i + 1 >= 3 && i % 2 === 0 ? ['nina'] : [],
      },
    );
  }

  plans.push(
    {
      location: 'santaMonica',
      dayOffset: draftWeekStart + 1,
      start: '17:00',
      end: '23:00',
      skill: 'bartender',
      headcount: 1,
      status: 'DRAFT',
      assign: [],
      notes: 'Open — Nina is certified here and at Portland.',
    },
    {
      location: 'portland',
      dayOffset: draftWeekStart + 1,
      start: '17:30',
      end: '23:30',
      skill: 'bartender',
      headcount: 1,
      status: 'DRAFT',
      assign: [],
      notes: 'Open — overlaps the Santa Monica slot on the same evening.',
    },
  );

  const createdShifts: {
    plan: ShiftPlan;
    id: string;
    startUtc: Date;
    endUtc: Date;
  }[] = [];

  const availabilityByKey = new Map(
    staffSeeds.map((seed) => [
      seed.key,
      seed.availability.flatMap((window) =>
        window.days.map((dayOfWeek) => ({
          dayOfWeek,
          startTime: window.start,
          endTime: window.end,
          spansMidnight: window.end <= window.start,
          timezone: window.zone ?? null,
          effectiveFrom: new Date(0),
          effectiveTo: null,
        })),
      ),
    ]),
  );
  const skillsByKey = new Map(staffSeeds.map((s) => [s.key, s.skills]));
  const locationsByKey = new Map(staffSeeds.map((s) => [s.key, s.locations]));
  const bookedByKey = new Map<string, { start: Date; end: Date }[]>();
  const skipped: string[] = [];

  function wouldBreakRules(
    key: string,
    plan: ShiftPlan,
    startUtc: Date,
    endUtc: Date,
    timeZone: string,
  ): string | null {
    if (!skillsByKey.get(key)?.includes(plan.skill)) {
      return `lacks the ${plan.skill} skill`;
    }
    if (!locationsByKey.get(key)?.includes(plan.location)) {
      return `is not certified at ${plan.location}`;
    }
    const booked = bookedByKey.get(key) ?? [];
    if (
      booked.some((b) => startUtc < b.end && b.start < endUtc)
    ) {
      return 'is already booked at that time';
    }
    const windows = resolveAvailability(availabilityByKey.get(key) ?? [], [], {
      from: startUtc,
      to: endUtc,
      evaluationZone: timeZone,
    });
    if (!coversInterval(windows, startUtc, endUtc).covered) {
      return 'is outside their stated availability';
    }
    return null;
  }

  for (const plan of plans) {
    const location = locations[plan.location];
    const { startUtc, endUtc } = localShift(
      location.timezone,
      plan.dayOffset,
      plan.start,
      plan.end,
    );
    const shift = await db.shift.create({
      data: {
        locationId: location.id,
        startUtc,
        endUtc,
        requiredSkillId: skills[plan.skill].id,
        headcount: plan.headcount,
        status: plan.status,
        publishedAt: plan.status === 'PUBLISHED' ? new Date(NOW.getTime() - 6 * 86_400_000) : null,
        notes: plan.notes ?? null,
        isPremium: isPremiumShift(startUtc, location.timezone),
        weekKey: weekKey(startUtc, location.timezone),
        createdById:
          plan.location === 'santaMonica' || plan.location === 'portland'
            ? marcus.id
            : priya.id,
      },
      select: { id: true },
    });
    createdShifts.push({ plan, id: shift.id, startUtc, endUtc });

    const accepted = (plan.assign ?? []).filter((key) => {
      if (plan.intentionalViolation) return true;
      const reason = wouldBreakRules(key, plan, startUtc, endUtc, location.timezone);
      if (reason) {
        skipped.push(
          `${staff[key]?.name ?? key} ${reason} — ${plan.location} ${plan.start}-${plan.end} (day ${plan.dayOffset})`,
        );
        return false;
      }
      return true;
    });

    for (const key of accepted) {
      const booked = bookedByKey.get(key) ?? [];
      booked.push({ start: startUtc, end: endUtc });
      bookedByKey.set(key, booked);
    }

    if (accepted.length > 0) {
      await db.assignment.createMany({
        data: accepted.map((key) => ({
          shiftId: shift.id,
          userId: staff[key].id,
          assignedById:
            plan.location === 'santaMonica' || plan.location === 'portland'
              ? marcus.id
              : priya.id,
          status: 'ASSIGNED' as const,
        })),
      });
    }
  }

  const nowShifts = createdShifts.filter(
    (s) =>
      s.startUtc.getTime() <= NOW.getTime() && s.endUtc.getTime() > NOW.getTime(),
  );
  for (const s of nowShifts) {
    await db.assignment.updateMany({
      where: { shiftId: s.id, status: 'ASSIGNED' },
      data: { clockInAt: new Date(s.startUtc.getTime() + 4 * 60_000) },
    });
  }

  const publishedWeeks = new Map<string, { locationId: string; week: string }>();
  for (const s of createdShifts) {
    if (s.plan.status !== 'PUBLISHED') continue;
    const location = locations[s.plan.location];
    const key = weekKey(s.startUtc, location.timezone);
    publishedWeeks.set(`${location.id}:${key}`, {
      locationId: location.id,
      week: key,
    });
  }
  for (const { locationId, week } of publishedWeeks.values()) {
    const count = await db.shift.count({
      where: { locationId, weekKey: week, status: 'PUBLISHED' },
    });
    await db.schedulePublication.create({
      data: {
        locationId,
        weekKey: week,
        publishedById:
          locationId === santaMonica.id || locationId === portland.id
            ? marcus.id
            : priya.id,
        publishedAt: new Date(NOW.getTime() - 6 * 86_400_000),
        shiftCount: count,
      },
    });
  }

  console.log('Creating coverage requests …');

  const tomShift = createdShifts.find(
    (s) =>
      s.plan.location === 'charleston' &&
      s.plan.skill === 'line-cook' &&
      s.plan.dayOffset === 2,
  );
  if (tomShift) {
    const tomAssignment = await db.assignment.findFirst({
      where: { shiftId: tomShift.id, status: 'ASSIGNED' },
      select: { id: true, userId: true },
    });
    if (tomAssignment) {
      const request = await db.coverageRequest.create({
        data: {
          type: 'SWAP',
          status: 'PENDING_MANAGER',
          shiftId: tomShift.id,
          requesterId: tomAssignment.userId,
          requesterAssignmentId: tomAssignment.id,
          targetId: staff.alicia.id,
          note: 'Dentist appointment I could not move.',
          shiftVersionAtRequest: 1,
        },
        select: { id: true },
      });
      await db.auditLog.createMany({
        data: [
          {
            action: 'COVERAGE_REQUESTED',
            actorId: tomAssignment.userId,
            actorLabel: 'Tom Okafor (STAFF)',
            entityType: 'CoverageRequest',
            entityId: request.id,
            locationId: charleston.id,
            summary: 'Tom Okafor asked Alicia Moreau to swap a Charleston line cook shift',
          },
          {
            action: 'COVERAGE_ACCEPTED',
            actorId: staff.alicia.id,
            actorLabel: 'Alicia Moreau (STAFF)',
            entityType: 'CoverageRequest',
            entityId: request.id,
            locationId: charleston.id,
            summary: 'Alicia Moreau accepted the swap — awaiting manager approval',
          },
        ],
      });
      await db.notification.create({
        data: {
          userId: priya.id,
          type: 'SWAP_REQUESTED',
          title: 'Swap needs your approval',
          body: 'Tom Okafor → Alicia Moreau for a Charleston line cook shift.',
          href: '/manage/swaps',
          data: { coverageRequestId: request.id },
        },
      });
    }
  }

  const devonShift = createdShifts.find(
    (s) => s.plan.location === 'santaMonica' && s.plan.assign?.includes('devon'),
  );
  if (devonShift) {
    const devonAssignment = await db.assignment.findFirst({
      where: { shiftId: devonShift.id, userId: staff.devon.id },
      select: { id: true },
    });
    if (devonAssignment && devonShift.startUtc.getTime() - NOW.getTime() > 25 * 3_600_000) {
      await db.coverageRequest.create({
        data: {
          type: 'DROP',
          status: 'OPEN',
          shiftId: devonShift.id,
          requesterId: staff.devon.id,
          requesterAssignmentId: devonAssignment.id,
          note: 'Midterm exam — happy for anyone to take it.',
          expiresAt: new Date(devonShift.startUtc.getTime() - 24 * 3_600_000),
          shiftVersionAtRequest: 1,
        },
      });
    }
  }

  await db.notification.createMany({
    data: [
      {
        userId: staff.jordan.id,
        type: 'SCHEDULE_PUBLISHED',
        title: 'Schedule published',
        body: 'Your Charleston schedule for this week is available.',
        href: '/schedule',
      },
      {
        userId: marcus.id,
        type: 'OVERTIME_WARNING',
        title: 'Projected overtime next week',
        body: 'Marco Ruiz is projected at 52h next week across Santa Monica and Portland.',
        href: '/manage/overtime',
      },
      {
        userId: staff.sarah.id,
        type: 'SCHEDULE_PUBLISHED',
        title: 'Schedule published',
        body: 'Your schedule for this week is available.',
        href: '/schedule',
        readAt: new Date(NOW.getTime() - 3_600_000),
      },
    ],
  });

  const counts = {
    users: await db.user.count(),
    locations: await db.location.count(),
    skills: await db.skill.count(),
    shifts: await db.shift.count(),
    assignments: await db.assignment.count(),
    coverage: await db.coverageRequest.count(),
  };

  if (skipped.length > 0) {
    console.log(
      `\nSkipped ${skipped.length} planned assignment${
        skipped.length === 1 ? '' : 's'
      } that would have broken a rule:`,
    );
    for (const line of skipped) console.log(`  - ${line}`);
  }

  console.log('\nSeed complete:');
  for (const [key, value] of Object.entries(counts)) {
    console.log(`  ${key.padEnd(12)} ${value}`);
  }
  console.log(`\n  Every account uses the password: ${PASSWORD}`);
  console.log(`  Admin    ${admin.email}`);
  console.log(`  Manager  ${marcus.email} (Santa Monica, Portland)`);
  console.log(`  Manager  ${priya.email} (Charleston, Columbus)`);
  console.log(`  Staff    ${staffSeeds.map((s) => s.email).join('\n           ')}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
