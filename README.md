# ShiftSync

Multi-location staff scheduling for **Coastal Eats** — four restaurants, two
timezones. Built for the Priority Soft full-stack assessment.

The hard part isn't drawing a calendar. It's that a schedule can be wrong in a
dozen ways at once, several invisible from any single screen, and two managers
can make it wrong at the same instant. Most of the work is in the constraint
engine, the concurrency handling, and the quality of the explanation when
something is refused.

## Run it

**Everything in Docker:**

```bash
docker compose --profile app up -d --build
docker compose run --rm migrate npx tsx prisma/seed.ts
```

**Or Postgres in Docker, Node on the host** (better for editing):

```bash
npm install
docker compose up -d db
cp .env.example .env
npm run db:migrate && npm run db:seed
npm run dev
```

Open <http://localhost:3000>. No Docker? `npm run db:start` runs a portable
PostgreSQL 18 with no admin rights, then follow from `npm run db:migrate`.

```bash
npm test           # 86 unit + integration
npm run test:e2e   # 24 Playwright (re-seeds, builds, runs production)
npm run verify     # scenario numbers straight from the database
npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # oxlint
```

## Logging in

Every seeded account uses **`Coastal2026!`**. The login page lists them all and
fills the form on click.

| Role | Email | Scope |
| --- | --- | --- |
| Admin | `dana.reyes@coastaleats.com` | All locations, audit export, email outbox |
| Manager | `marcus.hale@coastaleats.com` | Santa Monica + Portland (Pacific) |
| Manager | `priya.nadkarni@coastaleats.com` | Charleston + Columbus (Eastern) |
| Staff | `sarah.chen@coastaleats.com` | Bartender, certified in **both** timezones |
| Staff | `marco.ruiz@coastaleats.com` | Line cook — the overtime case |
| Staff | `jordan.blake@coastaleats.com` | Server — the fairness case |

Eleven more staff accounts exist; all are on the login page.

## The evaluation scenarios

`npm run verify` prints the numbers behind all of these from the database.

**1. Sunday Night Chaos.** Sign in as Priya → dashboard opens on *Coverage
gaps*. Click a gap → shift drawer → **Suggest** → ranked candidates, each with
a reason and their week before/after. Pick one, see the impact panel, assign.
About four clicks. Anyone the engine would refuse is excluded, not offered.

**2. The Overtime Trap.** Marcus → **Overtime** → next week. Marco Ruiz sits at
52h / 12h overtime across *two* locations, so no single roster reveals it. The
report names the exact shift that crosses 40h. The same maths runs in the
builder *before* you assign.

**3. The Timezone Tangle.** Sarah Chen → **My availability**. Certified in
Pacific and Eastern, so each window carries a timezone choice: *local to the
location* (Sarah) or *anchored to a zone* (Elena Vasquez). Assigning Elena to a
9am Charleston shift is blocked, naming the uncovered hours in Charleston time.

**4. Simultaneous Assignment.** `npx vitest run tests/concurrency.test.ts`
fires two assignments at the same instant. Exactly one wins; the loser gets
`DOUBLE_BOOKING` naming the other location, a live conflict toast, and
alternatives. One row in the database.

**5. The Fairness Complaint.** Priya → **Fairness**. Jordan Blake: 0 premium
shifts against ~2 expected, marked under-served, with the full ledger of who
worked every Friday/Saturday evening.

**6. The Regret Swap.** Tom → **My requests** → **Withdraw**. Nothing needs
repairing because nothing moved: the original assignment stands until a manager
approves. Alicia and Priya are both notified.

**Bonus — the compliance panel.** Marcus → **Build schedule** → back one week.
Marco has a 9-hour turnaround against a 10-hour minimum. It's the only rule
breach in the seed, and it's deliberate: every other seeded assignment is
validated against the real availability resolver before it's written.

## How it's built

Next.js 16 · React 19 · TypeScript 7 · Tailwind 4 · PostgreSQL 18 · Prisma 7
(driver adapter) · Auth.js v5 · Zod 4 · Temporal · Vitest · Playwright · oxlint

```
src/lib/time/zones.ts              Temporal: ISO weeks, DST, premium tagging
src/lib/scheduling/rules.ts        rule catalogue — severity as data
src/lib/scheduling/availability.ts recurring rules + exceptions → UTC intervals
src/lib/scheduling/constraints.ts  the engine: pure, no Prisma, no await
src/lib/services/                  transactions, locking, notifications, audit
src/lib/queries/                   read models, formatted server-side
src/app/(app)/                     role-aware pages
```

The engine takes everything it needs as arguments. That's what lets one code
path serve three callers that must never disagree — the real mutation, the
what-if preview, and the suggestion ranker — and why most tests need no database.

**Enforcement.** Not certified · missing skill · outside availability ·
double-booked · under 10h rest · over 12h/day · shift full · past edit cutoff →
**blocked**, no override. 7th consecutive day → **documented override**.
8h+/day, 6th day, 35h+, 40h+, over desired hours → **warning**. Every violation
carries what broke, a message naming people and numbers, why the rule exists,
and what to do instead.

**Concurrency.** Assignment writes take Postgres advisory locks in a fixed
order (shift, then staffer — so writers can't deadlock) and re-check
constraints *inside* the lock against fresh data. `@@unique([shiftId, userId])`
is the backstop. Advisory locks rather than `SERIALIZABLE` because they fail by
waiting, so the loser gets an explainable conflict instead of a retryable
serialization error.

**Real-time.** SSE over Postgres `LISTEN/NOTIFY`, not Socket.IO — a Vercel
function can't host a socket server, and Postgres is already shared and
always-on. Events say *something changed*; the client re-fetches rather than
patching from a payload, so it can't render a state the database never held.

## Tests

```
86 unit + integration          npm test
├── constraints    33  every rule, thresholds, boundaries, ranking
├── availability   20  floating vs anchored zones, DST, exceptions, overnight
├── time           23  ISO weeks, DST transitions, premium tagging, overnight
├── concurrency     6  real Postgres: races, headcount, rest, audit atomicity
└── notifications   4  real Postgres: overtime warnings, per-shift history

24 end-to-end                  npm run test:e2e
├── every scenario, role scoping, audit export, and a cross-session real-time
│   check: one browser publishes, a second receives it without navigating
└── responsive: no sideways scroll, reachable nav, at 375/768/1280px
```

DST is tested against real transitions: an overnight window across
spring-forward is **7** elapsed hours, across fall-back **9**, and an ISO week
containing one is **167** or **169** hours.

Two bugs the concurrency suite caught before they shipped:
`pg_advisory_xact_lock` returns `void`, which `$queryRaw` can't deserialize —
every assignment would have failed at runtime; and `effectiveFrom` defaulting
to `now()` meant seeded availability didn't apply to historical shifts.

## Known limitations

1. **No pagination.** Audit shows the most recent 60, exports up to 10,000.
2. **Drop expiry is swept on page load**, not by a scheduler — the deploy target
   has no cron. Read paths also filter on `expiresAt`, so an unswept row is
   never wrong, only untidy.
3. **Suggestions evaluate up to 60 candidates per request.** Correct but linear.
4. **The what-if preview is advisory.** The authoritative check re-runs inside
   the write transaction, so it can only be *more* permissive than the save.
5. **Editing a shift doesn't re-validate its existing assignees** — the
   compliance panel catches it instead of blocking at the point of edit.
6. **Skills, certifications and staff records are read-only.** The seed sets
   them and the Team page shows them, but there's no admin CRUD, so a message
   saying "certify Sarah at Santa Monica" describes a database step. The audit
   actions exist; nothing writes them yet.
7. **Below 320px** things crowd. Not a target.
8. **Linting is oxlint, not ESLint** — `typescript-eslint` doesn't support the
   TypeScript 7 compiler API, so `eslint-config-next` crashes on load. To go
   back, pin `typescript` to 5.9 and reinstall ESLint.

## Assumptions

- One password for all seeded accounts, listed on the login page: a review
  affordance, not production behaviour.
- Overtime is a flat 1.5× past 40h/week. Real multi-state payroll (California's
  daily overtime, seventh-day rules) would need per-location rules.
- "Premium" is Friday/Saturday from 5pm; real venues would configure this.
- Managers are assigned to locations by an admin; there's no self-service UI.

The five deliberate ambiguities are answered in
**[docs/DECISIONS.md](docs/DECISIONS.md)**. Deployment is in
**[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)**.
