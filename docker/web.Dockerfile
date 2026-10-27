# =============================================================================
# apps/web — multi-stage image
# =============================================================================
#
# Node 24.22.1 LTS, the locked runtime (TECH_STACK.md 3). Pinned exactly so the
# container matches the production target regardless of the workstation.
#
# FIVE STAGES, and the separation is the point (Review #3, N5):
#
#   deps    — dependency install only, so a source edit does not reinstall
#   test    — the FULL repository including tests and their inputs
#   dev     — the local development runtime, without the test suite
#   build   — the production `next build`, for ONE origin (Phase 28)
#   runtime — the production server: production dependencies, the build
#             output and the start wrapper, run as the unprivileged `node` user
#
# Previously one stage copied `tests/` into the running image while
# `.env.example` was left out of the context, so three tests failed inside the
# image and the runtime carried fixtures it never used. Both halves of that are
# wrong in the same way: the image and the checks disagreed about what an image
# is for.
#
# Now the test suite runs in a stage BUILT FOR IT, with every input it needs,
# and the runtime stage carries application source only. `--target test`
# selects the former; the default build produces the latter.
#
# Phase 0B provides a local development runtime. Phase 25 adds the realtime
# process (`realtime.Dockerfile`) and the NGINX WebSocket seam (`nginx/`).
# Phase 28, the deployment phase ARCHITECTURE.md 10.1 deferred this to, adds
# the production `runtime` stage that staging serves. Nothing here deploys
# anything: the image is built, and an operator decides where it runs.
#
# THE RUNTIME IMAGE IS ORIGIN-SPECIFIC. Prerendered pages embed the canonical
# origin and `next.config.ts` binds the indexing posture into the bundle, so
# both are fixed when the artifact is built, not when it starts. Each origin
# gets its own build: `--target runtime --build-arg AUTH_BASE_URL=<origin>`
# (and `PUBLIC_INDEXING_ENABLED`, which defaults to `false`). Serving one
# origin's image under another would render the wrong canonical addresses.
#
# No secrets are present here or in compose, and NO SECRET IS EVER A BUILD
# ARG: build arguments are recorded in the image history, so only the two
# non-secret, build-bound values above are accepted that way. Every secret
# arrives as an environment variable at run time and is validated at startup
# with Zod before a port is bound.
#
# Host contamination: the repository root is the build context, and the host is
# Windows while this image is Linux. `.dockerignore` excludes node_modules,
# build output and any real .env so a `COPY` cannot overwrite the Linux install
# with Windows binaries. That exclusion is load-bearing, not cosmetic.
# =============================================================================

# -----------------------------------------------------------------------------
# deps — install from the committed lockfile
# -----------------------------------------------------------------------------
FROM node:24.22.1-bookworm-slim AS deps

ENV NODE_ENV=development

WORKDIR /app

# Manifests first, so a source edit does not invalidate the dependency layer.
# The workspace manifests are all that `npm ci` needs to resolve the tree.
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

# -----------------------------------------------------------------------------
# test — the verification stage: complete inputs, never shipped
# -----------------------------------------------------------------------------
#
# Built with `docker build --target test`. It carries the test suite, the
# fixtures, and — critically — `.env.example`, which `tests/config/
# env-example.test.ts` reads to assert the file stays valueless
# (SECURITY_BASELINE.md 18.1). Omitting it previously produced three failures
# that said nothing about the code.
#
# `.env.example` is tracked, non-secret and deliberately valueless. A real
# `.env` is excluded by `.dockerignore` and never enters any layer.
FROM deps AS test

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts
COPY tests ./tests
# The tool CONFIGURATION the suite runs under, ignore files included.
#
# `.prettierignore` is load-bearing, not decoration: two fixtures are
# DELIBERATELY malformed (a broken package.json and a broken tsconfig) so the
# analyser can be proven to report them rather than skip them silently. Without
# the ignore file, Prettier tries to parse those fixtures and `format:check`
# fails inside the image for a packaging reason — which is the same class of
# defect Review #3 reported about `.env.example`.
COPY eslint.config.js prettier.config.js vitest.config.ts playwright.config.ts ./
COPY .prettierignore ./
# `npm run typecheck` ends with the migration tooling's own project (Phase 30).
COPY tsconfig.tooling.json ./

# Inputs the SUITE reads. Copied ONLY into this stage: the runtime has no use
# for any of them and should not carry them.
#
#   .env.example    — `tests/config/env-example.test.ts` asserts it stays
#                     valueless (SECURITY_BASELINE.md 18.1). This is the exact
#                     file Review #3 found missing.
#   .dockerignore   — `tests/config/docker-packaging.test.ts` asserts a real
#                     .env and any certificate can never enter a layer.
#   docker/         — the same suite reads this Dockerfile and compose.yaml to
#                     assert the test/runtime stage separation holds.
#
# A packaging test that cannot read the packaging is the very defect this
# section exists to correct, one level up.
COPY .env.example .dockerignore ./
COPY docker ./docker

# The Phase 2 architecture gate verifies that the permission catalogue still
# matches the frozen security baseline. Carry that single non-secret document
# in the test image only; the runtime stage remains documentation-free.
COPY docs/SECURITY_BASELINE.md ./docs/SECURITY_BASELINE.md

# `tests/config/ci-credentials.test.ts` reads the workflow to assert the CI
# contract: Prisma generation ordering, dotenv-safe credentials, and the
# compose fail-closed guard. It is an input to the suite exactly as
# `.dockerignore` and `docker/` above are, so the TEST stage carries it and
# the runtime stage below does not.
COPY .github/workflows/ci.yml ./.github/workflows/ci.yml
# Phase 28: `tests/config/staging-foundation.test.ts` reads the deploy workflow.
COPY .github/workflows/staging-deploy.yml ./.github/workflows/staging-deploy.yml

# Prisma's generated client is intentionally build output in node_modules, not
# committed source. Generate it only after the schema enters this stage.
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

# `npm run verify` ends in `npm run build`, which is a PRODUCTION build.
#
# The `deps` stage sets NODE_ENV=development so `npm ci` installs devDependencies
# — the suite, the linters and the compiler all live there. Leaving that value in
# place through `next build` makes Next prerender against React's development
# build and the export fails. Setting it here means this stage installs like a
# development environment and BUILDS like production, which is what a
# verification stage is: both, in that order.
ENV NODE_ENV=production

# The default command verifies; it does not serve. Run the whole gate with
# `docker build --target test -t minhaj-web-test . && docker run --rm
# minhaj-web-test`.
CMD ["npm", "run", "verify"]

# -----------------------------------------------------------------------------
# dev — the local development runtime
# -----------------------------------------------------------------------------
#
# Application and package source only. No `tests/`, no fixtures, no
# `.env.example`. A runtime image should contain what it runs and nothing else:
# fixtures in a running image are dead weight at best and a source of confusion
# about what the image is at worst.
FROM deps AS dev

COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

# The dev image also needs the generated client at runtime. No database URL is
# needed to generate from this provider-only schema.
RUN npx prisma generate --schema packages/database/prisma/schema.prisma

EXPOSE 3000

# Bind to every interface so the port is reachable from the host.
# The start wrapper validates the environment BEFORE any listener is created,
# so a container with bad configuration exits non-zero instead of coming up and
# serving 500s — which would pass an orchestrator's port health check
# (SECURITY_BASELINE.md 18.1).
CMD ["npm", "run", "dev", "--workspace", "@minhaj/web", "--", "--dev", "--hostname", "0.0.0.0"]

# -----------------------------------------------------------------------------
# build — the production `next build`, for exactly one origin (Phase 28)
# -----------------------------------------------------------------------------
#
# Built only as an input to `runtime`; never run. It inherits `deps` because
# `next build` needs the compiler, Tailwind and the Prisma CLI, all of which
# are devDependencies the runtime must not carry.
FROM deps AS build

# The two BUILD-BOUND values, and nothing else. Both are non-secret: one is a
# public origin and the other a public launch posture. `next.config.ts`
# validates them with the same schema the server uses and substitutes the
# indexing boolean into every server chunk, and prerendering writes the
# origin into the generated pages — so an image is correct for one origin and
# changing either value means rebuilding, as DELIVERY_PLAN.md Phase 35 says.
#
# `AUTH_BASE_URL` has NO default. The schema would quietly fall back to
# `http://localhost:3000`, and a production artifact whose canonical links
# point at localhost passes every check that does not read a page. Refusing
# an empty value here is what makes the origin a decision rather than an
# accident. `PUBLIC_INDEXING_ENABLED` defaults to the fail-closed `false`.
ARG AUTH_BASE_URL
ARG PUBLIC_INDEXING_ENABLED=false
RUN if [ -z "$AUTH_BASE_URL" ]; then \
      echo 'AUTH_BASE_URL is required: build with --build-arg AUTH_BASE_URL=<the public origin>.' >&2; \
      exit 1; \
    fi

# Application and package source only: the build reads `apps/web` and the
# workspace packages it imports, and nothing under the repository's own
# `scripts/` (those are the gates `npm run verify` runs, not build inputs).
COPY apps ./apps
COPY packages ./packages

RUN npx prisma generate --schema packages/database/prisma/schema.prisma

# The same reason as the test stage: `deps` installs with NODE_ENV=development
# so devDependencies arrive, and prerendering under that value fails against
# React's development build. CI's `Production build` step needs no secret and
# sets nothing else, so neither does this.
#
# Next.js usage telemetry is off: a deployment build reports nothing about
# this project to a third party.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The type check inside `next build` needs more than 2 GB of heap, and Node
# sizes its default heap from the memory the BUILDER happens to have: a 16 GB
# CI runner passes, an 8 GB Docker Desktop VM dies with "heap out of memory"
# at "Running TypeScript". A fixed ceiling, scoped to this one command, makes
# the build behave the same on both. It reserves nothing.
#
# The build cache is a build-machine accelerator; shipping it would put
# hundreds of megabytes of compiler state in every runtime layer.
RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build --workspace @minhaj/web \
 && rm -rf apps/web/.next/cache

# -----------------------------------------------------------------------------
# runtime — the production server, and nothing else
# -----------------------------------------------------------------------------
FROM node:24.22.1-bookworm-slim AS runtime

# Production: the server schema rejects every development default, so a
# container missing a real secret exits instead of signing with a sentinel.
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# The origin this image was BUILT for, recorded on the artifact itself so a
# deployment can refuse to run it anywhere else (`docker/staging/bin/deploy.sh`
# compares it with the host). Public, non-secret, and the same value `build`
# was given.
ARG AUTH_BASE_URL
LABEL org.minhaj.public-origin=$AUTH_BASE_URL

# The SAME `/app` layout as `build`, and that is load-bearing: Turbopack
# records a few externals (the Prisma client, Pino, PostCSS) as ABSOLUTE
# symlinks under `.next/node_modules` pointing into `/app/node_modules`. A
# different working directory would leave them dangling and fail the first
# request that touched the database or the logger, not the start.
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

# Production dependencies only: no compiler, no linter, no test runner, no
# Prisma CLI. The generated client is build output and is taken from `build`.
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# What `next start` and the start wrapper load, and nothing more:
#
#   next.config.ts — Next loads it again at start (headers, env binding), and
#                    it imports `@minhaj/contracts` source for the shared
#                    schema and the media provider origins
#   start.mjs and validate-env.mjs — the fail-fast wrapper and its validator,
#                    which imports `@minhaj/contracts/env/server`
#   packages/contracts/src — the one workspace package either of those reads
#                    at run time; every other package is compiled into the
#                    server chunks by the build and is not needed as source
#
# Deliberately absent: application source, the other packages' source, the
# database lifecycle CLIs, SQL, migrations, the test suite, docs, CI metadata
# and every environment file. Migrations are an operator action run from the
# operations image (`ops.Dockerfile`), never something this server can do.
COPY packages/contracts/src ./packages/contracts/src
COPY apps/web/next.config.ts ./apps/web/
COPY apps/web/scripts/start.mjs apps/web/scripts/validate-env.mjs ./apps/web/scripts/

# The build output, owned by the runtime user because it is the one tree Next
# writes to while serving (its incremental cache lives beneath it). Everything
# else stays root-owned and read-only to the process.
COPY --from=build --chown=node:node /app/apps/web/.next ./apps/web/.next

USER node

EXPOSE 3000

# `/robots.txt` is prerendered, reads no database and is answered by the Next
# server itself, so a 200 proves the process is up and serving rather than
# merely holding a port. There is deliberately no bespoke health route.
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/robots.txt`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

# Directly under Node, not through npm, so SIGTERM reaches the wrapper that
# forwards it to Next and lets in-flight requests drain. Not invoked as npm's
# `dev` and given no `--dev`, the wrapper validates the environment and then
# runs `next start`; an invalid environment exits non-zero with no listener.
CMD ["node", "apps/web/scripts/start.mjs"]
