/**
 * Mechanical enforcement of the bounded-context allowlist and the server-only
 * boundary of `packages/server-core`.
 *
 * Implemented with ESLint core `no-restricted-imports` plus one local resolved-
 * path rule — no third-party boundary framework (ARCHITECTURE.md §6.4).
 * Violations are errors, so lint and therefore the build fail.
 *
 * ARCHITECTURE.md §6.3 rule 12: architecture rules take NO exceptions. Nothing
 * here emits a warning or a bypass.
 */

import path from 'node:path';

import {
  contextAllowlist,
  contextRoot,
  contextSlugs,
  contextPublicEntry,
} from './contexts.js';

/**
 * Every path shape that resolves to one bounded context's public interface.
 *
 * BOTH forms are legal and BOTH resolve to the same file. `@/contexts/x` is the
 * canonical spelling; `@/contexts/x/index` is the explicit one TypeScript
 * resolves identically, and the architecture analyser — which resolves rather
 * than matches strings — has always accepted it (`isPublicEntry`). ESLint must
 * agree, or the two gates encode two different architectures and the local one
 * rejects code the authoritative one permits.
 */
function publicEntryPatterns(slug) {
  return [`@/${contextRoot}/${slug}`, `@/${contextRoot}/${slug}/${contextPublicEntry}`];
}

/**
 * Every path shape reaching inside a context, at any depth — EXCEPT its public
 * entry point.
 *
 * `no-restricted-imports` matches `group` patterns with gitignore semantics, so
 * a trailing negation genuinely re-includes. Without it `@/contexts/x/*`
 * swallowed `@/contexts/x/index`, and the legal explicit public entry of an
 * ALLOWLISTED context was reported as an internals breach (§6.3 rule 4 is about
 * `contexts/library/internal/...`, never about the interface file itself).
 *
 * The negation is only correct here because `contextPublicEntry` IS the public
 * interface. It re-includes exactly one name and nothing else: `service`,
 * `internal/...` and every other subpath stay restricted.
 */
function internalPatterns(slug) {
  return [
    `@/${contextRoot}/${slug}/*`,
    `@/${contextRoot}/${slug}/*/**`,
    `!@/${contextRoot}/${slug}/${contextPublicEntry}`,
  ];
}

/**
 * Relative path shapes that ESCAPE this context into ANOTHER named context.
 *
 * The previous rule restricted two glob shapes wholesale — one parent level
 * followed by anything, and two parent levels followed by anything — on the
 * reasoning that "a context never escapes its own directory with a relative
 * import". It was wrong in the one direction a boundary rule must never be
 * wrong: it rejected legal code. A module at
 * `contexts/messaging/internal/store/index.ts` importing `../../shared/ids` is
 * an OWN-CONTEXT import, entirely inside `messaging`, and it matched `../../**`.
 * Nesting a context's own modules was therefore a lint error, and the pressure
 * that creates is to flatten the architecture or to disable the rule — the
 * second of which §6.3 rule 12 forbids outright.
 *
 * The replacement names what is actually prohibited rather than approximating
 * it by depth: a relative climb that lands in ANOTHER bounded context, at any
 * depth, in any spelling. `../quran/x`, `../../quran/x` and
 * `../../../contexts/quran/x` all match; `../shared/ids` and `../../shared/ids`
 * do not, because they are not another context.
 *
 * The resolved-graph analyser remains authoritative — it resolves specifiers
 * rather than matching their spelling, so it sees an escape however it is
 * written, and it is the gate that cannot be silenced by a comment.
 */
const relativeContextPlugin = {
  rules: {
    'no-relative-context-escape': {
      meta: {
        type: 'problem',
        schema: [
          {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              permitted: { type: 'array', items: { type: 'string' } },
            },
            required: ['slug', 'permitted'],
            additionalProperties: false,
          },
        ],
      },
      create(eslintContext) {
        const [{ slug, permitted }] = eslintContext.options;
        const permittedSet = new Set(permitted);
        const filename = path.resolve(eslintContext.filename);

        const check = (node) => {
          const specifier = node.source?.value;
          if (typeof specifier !== 'string' || !specifier.startsWith('.')) return;

          const target = path.resolve(path.dirname(filename), specifier);
          const normalised = target.split(path.sep).join('/');
          const marker = `/${contextRoot}/`;
          const markerIndex = normalised.lastIndexOf(marker);
          if (markerIndex === -1) return;

          const [targetSlug, ...inside] = normalised
            .slice(markerIndex + marker.length)
            .split('/');

          // This is the crucial distinction globs cannot make. A directory
          // named like another context but physically nested under this one
          // still resolves to THIS context and is an ordinary internal import.
          if (targetSlug === slug || !contextSlugs.includes(targetSlug)) return;

          const withinContext = inside.join('/');
          const isPublic =
            withinContext === '' ||
            ['', '.ts', '.tsx', '.d.ts'].some(
              (extension) => withinContext === `${contextPublicEntry}${extension}`,
            );

          if (permittedSet.has(targetSlug) && isPublic) return;

          eslintContext.report({
            node: node.source,
            message: permittedSet.has(targetSlug)
              ? `Architecture: '${slug}' may depend on '${targetSlug}', but only through its public interface. Reaching into '${targetSlug}' internals is prohibited (ARCHITECTURE.md §6.3 rule 4).`
              : `Architecture: '${slug}' may not depend on '${targetSlug}'. The allowlist (DOMAIN_MODEL.md §3.1) permits only: ${permitted.length > 0 ? permitted.join(', ') : 'Layer 0 only'}.`,
          });
        };

        return {
          ImportDeclaration: check,
          ExportNamedDeclaration: check,
          ExportAllDeclaration: check,
        };
      },
    },
  },
};

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
    plugins: { 'minhaj-boundaries': relativeContextPlugin },
    rules: {
      'no-restricted-imports': ['error', { patterns: restrictionsForContext(slug) }],
      'minhaj-boundaries/no-relative-context-escape': [
        'error',
        { slug, permitted: contextAllowlist[slug] ?? [] },
      ],
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
    group: ['@minhaj/database', '@minhaj/database/**'],
    message:
      `Architecture: 'packages/database' is server-only and must never be ` +
      `imported into a client bundle (ARCHITECTURE.md section 4.1).`,
  },
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
