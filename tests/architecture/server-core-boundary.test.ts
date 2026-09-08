import { createRequire } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';

/**
 * `packages/server-core` must never enter a client bundle
 * (ARCHITECTURE.md §3.1, §6.3 rule 9).
 *
 * The AUTHORITATIVE proof is a real Next build: `npm run check:server-only`
 * runs `next build` against an isolated fixture app once per bypass variant and
 * asserts each fails while legitimate server usage still builds. A Vitest
 * import assertion exercises Node resolution, not the bundler that actually
 * decides what reaches a browser, so it is not sufficient on its own.
 *
 * These tests assert the MECHANISMS that build proof depends on, so a
 * regression is caught in seconds rather than only by the slower build gate.
 */

const require = createRequire(import.meta.url);
const serverCoreRoot = path.join(repoRoot, 'packages', 'server-core');

describe('B4 — the server-only marker is present', () => {
  it('declares server-only as a dependency', () => {
    const manifest = require(path.join(serverCoreRoot, 'package.json')) as {
      dependencies: Record<string, string>;
    };

    // The official React marker package. Next.js 16 recognises this specifier
    // in its bundler and fails the build when a client graph reaches it.
    expect(manifest.dependencies['server-only']).toBe('0.0.1');
  });

  it('imports server-only from every entry point', async () => {
    // Both the root and the subpath must carry the marker: a boundary enforced
    // on one entry and not the other is not a boundary.
    for (const entry of ['src/index.ts', 'src/logging/logger.ts']) {
      const source = await readFile(path.join(serverCoreRoot, entry), 'utf8');

      expect(source, `${entry} must import 'server-only'`).toMatch(
        /import\s+['"]server-only['"]/,
      );
    }
  });
});

describe('S1/S2 — every bypass variant has a real build fixture', () => {
  it('covers package, source-path, alias, wrapper and contracts-env reaches', async () => {
    const variants = await readdir(
      path.join(repoRoot, 'tests', 'fixtures', 'next-client-boundary', 'variants'),
    );

    // Package-name reaches were already covered; the SOURCE-PATH reaches are
    // what the second review showed still bypassed the boundary, and the
    // server-env reaches are what the THIRD review showed still did.
    expect(variants.sort()).toEqual(
      [
        // server-core
        'alias-source',
        'direct',
        'dynamic',
        'relative-source',
        'shared-wrapper',
        'subpath',
        'wrapper',
        // contracts server environment
        'contracts-env-alias',
        'contracts-env-internal-relative',
        'contracts-env-relative',
        'contracts-env-schema',
        'contracts-env-subpath',
        'contracts-env-wrapper',
      ].sort(),
    );
  });

  it('reaches the server env implementation by every available route', async () => {
    // Review #3 built a Client Component against `@minhaj/contracts/env/schema`
    // — a public, marker-free subpath — and the build SUCCEEDED. Removing that
    // subpath closes the specifier; these variants close the rest, so the fix
    // cannot be re-opened by reaching the same module a different way.
    const variants = await readdir(
      path.join(repoRoot, 'tests', 'fixtures', 'next-client-boundary', 'variants'),
    );

    for (const required of [
      'contracts-env-schema', // the exact Review #3 bypass
      'contracts-env-subpath', // the supported (guarded) package subpath
      'contracts-env-relative', // relative path to the marked entry point
      'contracts-env-internal-relative', // relative path to the IMPLEMENTATION
      'contracts-env-alias', // tsconfig alias to the IMPLEMENTATION
      'contracts-env-wrapper', // laundered through a wrapper module
    ]) {
      expect(variants, `missing build fixture: ${required}`).toContain(required);
    }
  });

  it('tests a REAL tsconfig alias, not a relative path wearing the name', async () => {
    // Review #3 (N3) found the `alias-source` variant importing
    // `../../../../../../packages/server-core/src/...` — a relative climb. It
    // duplicated `relative-source` and proved nothing about alias resolution,
    // while its name asserted otherwise.
    //
    // A misleadingly-named test is worse than a missing one: it reports
    // coverage that does not exist. So this asserts both halves — the import is
    // an alias, and the alias is genuinely declared by the fixture's tsconfig.
    const fixtureRoot = path.join(repoRoot, 'tests', 'fixtures', 'next-client-boundary');

    const tsconfig = JSON.parse(
      await readFile(path.join(fixtureRoot, 'tsconfig.json'), 'utf8'),
    ) as { compilerOptions: { paths: Record<string, readonly string[]> } };

    for (const [variant, alias] of [
      ['alias-source', '~server/'],
      ['contracts-env-alias', '~contracts/'],
    ] as const) {
      const source = await readFile(
        path.join(fixtureRoot, 'variants', variant, 'page.tsx'),
        'utf8',
      );

      expect(source, `${variant} must import through the ${alias} alias`).toContain(
        `from '${alias}`,
      );

      // ...and must NOT be a relative climb pretending to be one.
      expect(source, `${variant} must not use a relative path`).not.toMatch(
        /from '\.\.\//,
      );

      // The alias must actually exist, or the build would fail for the wrong
      // reason and the variant would "pass" while proving nothing.
      expect(
        tsconfig.compilerOptions.paths,
        `${alias}* must be declared in the fixture tsconfig`,
      ).toHaveProperty(`${alias}*`);
    }
  });

  it('marks every variant page as a real Client Component', async () => {
    const variantsRoot = path.join(
      repoRoot,
      'tests',
      'fixtures',
      'next-client-boundary',
      'variants',
    );

    for (const variant of await readdir(variantsRoot)) {
      const source = await readFile(path.join(variantsRoot, variant, 'page.tsx'), 'utf8');

      // A `.client.tsx` filename convention proves nothing. The fixture must
      // carry the directive Next actually acts on.
      expect(source, `${variant} must carry the 'use client' directive`).toMatch(
        /^['"]use client['"];/m,
      );
    }
  });
});

describe('the browser export condition is a second gate', () => {
  const manifest = require(path.join(serverCoreRoot, 'package.json')) as {
    exports: Record<string, Record<string, string>>;
  };

  it('declares a browser condition on every export', () => {
    for (const [subpath, conditions] of Object.entries(manifest.exports)) {
      expect(conditions, `${subpath} must declare a browser condition`).toHaveProperty(
        'browser',
      );
      expect(conditions['browser']).toBe('./src/client-import-error.ts');
    }
  });

  it('routes server conditions to real implementations', () => {
    const root = manifest.exports['.'];

    expect(root?.['react-server']).toBe('./src/index.ts');
    expect(root?.['node']).toBe('./src/index.ts');
  });

  it('throws when the browser entry is evaluated', async () => {
    await expect(
      import('../../packages/server-core/src/client-import-error.ts'),
    ).rejects.toThrow(/server-only/);
  });
});

describe('server-core is a host, not a domain', () => {
  it('hosts no invented business services', async () => {
    // ARCHITECTURE.md §3.1: admission is by justification. Phase 0B is
    // structure only, so the messaging/authorization/relationships/session
    // directories must NOT exist — the contexts that own them do not.
    const entries = await readdir(path.join(serverCoreRoot, 'src'), {
      withFileTypes: true,
    });
    const directories = entries.filter((entry) => entry.isDirectory()).map((e) => e.name);

    for (const premature of ['messaging', 'authorization', 'relationships', 'session']) {
      expect(directories).not.toContain(premature);
    }
  });
});
