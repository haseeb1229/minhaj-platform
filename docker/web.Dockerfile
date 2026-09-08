# =============================================================================
# apps/web — multi-stage image
# =============================================================================
#
# Node 24.20.0 LTS, the locked runtime (TECH_STACK.md 3). Pinned exactly so the
# container matches the production target regardless of the workstation.
#
# THREE STAGES, and the separation is the point (Review #3, N5):
#
#   deps  — dependency install only, so a source edit does not reinstall
#   test  — the FULL repository including tests and their inputs
#   dev   — the local development runtime, without the test suite
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
# Phase 0B provides a local development runtime. The production multi-stage
# build, the NGINX reverse proxy and the realtime process belong to the
# deployment phase (ARCHITECTURE.md 10.1). Nothing here deploys anything.
#
# No secrets are present here or in compose. Configuration arrives as
# environment variables at run time and is validated at startup with Zod.
#
# Host contamination: the repository root is the build context, and the host is
# Windows while this image is Linux. `.dockerignore` excludes node_modules,
# build output and any real .env so a `COPY` cannot overwrite the Linux install
# with Windows binaries. That exclusion is load-bearing, not cosmetic.
# =============================================================================

# -----------------------------------------------------------------------------
# deps — install from the committed lockfile
# -----------------------------------------------------------------------------
FROM node:24.20.0-bookworm-slim AS deps

ENV NODE_ENV=development

WORKDIR /app

# Manifests first, so a source edit does not invalidate the dependency layer.
# The workspace manifests are all that `npm ci` needs to resolve the tree.
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/config/package.json ./packages/config/
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/database/package.json ./packages/database/
COPY packages/server-core/package.json ./packages/server-core/

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
COPY eslint.config.js prettier.config.js vitest.config.ts ./
COPY .prettierignore ./

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
