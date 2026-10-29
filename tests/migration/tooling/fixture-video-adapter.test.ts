import { createHash } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FetchOutcome,
  MigrationFetchPort,
  PendingItem,
} from '@minhaj/contracts/migration';

import {
  createFixtureVideoAdapter,
  FIXTURE_VIDEO_ADAPTER_KEY,
} from '../../../scripts/migration/adapters/fixture-video.ts';
import {
  FIXTURE_BASE_VIDEO_COUNT,
  FIXTURE_HOSTILE_HTML,
  FIXTURE_PERSONAL_EMAIL,
  startFixtureServer,
  type FixtureServer,
} from '../../../scripts/migration/fixture-server.ts';
import { createFixtureFetcher } from '../../../scripts/migration/safe-fetch.ts';

import { fixtureSource } from './support.ts';

/**
 * The fixture video adapter, against the local fixture site only: discovery,
 * retrieval and Cheerio parsing. Sanitisation is NOT this layer's job, so a
 * hostile page must come through exactly as the source wrote it.
 */

let server: FixtureServer;
let fetcher: MigrationFetchPort;
const adapter = createFixtureVideoAdapter();

beforeAll(async () => {
  server = await startFixtureServer({ pageSize: 5 });
  fetcher = createFixtureFetcher(fixtureSource(), server.endpoint);
});

afterAll(async () => {
  await server.close();
});

beforeEach(() => {
  server.control.reset();
});

const pageUrl = (id: string) => `http://videos.fixture.invalid/videos/${id}.html`;

function pending(id: string): PendingItem {
  return {
    itemId: '00000000-0000-4000-8000-0000000000aa',
    recordId: '00000000-0000-4000-8000-0000000000bb',
    externalKey: pageUrl(id),
    originalUrl: pageUrl(id),
    legacyIdentifier: id,
    attempts: 0,
    latestSnapshot: null,
    currentStaged: null,
  };
}

async function discoverAll() {
  const pages: { items: string[]; next: string | null }[] = [];
  let cursor: string | null = null;
  do {
    const result = await adapter.discover(cursor, fetcher);
    if (result.kind !== 'page')
      throw new Error(`discovery stopped: ${JSON.stringify(result.outcome)}`);
    pages.push({
      items: result.items.map((item) => item.legacyIdentifier ?? ''),
      next: result.next,
    });
    cursor = result.next;
  } while (cursor !== null);
  return pages;
}

async function parsed(id: string) {
  const evidence = await adapter.retrieve(pending(id), fetcher);
  if (evidence.kind !== 'evidence') throw new Error('expected evidence');
  return adapter.parse(evidence);
}

describe('identity', () => {
  it('declares what it is', () => {
    expect(adapter).toMatchObject({
      adapterKey: FIXTURE_VIDEO_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-fixture-video',
      parserVersion: '1',
      contentKind: 'media.video',
      accessMethod: 'http',
    });
  });

  it('refuses a base URL that is not a fixture host', () => {
    expect(() =>
      createFixtureVideoAdapter({ baseUrl: 'https://www.example.org/' }),
    ).toThrow();
  });
});

describe('discovery', () => {
  it('paginates deterministically, cursor = next page number', async () => {
    const first = await discoverAll();
    const second = await discoverAll();

    expect(first).toEqual(second);
    expect(first.map((page) => page.next)).toEqual(['2', '3', null]);
    expect(first.flatMap((page) => page.items)).toEqual(
      Array.from(
        { length: FIXTURE_BASE_VIDEO_COUNT },
        (_, index) => `v${String(index + 1).padStart(3, '0')}`,
      ),
    );
  });

  it('keys items by canonical URL and never queues a link to another host', async () => {
    const result = await adapter.discover(null, fetcher);
    if (result.kind !== 'page') throw new Error('expected a page');

    expect(result.items[0]).toEqual({
      externalKey: pageUrl('v001'),
      originalUrl: pageUrl('v001'),
      legacyIdentifier: 'v001',
    });
    // Page 1 of the fixture index also links to archive.fixture.invalid.
    expect(
      result.items.every((item) =>
        item.externalKey.startsWith('http://videos.fixture.invalid/'),
      ),
    ).toBe(true);
  });

  it('reflects disappearance and optional records', async () => {
    server.control.hide('v003');
    server.control.enable('duplicates');

    const items = (await discoverAll()).flatMap((page) => page.items);

    expect(items).not.toContain('v003');
    expect(items).toContain('x-dup-same');
    expect(items).toContain('x-dup-cross');
    expect(items).toHaveLength(FIXTURE_BASE_VIDEO_COUNT - 1 + 2);
  });

  it('hands a failed index fetch back as the outcome', async () => {
    server.control.setStatus('/videos/index.html?page=2', 503, { times: 1 });

    expect(await adapter.discover('2', fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 503 },
    });
  });

  it('refuses an index it cannot recognise rather than reporting an empty, complete page', async () => {
    const page: FetchOutcome = {
      kind: 'response',
      status: 200,
      requestedUrl: 'http://videos.fixture.invalid/videos/index.html?page=1',
      finalUrl: 'http://videos.fixture.invalid/videos/index.html?page=1',
      contentType: 'text/html; charset=utf-8',
      headers: {},
      body: new TextEncoder().encode(
        '<!doctype html><title>FIXTURE redesigned</title><div>no list</div>',
      ),
      retryAfter: null,
    };
    const fake: MigrationFetchPort = {
      fetcherKey: 'fake',
      fetcherVersion: '1',
      fetch: vi.fn(() => Promise.resolve(page)),
    };

    expect(await adapter.discover(null, fake)).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'unsupported-type',
        detail: 'index-unrecognised',
      },
    });
  });

  it('refuses a malformed cursor', async () => {
    await expect(adapter.discover('../1', fetcher)).rejects.toThrow(/cursor/);
  });
});

describe('retrieval', () => {
  it('returns the exact bytes and provenance of a 200', async () => {
    const evidence = await adapter.retrieve(pending('v001'), fetcher);

    expect(evidence).toMatchObject({
      kind: 'evidence',
      requestedUrl: pageUrl('v001'),
      finalUrl: pageUrl('v001'),
      httpStatus: 200,
      contentType: 'text/html; charset=utf-8',
    });
  });

  it('hands anything but a 200 back as the outcome', async () => {
    server.control.setStatus('/videos/v002.html', 429, { retryAfter: '7' });

    expect(await adapter.retrieve(pending('v002'), fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 429, retryAfter: '7' },
    });
    expect(await adapter.retrieve(pending('x-hostile'), fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 404 },
    });
  });

  it('a content revision changes the evidence', async () => {
    const before = await adapter.retrieve(pending('v004'), fetcher);
    server.control.bumpVersion('v004');
    const after = await adapter.retrieve(pending('v004'), fetcher);
    if (before.kind !== 'evidence' || after.kind !== 'evidence')
      throw new Error('expected evidence');

    const digest = (body: Uint8Array) => createHash('sha256').update(body).digest('hex');
    expect(digest(after.body)).not.toBe(digest(before.body));
  });
});

describe('parsing with Cheerio', () => {
  it('extracts every field of a video page', async () => {
    const result = await parsed('v001');

    expect(result).toEqual({
      kind: 'parsed',
      record: {
        kind: 'media.video',
        title: 'FIXTURE نمونہ خطاب 1 (فکسچر)',
        primaryLocale: 'ur',
        languageCode: 'ur',
        provider: 'youtube',
        providerReference: 'FIXTUREv001',
        labels: [
          {
            locale: 'en',
            title: 'FIXTURE Sample lecture 1',
            descriptionHtml: '<p>FIXTURE synthetic English description 1.</p>',
          },
          {
            locale: 'ar',
            title: 'FIXTURE محاضرة تجريبية 1 (اختبار)',
            descriptionHtml: '<p>FIXTURE وصف عربي تجريبي 1 (اختبار)</p>',
          },
        ],
        descriptionHtml:
          '<p>FIXTURE synthetic description of lecture 1.</p><p>See <a href="/videos/v002.html">the next lecture</a>, <a href="/legacy/old-page-1.php?id=1">an unmapped legacy page</a> and <a href="https://external.example.invalid/reference/1">an external reference</a>.</p>',
        publishedOn: '2015-01-11',
        durationSeconds: 660,
        legacyIdentifier: 'v001',
        categories: [{ key: 'fixture-lectures', label: 'FIXTURE Lectures' }],
        links: [
          '/videos/v002.html',
          '/legacy/old-page-1.php?id=1',
          'https://external.example.invalid/reference/1',
        ],
        assets: [
          {
            url: 'http://videos.fixture.invalid/files/poster-v001.png',
            licence: 'organisation-owned',
            licenceEvidence: 'FIXTURE licence record 1',
            rightsHolder: 'FIXTURE Organisation',
          },
        ],
        // The fixture adapter names no poster: its asset stays an acquisition.
        poster: null,
      },
    });
  });

  it('reads a vimeo record and several categories', async () => {
    const result = await parsed('v012');
    if (result.kind !== 'parsed') throw new Error('expected a record');

    expect(result.record).toMatchObject({
      primaryLocale: 'ar',
      provider: 'vimeo',
      providerReference: '900000012',
      categories: [
        { key: 'fixture-spirituality', label: 'FIXTURE Spirituality' },
        { key: 'fixture-youth', label: 'FIXTURE Youth' },
      ],
    });
  });

  it('declares two assets with identical bytes under different licences', async () => {
    const result = await parsed('v005');
    if (result.kind !== 'parsed') throw new Error('expected a record');
    expect(result.record.assets).toEqual([
      {
        url: 'http://videos.fixture.invalid/files/poster-copy.png',
        licence: 'third-party',
        licenceEvidence: 'FIXTURE third-party notice',
        rightsHolder: 'FIXTURE Third Party',
      },
    ]);

    const copy = await fetcher.fetch(
      'http://videos.fixture.invalid/files/poster-copy.png',
    );
    const original = await fetcher.fetch(
      'http://videos.fixture.invalid/files/poster-v001.png',
    );
    if (copy.kind !== 'response' || original.kind !== 'response')
      throw new Error('expected responses');
    expect(Buffer.from(copy.body).equals(Buffer.from(original.body))).toBe(true);
  });

  it('passes hostile markup through EXACTLY as written — sanitising is normalisation’s job', async () => {
    server.control.enable('hostile');
    const result = await parsed('x-hostile');
    if (result.kind !== 'parsed') throw new Error('expected a record');

    expect(result.record.descriptionHtml).toBe(FIXTURE_HOSTILE_HTML);
    expect(result.record.links).toEqual([
      'javascript:void(0)',
      'data:text/html;base64,PHA+RklYVFVSRTwvcD4=',
      'https://external.example.invalid/ok',
    ]);
  });

  it('carries synthetic personal data through for normalisation to flag', async () => {
    server.control.enable('personal-data');
    const result = await parsed('x-personal');
    if (result.kind !== 'parsed') throw new Error('expected a record');

    expect(result.record.descriptionHtml).toContain(FIXTURE_PERSONAL_EMAIL);
  });

  it('reflects a content revision in the parsed words', async () => {
    server.control.bumpVersion('v002');
    const result = await parsed('v002');
    if (result.kind !== 'parsed') throw new Error('expected a record');

    expect(result.record.title).toBe('FIXTURE Sample lecture 2 r2');
    expect(result.record.descriptionHtml).toContain('FIXTURE revision 2 note.');
  });

  it('excludes a page that is not a video', async () => {
    server.control.enable('not-a-video');
    expect(await parsed('x-article')).toEqual({
      kind: 'excluded',
      reason: 'not-a-video',
    });
  });

  it('fails a malformed page', async () => {
    server.control.enable('malformed');
    expect(await parsed('x-malformed')).toEqual({
      kind: 'failed',
      detail: 'record-structure-missing',
    });
  });

  it('fails a body that is not UTF-8 HTML', () => {
    const finalUrl = pageUrl('v001');
    expect(
      adapter.parse({
        body: new Uint8Array([0x7b, 0x7d]),
        contentType: 'application/json',
        finalUrl,
      }),
    ).toEqual({
      kind: 'failed',
      detail: 'unsupported-content-type',
    });
    expect(
      adapter.parse({
        body: new Uint8Array([0x3c, 0xff, 0xfe]),
        contentType: 'text/html; charset=utf-8',
        finalUrl,
      }),
    ).toEqual({ kind: 'failed', detail: 'invalid-utf8' });
    expect(
      adapter.parse({
        body: new Uint8Array([0x3c]),
        contentType: 'text/html; charset=windows-1256',
        finalUrl,
      }),
    ).toEqual({
      kind: 'failed',
      detail: 'unsupported-charset',
    });
  });
});
