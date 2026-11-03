import { describe, expect, it } from 'vitest';

import type {
  EditorialPublicReaderPort,
  EditorialSearchRecord,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialSearchSources } from '../../apps/web/src/contexts/editorial/application/search-projection.ts';

/**
 * Editorial's search documents state the same date the record's own page
 * states: an Article and a News record their chronology year, a Page none
 * (Phase 30-RF: a Page shows no publication date, because the only one it has
 * is the day the platform published it — Phase 30-RV).
 */
const PUBLISHED = new Date('2026-10-30T12:00:00Z');
const SOURCE_DATE = new Date('2009-03-14T00:00:00Z');

function record(chronologyAt?: Date): EditorialSearchRecord {
  return {
    id: 'record-1',
    stamp: '3',
    publishedAt: PUBLISHED,
    ...(chronologyAt === undefined ? {} : { chronologyAt }),
    topicIds: [],
    translations: [
      {
        languageCode: 'en',
        title: 'Fixture title',
        excerpt: 'Fixture excerpt',
        document: JSON.stringify({ type: 'doc', content: [] }),
      },
    ],
  };
}

function sources(found: EditorialSearchRecord) {
  const reader = {
    searchArticle: () => Promise.resolve(found),
    searchPage: () => Promise.resolve(found),
    searchNews: () => Promise.resolve(found),
  } as unknown as EditorialPublicReaderPort;
  return createEditorialSearchSources(reader);
}

async function years(
  source: ReturnType<typeof sources>['page'],
): Promise<(number | null)[]> {
  const projection = await source.project('record-1');
  return (projection?.documents ?? []).map(
    (document) => (document as { year: number | null }).year,
  );
}

describe('Editorial search projection years', () => {
  it('states no year for a Page, even a migrated one with a source date', async () => {
    expect(await years(sources(record()).page)).toEqual([null]);
    expect(await years(sources(record(SOURCE_DATE)).page)).toEqual([null]);
  });

  it("states an Article's chronology year, else its publication year", async () => {
    expect(await years(sources(record(SOURCE_DATE)).article)).toEqual([2009]);
    expect(await years(sources(record()).article)).toEqual([2026]);
  });

  it("states a News record's chronology year", async () => {
    expect(await years(sources(record(SOURCE_DATE)).news['news-article'])).toEqual([
      2009,
    ]);
  });
});
