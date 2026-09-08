import { defineConfig } from 'vitest/config';

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
  },

  // The same conditions for Vitest's SSR transform pipeline, which resolves
  // separately from the client-side `resolve` block above.
  ssr: {
    resolve: {
      conditions: ['react-server', 'node', 'import', 'module', 'default'],
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
        inline: ['server-only'],
      },
    },

    // Fixtures are deliberately invalid source linted by the tests, never run.
    passWithNoTests: false,

    // Linting fixtures through the ESLint API is slower than a unit assertion.
    testTimeout: 30_000,

    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**/*.ts'],
    },
  },
});
