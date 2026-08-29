# ShiftSync

Multi-location staff scheduling for Coastal Eats — four restaurants, two
timezones. Built for the Priority Soft full-stack assessment.

**Live:** <https://shiftsync-two-sigma.vercel.app>

## Requirements

Node 20.9+ and a PostgreSQL 18 database. Docker is optional — there are three
ways to get the database, below.

## Run it

**Everything in Docker:**

```bash
docker compose --profile app up -d --build
docker compose run --rm migrate npx tsx prisma/seed.ts
```

**Postgres in Docker, Node on the host** — better if you want to edit code:

```bash
npm install
docker compose up -d db
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

**No Docker at all** — `npm run db:start` brings up a portable PostgreSQL 18
on port 5433 with no admin rights required. Run it instead of
`docker compose up -d db`, then continue from `npm run db:migrate`.

Open <http://localhost:3000>.

## Environment

`cp .env.example .env` is enough for local development. The only value worth
changing is `AUTH_SECRET`, which you can generate with `npx auth secret`.
`.env.example` documents the rest, including when a second, unpooled database
URL is needed.

## Commands

```bash
npm run dev        # development server
npm run build      # applies migrations, then builds
npm start          # serve the production build

npm test           # 86 unit + integration tests
npm run test:e2e   # 24 Playwright tests (re-seeds, builds, runs production)
npm run verify     # prints the evaluation-scenario numbers from the database

npm run typecheck  # next typegen && tsc --noEmit
npm run lint       # oxlint

npm run db:start   # portable Postgres, no Docker needed
npm run db:migrate # apply migrations
npm run db:seed    # reset and re-seed the demo data
npm run db:studio  # browse the database
```

`npm test` needs a local database — the concurrency suite races real
transactions, so it assumes millisecond latency. Pointed at a remote database
it times out rather than failing an assertion.

## Logging in

Every seeded account uses the password `Coastal2026!`. The login page lists
them all and fills the form when you click one.

## Documentation

- `docs/ShiftSync-Brief-Documentation.docx` — logins per role, known
  limitations, assumptions
- `docs/ShiftSync-Intentional-Ambiguities.docx` — the five deliberately
  unspecified questions and what I decided
