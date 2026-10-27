# =============================================================================
# The staging OPERATIONS image — Phase 28
# =============================================================================
#
# Node 24.22.1 LTS, the locked runtime (TECH_STACK.md 3), the same exact image
# `web.Dockerfile` and `realtime.Dockerfile` use.
#
# WHAT THIS IS. A tool image an operator runs on purpose, one command at a
# time, and that exits: `docker run --rm ... minhaj-ops <script>`, where the
# script is one of the database lifecycle commands under
# `packages/database/scripts/` (migrate, provision, inspect, back up, the
# migration proof) or a migration command under `scripts/migration/`. It is
# never a long-running service and has no default command — the entrypoint is
# Node under the `react-server` condition, and the operator names the script.
#
# WHY A SEPARATE IMAGE. The web and realtime runtimes must stay free of
# migration tooling: the Prisma CLI, the SQL scripts and the migration history
# give whoever controls a process the ability to change the schema, and a
# serving process has no business holding that ability. Applying migrations is
# an explicit operator action (ARCHITECTURE.md 10.3), never a side effect of a
# container starting, so nothing here — and nothing in either runtime — runs a
# migration on its own.
#
# THE DEPLOY BUNDLE. The staging compose file, its operator scripts, the NGINX
# staging template and the SQL Server image recipe are carried under
# `/opt/minhaj-staging`, so the host extracts them from THIS exact-commit image
# rather than from a separately copied checkout that could drift from it.
#
# NO SECRETS. Nothing here is a credential; `.dockerignore` excludes every
# environment file at any depth and none is copied. Connection strings and
# passwords arrive as environment variables when the operator runs a command,
# and each script proves its target before it mutates anything.
# =============================================================================

FROM node:24.22.1-bookworm-slim AS ops

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

# The FULL install, scoped to this one command: the Prisma CLI (`migrate
# deploy`, `generate`) is a devDependency of `packages/database`, and it is
# the point of this image.
RUN NODE_ENV=development npm ci && npm cache clean --force

# Every command then runs with the production posture, so anything that
# validates the server environment refuses the development defaults exactly
# as the deployed processes do.
ENV NODE_ENV=production

# The database package whole — adapters, lifecycle scripts, the reviewed SQL,
# the schema with its migration history, and the Prisma config — plus the
# workspace package SOURCE it and its operator scripts import: contracts
# everywhere, and storage for the staging seed and restore proof, which write
# the synthetic fixture's bytes. Nothing imports search, so it is not here. The
# packages ship TypeScript, run by Node's type stripping.
COPY packages/database/prisma.config.ts ./packages/database/
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/sql ./packages/database/sql
COPY packages/database/src ./packages/database/src
COPY packages/database/scripts ./packages/database/scripts
COPY packages/contracts/src ./packages/contracts/src
COPY packages/storage/src ./packages/storage/src

# Phase 29 — the migration tooling (the fixture runner, the promotion command
# and the proof `staging-migration-proof` starts as a child process as the
# runtime principal) and EXACTLY the node-runnable composition graph it loads:
# the tooling's own Layer-4 root with the wiring and the publication targets
# (Phase 30: Media, Library and Editorial, behind one fail-closed router) it
# shares with the web process, the seven bounded contexts that graph composes
# through their public interfaces, and the server-core authorisation service
# that answers it. No page, route, component or other web source.
COPY packages/server-core/src ./packages/server-core/src
COPY apps/web/src/composition/migration-runner.ts \
     apps/web/src/composition/migration-wiring.ts \
     apps/web/src/composition/migration-targets.ts \
     apps/web/src/composition/migration-target-router.ts \
     apps/web/src/composition/migration-target-support.ts \
     apps/web/src/composition/migration-library-targets.ts \
     apps/web/src/composition/migration-editorial-targets.ts \
     ./apps/web/src/composition/
COPY apps/web/src/contexts/migration-provenance ./apps/web/src/contexts/migration-provenance
COPY apps/web/src/contexts/media ./apps/web/src/contexts/media
COPY apps/web/src/contexts/library ./apps/web/src/contexts/library
COPY apps/web/src/contexts/editorial ./apps/web/src/contexts/editorial
COPY apps/web/src/contexts/people-contributors ./apps/web/src/contexts/people-contributors
COPY apps/web/src/contexts/personalisation-notifications ./apps/web/src/contexts/personalisation-notifications
COPY apps/web/src/contexts/taxonomy ./apps/web/src/contexts/taxonomy
COPY scripts/migration ./scripts/migration

# Generated from the schema alone; no database URL is read.
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

# The deploy bundle, root-owned and read-only to the operator user. Named
# piece by piece, so a file added beside them is not shipped by accident.
COPY docker/staging/compose.yaml /opt/minhaj-staging/compose.yaml
COPY docker/staging/bin /opt/minhaj-staging/bin
COPY docker/staging/systemd /opt/minhaj-staging/systemd
COPY docker/nginx/staging /opt/minhaj-staging/nginx
COPY docker/sqlserver/Dockerfile /opt/minhaj-staging/sqlserver/Dockerfile

# Unprivileged. The commands talk to SQL Server over the network and write
# nothing inside the container beyond the migration proof's own temporary
# bundle directories, which it removes before it exits.
USER node

ENTRYPOINT ["node", "--conditions=react-server"]
