# Decisions

The brief leaves five things deliberately unspecified. Here is what I chose,
why, and what it costs.

## 1. De-certifying a staff member from a location

**Soft revoke. History is never rewritten.**

`LocationCertification` carries a `revokedAt` rather than being deleted, so past
assignments stay attributable and keep counting in hours, cost and fairness —
they really happened, and payroll records must not change retroactively. Future
scheduling is blocked immediately.

Existing *future* assignments are **not** auto-cancelled. Silently pulling
someone off next week's roster because an admin updated a record would create
the exact coverage hole this system exists to prevent. The compliance panel
surfaces them instead, so a human decides.

*Seeded:* Wes Tanaka, de-certified from Portland 30 days ago; his history is
intact, he can't be scheduled there again.

## 2. Desired hours vs availability windows

**Orthogonal. Availability is hard; desired hours are advisory.**

Availability answers *can* this person work — violating it is `BLOCK`. Desired
hours answer *how much* they'd like — exceeding it is `WARN`. Conflating them
breaks in both directions: someone available 60h who wants 20 shouldn't be
blocked from covering an emergency, and someone who wants 40h still can't be
scheduled into hours they never offered.

Where desired hours do bite is ranking: the suggestion engine scores people
below their target higher and penalises anyone heading into overtime, so the
fair choice is the default one.

*Cost:* a manager can schedule well past someone's preference with only a
warning. Making it blocking would break emergency coverage, which matters more.

## 3. Does a 1-hour shift count like an 11-hour one for consecutive days?

**Yes. Any non-zero shift marks the day as worked.**

The rule exists for rest and burnout, and a day you travel in, change and show
up is a day you didn't have off. A duration threshold would also be trivially
gamed by splitting shifts.

Two refinements keep it honest: the engine reports the **hours on each day**
alongside the streak, so a manager can see that a "6th consecutive day" is six
one-hour shifts; and streaks are counted by walking **backwards and forwards**,
so inserting a shift that bridges two runs reports the combined length.

Days are attributed in the staff member's **home timezone**, by the shift's
**start** date. An 11pm–3am shift is one working day, not two.

## 4. A shift edited after a swap, but before it happens

**Depends whether the manager has approved yet.**

*Before approval* — auto-cancelled. Every shift carries a `version`; coverage
requests snapshot it, and any edit that bumps it cancels pending requests with a
notification explaining the terms changed. A swap agreed on a 4pm–10pm shift
must not silently become a swap of 4pm–2am.

*After approval* — the swap is done and is **not** unwound. The roster already
reflects it, so a later edit is an ordinary shift edit: whoever is now on it is
notified, it's audited, and the 48-hour cutoff applies. Reverting a completed
swap because a manager moved the shift fifteen minutes would be astonishing and
would leave it unstaffed.

*Cost:* someone who accepted 4pm–10pm could end up on 4pm–11pm. Mitigated by
notification and the edit cutoff.

## 5. A location spanning a timezone boundary

**One canonical IANA zone per location — the operating and payroll zone.
Geography is documented, not modelled.**

`Location.timezone` is authoritative for every computation. Modelling two zones
would mean a shift had no single start time, which is incoherent — a restaurant
opens once. What makes it safe is that **every displayed time carries its zone
abbreviation** ("7:00 PM EDT"), so someone commuting across the line is never
guessing.

*Seeded:* Columbus Riverwalk sits one bridge from Phenix City, Alabama, which is
Central. The restaurant runs on Eastern; a note on the builder explains it.

---

# Decisions the brief didn't raise

**Severity is data, not `if` statements.** `BLOCK` (no override path exists),
`OVERRIDABLE` (documented reason, audited), `WARN`. Mapped straight from the
brief's own wording. There is deliberately **no override for `BLOCK`** — if a
manager truly needs someone at an uncertified location, the certification must
change first, and that change is itself audited.

**Workweek** is Monday–Sunday in the staff member's **home** timezone, so hours
across two locations aggregate into one coherent week. Shifts are grouped for
*publishing* by the location's zone, since that's a location-level operation.

**A shift's hours belong entirely to its start date**, not split across
midnight. Schedulers think of an 11pm–3am shift as Tuesday's; splitting it would
mean a 12-hour overnight never trips the daily ceiling on either day.

**Premium** = Friday or Saturday, starting at or after 17:00 in the location's
zone, evaluated on the start instant so a Friday 11pm shift stays Friday's.

**Fairness score** = `(1 − Gini) × 100` over premium counts. Gini behaves
sensibly for small teams and doesn't collapse when several people have zero —
exactly the case a complaint is about. Per person, a **±25% dead band** around
an even split is treated as noise; with whole shifts and a team of five, exact
parity in one period isn't achievable, and flagging normal variance would train
managers to ignore the report.

**Availability is floating or anchored**, per window. Floating means "9am
wherever I'm working"; anchored means "9am Pacific, even in Charleston". The
system doesn't guess — but only asks the question of people certified across two
zones.

**Draft shifts are invisible to staff.** Nobody should plan around a roster the
manager hasn't committed to.

**Unpublishing respects the cutoff** — shifts already inside it stay published,
which is exactly what the cutoff is for.

**Concurrency: advisory locks, fixed order** (shift, then staffer, so writers
can't deadlock), with the constraint check re-run *inside* the lock.
`SERIALIZABLE` was the alternative; advisory locks fail by waiting, so the loser
gets "Nina is already working 5pm–11pm at Portland" instead of a retryable
serialization error that means nothing to a manager.

**Real-time is SSE over `LISTEN/NOTIFY`.** Vercel functions can't host a
WebSocket server, and Postgres is already shared and always-on. Events are
notifications that something changed, never the change itself — the client
re-fetches, so it can't render a state the database never held.

**Email is simulated, visibly.** Nothing is sent; opted-in messages are written
to `EmailLog` and rendered at `/admin/outbox`, so the path is demonstrable
rather than asserted. In-app notifications can't be switched off — the
notification centre is the record of what happened.
