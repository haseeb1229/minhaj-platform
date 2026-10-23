import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { repoRoot } from './architecture-harness.ts';
import {
  ARCHITECTURAL_ROLES,
  layerZeroPersistentConcerns,
  prohibitedInContextPackages,
  workspaceRoles,
} from '../../packages/config/eslint/contexts.js';
import {
  SEARCH_KINDS,
  SEARCH_SCOPE_KINDS,
} from '../../packages/contracts/src/search/values.ts';

/**
 * Phase 17 boundaries — Search is Layer-0 infrastructure, and it stays there.
 *
 * The failure this file exists to prevent is Search quietly becoming a
 * seventeenth bounded context: owning a publication rule, reading an owner's
 * tables, growing a result kind for a domain that has not shipped, or letting
 * its engine's grammar leak above the adapter. Each is a property of the source
 * tree, so each is asserted against it.
 */

const read = (relative: string) => readFile(path.join(repoRoot, relative), 'utf8');

/** Source with comments and string literals removed, so prose cannot match. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, ' ')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1 ')
    .replace(/'(?:[^'\\\n]|\\.)*'/gu, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/gu, '""');
}

/** Every import specifier in a module. */
function imports(source: string): string[] {
  const statements = [
    // `import … from 'x'`, `export … from 'x'`, spanning lines.
    ...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+'([^']+)'/gmu),
    // `import 'x'` for its side effect.
    ...source.matchAll(/^\s*import\s+'([^']+)'/gmu),
    // `await import('x')`.
    ...source.matchAll(/\bimport\(\s*'([^']+)'\s*\)/gu),
  ];
  return statements.map((match) => match[1] ?? '');
}

async function filesUnder(relative: string, pattern = /\.(ts|tsx)$/u): Promise<string[]> {
  const found: string[] = [];
  async function visit(current: string): Promise<void> {
    for (const entry of await readdir(path.join(repoRoot, current), {
      withFileTypes: true,
    })) {
      const child = `${current}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== '.next') await visit(child);
      } else if (pattern.test(entry.name)) found.push(child);
    }
  }
  await visit(relative);
  return found;
}

describe('search is Layer 0, not a bounded context', () => {
  it('is a platform workspace whose state is a declared Layer-0 concern', async () => {
    expect(workspaceRoles['@minhaj/search']).toBe(ARCHITECTURAL_ROLES.PLATFORM);
    expect(layerZeroPersistentConcerns).toContain('search');

    const manifest = JSON.parse(await read('packages/database/package.json')) as {
      minhaj: { persistenceAdapters: { owners: Record<string, unknown> } };
    };
    expect(manifest.minhaj.persistenceAdapters.owners['search']).toEqual({
      kind: 'layer0',
      concern: 'search',
    });
  });

  it('creates no bounded context', async () => {
    const contexts = await readdir(path.join(repoRoot, 'apps', 'web', 'src', 'contexts'));
    expect(contexts).not.toContain('search');
    // The delivered contexts — Media joined at Phase 10, Global Network at
    // Phase 16, Quran at Phase 18, Hadith at Phase 19, Fatwa at Phase 20,
    // Personalisation & Notifications at Phase 21, Learning at Phase 22,
    // Membership at Phase 26, Donations at Phase 27, Migration & Provenance at
    // Phase 29 — and never one for Search.
    expect(contexts).toHaveLength(15);
  });

  it('depends on no bounded context and holds no database capability', async () => {
    for (const file of await filesUnder('packages/search/src')) {
      for (const specifier of imports(await read(file))) {
        expect(
          specifier.startsWith('@minhaj/contracts') ||
            specifier.startsWith('./') ||
            ['server-only', 'node:crypto'].includes(specifier),
          `${file} imports ${specifier}`,
        ).toBe(true);
      }
    }
  });

  it('is unreachable from every bounded context', async () => {
    expect(prohibitedInContextPackages['@minhaj/search']).toBeTypeOf('string');
    for (const file of await filesUnder('apps/web/src/contexts')) {
      for (const specifier of imports(await read(file))) {
        expect(
          specifier.startsWith('@minhaj/search'),
          `${file} imports ${specifier}`,
        ).toBe(false);
        expect(
          specifier.startsWith('@minhaj/database'),
          `${file} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });
});

describe('the engine stays behind its port', () => {
  it('confines full-text grammar to the SQL Server adapter', async () => {
    const files = [
      ...(await filesUnder('apps/web/src')),
      ...(await filesUnder('packages/search/src')),
      ...(await filesUnder('packages/contracts/src')),
      ...(await filesUnder('packages/database/src')),
    ];
    for (const file of files) {
      if (file === 'packages/database/src/adapters/search/index.ts') continue;
      const source = await read(file);
      for (const grammar of ['CONTAINSTABLE', 'FREETEXTTABLE', 'FORMSOF(', 'CONTAINS(']) {
        expect(source.includes(grammar), `${file} names ${grammar}`).toBe(false);
      }
    }
  });

  it('introduces no external search engine or vector store', async () => {
    const forbidden = [
      'elasticsearch',
      '@elastic/',
      '@opensearch-project/',
      'meilisearch',
      'algoliasearch',
      'typesense',
      '@azure/search-documents',
      'lunr',
      'flexsearch',
      'minisearch',
      '@pinecone-database/',
      'weaviate',
      'chromadb',
      '@qdrant/',
      '@zilliz/',
      'redis',
      'ioredis',
    ];
    const lock = JSON.parse(await read('package-lock.json')) as {
      packages: Record<string, unknown>;
    };
    for (const name of Object.keys(lock.packages)) {
      const bare = name.replace(/^.*node_modules\//u, '');
      expect(
        forbidden.some((entry) => bare === entry || bare.startsWith(entry)),
        `package-lock resolves ${bare}`,
      ).toBe(false);
    }
  });
});

describe('the inventory is closed — the delivered searchable domains and nothing later', () => {
  // Phase 17's initial seven, Phase 9's six scholarly and periodical kinds,
  // Phase 10's `video`, Phase 11's `audio`, Phase 13's four News families and
  // Phase 18's `quran-ayah`, Phase 19's `hadith`, Phase 20's `fatwa` and Phase
  // 22's `course` and `learning-path` — a Series, a Playlist or
  // an AudioSeries is a grouping, not a kind, a Quran recitation is not a
  // search result, and a Hadith variant, chain, grading or commentary is not a
  // result of its own, and neither is a Course module, a lesson, an Enrolment,
  // Progress or a trial request. A later searchable domain adds its own in its own
  // phase; none is pre-created.
  const EXPECTED = [
    'article',
    'audio',
    'book-translation',
    'course',
    'edition',
    'encyclopedia',
    'fatwa',
    'hadith',
    'learning-path',
    'magazine',
    'magazine-issue',
    'media-coverage',
    'news-article',
    'page',
    'person',
    'press-release',
    'publication',
    'quran-ayah',
    'research',
    'research-paper',
    'statement',
    'topic',
    'video',
    'work',
  ];
  /** An Edition and a translation are projected within their Work's scope. */
  const SCOPES = EXPECTED.filter(
    (kind) => kind !== 'edition' && kind !== 'book-translation',
  );

  it('declares exactly the delivered kinds', () => {
    expect([...SEARCH_KINDS].sort()).toEqual(EXPECTED);
  });

  it('holds the same kinds in the database constraint the latest migration set', async () => {
    const migration = await read(
      'packages/database/prisma/migrations/20261006000000_phase22_learning/migration.sql',
    );
    const constraint = /SearchDocument_kind_ck\] CHECK \(\[kind\] IN \(([^)]*)\)\)/u.exec(
      migration,
    );
    expect(constraint).not.toBeNull();
    const kinds = [...(constraint?.[1] ?? '').matchAll(/N'([^']+)'/gu)].map((m) => m[1]);
    expect(kinds.sort()).toEqual(EXPECTED);
  });

  it('labels exactly the same kinds in every interface locale', async () => {
    for (const locale of ['en', 'ur', 'ar']) {
      const catalogue = JSON.parse(await read(`apps/web/messages/${locale}.json`)) as {
        search: { kinds: Record<string, string> };
        admin: { search: { kinds: Record<string, string> } };
      };
      expect(Object.keys(catalogue.search.kinds).sort(), locale).toEqual(EXPECTED);
      // The operator view labels each SCOPE kind a failure can belong to.
      expect(Object.keys(catalogue.admin.search.kinds).sort(), locale).toEqual(SCOPES);
      expect([...SEARCH_SCOPE_KINDS].sort()).toEqual(SCOPES);
    }
  });
});

describe('owners commit indexing intent in their own transactions', () => {
  /**
   * WHERE an owner's public state can change, the owner records a request in
   * the same transaction. The live proofs show each transition reaching the
   * index; this keeps the call sites from being deleted unnoticed.
   */
  const OWNERS: readonly { file: string; minimum: number; why: string }[] = [
    {
      file: 'packages/database/src/adapters/taxonomy/persistence.ts',
      minimum: 4,
      why: 'create, translate, remove translation, change status',
    },
    {
      file: 'packages/database/src/adapters/people-contributors/persistence.ts',
      minimum: 2,
      why: 'the touch chokepoint, and publication status',
    },
    {
      file: 'packages/database/src/adapters/editorial/persistence.ts',
      minimum: 4,
      why: 'revise and transition, for Articles and Pages',
    },
    {
      file: 'packages/database/src/adapters/library/persistence.ts',
      minimum: 5,
      why: 'Work, Edition, translation save and removal, and linked sale points',
    },
    {
      file: 'packages/database/src/adapters/learning/catalogue.ts',
      minimum: 6,
      why: 'Course save, transition, module and lesson change; path save, transition and membership',
    },
  ];

  it.each(OWNERS)('$file requests indexing ($why)', async ({ file, minimum }) => {
    const body = code(await read(file));
    const calls = body.match(/requestSearchIndexing\(tx,/gu) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(minimum);
  });

  it('writes requests only through the one shared helper', async () => {
    for (const file of await filesUnder('packages/database/src')) {
      if (
        file === 'packages/database/src/search-intent.ts' ||
        file === 'packages/database/src/adapters/search/index.ts'
      ) {
        continue;
      }
      expect(code(await read(file)).includes('searchIndexRequest'), file).toBe(false);
    }
  });

  it('keeps the helper package-internal', async () => {
    const entry = await read('packages/database/src/index.ts');
    expect(entry.includes('search-intent')).toBe(false);
  });
});
