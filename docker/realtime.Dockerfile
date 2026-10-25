# =============================================================================
# The realtime process — Phase 25
# =============================================================================
#
# Node 24.22.1 LTS, the locked runtime (TECH_STACK.md 3), the same exact image
# `web.Dockerfile` uses.
#
# WHAT RUNS. `apps/web/src/composition/realtime-main.ts` under the
# `react-server` condition: the realtime process's own Layer-4 composition
# root, which wires Identity's and Messaging's ports to their context-owned
# adapters and hands the Socket.IO transport (`apps/realtime`) two narrow
# services. The transport itself never reaches the database package; the
# composition root does, exactly as the web process's does.
#
# TWO STAGES:
#
#   build   — the full dependency install, which carries the Prisma CLI, and
#             the generated Prisma client
#   runtime — production dependencies only, the generated client, and ONLY the
#             source the process loads, run as the unprivileged `node` user
#
# WHAT IS DELIBERATELY ABSENT. No tests, no fixtures, no `.env` (excluded at
# any depth by `.dockerignore`, and never copied), no backups, no browser, no
# database lifecycle CLIs (`packages/database/scripts`, `sql/`, migrations), no
# web application source beyond the four composition modules this process
# imports, and no build output. Configuration arrives as environment variables
# at run time and is validated before a port is bound.
# =============================================================================

# -----------------------------------------------------------------------------
# build — install from the committed lockfile and generate the Prisma client
# -----------------------------------------------------------------------------
FROM node:24.22.1-bookworm-slim AS build

ENV NODE_ENV=development

WORKDIR /app

# EVERY workspace manifest, so `npm ci` resolves the same tree the lockfile
# describes. A missing manifest is a workspace npm cannot reconcile.
COPY package.json package-lock.json ./
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/search/package.json ./packages/search/
COPY packages/server-core/package.json ./packages/server-core/
COPY packages/storage/package.json ./packages/storage/

RUN npm ci

# The schema is the only input generation needs; no database URL is read.
COPY packages/database/prisma/schema.prisma ./packages/database/prisma/schema.prisma
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

# -----------------------------------------------------------------------------
# runtime — what the realtime process loads, and nothing else
# -----------------------------------------------------------------------------
FROM node:24.22.1-bookworm-slim AS runtime

# Production: the server schema rejects every development default, so a
# container missing a real secret exits instead of signing with a sentinel.
ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/realtime/package.json ./apps/realtime/
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/search/package.json ./packages/search/
COPY packages/server-core/package.json ./packages/server-core/
COPY packages/storage/package.json ./packages/storage/

# Production dependencies only: no compiler, no linter, no test runner, no
# Prisma CLI. The generated client is build output and is taken from `build`.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# The package SOURCE the process loads (the packages ship TypeScript, run by
# Node's type stripping), the transport, and the composition root's modules.
COPY packages/contracts/src ./packages/contracts/src
COPY packages/server-core/src ./packages/server-core/src
COPY packages/database/src ./packages/database/src
COPY apps/realtime/src ./apps/realtime/src
COPY apps/web/src/composition/realtime-main.ts \
     apps/web/src/composition/realtime.ts \
     apps/web/src/composition/identity-mechanics.ts \
     apps/web/src/composition/messaging-wiring.ts \
     ./apps/web/src/composition/

# Unprivileged. Nothing here writes to the filesystem: presence and typing
# live in memory, and durable state is SQL Server's.
USER node

# Inside a container the process listens on every interface of ITS network
# namespace; only the proxy is published to the host.
ENV REALTIME_HOST=0.0.0.0
ENV REALTIME_PORT=3200
EXPOSE 3200

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.REALTIME_PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Directly under Node, not through npm, so SIGTERM reaches the process that
# owns the shutdown (bounded grace for in-flight sends, then exit).
CMD ["node", "--conditions=react-server", "apps/web/src/composition/realtime-main.ts"]
