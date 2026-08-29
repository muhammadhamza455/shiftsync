import 'dotenv/config';
import { db } from '../src/lib/db';
import {
  coverageGaps,
  fairnessReport,
  onDutyNow,
  overtimeReport,
} from '../src/lib/services/analytics';
import { complianceIssues } from '../src/lib/queries/schedule';
import { weekKey } from '../src/lib/time/zones';

const DAY = 86_400_000;

function heading(text: string) {
  console.log(`\n${text}\n${'─'.repeat(text.length)}`);
}

async function main() {
  const locations = await db.location.findMany({
    select: { id: true, name: true, slug: true, timezone: true },
    orderBy: { name: 'asc' },
  });
  const bySlug = Object.fromEntries(locations.map((l) => [l.slug, l]));
  const pacific = [bySlug['santa-monica'].id, bySlug['portland-pearl'].id];
  const eastern = [
    bySlug['charleston-battery'].id,
    bySlug['columbus-riverwalk'].id,
  ];
  const all = locations.map((l) => l.id);
  const now = new Date();

  heading('1. Sunday Night Chaos — coverage gaps in the next 48 hours');
  const gaps = await coverageGaps(all, now, new Date(now.getTime() + 2 * DAY));
  if (gaps.length === 0) {
    console.log('  (none — everything is covered)');
  }
  for (const gap of gaps) {
    console.log(
      `  ${gap.locationName}\n    ${gap.label} · ${gap.skill} · ${gap.filled}/${gap.headcount} filled`,
    );
  }

  heading('2. The Overtime Trap — next week, Pacific locations');
  const nextWeek = weekKey(new Date(now.getTime() + 7 * DAY), 'America/Los_Angeles');
  const overtime = await overtimeReport(pacific, nextWeek);
  for (const row of overtime.rows.slice(0, 5)) {
    console.log(
      `  ${row.name.padEnd(14)} ${String(row.totalHours).padStart(5)}h   OT ${String(
        row.overtimeHours,
      ).padStart(5)}h   $${row.totalCost}  [${row.status}]`,
    );
    const tipping = row.assignments.find((a) => a.tipsIntoOvertime);
    if (tipping) {
      console.log(`      crosses 40h on: ${tipping.label} @ ${tipping.locationName}`);
    }
  }
  console.log(
    `  TOTAL ${overtime.totals.totalHours}h · ${overtime.totals.overtimeHours}h overtime · $${overtime.totals.totalCost}`,
  );

  heading('3. The Timezone Tangle — staff certified in two zones');
  const crossZone = await db.user.findMany({
    where: { role: 'STAFF' },
    select: {
      name: true,
      certifications: {
        where: { revokedAt: null },
        select: { location: { select: { name: true, timezone: true } } },
      },
      availabilityRules: {
        take: 1,
        select: { startTime: true, endTime: true, timezone: true },
      },
    },
  });
  for (const person of crossZone) {
    const zones = [
      ...new Set(person.certifications.map((c) => c.location.timezone)),
    ];
    if (zones.length < 2) continue;
    const rule = person.availabilityRules[0];
    console.log(
      `  ${person.name.padEnd(14)} ${zones.join(' + ')}\n      states ${rule?.startTime}-${rule?.endTime} ${
        rule?.timezone ? `anchored to ${rule.timezone}` : 'local to the location worked'
      }`,
    );
  }

  heading('5. The Fairness Complaint — Eastern locations, last 3 weeks');
  const fairness = await fairnessReport(
    eastern,
    new Date(now.getTime() - 21 * DAY),
    new Date(now.getTime() + 7 * DAY),
  );
  console.log(
    `  score ${fairness.fairnessScore}/100 over ${fairness.totalPremiumShifts} premium shifts`,
  );
  for (const row of fairness.rows) {
    console.log(
      `  ${row.name.padEnd(14)} premium ${String(row.premiumShiftCount).padStart(
        2,
      )}  vs ${String(row.expectedPremium).padStart(4)} expected  [${row.standing}]`,
    );
  }

  heading('6. The Regret Swap — coverage requests in flight');
  const requests = await db.coverageRequest.findMany({
    where: { status: { in: ['OPEN', 'PENDING_MANAGER'] } },
    select: {
      type: true,
      status: true,
      requester: { select: { name: true } },
      target: { select: { name: true } },
    },
  });
  if (requests.length === 0) console.log('  (none)');
  for (const r of requests) {
    console.log(
      `  ${r.type.padEnd(5)} ${r.requester.name} → ${r.target?.name ?? 'anyone'} [${r.status}]`,
    );
  }

  heading('On duty right now');
  const duty = await onDutyNow(all, now);
  if (duty.length === 0) console.log('  (nobody clocked in)');
  for (const row of duty) {
    console.log(`  ${row.userName.padEnd(14)} ${row.locationName}  [${row.state}]`);
  }

  heading('Rule violations on existing assignments (expect exactly one pair)');
  let total = 0;
  for (const week of [-1, 0, 1]) {
    const when = new Date(now.getTime() + week * 7 * DAY);
    for (const location of locations) {
      const key = weekKey(when, location.timezone);
      const issues = await complianceIssues(location.id, key);
      total += issues.length;
      for (const issue of issues) {
        console.log(
          `  [${issue.violation.severity}] ${issue.userName} — ${issue.violation.title}\n      ${location.name}, ${key}`,
        );
      }
    }
  }
  console.log(
    total === 2
      ? '\n  As designed: the seeded 9-hour turnaround, and nothing else.'
      : `\n  ${total} violations found — expected 2 (one pair). Investigate.`,
  );

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
