import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  EXTERNALLY_GATED_PERMISSIONS,
  PLATFORM_ADMINISTRATOR_PERMISSIONS,
  STEP_UP_PURPOSES,
} from '../../packages/contracts/src/identity/index.ts';
import { rawDownloadHeaders } from '../../apps/web/src/contexts/migration-provenance/index.ts';
import { repoRoot } from './architecture-harness.ts';

/**
 * Phase 29 boundaries — Migration & Provenance.
 *
 * THE FAILURES THIS FILE EXISTS TO PREVENT, each of which would pass every
 * behavioural test on the day it was introduced:
 *
 *   - the migration context reaching a TARGET context (Media, Editorial, …) or
 *     database capability, instead of the ports Layer 4 hands it — or a target
 *     context reaching back into migration;
 *   - the migration TOOLING (`scripts/migration/`) holding database capability
 *     of its own, or an embedded SQLite engine escaping the synthetic export;
 *   - the Media publication target wired anywhere but Layer 4, or reaching
 *     Media around its public service;
 *   - the node-runnable composition graph the CLIs and the staging proof load
 *     acquiring a bundler-only `@/` import, so it stops loading in plain Node;
 *   - the adapter surface widening past its seven port factories;
 *   - `migration.publish` bundled to a standing role, or a publisher verified
 *     for any step-up purpose but `migration-publication`;
 *   - a raw snapshot served with headers that let a browser render it;
 *   - a state-changing GET under `/api/admin/migration/**`.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments removed, string literals kept, so prose cannot match. */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:'"`\\])\/\/.*$/gmu, '$1 ');
}

async function exists(relative: string): Promise<boolean> {
  try {
    await stat(path.join(repoRoot, relative));
    return true;
  } catch {
    return false;
  }
}

const SKIPPED = new Set(['node_modules', '.next', 'dist', 'generated', 'test-results']);

async function walk(directory: string): Promise<string[]> {
  if (!(await exists(directory))) return [];
  const found: string[] = [];
  for (const entry of await readdir(path.join(repoRoot, directory), {
    withFileTypes: true,
  })) {
    if (SKIPPED.has(entry.name)) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...(await walk(relative)));
    else found.push(relative);
  }
  return found;
}

const CODE = /\.(?:ts|tsx|mts|mjs|js|cjs)$/u;
const sources = async (directory: string) =>
  (await walk(directory)).filter((file) => CODE.test(file));

/** Every import specifier, static or dynamic. */
function imports(source: string): string[] {
  const body = withoutComments(source);
  return [
    ...body.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/gu),
    ...body.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/gu),
    ...body.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gmu),
    ...body.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/gu),
  ].map((match) => match[1]!);
}

const CONTEXT = 'apps/web/src/contexts/migration-provenance';
const CONTRACTS = 'packages/contracts/src/migration';
const ADAPTER = 'packages/database/src/adapters/migration-provenance';
const TOOLING = 'scripts/migration';
const COMPOSITION = 'apps/web/src/composition';
const WEB_ROOT = `${COMPOSITION}/migration.ts`;
const RUNNER = `${COMPOSITION}/migration-runner.ts`;
const WIRING = `${COMPOSITION}/migration-wiring.ts`;
const TARGETS = `${COMPOSITION}/migration-targets.ts`;
/** The composition the CLIs and the staging proof load outside the bundler. */
const NODE_RUNNABLE = [RUNNER, WIRING, TARGETS];
const API = 'apps/web/src/app/api/admin/migration';

/** Every bounded context but Migration itself. */
async function otherContexts(): Promise<string[]> {
  return (
    await readdir(path.join(repoRoot, 'apps/web/src/contexts'), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory() && entry.name !== 'migration-provenance')
    .map((entry) => entry.name);
}

/* ===========================================================================
 * The context and its dependency edges
 * ========================================================================= */

describe('Migration depends only on Layer 0 and the ports Layer 4 hands it', () => {
  it('imports nothing into the context but its own modules, the contracts, zod, sanitize-html and node built-ins', async () => {
    const files = await sources(CONTEXT);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files)
      for (const specifier of imports(await read(file)))
        expect(
          specifier === 'server-only' ||
            specifier === 'zod' ||
            specifier === 'sanitize-html' ||
            /^node:[a-z]+$/u.test(specifier) ||
            specifier === '@minhaj/contracts' ||
            specifier === '@minhaj/contracts/migration' ||
            // Relative and explicit — the context runs in plain Node too.
            /^\.{1,2}\/[a-z/.-]+\.ts$/u.test(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
  });

  it('reaches no target context, no other context, and no database capability', async () => {
    const contexts = await otherContexts();
    expect(contexts).toEqual(expect.arrayContaining(['media', 'editorial', 'library']));
    for (const file of [...(await sources(CONTEXT)), ...(await sources(CONTRACTS))]) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/@prisma|PrismaClient|\$queryRaw|\$executeRaw/u);
      for (const specifier of imports(source)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /@prisma|^mssql$|^tedious$|@minhaj\/database|packages\/database|@\/|composition/u,
        );
        for (const other of contexts)
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(
            new RegExp(
              `contexts/${other}\\b|^\\.\\./\\.\\./${other}\\b|contracts/${other}$`,
              'u',
            ),
          );
      }
    }
  });

  it('is reached by no other context, in code or contracts', async () => {
    for (const other of await otherContexts())
      for (const file of await sources(`apps/web/src/contexts/${other}`))
        for (const specifier of imports(await read(file)))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(
            /migration-provenance|contracts\/migration/u,
          );
    for (const file of await sources('packages/contracts/src'))
      if (!file.startsWith(`${CONTRACTS}/`))
        for (const specifier of imports(await read(file)))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(/migration\//u);
    // No other context's adapter reaches Migration's adapter, nor it theirs.
    for (const file of await sources('packages/database/src/adapters'))
      for (const specifier of imports(await read(file)))
        if (file.startsWith(`${ADAPTER}/`))
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(
            /^\.\.\/(?!\.\.)|adapters\/(?!migration-provenance)/u,
          );
        else
          expect(specifier, `${file} imports ${specifier}`).not.toMatch(
            /migration-provenance/u,
          );
  });
});

/* ===========================================================================
 * The tooling holds no database capability
 * ========================================================================= */

describe('scripts/migration holds no database capability of its own', () => {
  it('imports no Prisma, driver or database package, and reaches the app only through the runner composition', async () => {
    const files = await sources(TOOLING);
    expect(files).toEqual(
      expect.arrayContaining([
        `${TOOLING}/run-fixture.ts`,
        `${TOOLING}/promote.ts`,
        `${TOOLING}/staging-fixture-proof.ts`,
      ]),
    );
    for (const file of files) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/PrismaClient|\$queryRaw|\$executeRaw/u);
      for (const specifier of imports(source)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /@prisma|^mssql$|^tedious$|@minhaj\/database|packages\/database|@minhaj\/storage|@minhaj\/server-core/u,
        );
        // Leaving the tooling directory means the one runner composition.
        if (specifier.startsWith('.')) {
          const target = path.posix.normalize(
            path.posix.join(path.posix.dirname(file), specifier),
          );
          if (!target.startsWith(`${TOOLING}/`))
            expect(target, `${file} imports ${specifier}`).toBe(RUNNER);
        }
      }
    }
  });

  it('uses the embedded SQLite engine only for the synthetic export', async () => {
    for (const file of await sources(TOOLING))
      if (!file.startsWith(`${TOOLING}/export/`))
        for (const specifier of imports(await read(file)))
          expect(specifier, `${file} imports ${specifier}`).not.toBe('node:sqlite');
  });

  it('the staging proof refuses every database but MinhajStaging and a disposable one, before composing anything', async () => {
    const proof = withoutComments(await read(`${TOOLING}/staging-fixture-proof.ts`));
    const guard = proof.indexOf("approvedTarget(process.env['DATABASE_URL'])");
    const compose = proof.indexOf('composeMigrationRunner()', guard);
    expect(guard).toBeGreaterThan(0);
    expect(compose).toBeGreaterThan(guard);
    expect(proof).toContain("database === 'MinhajStaging' && host === 'sqlserver'");
    expect(proof).toContain('/^MinhajPhase1Test_[0-9a-f]{32}$/');
    // The fixture server it starts listens on loopback only, and the fetcher
    // it uses resolves nothing but `*.fixture.invalid`.
    expect(proof).toContain('createFixtureFetcher(source, server.endpoint)');
    expect(proof).not.toMatch(/createSafeFetcher|\bfetch\s*\(/u);
  });
});

/* ===========================================================================
 * Layer 4 — the wiring, the target, the node-runnable graph
 * ========================================================================= */

describe('only Layer-4 composition wires Migration and its Media target', () => {
  it('names the Media target only in the migration composition', async () => {
    const scanned = [
      ...(await sources('apps/web/src')),
      ...(await sources('packages')),
      ...(await sources('scripts')),
    ];
    expect(scanned.length).toBeGreaterThan(300);
    const allowed = new Set([TARGETS, WEB_ROOT, RUNNER]);
    for (const file of scanned) {
      if (allowed.has(file)) continue;
      expect(withoutComments(await read(file)), file).not.toMatch(
        /createMediaVideoTarget|mediaVideoTargetOver|migration-targets/u,
      );
    }
    // The migration services are built from the one wiring, in two roots only.
    for (const file of scanned) {
      // The context defines its factories; the wiring alone calls them.
      if (file === WIRING || file === WEB_ROOT || file === RUNNER) continue;
      if (file.startsWith(`${CONTEXT}/`)) continue;
      expect(withoutComments(await read(file)), file).not.toMatch(
        /\bmigrationDependencies\b|createMigration(?:Source|Pipeline|Decision|Raw|Publication|Promotion|Read)Service\(/u,
      );
    }
  });

  it('reaches Media only through its public service and Personalisation only through its own', async () => {
    const targets = withoutComments(await read(TARGETS));
    const specifiers = imports(targets);
    expect(specifiers).toEqual(
      expect.arrayContaining([
        '../contexts/media/index.ts',
        '../contexts/personalisation-notifications/index.ts',
      ]),
    );
    for (const specifier of specifiers)
      expect(specifier).toMatch(
        /^(?:server-only|@minhaj\/database|@minhaj\/contracts\/(?:media|migration)|\.\.\/contexts\/(?:media|personalisation-notifications)\/index\.ts)$/u,
      );
    // Media's tables are never named: the target saves and reads Videos only
    // through `saveVideo`, `video` and `videos`.
    for (const file of [TARGETS, WIRING, RUNNER, WEB_ROOT]) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(
        /\[dbo\]|@prisma|\$queryRaw|\$executeRaw|getDatabaseClient/u,
      );
      expect(source, file).not.toMatch(
        /create(?:MediaReferences|MediaAssetRelations)\b/u,
      );
    }
    expect(targets).toMatch(/media\.saveVideo\(/u);
    expect(targets).not.toMatch(/persistence\.saveVideo|store\.saveVideo/u);
  });

  it('keeps the node-runnable composition free of the bundler alias, all the way down', async () => {
    const reached = new Set<string>();
    const queue = [...NODE_RUNNABLE];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (reached.has(file)) continue;
      reached.add(file);
      for (const specifier of imports(await read(file))) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(/^@\//u);
        if (!specifier.startsWith('.')) continue;
        // Node resolves only explicit file paths.
        expect(specifier, `${file} imports ${specifier}`).toMatch(/\.ts$/u);
        const target = path.posix.normalize(
          path.posix.join(path.posix.dirname(file), specifier),
        );
        if (target.startsWith('apps/web/src/')) queue.push(target);
      }
    }
    // The graph is the three composition modules and five contexts' sources.
    const contexts = new Set(
      [...reached]
        .filter((file) => file.startsWith('apps/web/src/contexts/'))
        .map((file) => file.split('/')[4]),
    );
    expect([...contexts].sort()).toEqual([
      'media',
      'migration-provenance',
      'people-contributors',
      'personalisation-notifications',
      'taxonomy',
    ]);
    expect(
      [...reached].filter((file) => file.startsWith(`${COMPOSITION}/`)).sort(),
    ).toEqual([...NODE_RUNNABLE].sort());
  });

  it('builds the web runtime with exactly the seven services the administration uses', async () => {
    const wiring = withoutComments(await read(WIRING));
    const services =
      /export interface MigrationServices \{([\s\S]*?)\n\}/u.exec(wiring)?.[1] ?? '';
    expect(
      [...services.matchAll(/readonly (\w+):/gu)].map((match) => match[1]).sort(),
    ).toEqual([
      'decisions',
      'pipeline',
      'promotion',
      'publication',
      'raw',
      'read',
      'sources',
    ]);
    const web = withoutComments(await read(WEB_ROOT));
    expect(web).toMatch(/export function migrationRuntime\(\): MigrationServices/u);
  });
});

/* ===========================================================================
 * The adapter surface
 * ========================================================================= */

describe('the adapter surface is the seven port factories and nothing else', () => {
  const FACTORIES = [
    ['createMigrationDecisions', 'MigrationDecisionPort'],
    ['createMigrationPipeline', 'MigrationPipelinePort'],
    ['createMigrationPromotion', 'MigrationPromotionPort'],
    ['createMigrationPublication', 'MigrationPublicationPort'],
    ['createMigrationRaw', 'MigrationRawPort'],
    ['createMigrationReader', 'MigrationReadPort'],
    ['createMigrationSources', 'MigrationSourcePort'],
  ] as const;

  it('exports exactly the factories and the refusal type, each returning its contract port', async () => {
    const index = withoutComments(await read(`${ADAPTER}/index.ts`));
    const exported = [...index.matchAll(/export \{ (\w+) \}/gu)]
      .map((match) => match[1])
      .sort();
    expect(exported).toEqual(
      ['MigrationDataError', ...FACTORIES.map(([name]) => name)].sort(),
    );
    const texts = await Promise.all(
      (await sources(ADAPTER)).map(async (file) => withoutComments(await read(file))),
    );
    for (const [name, port] of FACTORIES) {
      const declared = texts
        .map(
          (text) =>
            new RegExp(`export function ${name}\\(\\): (\\w+)`, 'u').exec(text)?.[1],
        )
        .filter((value) => value !== undefined);
      expect(declared, name).toEqual([port]);
    }
    const database = withoutComments(await read('packages/database/src/index.ts'));
    const block =
      /export \{([^}]*)\} from '\.\/adapters\/migration-provenance\/index\.ts';/u.exec(
        database,
      )?.[1];
    expect(
      (block ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .sort(),
    ).toEqual(['MigrationDataError', ...FACTORIES.map(([name]) => name)].sort());
  });

  it('adds exactly one narrow Personalisation read for the target: a held bit', async () => {
    const ports = withoutComments(
      await read('packages/contracts/src/personalisation/ports.ts'),
    );
    const holding =
      /interface PersonalHoldingPort \{([\s\S]*?)\n\}/u.exec(ports)?.[1] ?? '';
    expect(holding.trim()).toBe('videoHeld(videoId: string): Promise<boolean>;');
    const adapter = withoutComments(
      await read(
        'packages/database/src/adapters/personalisation-notifications/holdings.ts',
      ),
    );
    expect(adapter).toMatch(
      /export function createPersonalHoldings\(\): PersonalHoldingPort/u,
    );
    // One statement, over this context's own two tables, returning one bit.
    expect([...adapter.matchAll(/\$queryRaw/gu)]).toHaveLength(1);
    expect(
      [...adapter.matchAll(/\[dbo\]\.\[(\w+)\]/gu)].map((match) => match[1]).sort(),
    ).toEqual(['SavedItem', 'WatchHistory']);
    expect(adapter).not.toMatch(/userId|COUNT\(|TOP \(/u);
  });
});

/* ===========================================================================
 * Publication authority
 * ========================================================================= */

describe('migration.publish is externally gated and step-up scoped', () => {
  it('is catalogued, gated externally and bundled to no standing role', async () => {
    expect(EXTERNALLY_GATED_PERMISSIONS).toContain('migration.publish');
    expect(PLATFORM_ADMINISTRATOR_PERMISSIONS).not.toContain('migration.publish');
    expect(PLATFORM_ADMINISTRATOR_PERMISSIONS).toEqual(
      expect.arrayContaining(['migration.read', 'migration.administer']),
    );
    expect(STEP_UP_PURPOSES).toContain('migration-publication');
    const migration = (
      await read(
        'packages/database/prisma/migrations/20261011000000_phase29_migration_provenance/migration.sql',
      )
    ).replace(/--.*$/gmu, ' ');
    for (const insert of migration.matchAll(
      /INSERT INTO \[dbo\]\.\[RolePermission\][\s\S]*?;/gu,
    ))
      expect(insert[0]).not.toContain('migration.publish');
  });

  it('verifies a publisher for exactly migration.publish with a migration-publication step-up', async () => {
    for (const file of [WIRING, RUNNER]) {
      const source = withoutComments(await read(file));
      const pairs = [
        ...source.matchAll(/permission: '([a-z.]+)',\s*stepUp: '([a-z-]+)'/gu),
      ].map((match) => `${match[1]} ${match[2]}`);
      expect(pairs, file).toEqual(['migration.publish migration-publication']);
    }
    // The purpose is spent nowhere in the application but the migration
    // composition and the migration administration.
    for (const file of await sources('apps/web/src')) {
      if (
        file.startsWith(`${COMPOSITION}/migration`) ||
        file.startsWith('apps/web/src/app/[locale]/admin/migration/')
      )
        continue;
      expect(withoutComments(await read(file)), file).not.toContain(
        "'migration-publication'",
      );
    }
  });
});

/* ===========================================================================
 * Raw evidence and the HTTP surface
 * ========================================================================= */

describe('raw evidence is never rendered and no GET changes anything', () => {
  it('downloads a snapshot only as an inert, uncached attachment', async () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(rawDownloadHeaders(id, 12)).toEqual({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="snapshot-${id}.bin"`,
      'Content-Length': '12',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    // A route serving the bytes passes exactly those headers and sets no type of its own.
    for (const file of await sources(API)) {
      const source = withoutComments(await read(file));
      expect(source, file).not.toMatch(/text\/html|dangerouslySetInnerHTML/u);
      if (/\.raw\.download\(/u.test(source))
        expect(source, file).toMatch(/headers: \{ \.\.\.download\.headers \}/u);
    }
  });

  it('answers only reads under /api/admin/migration, and its reads call no mutation', async () => {
    const routes = (await sources(API)).filter((file) => file.endsWith('/route.ts'));
    const MUTATIONS =
      /\.(?:createFixture|update|cancel|review|duplicate|topicMapping|disappearance|rights|legacyMapping|createManifest|discard|publish|rollback|approve|withdraw|execute|dispose)\(|pipeline\.run\(|promotion\.create\(/u;
    for (const file of routes) {
      const source = withoutComments(await read(file));
      const handlers = [
        ...source.matchAll(
          /export (?:async )?function (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gu,
        ),
        ...source.matchAll(/export const (GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/gu),
      ].map((match) => match[1]);
      expect(handlers.length, file).toBeGreaterThan(0);
      // A file that answers a read holds no mutation at all: a change is a
      // Server Action's, behind the action's own CSRF model, never a GET's.
      if (handlers.includes('GET') || handlers.includes('HEAD'))
        expect(source, file).not.toMatch(MUTATIONS);
    }
  });
});
