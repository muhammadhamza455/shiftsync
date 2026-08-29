# Deploying

Target: **Vercel + managed Postgres** (Neon, Supabase or Vercel Postgres — any
plain connection string works).

## 1. Environment

Set these in the Vercel project, Production **and** Preview:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (use the **pooled** one if offered) |
| `DIRECT_DATABASE_URL` | The **unpooled** string. Required whenever `DATABASE_URL` is a pooler — see below |
| `AUTH_SECRET` | `npx auth secret` |
| `AUTH_TRUST_HOST` | `true` |
| `NEXT_PUBLIC_APP_URL` | The deployed URL — optional, only used for links in simulated emails |

### Why both URLs

A transaction pooler (Neon's `-pooler` host, PgBouncer, Supabase port 6543)
multiplexes clients onto shared backends, so it cannot support session-level
`LISTEN` — real-time would connect and then silently never deliver. Migrations
are also happier on a direct connection.

So the pooled URL serves ordinary queries, and `DIRECT_DATABASE_URL` is used by
exactly two things: `prisma migrate deploy`, and the `LISTEN` connection in
`src/lib/realtime/bus.ts`. `NOTIFY` is fine through the pooler — it is
transaction-scoped. On Neon, the direct host is the pooled one with `-pooler`
removed. Unset, it falls back to `DATABASE_URL`, which is correct for a plain
local Postgres.

## 2. Deploy

Import the repo into Vercel. Defaults are correct: build runs
`prisma migrate deploy && next build`, so migrations apply on every deploy;
install runs `prisma generate` via `postinstall`.

Prisma 7 uses a driver adapter rather than a native engine, so there's no binary
target to configure.

## 3. Seed once

Seeding is manual so a deploy can never wipe real data. From a machine with the
production `DATABASE_URL`:

```bash
DATABASE_URL="postgres://…" npx tsx prisma/seed.ts
```

> The seed **deletes all rows** first. It's a demo fixture, not a migration.

## Real-time on serverless

SSE over Postgres `LISTEN/NOTIFY`, because a Vercel function can't host a socket
server. Two consequences:

- **Streams are capped by function duration.** `/api/events` sets
  `maxDuration = 300`; Hobby is lower. `EventSource` reconnects on its own and
  every event has a durable counterpart, so a dropped stream costs one refresh,
  not correctness.
- **Each instance holds one `LISTEN` connection** while a client is streaming,
  released when the last disconnects. Watch connection limits on a small
  managed Postgres.

## Health check

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://your-app.vercel.app/login    # 200
curl -s -o /dev/null -w "%{http_code}\n" https://your-app.vercel.app/dashboard # 307
```

Sign in as `dana.reyes@coastaleats.com` / `Coastal2026!` and confirm the header
shows **Live** — that means SSE connected and `LISTEN/NOTIFY` works end to end.

## Containers instead

A `Dockerfile` and `docker-compose.yml` are included and tested — the full E2E
suite passes against the containerised app.

```bash
docker compose --profile app up -d --build
docker compose run --rm migrate npx tsx prisma/seed.ts
```

Four stages: `deps` → `builder` → `runner`, plus `migrator` for the one-shot
`migrate` service. The serving image is Next.js standalone output (~300 MB,
non-root, `node server.js` as PID 1 so `docker stop` is clean). The Prisma CLI
and tsx live only in the migrator.

Standalone output is gated behind `DOCKER_BUILD=1` in `next.config.ts` — Vercel
does its own tracing and prefers the default output.

For Railway, Render or Fly, point them at the `Dockerfile` and set
`DATABASE_URL` and `AUTH_SECRET`. SSE streams are then not capped by a function
timeout.

Two gotchas if you adapt the compose file:

- Postgres 18 images store data in a major-version subdirectory, so the volume
  mounts at `/var/lib/postgresql`, **not** the pre-18 `/var/lib/postgresql/data`.
  The image refuses to start on the old path.
- Inside the compose network the database is `db:5432`. The `5433` in `.env` is
  the port published to the host.
