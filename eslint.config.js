/**
 * Root ESLint flat configuration.
 *
 * Composes the shared base with the architecture rules:
 *   - bounded-context dependency allowlist (DOMAIN_MODEL.md §3.1, §3.2)
 *   - `packages/server-core` server-only client boundary (ARCHITECTURE.md §3.1)
 *   - `apps/realtime` database prohibition (ARCHITECTURE.md §6.3 rule 8)
 *   - RTL-safe Tailwind conventions (TECH_STACK.md §5)
 *
 * ARCHITECTURE.md §6.3 rule 12: architecture rules take no exceptions. Nothing
 * below downgrades an architecture rule to a warning or carves out a path.
 */

import { baseConfig } from './packages/config/eslint/base.js';
import {
  clientBoundaryConfigs,
  contextBoundaryConfigs,
  realtimeBoundaryConfig,
} from './packages/config/eslint/boundaries.js';
import { rtlConfig } from './packages/config/eslint/rtl.js';

const APP_ROOT = 'apps/web/src';

export default [
  ...baseConfig,

  {
    name: 'minhaj/language-options',
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        // Node globals. Declared explicitly rather than pulled from a globals
        // package, since this is the whole set the repository uses.
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        fetch: 'readonly',
      },
    },
  },

  // ---------------------------------------------------------------------
  // Architecture enforcement
  // ---------------------------------------------------------------------
  //
  // Inline ESLint configuration is DISABLED across production source.
  // Independent review demonstrated that an inline disable directive permitted
  // an otherwise illegal context dependency, which is precisely the exception
  // ARCHITECTURE.md §6.3 rule 12 says must not exist: "A rule needing an
  // exception is a wrong rule or a wrong design."
  //
  // `noInlineConfig` also reports any attempt, so a disable comment is itself
  // a lint error rather than silently ignored — the reviewer sees the attempt.
  //
  // This is defence in depth. The AUTHORITATIVE architecture gate is
  // `scripts/check-architecture.mjs`, a separate process that no ESLint
  // directive can reach at all.
  {
    name: 'minhaj/no-inline-config-in-production-source',
    files: [
      `${APP_ROOT}/**/*.{ts,tsx}`,
      'apps/realtime/**/*.{ts,tsx}',
      'packages/*/src/**/*.{ts,tsx}',
    ],
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: 'error',
    },
  },

  ...contextBoundaryConfigs({ appRoot: APP_ROOT }),
  ...clientBoundaryConfigs({ appRoot: APP_ROOT }),
  realtimeBoundaryConfig,
  rtlConfig({ appRoot: APP_ROOT }),

  // ---------------------------------------------------------------------
  // Per-area adjustments
  // ---------------------------------------------------------------------
  {
    name: 'minhaj/config-package',
    files: ['packages/config/**/*.js'],
    rules: {
      // Shared configuration is plain JavaScript, not typed source.
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },

  {
    name: 'minhaj/scripts',
    files: ['scripts/**/*.{js,mjs,ts}'],
    rules: {
      // A command-line tool reports through stdout; that IS its interface.
      // The rule exists to keep stray logging out of the application, and
      // these files are not the application.
      'no-console': 'off',
    },
  },

  {
    name: 'minhaj/tests',
    files: ['**/*.test.ts', '**/*.test.tsx', 'tests/**/*.{ts,tsx}'],
    rules: {
      // Assertions legitimately reach into shapes a production module would not.
      '@typescript-eslint/no-non-null-assertion': 'off',

      // A test asserting that a dangerous URL is REJECTED must be able to name
      // one. The string is test data handed to a validator, never navigated to.
      'no-script-url': 'off',
    },
  },

  {
    // Architecture FIXTURES are deliberately invalid source. They exist so the
    // boundary rules can be proven to reject what they claim to reject, and are
    // linted only by the tests that assert those rejections — never by the
    // repository lint run, which must stay clean.
    name: 'minhaj/fixtures-excluded',
    ignores: ['tests/fixtures/**'],
  },
];
