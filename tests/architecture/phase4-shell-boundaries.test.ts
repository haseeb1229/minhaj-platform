import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * PHASE 4 — the boundaries the public shell must hold.
 *
 * THE CENTRAL ONE IS THE CACHE BOUNDARY. "The anonymous public render tree must
 * never read session-derived state" (ARCHITECTURE.md §8.1,
 * SECURITY_BASELINE.md §17) is not a property a page can be spot-checked for:
 * one `await session()` three components deep, added a year from now to put a
 * name in the header, turns one cached document into somebody else's. So the
 * proof is over the whole reachable import graph rather than over the files a
 * reviewer thought to open, and a new public route inherits it automatically.
 *
 * These are SOURCE proofs. The rendered-output half — that a request carrying a
 * session cookie and one carrying none produce identical public HTML — lives in
 * the browser suite, because that is the only place it can honestly be made.
 */

const APP_SRC = path.join(repoRoot, 'apps', 'web', 'src');
const PUBLIC_GROUP = path.join(APP_SRC, 'app', '[locale]', '(public)');

/* ===========================================================================
 * A small module-graph walker
 * ========================================================================= */

/** Every file beneath a directory. */
async function filesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];

  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(child);
      else found.push(child);
    }
  }

  await visit(directory);
  return found;
}

/**
 * Static and dynamic import specifiers in a source file.
 *
 * COMMENTS ARE STRIPPED FIRST. These files discuss the modules they must not
 * import — that prose is the most useful documentation in them — and matching
 * raw text would report every explanation as an import.
 *
 * `from '…'` covers static imports, type imports and re-exports in whatever
 * shape a multi-line import clause takes; the other three cover a side-effect
 * import, a dynamic one, and `require`.
 */
function specifiersIn(source: string): string[] {
  const body = code(source);
  const found: string[] = [];

  for (const pattern of [
    /\bfrom\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of body.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) found.push(specifier);
    }
  }

  return found;
}

/** Resolves an in-app specifier to a file, or `null` for anything external. */
async function resolveInApp(from: string, specifier: string): Promise<string | null> {
  const base = specifier.startsWith('@/')
    ? path.join(APP_SRC, specifier.slice('@/'.length))
    : specifier === '@minhaj/contracts/env/prerender'
      ? path.join(repoRoot, 'packages', 'contracts', 'src', 'env', 'prerender.ts')
      : specifier.startsWith('.')
        ? path.resolve(path.dirname(from), specifier)
        : null;

  if (base === null) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not this candidate. A specifier that resolves to nothing at all is
      // reported by the typecheck, which runs before this suite in `verify`.
    }
  }

  return null;
}

interface Graph {
  /** Every in-app module reachable from the entry points. */
  readonly modules: Map<string, string>;
  /** Every external package specifier any reachable module imports. */
  readonly packages: Set<string>;
}

/** Walks the reachable graph from a set of entry files. */
async function reachableFrom(entries: readonly string[]): Promise<Graph> {
  const modules = new Map<string, string>();
  const packages = new Set<string>();
  const queue = [...entries];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined || modules.has(current)) continue;

    const source = await readFile(current, 'utf8');
    modules.set(current, source);

    for (const specifier of specifiersIn(source)) {
      const resolved = await resolveInApp(current, specifier);

      if (resolved === null) packages.add(specifier);
      else if (!modules.has(resolved)) queue.push(resolved);
    }
  }

  return { modules, packages };
}

/** Repo-relative, forward-slashed, for readable assertion messages. */
function relative(file: string): string {
  return path.relative(repoRoot, file).split(path.sep).join('/');
}

/** Source with comments removed — the prose here names what it prohibits. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
}

let cached: Graph | null = null;

async function publicGraph(): Promise<Graph> {
  cached ??= await reachableFrom(await filesUnder(PUBLIC_GROUP));
  return cached;
}

/* ===========================================================================
 * The cache boundary
 * ========================================================================= */

describe('the anonymous public tree reads no session-derived state', () => {
  it('reaches a real graph, so nothing below passes vacuously', async () => {
    const { modules } = await publicGraph();

    // The layout, the home shell, the Explore routes, the legal routes, the
    // sitemap, the error surfaces, and everything they pull in.
    expect(modules.size).toBeGreaterThan(10);
    expect([...modules.keys()].map(relative)).toContain(
      'apps/web/src/components/shell/site-header.tsx',
    );
  });

  it('imports no identity, session or authorisation module anywhere in the graph', async () => {
    // Named by MODULE rather than by symbol: the rule is that the capability
    // is not reachable at all. A helper that wrapped `requireOwnSession` under
    // a friendlier name would still import it, and would still be caught here.
    const forbidden = [
      '@/composition/identity',
      '@/composition/authorization',
      '@/composition/request',
      '@/composition/dispatch',
      '@/contexts/identity-access',
      '@/config/server-env',
      '@minhaj/contracts/env/server',
    ];

    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      for (const specifier of specifiersIn(source)) {
        expect(
          forbidden.some(
            (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
          ),
          `${relative(file)} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it('reaches only the narrow non-secret prerender environment module', async () => {
    // Walk through aliases, wrappers, relative imports and the guarded package
    // subpath. A source-only name check would miss a wrapper that imported the
    // full server entry on the public tree's behalf.
    const { modules } = await publicGraph();
    const reached = [...modules.keys()].map(relative);

    expect(reached).toContain('packages/contracts/src/env/prerender.ts');
    expect(reached).toContain('packages/contracts/src/env/prerender-build.ts');
    expect(reached).not.toContain('packages/contracts/src/env/server.ts');
    expect(reached).not.toContain('packages/contracts/src/env/server-schema.ts');
    expect(reached).not.toContain('apps/web/src/config/server-env.ts');

    const prerenderSource = code(
      [
        modules.get(
          path.join(repoRoot, 'packages', 'contracts', 'src', 'env', 'prerender.ts'),
        ) ?? '',
        modules.get(
          path.join(
            repoRoot,
            'packages',
            'contracts',
            'src',
            'env',
            'prerender-build.ts',
          ),
        ) ?? '',
      ].join('\n'),
    );

    for (const secret of [
      'AUTH_SECRETS',
      'DATABASE_URL',
      'EMAIL_DIGEST_KEY',
      'RATE_LIMIT_DIGEST_KEY',
      'RESEND_API_KEY',
    ]) {
      expect(prerenderSource, secret).not.toContain(secret);
    }
  });

  it('imports no request-scoped framework API, so the tree stays static', async () => {
    // `cookies()` and `headers()` are how a session would be read, and they
    // are also what opts a route out of static rendering. One import defeats
    // the caching boundary and opens the door to reading a session in the same
    // move (ARCHITECTURE.md §8.1).
    const forbidden = ['next/headers', 'next/cookies', 'better-auth'];

    const { packages, modules } = await publicGraph();

    for (const specifier of packages) {
      expect(
        forbidden.some(
          (entry) => specifier === entry || specifier.startsWith(`${entry}/`),
        ),
        `the public graph imports ${specifier}`,
      ).toBe(false);
    }

    // And no database or shared-server capability either: a public page has no
    // business holding one, and Model A would not permit it in any case.
    for (const specifier of packages) {
      expect(specifier.startsWith('@minhaj/database'), specifier).toBe(false);
      expect(specifier.startsWith('@minhaj/server-core'), specifier).toBe(false);
      expect(specifier.startsWith('@prisma/'), specifier).toBe(false);
    }

    expect(modules.size).toBeGreaterThan(0);
  });

  it('marks no public route dynamic, and revalidates none of them per request', async () => {
    // `force-dynamic` on a public route would mean rendering it per visitor,
    // which is both the performance cost and the precondition for a leak. The
    // private surfaces use it deliberately and correctly; none of them is in
    // this group.
    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      if (!file.startsWith(PUBLIC_GROUP)) continue;

      expect(code(source), relative(file)).not.toContain('force-dynamic');
    }
  });

  it('keeps the private surfaces OUT of the public group entirely', async () => {
    // The split is what stops a public header from being wrapped around a
    // private page — and, more importantly, stops a private page's session
    // handling from being pulled into a layout the public tree shares.
    for (const area of ['admin', 'my', '(identity)']) {
      const inside = path.join(PUBLIC_GROUP, area);

      await expect(stat(inside)).rejects.toThrow();
    }
  });

  it('leaves the private surfaces private and unindexed', async () => {
    // A Phase-2 regression this phase could plausibly cause: moving routes
    // into a group and losing the directives that were on them.
    for (const file of [
      'apps/web/src/app/[locale]/admin/layout.tsx',
      'apps/web/src/app/[locale]/my/page.tsx',
      'apps/web/src/app/[locale]/admin/system/navigation/page.tsx',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');

      expect(source, file).toContain('force-dynamic');
      expect(source, file).toContain('robots');
      expect(source, file).toContain('index: false');
    }
  });
});

/* ===========================================================================
 * Client JavaScript
 * ========================================================================= */

describe('the public shell is server-rendered, with narrow client islands', () => {
  it('declares `use client` in exactly the files that genuinely need it', async () => {
    // A `'use client'` on a layout or a page would take the whole subtree with
    // it. The islands are the two navigation controls, whose open/closed state
    // genuinely lives in the browser, and the error boundary, which React
    // requires to be a Client Component.
    const { modules } = await publicGraph();

    const clientModules = [...modules]
      .filter(([, source]) => /^\s*['"]use client['"]/m.test(source))
      .map(([file]) => relative(file))
      .sort();

    expect(clientModules).toEqual([
      'apps/web/src/app/[locale]/(public)/error.tsx',
      'apps/web/src/components/locale-switcher-links.tsx',
      'apps/web/src/components/shell/disclosure-menu.tsx',
      'apps/web/src/components/shell/mobile-nav.tsx',
    ]);
  });

  it('renders nothing the error boundary was handed', async () => {
    // THE SECURITY HALF OF THE ERROR SURFACE, and the half worth proving
    // mechanically. Next.js redacts a server error's message in production,
    // but a boundary that printed whatever it was given would disclose
    // everything the day something threw on the CLIENT instead — where nothing
    // is redacted. So it prints none of it: no message, no digest, no stack,
    // no cause, and it does not even accept the `error` prop.
    //
    // A live render is not asserted here. Triggering a real failure would mean
    // shipping a route that throws, which is a test-only production bypass;
    // the catalogue tests prove the three strings exist and are translated,
    // and this proves what the component may do with them.
    const source = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/app/[locale]/(public)/error.tsx'),
        'utf8',
      ),
    );

    for (const disclosure of [
      'error.message',
      'error.stack',
      'error.digest',
      'error.cause',
      'error.name',
      'JSON.stringify',
      'String(error)',
    ]) {
      expect(source, disclosure).not.toContain(disclosure);
    }

    // It takes `reset` and nothing else, so there is no `error` in scope to
    // render by accident.
    expect(source).toContain('reset');
    expect(source).not.toMatch(/\berror\s*[,}:]/);
  });

  it('requests no external font, script or stylesheet', async () => {
    // ARCHITECTURE.md §13.8 and the brand gate together: no third-party font
    // request, no unlicensed bundled face, and nothing loaded from an origin
    // the CSP does not allow anyway.
    const { modules } = await publicGraph();

    for (const [file, source] of modules) {
      // The traversed contracts module validates the localhost application
      // origin; it does not request a font, script or stylesheet. This check is
      // about render code that could create an external browser request.
      if (!file.startsWith(APP_SRC)) continue;

      expect(code(source), relative(file)).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
      expect(code(source), relative(file)).not.toContain('next/font');
    }
  });
});

/* ===========================================================================
 * No Page aggregate, no hidden CMS
 * ========================================================================= */

describe('Phase 4 introduces no editorial content model', () => {
  it('adds no table, no model and no enum to the schema', async () => {
    // The hard boundary of the phase: Page arrives exactly once, in Phase 6.
    const schema = await readFile(
      path.join(repoRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
      'utf8',
    );

    for (const model of [
      'Page',
      'PageRevision',
      'Navigation',
      'NavigationItem',
      'Menu',
      'MenuItem',
      'Footer',
      'SiteSettings',
      'OrganisationProfile',
      'LegalDocument',
      'SEOPage',
      'Sitemap',
      'DesignToken',
    ]) {
      expect(schema, model).not.toMatch(new RegExp(`\\bmodel\\s+${model}\\b`));
    }
  });

  it('creates no table in the Phase-4 migration', async () => {
    const migration = await readFile(
      path.join(
        repoRoot,
        'packages/database/prisma/migrations',
        '20260918000000_phase4_navigation_permission',
        'migration.sql',
      ),
      'utf8',
    );

    expect(migration).not.toMatch(/CREATE\s+TABLE/i);
    expect(migration).not.toMatch(/CREATE\s+PROCEDURE/i);
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i);
    expect(migration).toContain("N'navigation.read'");
  });

  it('seeds no `navigation.administer`, because no mutation exists to authorise', async () => {
    const migration = await readFile(
      path.join(
        repoRoot,
        'packages/database/prisma/migrations',
        '20260918000000_phase4_navigation_permission',
        'migration.sql',
      ),
      'utf8',
    );

    // Comments stripped: the migration EXPLAINS why no write key exists, and
    // the explanation must not be the thing that fails the test.
    expect(migration.replace(/^\s*--.*$/gm, '')).not.toContain('navigation.administer');
  });

  it('pairs the forward migration with a reviewed rollback', async () => {
    const rollback = await readFile(
      path.join(
        repoRoot,
        'packages/database/sql/rollback',
        '20260918000000_phase4_navigation_permission.rollback.sql',
      ),
      'utf8',
    );

    // A privilege change is reversed the same way it was made: the bundle
    // narrows, and the sessions and step-up grants issued under the wider
    // bundle go with it (SECURITY_BASELINE.md §8.1).
    expect(rollback).toContain('DELETE FROM [dbo].[StepUpGrant]');
    expect(rollback).toContain('DELETE FROM [dbo].[Session]');
    expect(rollback).toContain("N'navigation.read'");
  });

  it('keeps the navigation status surface read-only', async () => {
    // No form, no Server Action, no submit control. The registry is code; a
    // Save button here would be a mutation contract nobody accepted.
    const page = code(
      await readFile(
        path.join(repoRoot, 'apps/web/src/app/[locale]/admin/system/navigation/page.tsx'),
        'utf8',
      ),
    );

    expect(page).not.toContain('<form');
    expect(page).not.toContain('use server');
    expect(page).not.toContain('<button');
    expect(page).not.toContain('action=');

    // And it is gated by the key, server-side, like every other admin route.
    expect(page).toContain("'navigation.read'");
    expect(page).toContain('requireAdminPage');
  });
});

/* ===========================================================================
 * Shell configuration carries no content
 * ========================================================================= */

describe('shell configuration is labels and routes, never content', () => {
  it('stores no prose in the registry or the allowlists', async () => {
    // The boundary is drawn by SUBSTANCE, not by storage mechanism
    // (DELIVERY_PLAN.md, Phase 4). A long string literal in these files would
    // be organisational or legal body content living in "configuration",
    // whatever it was named. Message KEYS are short; bodies are not.
    for (const file of [
      'apps/web/src/shell/registry.ts',
      'apps/web/src/shell/explore.ts',
    ]) {
      const source = code(await readFile(path.join(repoRoot, file), 'utf8'));

      for (const line of source.split('\n')) {
        for (const match of line.matchAll(/'([^']{60,})'/g)) {
          expect.fail(`${file} holds a long literal: ${match[1]?.slice(0, 80)}`);
        }
      }
    }
  });

  it('renders a publication-status state on every reserved route', async () => {
    for (const file of [
      'apps/web/src/app/[locale]/(public)/explore/[section]/page.tsx',
      'apps/web/src/app/[locale]/(public)/explore/[section]/[page]/page.tsx',
      'apps/web/src/app/[locale]/(public)/legal/[document]/page.tsx',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');

      expect(source, file).toContain('<PublicationStatus');
    }
  });

  it('refuses an unknown slug rather than rendering a titled empty page', async () => {
    for (const file of [
      'apps/web/src/app/[locale]/(public)/explore/[section]/page.tsx',
      'apps/web/src/app/[locale]/(public)/explore/[section]/[page]/page.tsx',
      'apps/web/src/app/[locale]/(public)/legal/[document]/page.tsx',
    ]) {
      const source = code(await readFile(path.join(repoRoot, file), 'utf8'));

      // Both halves: the router refuses an unlisted parameter, and the
      // component refuses it again rather than trusting the router.
      expect(source, file).toContain('export const dynamicParams = false');
      expect(source, file).toContain('notFound()');
    }
  });
});

/* ===========================================================================
 * Security headers
 * ========================================================================= */

describe('the base security headers', () => {
  it('sets the policy in one place, for every response', async () => {
    const config = await readFile(
      path.join(repoRoot, 'apps', 'web', 'next.config.ts'),
      'utf8',
    );

    for (const header of [
      'Content-Security-Policy',
      'X-Content-Type-Options',
      'Referrer-Policy',
      'X-Frame-Options',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
    ]) {
      expect(config, header).toContain(header);
    }

    expect(config).toContain("source: '/:path*'");
  });

  it('permits no eval, and pre-allows no third-party origin', async () => {
    const config = code(
      await readFile(path.join(repoRoot, 'apps', 'web', 'next.config.ts'), 'utf8'),
    );

    expect(config).not.toContain('unsafe-eval');

    // Media providers, analytics and font CDNs arrive with the phases that own
    // them and their embed privacy contract — not pre-emptively.
    for (const origin of [
      'youtube',
      'vimeo',
      'googleapis',
      'gstatic',
      'google-analytics',
      'googletagmanager',
    ]) {
      expect(config, origin).not.toContain(origin);
    }
  });

  it('locks down the directives that do not depend on inline script', async () => {
    const config = await readFile(
      path.join(repoRoot, 'apps', 'web', 'next.config.ts'),
      'utf8',
    );

    for (const directive of [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      // Strict, and proved to hold by the browser suite rather than assumed.
      "style-src 'self'",
    ]) {
      expect(config, directive).toContain(directive);
    }

    // Exactly ONE `'unsafe-inline'` IN THE POLICY ITSELF, and it is the script
    // one the caching boundary forces. A second would mean the style directive
    // had been quietly relaxed. Comments are stripped first: the file explains
    // at length why the one allowance exists and why the other does not, and
    // the explanation must not be what the count measures.
    expect(code(config).match(/'unsafe-inline'/g) ?? []).toHaveLength(1);
  });
});
