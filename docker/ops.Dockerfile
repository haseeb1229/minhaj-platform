# =============================================================================
# The staging OPERATIONS image — Phase 28
# =============================================================================
#
# Node 24.20.0 LTS, the locked runtime (TECH_STACK.md 3), the same exact image
# `web.Dockerfile` and `realtime.Dockerfile` use.
#
# WHAT THIS IS. A tool image an operator runs on purpose, one command at a
# time, and that exits: `docker run --rm ... minhaj-ops <script>`, where the
# script is one of the database lifecycle commands under
# `packages/database/scripts/` (migrate, provision, inspect, back up). It is
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

FROM node:24.20.0-bookworm-slim AS ops

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
# the synthetic fixture's bytes. Nothing imports server-core or search, so
# neither is here. The packages ship TypeScript, run by Node's type stripping.
COPY packages/database/prisma.config.ts ./packages/database/
COPY packages/database/prisma ./packages/database/prisma
COPY packages/database/sql ./packages/database/sql
COPY packages/database/src ./packages/database/src
COPY packages/database/scripts ./packages/database/scripts
COPY packages/contracts/src ./packages/contracts/src
COPY packages/storage/src ./packages/storage/src

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
# nothing inside the container.
USER node

ENTRYPOINT ["node", "--conditions=react-server"]
