import { describe, expect, it } from 'vitest';

import {
  LIBRARY_DOWNLOADS_PAGE,
  LIBRARY_TOPIC_TOTALS_MAX,
  libraryDownloadsQuerySchema,
  librarySalePointQuerySchema,
  type LibraryPublicReaderPort,
} from '../../packages/contracts/src/library/index.ts';
import { createLibraryReadService } from '../../apps/web/src/contexts/library/index.ts';

/**
 * Library Part 2 — the browse and access reads at the trust boundary: every
 * input is parsed by the read service BEFORE any read, so a malformed Topic,
 * an unknown order, an over-long search or an offset past the bound reaches
 * no query; an empty ask reads nothing; and the defaults are stated.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

function harness() {
  const asked: { method: string; input: unknown }[] = [];
  const record =
    (method: string, answer: unknown) =>
    async (input?: unknown): Promise<unknown> => {
      asked.push({ method, input });
      return answer;
    };
  const reader = {
    holdings: record('holdings', {}),
    topicHoldings: record('topicHoldings', []),
    languageHoldings: record('languageHoldings', []),
    contributorDirectory: record('contributorDirectory', { items: [], hasMore: false }),
    downloads: record('downloads', { items: [], total: 0, hasMore: false }),
    downloadFacets: record('downloadFacets', {}),
    salePointDirectory: record('salePointDirectory', {}),
  } as unknown as LibraryPublicReaderPort;
  return { reads: createLibraryReadService(reader), asked };
}

describe('the browse reads parse every input before any read', () => {
  it('states the downloads defaults, and passes a valid query through', async () => {
    expect(libraryDownloadsQuerySchema.parse({})).toEqual({
      language: null,
      topic: null,
      sort: 'title',
      titleLocale: null,
      offset: 0,
      limit: LIBRARY_DOWNLOADS_PAGE,
    });
    const { reads, asked } = harness();
    const query = {
      language: 'ur',
      topic: TOPIC,
      sort: 'newest',
      titleLocale: 'ar',
      offset: 24,
    };
    await reads.downloads(query);
    await reads.downloadFacets(query);
    expect(asked.map((entry) => entry.method)).toEqual(['downloads', 'downloadFacets']);
    expect(asked[0]?.input).toEqual({ ...query, limit: LIBRARY_DOWNLOADS_PAGE });
  });

  it('refuses a malformed download query before reading', async () => {
    const { reads, asked } = harness();
    for (const bad of [
      { language: "ur'; DROP TABLE Edition;--" },
      { topic: 'not-a-topic' },
      { sort: 'price' },
      { titleLocale: 'fr' },
      { offset: -1 },
      { offset: 25_001 },
      { limit: LIBRARY_DOWNLOADS_PAGE + 1 },
      { downloads: true },
    ])
      expect(() => reads.downloads(bad)).toThrow();
    expect(asked).toEqual([]);
  });

  it('states the sale-point defaults, trims a search and refuses a bad one', async () => {
    expect(librarySalePointQuerySchema.parse({})).toEqual({
      text: null,
      titleLocale: null,
      offset: 0,
    });
    const { reads, asked } = harness();
    await reads.salePointDirectory({ text: '  Lahore ' });
    expect(asked[0]?.input).toEqual({ text: 'Lahore', titleLocale: null, offset: 0 });
    for (const bad of [
      { text: '' },
      { text: 'x'.repeat(81) },
      { offset: 1.5 },
      { city: 'x' },
    ])
      expect(() => reads.salePointDirectory(bad)).toThrow();
    expect(asked).toHaveLength(1);
  });

  it('asks Topic holdings only for distinct, well-formed, bounded Topics', async () => {
    const { reads, asked } = harness();
    expect(await reads.topicHoldings([])).toEqual([]);
    expect(asked).toEqual([]);
    await expect(reads.topicHoldings(['nope'])).rejects.toThrow();
    await expect(reads.topicHoldings([TOPIC, TOPIC])).rejects.toThrow();
    await expect(
      reads.topicHoldings(
        Array.from(
          { length: LIBRARY_TOPIC_TOTALS_MAX + 1 },
          (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        ),
      ),
    ).rejects.toThrow();
    expect(asked).toEqual([]);
    await reads.topicHoldings([TOPIC]);
    expect(asked).toEqual([{ method: 'topicHoldings', input: [TOPIC] }]);
  });

  it('takes no input for the whole-Library reads', async () => {
    const { reads, asked } = harness();
    await reads.holdings();
    await reads.languageHoldings();
    await reads.contributorDirectory();
    expect(asked.map((entry) => entry.method)).toEqual([
      'holdings',
      'languageHoldings',
      'contributorDirectory',
    ]);
  });
});
