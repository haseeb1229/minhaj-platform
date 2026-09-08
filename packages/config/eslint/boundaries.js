/**
 * Mechanical enforcement of the bounded-context allowlist and the server-only
 * boundary of `packages/server-core`.
 *
 * Implemented with ESLint core `no-restricted-imports` only — no third-party
 * boundary framework (ARCHITECTURE.md §6.4). Violations are errors, so lint and
 * therefore the build fail.
 *
 * ARCHITECTURE.md §6.3 rule 12: architecture rules take NO exceptions. Nothing
 * here emits a warning or a bypass.
 */

import {
  contextAllowlist,
  contextRoot,
  contextSlugs,
  contextPublicEntry,
} from './contexts.js';

/**
 * Every path shape that resolves to one bounded context's public interface.
 * A cross-context import may name a context, and nothing below it.
 */
function publicEntryPatterns(slug) {
  return [`@/${contextRoot}/${slug}`, `@/${contextRoot}/${slug}/${contextPublicEntry}`];
}

/** Every path shape reaching inside a context, at any depth. */
function internalPatterns(slug) {
  return [`@/${contextRoot}/${slug}/*`, `@/${contextRoot}/${slug}/*/**`];
}

/**
 * Build the restriction set applied to files inside `contexts/<slug>/`.
 *
 * Denies, for every OTHER context:
 *   - its public interface, unless the allowlist names it;
 *   - its internals, ALWAYS — even for an allowlisted edge
 *     (ARCHITECTURE.md §6.3 rule 4, interface-only cross-context imports).
 *
 * Because the deny list is built from the full context roster rather than from
 * a wildcard, an unlisted context is denied by construction: there is no
 * pattern that permits "any sibling", so no cycle-friendly wildcard exists.
 */
function restrictionsForContext(slug) {
  const permitted = contextAllowlist[slug] ?? [];
  const patterns = [];

  for (const other of contextSlugs) {
    if (other === slug) continue;

    if (!permitted.includes(other)) {
      patterns.push({
        group: [...publicEntryPatterns(other), ...internalPatterns(other)],
        message:
          `Architecture: '${slug}' may not depend on '${other}'. ` +
          `The allowlist (DOMAIN_MODEL.md §3.1) permits only: ` +
          `${permitted.length > 0 ? permitted.join(', ') : 'Layer 0 only'}. ` +
          `An edge that is not listed does not exist. Adding one is an ` +
          `architecture decision, not a lint exception.`,
      });
      continue;
    }

    // Allowlisted edge: the public interface is reachable, internals are not.
    patterns.push({
      group: internalPatterns(other),
      message:
        `Architecture: '${slug}' may depend on '${other}', but only through ` +
        `its public interface '@/${contextRoot}/${other}'. Reaching into ` +
        `'${other}' internals is prohibited (ARCHITECTURE.md §6.3 rule 4).`,
    });
  }

  // A context never reaches its own siblings through a relative escape either.
  patterns.push({
    group: ['../*/**', '../../**'],
    message:
      `Architecture: '${slug}' must not escape its own directory with a ` +
      `relative import. Reference another context by its '@/${contextRoot}/…' ` +
      `public interface, which the allowlist governs.`,
  });

  // Infrastructure is consumed through abstractions (DOMAIN_MODEL.md §2 rule 7).
  patterns.push({
    group: ['@prisma/*', '@prisma/client', 'prisma'],
    message:
      `Architecture: no context imports Prisma directly. Data access is ` +
      `confined to 'packages/database' and reached through an interface ` +
      `(ARCHITECTURE.md §4.1).`,
  });

  return patterns;
}

/** Flat-config overrides, one per bounded context. */
export function contextBoundaryConfigs({ appRoot = 'apps/web/src' } = {}) {
  return contextSlugs.map((slug) => ({
    name: `minhaj/boundaries/${slug}`,
    files: [`${appRoot}/${contextRoot}/${slug}/**/*.{ts,tsx}`],
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictionsForContext(slug) }],
    },
  }));
}

/**
 * `packages/server-core` must never enter a client bundle
 * (ARCHITECTURE.md §3.1, §6.3 rule 9).
 *
 * Lint is the first of two gates. The second is the `server-only` package
 * imported by `server-core` itself, which makes a client-side import a BUILD
 * error even if a file were to evade lint.
 */
export const serverOnlyImportPatterns = [
  {
    group: ['@minhaj/server-core', '@minhaj/server-core/**'],
    message:
      `Architecture: 'packages/server-core' is server-only and must never be ` +
      `imported into a client bundle (ARCHITECTURE.md §3.1). Move the call ` +
      `into a Server Component, Server Action or Route Handler.`,
  },
];

/**
 * Applied to any module that can end up in a client bundle: a file carrying the
 * 'use client' directive, and anything under a client-only directory.
 */
export function clientBoundaryConfigs({ appRoot = 'apps/web/src' } = {}) {
  return [
    {
      name: 'minhaj/boundaries/server-core-not-in-client',
      files: [`${appRoot}/**/*.client.{ts,tsx}`, `${appRoot}/**/client/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': ['error', { patterns: serverOnlyImportPatterns }],
      },
    },
  ];
}

/**
 * `apps/realtime` never imports `packages/database`, Prisma, or any table
 * access (ARCHITECTURE.md §3.1 rule 1, §6.3 rule 8). The app does not exist
 * until the Messaging phase; the rule is configured now so it is in force the
 * day the directory appears.
 */
export const realtimeBoundaryConfig = {
  name: 'minhaj/boundaries/realtime-no-database',
  files: ['apps/realtime/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: ['@minhaj/database', '@minhaj/database/**', '@prisma/*', 'prisma'],
            message:
              `Architecture: 'apps/realtime' never accesses the database. It ` +
              `calls context-owned services hosted in '@minhaj/server-core' ` +
              `(ARCHITECTURE.md §3.1 rule 1).`,
          },
        ],
      },
    ],
  },
};
