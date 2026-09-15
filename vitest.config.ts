import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

/**
 * `@opentelemetry/semantic-conventions` 1.43.0 publishes a `module` field
 * pointing at `build/esm/index.js`, and that file imports a DIRECTORY
 * (`./trace`). Directory imports are not resolvable ES modules, so whichever
 * resolver honours `module` fails to load it — which is every ESM-aware
 * bundler, including Vite.
 *
 * Its `exports["."].default` is a working CommonJS build of the same thing, so
 * the package is resolved to that build explicitly. This is a RESOLUTION
 * choice, not a substitution: the same package at the same version, reached by
 * the entry point its own manifest already names as the default.
 *
 * It arrives transitively through `@better-auth/core`'s instrumentation. The
 * application build is unaffected — Next bundles server dependencies with its
 * own resolver — so this belongs to the test runner's configuration and
 * nowhere else.
 */
const openTelemetrySemanticConventions =
  require.resolve('@opentelemetry/semantic-conventions');

/**
 * Vitest configuration — Phase 0B.
 *
 * Covers configuration, architecture-boundary and environment-validation tests.
 * No browser environment and no E2E tooling: Playwright and its browsers are
 * installed in the phase that first genuinely needs them (TECH_STACK.md §1.3).
 */
export default defineConfig({
  // Tests exercise SERVER code, so resolve the server export conditions.
  //
  // `react-server` is what makes `server-only` resolve to its empty module
  // rather than its throwing one — the same condition Next.js applies to the
  // Server Component graph. Without it the marker fires against the test
  // runner itself: the boundary working correctly, merely aimed at the wrong
  // consumer. The client-side proof is the real Next build in
  // `npm run check:server-only`, not this runner.
  resolve: {
    conditions: ['react-server', 'node', 'import', 'module', 'default'],
    alias: [
      {
        find: /^@opentelemetry\/semantic-conventions$/,
        replacement: openTelemetrySemanticConventions,
      },
      {
        // The web app's own `@/*` path alias, declared in its `tsconfig.json`.
        //
        // Next resolves it during a build and `tsc` resolves it during a
        // typecheck; the test runner has no reason to know about it unless it
        // is told. Without this a suite can only reach app modules that happen
        // to use no alias, which is a poor reason to leave a security rule
        // untested — and a worse reason to relax the rule's own imports.
        find: /^@\/(.*)$/,
        replacement: `${fileURLToPath(new URL('./apps/web/src/', import.meta.url))}$1`,
      },
    ],
  },

  // The same conditions for Vitest's SSR transform pipeline, which resolves
  // separately from the client-side `resolve` block above.
  ssr: {
    resolve: {
      // `module` is deliberately absent here. Vite's SSR resolver honours it,
      // and honouring it is what selects the unloadable ESM build of
      // `@opentelemetry/semantic-conventions` (see the note above). Dropping
      // it leaves the standard `exports` conditions, which reach that
      // package's working default build and change nothing for any other
      // dependency — `node` and `import` already select the right entry
      // everywhere else in this tree.
      conditions: ['react-server', 'node', 'import', 'default'],
    },
  },

  test: {
    environment: 'node',

    // Loads the ignored `docker/.env` so the live database tests run under
    // `npm test` instead of silently skipping. Vitest does not apply Node's
    // `--env-file-if-exists`, which the `db:*` commands rely on.
    setupFiles: ['tests/database/load-database-env.ts'],
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**'],

    server: {
      deps: {
        // `server-only` must be processed by Vite rather than externalised to
        // Node's resolver, so the `react-server` condition above applies and
        // it resolves to its empty module.
        //
        // `better-auth` is inlined for a different reason. Its instrumentation
        // reaches `@opentelemetry/semantic-conventions`, which publishes ESM
        // that imports a DIRECTORY (`.../build/esm/trace`). Node's native ESM
        // resolver rejects directory imports outright, so an externalised
        // `better-auth` fails to load under the test runner. Vite's resolver
        // handles it, and inlining changes only who resolves the module —
        // not which module is loaded. The application build is unaffected:
        // Next bundles server dependencies with its own resolver.
        inline: ['server-only', 'better-auth', /^@better-auth\//],
      },
    },

    // Fixtures are deliberately invalid source linted by the tests, never run.
    passWithNoTests: false,

    // Linting fixtures through the ESLint API is slower than a unit assertion,
    // and the architecture tests additionally spawn the REAL `tsc` over fixture
    // projects — tens of seconds of CPU each, several at a time.
    //
    // Raised from 30s in Phase 1 Chunk 3. The architecture tests pass in
    // isolation and under `--maxWorkers=1` but intermittently exceeded 30s once
    // the live database suites were added alongside them: enough parallel work
    // to starve a `tsc` child, on a runner with fewer cores than a workstation.
    // That is a timeout measuring machine load, not a defect it can detect, and
    // a gate that fails on scheduling teaches everyone to re-run it until green.
    //
    // Nothing is skipped or relaxed by this — every assertion still runs and
    // still has to pass.
    testTimeout: 120_000,

    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
