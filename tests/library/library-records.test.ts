import { describe, expect, it } from 'vitest';

import type {
  LibraryPublicReaderPort,
  MagazineDirectoryQuery,
  MagazineIssuesQuery,
  PublishedRecordsQuery,
} from '../../packages/contracts/src/library/index.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Library Part 3 — the trust boundary of the published-records read
 * (`/library/publications`, `/library/encyclopedias`) and of the periodicals'
 * reads (a Magazine's issues, its year index, the directory). Every field is
 * parsed by Library's public read service BEFORE any read: a value that is
 * malformed, out of range or unknown reaches no adapter, and an accepted one
 * reaches it with every default stated.
 */

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';

function recording() {
  const seen: { method: string; query: unknown }[] = [];
  const note = (method: string, query: unknown, answer: unknown) => {
    seen.push({ method, query });
    return Promise.resolve(answer);
  };
  const reader = {
    publishedRecords: (query: PublishedRecordsQuery) =>
      note('publishedRecords', query, { items: [], total: 0, hasMore: false }),
    publishedRecordFacets: (query: PublishedRecordsQuery) =>
      note('publishedRecordFacets', query, {}),
    magazineIssuePage: (query: MagazineIssuesQuery) =>
      note('magazineIssuePage', query, { items: [], total: 0, hasMore: false }),
    magazineIssueFacets: (id: string) => note('magazineIssueFacets', id, {}),
    magazineDirectory: (query: MagazineDirectoryQuery) =>
      note('magazineDirectory', query, {}),
  } as unknown as LibraryPublicReaderPort;
  return { service: createLibraryReadService(reader), seen };
}

describe('the published-records read', () => {
  it('states every default for the smallest query', async () => {
    const { service, seen } = recording();
    await service.publishedRecords({ kind: 'publication' });
    await service.publishedRecordFacets({ kind: 'encyclopedia' });
    const expected = {
      topic: null,
      language: null,
      contributor: null,
      decade: null,
      fullText: false,
      sort: 'newest',
      titleLocale: null,
      offset: 0,
      limit: 24,
    };
    expect(seen).toEqual([
      { method: 'publishedRecords', query: { kind: 'publication', ...expected } },
      { method: 'publishedRecordFacets', query: { kind: 'encyclopedia', ...expected } },
    ]);
  });

  it('passes a full, valid query through unchanged', async () => {
    const { service, seen } = recording();
    const query = {
      kind: 'encyclopedia',
      topic: ID,
      language: 'ur-PK',
      contributor: ID,
      decade: 1990,
      fullText: true,
      sort: 'title',
      titleLocale: 'ar',
      offset: 25_000,
      limit: 1,
    };
    await service.publishedRecords(query);
    expect(seen[0]?.query).toEqual(query);
  });

  it.each([
    ['no kind at all', {}],
    ['a research kind', { kind: 'research' }],
    ['a periodical', { kind: 'magazine' }],
    ['a year that is no decade', { kind: 'publication', decade: 1995 }],
    ['a malformed Topic', { kind: 'publication', topic: 'quran' }],
    ['a malformed contributor', { kind: 'publication', contributor: "x' OR 1=1 --" }],
    ['a malformed language', { kind: 'publication', language: "ur'; DROP TABLE x;--" }],
    ['an unknown order', { kind: 'publication', sort: 'popular' }],
    ['an offset past the bound', { kind: 'publication', offset: 25_001 }],
    ['a page larger than the listing’s', { kind: 'publication', limit: 25 }],
    [
      'the hub’s scope, which this read has not',
      { kind: 'publication', scope: 'library' },
    ],
  ])('refuses %s before any read', (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.publishedRecords(raw)).toThrow();
    expect(() => service.publishedRecordFacets(raw)).toThrow();
    expect(seen).toEqual([]);
  });
});

describe('the periodicals’ reads', () => {
  it('states a Magazine page’s defaults, and passes a year or the undated view', async () => {
    const { service, seen } = recording();
    await service.magazineIssuePage({ magazineId: ID });
    await service.magazineIssuePage({ magazineId: ID, year: 2021, offset: 24 });
    await service.magazineIssuePage({ magazineId: ID, undated: true, limit: 1 });
    await service.magazineIssueFacets(ID);
    await service.magazineDirectory();
    await service.magazineDirectory({ topic: ID });
    expect(seen).toEqual([
      {
        method: 'magazineIssuePage',
        query: { magazineId: ID, year: null, undated: false, offset: 0, limit: 24 },
      },
      {
        method: 'magazineIssuePage',
        query: { magazineId: ID, year: 2021, undated: false, offset: 24, limit: 24 },
      },
      {
        method: 'magazineIssuePage',
        query: { magazineId: ID, year: null, undated: true, offset: 0, limit: 1 },
      },
      { method: 'magazineIssueFacets', query: ID },
      { method: 'magazineDirectory', query: { topic: null } },
      { method: 'magazineDirectory', query: { topic: ID } },
    ]);
  });

  it.each([
    ['no Magazine', {}],
    ['a malformed Magazine', { magazineId: 'monthly' }],
    ['a year and "undated" at once', { magazineId: ID, year: 2021, undated: true }],
    ['a year of zero', { magazineId: ID, year: 0 }],
    ['a year past 9999', { magazineId: ID, year: 10_000 }],
    ['a page larger than 24', { magazineId: ID, limit: 25 }],
    ['an offset past the bound', { magazineId: ID, offset: 25_001 }],
    ['a field it does not know', { magazineId: ID, state: 'draft' }],
  ])('refuses an issue page with %s before any read', (_name, raw) => {
    const { service, seen } = recording();
    expect(() => service.magazineIssuePage(raw)).toThrow();
    expect(seen).toEqual([]);
  });

  it('refuses a malformed Magazine or Topic before any read', () => {
    const { service, seen } = recording();
    expect(() => service.magazineIssueFacets('monthly')).toThrow();
    expect(() => service.magazineDirectory({ topic: 'quran' })).toThrow();
    expect(() => service.magazineDirectory({ topic: ID, language: 'ur' })).toThrow();
    expect(seen).toEqual([]);
  });
});
