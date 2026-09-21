import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';
import {
  ARCHITECTURAL_ROLES,
  layerZeroPersistentConcerns,
  workspaceRoles,
} from '../../packages/config/eslint/contexts.js';

/**
 * Phase 7 boundaries — storage is Layer 0, and it stays there.
 *
 * The failure this file exists to prevent is storage quietly becoming a
 * seventeenth bounded context: acquiring an owner column, an Identity import,
 * or a dependency on a business domain, any one of which would invert the
 * layer diagram and make every later phase depend on it in the wrong direction.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/**
 * SQL with its comments removed.
 *
 * The migration's comments NAME the things it deliberately does not create —
 * "there is no VARBINARY column below", "no foreign key reaches Permission" —
 * so a substring match over the raw text reads each explanation as the very
 * violation it documents. The assertions below are about executable SQL.
 */
function statements(sql: string): string {
  return sql.replace(/--.*$/gmu, ' ').replace(/\/\*[\s\S]*?\*\//gu, ' ');
}

/** Source with comments and string literals removed, so prose cannot match. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""')
    .replace(/`(?:[^`\\]|\\.)*`/gu, '``');
}

async function storageSources(): Promise<{ file: string; source: string }[]> {
  const directory = path.join(repoRoot, 'packages', 'storage', 'src');
  const names = await readdir(directory);

  return Promise.all(
    names
      .filter((name) => name.endsWith('.ts'))
      .map(async (name) => ({
        file: `packages/storage/src/${name}`,
        source: await readFile(path.join(directory, name), 'utf8'),
      })),
  );
}

describe('storage is Layer 0, not a bounded context', () => {
  it('is classified as a platform workspace', () => {
    expect(workspaceRoles['@minhaj/storage']).toBe(ARCHITECTURAL_ROLES.PLATFORM);
  });

  it('declares its persistence as a Layer-0 concern rather than a context', async () => {
    const manifest = JSON.parse(await read('packages/database/package.json')) as {
      minhaj: { persistenceAdapters: { owners: Record<string, unknown> } };
    };

    expect(manifest.minhaj.persistenceAdapters.owners['storage']).toEqual({
      kind: 'layer0',
      concern: 'storage',
    });
    expect(layerZeroPersistentConcerns).toContain('storage');
  });

  it('creates no bounded context directory', async () => {
    // A context lives under `apps/web/src/contexts`. Storage must not appear
    // there, because appearing there is what would make it one.
    const contexts = await readdir(path.join(repoRoot, 'apps', 'web', 'src', 'contexts'));

    expect(contexts).not.toContain('storage');
  });
});

describe('storage depends on no context and on no Identity', () => {
  it('imports nothing but contracts, zod and Node built-ins', async () => {
    const permitted = /^(?:node:|\.\/|\.\.\/|@minhaj\/contracts|zod$|server-only$)/u;

    for (const { file, source } of await storageSources()) {
      for (const [, specifier] of code(source).matchAll(
        /(?:^|\n)\s*import\s+(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/gu,
      )) {
        expect(specifier, `${file} imports ${specifier}`).toMatch(permitted);
      }
    }
  });

  it.each([
    'better-auth',
    '@minhaj/database',
    '@minhaj/server-core',
    '@prisma/client',
    'contexts/identity-access',
    'contexts/editorial',
    'contexts/people-contributors',
    'contexts/taxonomy',
  ])('never names %s', async (forbidden) => {
    for (const { file, source } of await storageSources()) {
      expect(code(source), `${file}`).not.toContain(forbidden);
    }
  });

  it('holds no raw database capability', async () => {
    for (const { file, source } of await storageSources()) {
      const text = code(source);
      for (const capability of ['PrismaClient', '$queryRaw', '$transaction', 'prisma.']) {
        expect(text, `${file}`).not.toContain(capability);
      }
    }
  });

  it('declares only Layer-0 dependencies in its manifest', async () => {
    const manifest = JSON.parse(await read('packages/storage/package.json')) as {
      dependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      '@minhaj/contracts',
      'server-only',
      'zod',
    ]);
  });

  it('is server-only, with a browser condition that fails the build', async () => {
    const manifest = JSON.parse(await read('packages/storage/package.json')) as {
      exports: Record<string, Record<string, string>>;
    };

    expect(manifest.exports['.']?.['browser']).toBe('./src/client-import-error.ts');
    expect(await read('packages/storage/src/client-import-error.ts')).toContain('throw');

    for (const { file, source } of await storageSources()) {
      if (file.endsWith('client-import-error.ts')) continue;
      expect(source.startsWith("import 'server-only';"), file).toBe(true);
    }
  });
});

describe('the serving route is the mechanism, never the policy', () => {
  const route = 'apps/web/src/app/assets/[id]/route.ts';

  it('imports no Identity of any kind', async () => {
    const source = code(await read(route));

    for (const forbidden of [
      'better-auth',
      '@/composition/identity',
      '@/composition/authorization',
      '@/composition/request',
      'contexts/identity-access',
      'getSession',
      'cookies',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('defaults to deny and ships no policy that ever allows', async () => {
    const source = await read(route);

    // Phase 7 delivers no allow decision at all. A consuming phase supplies
    // one; until then the correct behaviour is that nothing is reachable.
    expect(source).toContain("Promise.resolve('deny')");
    expect(source).not.toContain("'allow'");
  });

  it('reads the asset identifier from the path and nothing else from the request', async () => {
    const source = code(await read(route));

    // No query, header, cookie or body may influence the decision. The handler
    // does not even name the request object.
    for (const reachable of [
      'searchParams',
      'nextUrl',
      'request.headers',
      'request.url',
      'cookies',
      'public=true',
    ]) {
      expect(source).not.toContain(reachable);
    }
  });

  it('sends safe headers derived from verified metadata', async () => {
    const source = await read(route);

    expect(source).toContain('X-Content-Type-Options');
    expect(source).toContain('nosniff');
    expect(source).toContain('Content-Disposition');
    // A default-deny response must never enter a shared cache.
    expect(source).toMatch(/Cache-Control[^\n]*private/u);
    expect(source).toMatch(/Cache-Control[^\n]*no-store/u);
    expect(source).toContain('noindex');
  });

  it('is not locale-prefixed, so one object has one address', async () => {
    // Under `app/assets`, not `app/[locale]/...`.
    expect(route).not.toContain('[locale]');
  });
});

describe('Phase 7 introduces no business surface', () => {
  it('adds no owner column and no polymorphic reference to Asset', async () => {
    const schema = await read('packages/database/prisma/schema.prisma');
    const model = /model Asset \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? '';

    expect(model).not.toBe('');

    for (const forbidden of [
      'userId',
      'personId',
      'roleId',
      'ownerId',
      'targetType',
      'targetId',
      'User',
      'Person',
    ]) {
      expect(model, `Asset must not carry ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('stores no file bytes in SQL', async () => {
    const migration = await read(
      'packages/database/prisma/migrations/20260921000000_phase7_storage_foundation/migration.sql',
    );

    for (const forbidden of ['VARBINARY', 'FILESTREAM', ' IMAGE']) {
      expect(statements(migration).toUpperCase()).not.toContain(forbidden);
    }
  });

  it('builds no generic upload product', async () => {
    const appRoot = path.join(repoRoot, 'apps', 'web', 'src', 'app');
    const found: string[] = [];

    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (/^(upload|uploads|files|media-library|file-manager)$/u.test(entry.name)) {
            found.push(path.relative(repoRoot, full));
          }
          await walk(full);
        }
      }
    };

    await walk(appRoot);

    // StorageService is consumed later by owning domains. No anonymous upload
    // endpoint, no admin file manager, no media library in this phase.
    expect(found).toEqual([]);
  });

  it('introduces no S3 or cloud storage adapter', async () => {
    const manifest = await read('packages/storage/package.json');

    for (const forbidden of ['aws-sdk', 's3', 'azure', '@google-cloud']) {
      expect(manifest.toLowerCase()).not.toContain(forbidden);
    }
  });

  it('seeds no storage permission', async () => {
    const catalogue = await read('packages/contracts/src/identity/permissions.ts');
    const migration = await read(
      'packages/database/prisma/migrations/20260921000000_phase7_storage_foundation/migration.sql',
    );

    // Storage has no Identity dependency, so it has no permission vocabulary.
    expect(catalogue).not.toContain('storage.');
    expect(catalogue).not.toContain('asset.');
    expect(statements(migration)).not.toContain('Permission');
  });
});
