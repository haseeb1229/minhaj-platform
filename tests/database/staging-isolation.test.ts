import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createFilesystemStore,
  detectMediaType,
  isValidStorageKey,
} from '@minhaj/storage';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  assertIsolatedRestoreRoot,
  seedStagingFixture,
  STAGING_SEED_ASSET_ID,
  STAGING_SEED_BYTE_SIZE,
  STAGING_SEED_BYTES,
  STAGING_SEED_CHECKSUM,
  STAGING_SEED_STORAGE_KEY,
  STAGING_SEED_TEXT,
  verifyRestoredStorage,
} from '../../packages/database/src/lifecycle/staging-fixture.ts';

/**
 * Phase 28 — what the staging tooling reads, what the seed is, and that the
 * restore proof's storage half reads an ISOLATED copy and fails closed.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const scriptsDirectory = path.join(repoRoot, 'packages', 'database', 'scripts');
const lifecycleDirectory = path.join(
  repoRoot,
  'packages',
  'database',
  'src',
  'lifecycle',
);

async function stagingSources(): Promise<{ file: string; source: string }[]> {
  const scripts = (await readdir(scriptsDirectory))
    .filter((name) => name.startsWith('staging-'))
    .map((name) => path.join(scriptsDirectory, name));
  const modules = (await readdir(lifecycleDirectory))
    .filter((name) => name.startsWith('staging-'))
    .map((name) => path.join(lifecycleDirectory, name));
  return Promise.all(
    [...scripts, ...modules].map(async (file) => ({
      file: path.relative(repoRoot, file),
      source: await readFile(file, 'utf8'),
    })),
  );
}

/** Import specifiers only — comments may legitimately NAME `docker/.env`. */
function importsOf(source: string): string[] {
  return [...source.matchAll(/^\s*import\s+(?:[^'"]*?from\s*)?['"]([^'"]+)['"]/gmu)].map(
    ([, specifier]) => specifier ?? '',
  );
}

/** Source with comments removed, for behaviour-level string checks. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '');
}

describe('staging commands take configuration from the process environment only', () => {
  it('finds every staging command and module', async () => {
    const files = (await stagingSources()).map((entry) =>
      entry.file.replaceAll('\\', '/'),
    );
    for (const expected of [
      'bootstrap',
      'inspect',
      'create',
      'migrate',
      'provision',
      'seed',
      'backup',
      'restore-proof',
      'reset',
    ]) {
      expect(files).toContain(`packages/database/scripts/staging-${expected}.ts`);
    }
    // A vacuous pass over an empty list would prove nothing.
    // Nine commands (bootstrap included) and three lifecycle modules.
    expect(files.length).toBeGreaterThanOrEqual(12);
  });

  it('never imports the local bootstrap or the local environment loader', async () => {
    for (const { file, source } of await stagingSources()) {
      for (const specifier of importsOf(source)) {
        expect(specifier, `${file} imports ${specifier}`).not.toMatch(
          /local-bootstrap|local-environment|local-target/,
        );
      }
    }
  });

  it('never reads docker/.env or any env file', async () => {
    for (const { file, source } of await stagingSources()) {
      const body = code(source);
      expect(body, file).not.toMatch(
        /docker\/\.env|docker[/\\]['"]?,\s*['"]\.env|\.env['"]/,
      );
      expect(body, file).not.toMatch(/readFileSync|--env-file|dotenv/);
    }
  });

  it('wires every command into package.json without an env-file flag', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      scripts: Record<string, string>;
    };
    for (const name of [
      'inspect',
      'create',
      'migrate',
      'provision',
      'seed',
      'backup',
      'restore-proof',
      'reset',
    ]) {
      expect(manifest.scripts[`staging:db:${name}`]).toBe(
        `node --conditions=react-server packages/database/scripts/staging-${name}.ts`,
      );
    }
  });
});

describe('the staging seed fixture', () => {
  it('is the fixed synthetic sentence and nothing else', () => {
    expect(STAGING_SEED_TEXT).toBe(
      'One Minhaj staging synthetic recovery fixture - not content. Safe to delete.',
    );
    const text = new TextDecoder().decode(STAGING_SEED_BYTES);
    expect(text).toContain(`(${STAGING_SEED_TEXT}) Tj`);
    // The only string literal in the PDF is the sentence.
    expect([...text.matchAll(/\(([^)]*)\)/gu)].map(([, literal]) => literal)).toEqual([
      STAGING_SEED_TEXT,
    ]);
  });

  it('is deterministic: fixed bytes, size, checksum, key and id', () => {
    expect(createHash('sha256').update(STAGING_SEED_BYTES).digest('hex')).toBe(
      STAGING_SEED_CHECKSUM,
    );
    expect(STAGING_SEED_BYTE_SIZE).toBe(STAGING_SEED_BYTES.byteLength);
    expect(STAGING_SEED_BYTE_SIZE).toBe(652);
    expect(STAGING_SEED_CHECKSUM).toBe(PINNED_CHECKSUM);
    expect(STAGING_SEED_STORAGE_KEY).toBe('5e/ed/5eed0000000000000000000000002800');
    expect(isValidStorageKey(STAGING_SEED_STORAGE_KEY)).toBe(true);
    expect(STAGING_SEED_ASSET_ID).toBe('5eed0000-0000-4000-8000-000000002800');
  });

  it('sniffs as a PDF through the real storage sniffer', () => {
    expect(detectMediaType(STAGING_SEED_BYTES)).toBe('application/pdf');
  });

  it('contains no religious term and no personal data', () => {
    const text = new TextDecoder().decode(STAGING_SEED_BYTES).toLowerCase();
    for (const term of [
      'quran',
      'qur',
      'hadith',
      'allah',
      'islam',
      'muslim',
      'prophet',
      'fatwa',
      'surah',
      'ayah',
      'sunnah',
      'mosque',
      'prayer',
      'scholar',
      '@',
    ]) {
      expect(text, term).not.toContain(term);
    }
  });
});

/**
 * Pinned so an accidental change to the fixture bytes is a visible test
 * change, not a silent re-baselining of every staging environment's seed.
 */
const PINNED_CHECKSUM =
  '997d0e7b9cd3ff3c3c09a45a311fcb4fabaceed44a47431b4aad20a2b348d5a3';

describe('restore storage root isolation', () => {
  let base: string;

  beforeAll(async () => {
    base = await mkdtemp(path.join(os.tmpdir(), 'minhaj-staging-roots-'));
    await mkdir(path.join(base, 'live'), { recursive: true });
    await mkdir(path.join(base, 'restore'), { recursive: true });
  });

  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('accepts two separate existing roots', async () => {
    await expect(
      assertIsolatedRestoreRoot(path.join(base, 'live'), path.join(base, 'restore')),
    ).resolves.toBeDefined();
  });

  it.each([
    ['the same path', 'live', 'live'],
    ['the same path spelled differently', 'live', `live${path.sep}.`],
    ['a restore root inside the live root', 'live', path.join('live', 'copy')],
    ['a restore root containing the live root', path.join('restore', 'inner'), 'restore'],
  ])('refuses %s', async (_label, live, restore) => {
    await mkdir(path.join(base, live), { recursive: true });
    await mkdir(path.join(base, restore), { recursive: true });
    await expect(
      assertIsolatedRestoreRoot(path.join(base, live), path.join(base, restore)),
    ).rejects.toThrow(/STORAGE_ROOT/);
  });

  it('refuses a restore root that is a link to the live root', async (context) => {
    const link = path.join(base, 'link-to-live');
    try {
      await symlink(path.join(base, 'live'), link, 'junction');
    } catch {
      context.skip('this host cannot create a directory link');
    }
    await expect(
      assertIsolatedRestoreRoot(path.join(base, 'live'), link),
    ).rejects.toThrow(/through a link/);
  });

  it('refuses a missing restore root and relative or unset roots', async () => {
    await expect(
      assertIsolatedRestoreRoot(path.join(base, 'live'), path.join(base, 'absent')),
    ).rejects.toThrow(/does not exist/);
    await expect(
      assertIsolatedRestoreRoot('relative', path.join(base, 'restore')),
    ).rejects.toThrow(/absolute/);
    await expect(
      assertIsolatedRestoreRoot(path.join(base, 'live'), undefined),
    ).rejects.toThrow(/MINHAJ_RESTORE_STORAGE_ROOT/);
  });
});

describe('restored storage verification fails closed', () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'minhaj-staging-restore-'));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  function restored(rows: unknown[]): SqlSession {
    return {
      query: async <Row>() => rows as Row[],
      runScript: async () => undefined,
      execute: async () => undefined,
      close: async () => undefined,
    };
  }

  it('verifies matching bytes and reports every mismatch', async () => {
    const files = await createFilesystemStore(root);
    await files.write(
      STAGING_SEED_STORAGE_KEY,
      (async function* () {
        yield STAGING_SEED_BYTES;
      })(),
      STAGING_SEED_BYTE_SIZE,
    );

    const report = await verifyRestoredStorage(
      restored([
        {
          id: 'fixture',
          storageKey: STAGING_SEED_STORAGE_KEY,
          byteSize: STAGING_SEED_BYTE_SIZE,
          checksum: STAGING_SEED_CHECKSUM,
        },
        {
          id: 'wrong-size',
          storageKey: STAGING_SEED_STORAGE_KEY,
          byteSize: STAGING_SEED_BYTE_SIZE + 1,
          checksum: STAGING_SEED_CHECKSUM,
        },
        {
          id: 'wrong-hash',
          storageKey: STAGING_SEED_STORAGE_KEY,
          byteSize: STAGING_SEED_BYTE_SIZE,
          checksum: '0'.repeat(64),
        },
        {
          id: 'missing',
          storageKey: 'ab/cd/abcd0000000000000000000000000000',
          byteSize: 1,
          checksum: '0'.repeat(64),
        },
        {
          id: 'unmeasured',
          storageKey: STAGING_SEED_STORAGE_KEY,
          byteSize: null,
          checksum: null,
        },
        { id: 'bad-key', storageKey: '../escape', byteSize: 1, checksum: '0'.repeat(64) },
      ]),
      files,
    );

    expect(report.durableAssets).toBe(6);
    expect(report.verified).toBe(1);
    expect(report.failures.map((failure) => failure.assetId)).toEqual([
      'wrong-size',
      'wrong-hash',
      'missing',
      'unmeasured',
      'bad-key',
    ]);
  });
});

describe('the seed never marks a row clean without a clean verdict', () => {
  it('leaves the fixture quarantined when the scanner is unavailable', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'minhaj-staging-seed-'));
    try {
      const files = await createFilesystemStore(root);
      const statements: string[] = [];
      const live: SqlSession = {
        query: async <Row>(statement: string) => {
          statements.push(statement);
          return [] as Row[];
        },
        runScript: async () => undefined,
        execute: async () => undefined,
        close: async () => undefined,
      };

      await expect(
        seedStagingFixture(live, files, {
          scan: async () => ({ status: 'unavailable' }),
        }),
      ).rejects.toThrow(/stays quarantined/);

      expect(statements.some((statement) => statement.includes("N'quarantined'"))).toBe(
        true,
      );
      expect(
        statements.some((statement) => statement.includes("[state] = N'clean'")),
      ).toBe(false);
      // The bytes landed through the storage package's own write path, exactly.
      expect(
        await files.verify(STAGING_SEED_STORAGE_KEY, {
          byteSize: STAGING_SEED_BYTE_SIZE,
          checksum: STAGING_SEED_CHECKSUM,
        }),
      ).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
