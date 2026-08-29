# syntax=docker/dockerfile:1

# ShiftSync container image.
#
# Four stages:
#   deps     — node_modules, cached independently of source changes
#   builder  — the Next.js production build (standalone output)
#   migrator — full toolchain, used by the one-shot `migrate` compose service
#   runner   — the shipped image: minimal server, non-root, no build tooling
#
# Prisma 7 talks to Postgres through a driver adapter rather than a native
# query engine, so there is no binary target to match and nothing
# platform-specific to copy between stages.

ARG NODE_VERSION=24-alpine

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# prisma.config.ts resolves DATABASE_URL eagerly, and the postinstall hook
# runs `prisma generate`. Generation never opens a connection — it only reads
# the schema — but the variable still has to resolve, so a placeholder is
# supplied here. The real URL arrives at runtime from the environment.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

COPY package.json package-lock.json ./
# Copied before install because the postinstall hook needs the schema.
COPY prisma ./prisma
COPY prisma.config.ts ./

RUN npm ci

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS builder
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1
ENV DOCKER_BUILD=1
# Same placeholder rationale as the deps stage: next build never connects.
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
COPY . .

# `build:local` rather than `build`: the latter runs `prisma migrate deploy`,
# which would require a reachable database at image-build time. Migrations are
# applied at deploy time by the migrator stage instead.
RUN npm run build:local

# ---------------------------------------------------------------------------
# Full toolchain for schema migrations and seeding. Run as a one-shot service,
# not as the long-lived app: shipping the Prisma CLI and tsx in the serving
# image would roughly double it for code that runs twice a year.
FROM node:${NODE_VERSION} AS migrator
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/src/generated ./src/generated
# tsconfig.json comes along because the seed imports through the `@/` alias;
# without it tsx cannot resolve the generated Prisma client.
COPY package.json prisma.config.ts tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Overridden by `docker compose run migrate npx tsx prisma/seed.ts` to load
# the demo dataset.
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image already ships a `node` user (uid 1000).
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# The standalone server does not bundle static assets — they are copied in
# explicitly so the container serves correctly without a CDN in front.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

# No shell form: this way the server is PID 1 and receives SIGTERM directly,
# so `docker stop` is a clean shutdown rather than a ten-second timeout.
CMD ["node", "server.js"]
