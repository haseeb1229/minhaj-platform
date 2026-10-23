import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MigrationFetchPort, PendingItem } from '@minhaj/contracts/migration';

import {
  EXPORT_ROW_CONTENT_TYPE,
  createFixtureExportAdapter,
  exportRowKey,
} from '../../../scripts/migration/adapters/fixture-export.ts';
import {
  openSyntheticExport,
  type SyntheticExportSource,
} from '../../../scripts/migration/export/export-source.ts';

/**
 * The synthetic executable legacy export (Phase-29 decision 14): executed into
 * an in-memory node:sqlite database, read through the export adapter, and
 * never anything to do with the target schema or the network.
 */

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
const exportDirectory = path.join(repoRoot, 'scripts', 'migration', 'export');

let source: SyntheticExportSource;

beforeEach(() => {
  source = openSyntheticExport();
});

afterEach(() => {
  source.close();
});

/** A fetcher that fails the test if an export ever reaches for the network. */
function forbiddenFetcher() {
  const fetch = vi.fn<MigrationFetchPort['fetch']>(() =>
    Promise.reject(new Error('no network in an export')),
  );
  return { fetcher: { fetcherKey: 'forbidden', fetcherVersion: '1', fetch }, fetch };
}

function pending(externalKey: string): PendingItem {
  return {
    itemId: '00000000-0000-4000-8000-0000000000aa',
    recordId: '00000000-0000-4000-8000-0000000000bb',
    externalKey,
    originalUrl: null,
    legacyIdentifier: null,
    attempts: 0,
    latestSnapshot: null,
    currentStaged: null,
  };
}

describe('the export is an in-memory source, not the target', () => {
  it('loads every synthetic row', () => {
    const insertions = readFileSync(
      path.join(exportDirectory, 'synthetic-export.sql'),
      'utf8',
    ).match(/^INSERT INTO legacy_video /gm);
    expect(source.rows(0, 100)).toHaveLength(insertions?.length ?? -1);
    expect(source.rows(0, 100)).toHaveLength(10);
  });

  it('pages by id', () => {
    expect(source.rows(0, 3).map((row) => row.id)).toEqual([1, 2, 3]);
    expect(source.rows(3, 3).map((row) => row.id)).toEqual([4, 5, 6]);
    expect(source.rows(10, 3)).toEqual([]);
    expect(() => source.rows(-1, 3)).toThrow();
    expect(() => source.rows(0, 1000)).toThrow();
  });

  it('writes no database file anywhere near the dump', () => {
    const before = readdirSync(exportDirectory).sort();
    const second = openSyntheticExport();
    second.rows(0, 10);
    second.close();
    expect(readdirSync(exportDirectory).sort()).toEqual(before);
    expect(
      before.filter((name) => /\.(db|sqlite|sqlite3|db-journal|db-wal)$/i.test(name)),
    ).toEqual([]);
  });

  it('shares no table name with the target schema', () => {
    const prisma = readFileSync(
      path.join(repoRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
      'utf8',
    );
    const targetNames = new Set(
      [
        ...prisma.matchAll(/^model\s+(\w+)/gm),
        ...prisma.matchAll(/@@map\("([^"]+)"\)/g),
      ].map((match) => match[1]!.toLowerCase()),
    );
    expect(targetNames.size).toBeGreaterThan(10);

    const tables = source.tables();
    expect(tables).toEqual(['legacy_video']);
    for (const table of tables) {
      expect(targetNames.has(table.toLowerCase())).toBe(false);
      expect(table).not.toMatch(/^(video|migration|account|user|session)/i);
    }
  });
});

describe('the export adapter', () => {
  it('declares an export source', () => {
    expect(createFixtureExportAdapter(source)).toMatchObject({
      adapterKey: 'fixture-export',
      parserKey: 'json-fixture-export',
      contentKind: 'media.video',
      accessMethod: 'export',
    });
  });

  it('discovers every row by id cursor without touching the fetcher', async () => {
    const adapter = createFixtureExportAdapter(source);
    const { fetcher, fetch } = forbiddenFetcher();

    const result = await adapter.discover(null, fetcher);

    expect(result).toEqual({
      kind: 'page',
      items: Array.from({ length: 10 }, (_, index) => ({
        externalKey: `export://fixture/legacy_video/${index + 1}`,
        originalUrl: null,
        legacyIdentifier: String(index + 1),
      })),
      next: null,
    });
    expect(await adapter.discover('10', fetcher)).toEqual({
      kind: 'page',
      items: [],
      next: null,
    });
    await expect(adapter.discover('x', fetcher)).rejects.toThrow(/cursor/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retrieves a row as canonical JSON evidence, identical on every reading', async () => {
    const adapter = createFixtureExportAdapter(source);
    const { fetcher, fetch } = forbiddenFetcher();

    const first = await adapter.retrieve(pending(exportRowKey(3)), fetcher);
    const again = await createFixtureExportAdapter(source).retrieve(
      pending(exportRowKey(3)),
      fetcher,
    );

    expect(first).toMatchObject({
      kind: 'evidence',
      requestedUrl: 'export://fixture/legacy_video/3',
      finalUrl: 'export://fixture/legacy_video/3',
      httpStatus: null,
      contentType: EXPORT_ROW_CONTENT_TYPE,
      headers: {},
    });
    if (first.kind !== 'evidence' || again.kind !== 'evidence')
      throw new Error('expected evidence');
    expect(Buffer.from(first.body).equals(Buffer.from(again.body))).toBe(true);
    const text = new TextDecoder().decode(first.body);
    expect(text.startsWith('{"body_html":')).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('round-trips every row through retrieve and parse', async () => {
    const adapter = createFixtureExportAdapter(source);
    const { fetcher } = forbiddenFetcher();
    const page = await adapter.discover(null, fetcher);
    if (page.kind !== 'page') throw new Error('expected a page');

    const results = [];
    for (const item of page.items) {
      const evidence = await adapter.retrieve(pending(item.externalKey), fetcher);
      if (evidence.kind !== 'evidence') throw new Error('expected evidence');
      results.push(adapter.parse(evidence));
    }

    expect(results.every((result) => result.kind === 'parsed')).toBe(true);
    expect(results[0]).toEqual({
      kind: 'parsed',
      record: {
        kind: 'media.video',
        title: 'FIXTURE برآمد خطاب ۱ (فکسچر)',
        primaryLocale: 'ur',
        languageCode: 'ur',
        provider: 'youtube',
        providerReference: 'FIXTUREe001',
        labels: [
          { locale: 'en', title: 'FIXTURE Export lecture 1', descriptionHtml: '' },
        ],
        descriptionHtml:
          '<p>FIXTURE export body 1 with <a href="/videos/v001.html">a legacy link</a>.</p>',
        publishedOn: '2012-01-05',
        durationSeconds: 1200,
        legacyIdentifier: '1',
        categories: [{ key: 'fixture-lectures', label: 'FIXTURE Lectures' }],
        links: ['/videos/v001.html'],
        assets: [],
      },
    });
    expect(results[2]).toMatchObject({
      record: {
        primaryLocale: 'en',
        provider: 'vimeo',
        providerReference: '910000003',
        labels: [],
      },
    });
    expect(results[4]).toMatchObject({
      record: { descriptionHtml: expect.stringContaining('<script>') as unknown },
    });
    expect(results[8]).toMatchObject({
      record: { provider: null, providerReference: null, categories: [] },
    });
  });

  it('reports a vanished row as not found and an alien key as out of scope', async () => {
    const adapter = createFixtureExportAdapter(source);
    const { fetcher } = forbiddenFetcher();

    expect(await adapter.retrieve(pending(exportRowKey(99)), fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 404 },
    });
    expect(
      await adapter.retrieve(
        pending('http://videos.fixture.invalid/videos/v001.html'),
        fetcher,
      ),
    ).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'refused', classification: 'scope-refused' },
    });
  });

  it('fails evidence that is not an export row', () => {
    const adapter = createFixtureExportAdapter(source);
    const finalUrl = exportRowKey(1);
    const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
    const row = source.row(1)!;

    expect(
      adapter.parse({ body: encode(row), contentType: 'application/json', finalUrl }),
    ).toMatchObject({
      kind: 'failed',
    });
    expect(
      adapter.parse({
        body: encode({ ...row, account_password: 'x' }),
        contentType: EXPORT_ROW_CONTENT_TYPE,
        finalUrl,
      }),
    ).toEqual({ kind: 'failed', detail: 'export-row-malformed' });
    expect(
      adapter.parse({
        body: encode({ ...row, title_ur: 5 }),
        contentType: EXPORT_ROW_CONTENT_TYPE,
        finalUrl,
      }),
    ).toEqual({ kind: 'failed', detail: 'export-row-malformed' });
    expect(
      adapter.parse({
        body: new TextEncoder().encode('{'),
        contentType: EXPORT_ROW_CONTENT_TYPE,
        finalUrl,
      }),
    ).toEqual({ kind: 'failed', detail: 'export-row-malformed' });
    expect(
      adapter.parse({
        body: encode({ ...row, lang: 'xx' }),
        contentType: EXPORT_ROW_CONTENT_TYPE,
        finalUrl,
      }),
    ).toEqual({ kind: 'failed', detail: 'primary-locale-invalid' });
  });
});
