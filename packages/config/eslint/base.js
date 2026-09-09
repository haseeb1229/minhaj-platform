/**
 * Shared ESLint base configuration (flat config, ESLint 10).
 *
 * Composes: JS recommended → typescript-eslint strict + stylistic →
 * repository-wide safety rules. Architecture rules live in `./boundaries.js`
 * and `./rtl.js` and are composed by the root `eslint.config.js`.
 */

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Paths never linted: genuine build output and dependencies.
 *
 * ANCHORED, NOT NAME-MATCHED — Review #8 (B8-1)
 * ---------------------------------------------
 * This list previously carried `'**\/dist/**'`, `'**\/build/**'` and
 * `'**\/coverage/**'`. Those patterns match a directory with that name
 * ANYWHERE, at any depth, so authored production source was silently exempt
 * from linting for the sole reason that a parent directory had a particular
 * name. Review #8's reproduction:
 *
 *     apps/app/src/dist/bad.tsx
 *     export const physicalDirectionStyle = { borderLeftWidth: 1 };
 *
 * Real `tsc` compiles it and the architecture gate includes it, but ESLint
 * answered "File ignored because of a matching ignore pattern" and the RTL
 * scanner skipped the directory too — so an RTL violation shipped with no
 * diagnostic from any gate.
 *
 * ESLint flat config takes static globs, so it cannot call the shared
 * `generated-roots` policy the analyser and the RTL scanner use. It can however
 * apply the same PRINCIPLE: only positively identified generated output is
 * ignored, named at the path the tooling actually writes it to rather than by
 * basename at arbitrary depth.
 *
 * Every workspace's build output is anchored below. No workspace currently
 * configures a TypeScript `outDir`/`declarationDir` at all, so the old
 * wildcards were exempting authored code while protecting nothing. A workspace
 * that later configures one adds its real path here, beside the others.
 */
export const ignores = [
  // Dependencies, at any depth: npm may install a nested `node_modules`, and
  // none of it is ever this repository's source.
  '**/node_modules/**',

  // Next build output, anchored to the one Next application that writes it.
  'apps/web/.next/**',

  // Coverage output, anchored to where the test runner is configured to write
  // it rather than to the name `coverage` at arbitrary depth.
  'coverage/**',

  // Compiler incremental state, never source in any location.
  '**/*.tsbuildinfo',

  // The one Next-generated declaration, at the application root that Next
  // writes it to. A `next-env.d.ts` planted anywhere else is authored code and
  // is linted — the same identity-over-basename rule the architecture gate
  // applies to it (Review #4).
  'apps/web/next-env.d.ts',
];

/**
 * Rules that apply everywhere and encode SECURITY_BASELINE.md expectations
 * that lint can genuinely check.
 */
export const safetyRules = {
  // SECURITY_BASELINE.md §9.2 — no unsanitised arbitrary HTML.
  'no-restricted-properties': [
    'error',
    {
      property: 'dangerouslySetInnerHTML',
      message:
        'dangerouslySetInnerHTML is prohibited except for server-sanitised ' +
        'rich text, and every use is reviewed (SECURITY_BASELINE.md §9.2).',
    },
  ],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-script-url': 'error',
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-console': ['error', { allow: ['warn', 'error'] }],
  'no-var': 'error',
  'prefer-const': 'error',
};

/** TypeScript rules holding the strict baseline of §10. */
export const typescriptRules = {
  // Widespread `any` is prohibited.
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'off',
  '@typescript-eslint/consistent-type-imports': [
    'error',
    { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
  ],
  '@typescript-eslint/no-unused-vars': [
    'error',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
    },
  ],
  // Suppression comments must carry a justification; a bare one is an error.
  '@typescript-eslint/ban-ts-comment': [
    'error',
    {
      'ts-ignore': true,
      'ts-nocheck': true,
      'ts-expect-error': 'allow-with-description',
      minimumDescriptionLength: 20,
    },
  ],
};

/** The composed base config array. */
export const baseConfig = [
  { name: 'minhaj/ignores', ignores },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    name: 'minhaj/base',
    rules: { ...safetyRules, ...typescriptRules },
  },
];

export default baseConfig;
