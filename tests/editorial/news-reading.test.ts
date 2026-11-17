import { describe, expect, it, vi } from 'vitest';

import {
  NEWS_PAGE,
  type EditorialPublicReaderPort,
} from '../../packages/contracts/src/editorial/index.ts';
import { createEditorialReadService } from '../../apps/web/src/contexts/editorial/application/public-service.ts';
import {
  CONTENTS_LIMIT,
  WORDS_PER_MINUTE,
  readingMinutes,
  revisedAfterPublication,
  withContents,
} from '../../apps/web/src/components/editorial/long-form.ts';

/**
 * R2 — the long-form reading rules of an Editorial record page, and the News
 * listings' content-language narrowing at the public read service.
 *
 * The contents list is derived from Editorial's SANITISED body, whose headings
 * carry no attributes; it may add an anchor this module generates and nothing
 * else, and it must never turn a heading's words into markup.
 */

describe('the contents of a long record', () => {
  it('lists second- and third-level headings and anchors exactly those', () => {
    const html =
      '<p>Opening.</p><h2>The first part</h2><p>One.</p><h3>A detail</h3><p>Two.</p><h2>The second part</h2><h4>Not listed</h4>';
    const { html: anchored, entries } = withContents(html);
    expect(entries).toEqual([
      { id: 'section-1', level: 2, text: 'The first part' },
      { id: 'section-2', level: 3, text: 'A detail' },
      { id: 'section-3', level: 2, text: 'The second part' },
    ]);
    expect(anchored).toBe(
      '<p>Opening.</p><h2 id="section-1">The first part</h2><p>One.</p><h3 id="section-2">A detail</h3><p>Two.</p><h2 id="section-3">The second part</h2><h4>Not listed</h4>',
    );
  });

  it('has no contents, and changes nothing, below two headings', () => {
    for (const html of ['<p>Only prose.</p>', '<h2>One heading</h2><p>Prose.</p>', ''])
      expect(withContents(html)).toEqual({ html, entries: [] });
  });

  it('reads a heading as plain text: markup stripped, references decoded, never re-encoded', () => {
    const { entries, html } = withContents(
      '<h2><strong>Faith</strong> &amp; <em>reason</em></h2><h2>&lt;script&gt;alert(1)&lt;/script&gt; &#x627;&#1585;</h2>',
    );
    expect(entries.map((entry) => entry.text)).toEqual([
      'Faith & reason',
      '<script>alert(1)</script> ار',
    ]);
    // The body keeps the sanitiser's escaped markup untouched.
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('leaves a heading that is not the sanitiser’s bare output alone and unlisted', () => {
    const html =
      '<h2 id="x" onclick="steal()">Attributed</h2><h2>Plain one</h2><h2>Plain two</h2>';
    const { html: anchored, entries } = withContents(html);
    expect(entries.map((entry) => entry.text)).toEqual(['Plain one', 'Plain two']);
    expect(anchored).toContain('<h2 id="x" onclick="steal()">Attributed</h2>');
  });

  it('skips an empty heading and stops listing at its bound', () => {
    expect(withContents('<h2> </h2><h2><br></h2><h2>Real</h2>').entries).toEqual([]);
    const many = Array.from(
      { length: CONTENTS_LIMIT + 5 },
      (_, i) => `<h2>Part ${i}</h2>`,
    );
    const { entries, html } = withContents(many.join(''));
    expect(entries).toHaveLength(CONTENTS_LIMIT);
    expect(html.match(/ id="/gu)).toHaveLength(CONTENTS_LIMIT);
  });
});

describe('the "Updated" date', () => {
  const published = new Date('2026-01-10T08:00:00Z');
  it('is shown only for a record revised more than a day after its publication', () => {
    expect(revisedAfterPublication(published, published)).toBe(false);
    expect(revisedAfterPublication(published, new Date('2026-01-11T07:59:59Z'))).toBe(
      false,
    );
    expect(revisedAfterPublication(published, new Date('2026-01-11T08:00:01Z'))).toBe(
      true,
    );
    // A clock skew backwards is never an update.
    expect(revisedAfterPublication(published, new Date('2026-01-01T00:00:00Z'))).toBe(
      false,
    );
  });
});

describe('the News listings’ content-language narrowing', () => {
  function stubReader() {
    const page = { items: [], more: false };
    const reader = {
      publishedNews: vi.fn(async () => page),
      newsTimeline: vi.fn(async () => page),
      newsArchivePeriods: vi.fn(async () => []),
    };
    return {
      reader,
      reads: createEditorialReadService(reader as unknown as EditorialPublicReaderPort),
    };
  }

  it('keeps a family’s plain chronology when nothing narrows or orders it', async () => {
    const { reader, reads } = stubReader();
    await reads.newsList('statement', 20);
    expect(reader.publishedNews).toHaveBeenCalledWith('statement', 20, NEWS_PAGE);
    expect(reader.newsTimeline).not.toHaveBeenCalled();
  });

  it('orders the interface language first, or narrows to one language, through the timeline', async () => {
    const { reader, reads } = stubReader();
    await reads.newsList('news-article', 0, { prefer: 'ur' });
    await reads.newsList('press-release', 40, { only: 'ar', prefer: 'en' });
    expect(reader.newsTimeline.mock.calls).toEqual([
      [
        {
          offset: 0,
          limit: NEWS_PAGE,
          year: null,
          month: null,
          topicId: null,
          kind: 'news-article',
          language: null,
          preferLanguage: 'ur',
        },
      ],
      [
        {
          offset: 40,
          limit: NEWS_PAGE,
          year: null,
          month: null,
          topicId: null,
          kind: 'press-release',
          // A narrowed list has nothing else to put after it.
          language: 'ar',
          preferLanguage: null,
        },
      ],
    ]);
    expect(reader.publishedNews).not.toHaveBeenCalled();
  });

  it('refuses a language, family or offset outside the accepted values before asking', async () => {
    const { reader, reads } = stubReader();
    await expect(
      reads.newsList('news-article', 0, { only: 'fr' as never }),
    ).rejects.toThrow();
    await expect(
      reads.newsList('news-article', 0, { prefer: "en' OR 1=1" as never }),
    ).rejects.toThrow();
    await expect(reads.newsList('event' as never, 0)).rejects.toThrow();
    await expect(reads.newsList('news-article', -20, { prefer: 'en' })).rejects.toThrow();
    await expect(reads.newsArchivePeriods({ kind: 'event' as never })).rejects.toThrow();
    expect(reader.newsTimeline).not.toHaveBeenCalled();
    expect(reader.publishedNews).not.toHaveBeenCalled();
    expect(reader.newsArchivePeriods).not.toHaveBeenCalled();
  });

  it('narrows the archive’s periods by family and language', async () => {
    const { reader, reads } = stubReader();
    await reads.newsArchivePeriods({ kind: 'statement', language: 'en' });
    await reads.newsArchivePeriods();
    expect(reader.newsArchivePeriods.mock.calls).toEqual([
      [{ kind: 'statement', language: 'en' }],
      [{ kind: null, language: null }],
    ]);
  });
});

describe('one News family’s listing at the public read service (News & Events Part 1)', () => {
  const TOPIC = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f';
  function stubReader() {
    const reader = {
      newsListing: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
      newsListingFacets: vi.fn(async () => ({})),
      newsNeighbours: vi.fn(async () => ({ newer: null, older: null })),
    };
    return {
      reader,
      reads: createEditorialReadService(reader as unknown as EditorialPublicReaderPort),
    };
  }

  it('asks for exactly the view, its defaults stated', async () => {
    const { reader, reads } = stubReader();
    await reads.newsListing({ kind: 'press-release' });
    await reads.newsListingFacets({
      kind: 'media-coverage',
      topic: TOPIC,
      year: 2024,
      month: 3,
      language: 'ur',
      outlet: '  Synthetic Outlet ',
      sort: 'oldest',
      offset: 40,
    });
    expect(reader.newsListing).toHaveBeenCalledWith({
      kind: 'press-release',
      topic: null,
      year: null,
      month: null,
      language: null,
      outlet: null,
      prefer: null,
      sort: 'newest',
      offset: 0,
      limit: NEWS_PAGE,
    });
    expect(reader.newsListingFacets).toHaveBeenCalledWith({
      kind: 'media-coverage',
      topic: TOPIC,
      year: 2024,
      month: 3,
      language: 'ur',
      // An outlet is trimmed as a record stores it.
      outlet: 'Synthetic Outlet',
      prefer: null,
      sort: 'oldest',
      offset: 40,
      limit: NEWS_PAGE,
    });
  });

  it('refuses every view outside the accepted values before asking', async () => {
    const { reader, reads } = stubReader();
    for (const query of [
      {},
      { kind: 'event' },
      { kind: 'statement', topic: 'not-a-uuid' },
      { kind: 'statement', topic: "x' OR 1=1 --" },
      { kind: 'statement', month: 3 }, // a month needs its year
      { kind: 'statement', year: 1899 },
      { kind: 'statement', year: 2024, month: 13 },
      { kind: 'statement', language: 'de' },
      { kind: 'statement', prefer: 'fr' },
      { kind: 'statement', outlet: 'Only coverage names one' },
      { kind: 'media-coverage', outlet: '   ' },
      { kind: 'media-coverage', outlet: 'x'.repeat(201) },
      { kind: 'statement', sort: 'title' },
      { kind: 'statement', offset: -1 },
      { kind: 'statement', offset: 25_001 },
      { kind: 'statement', limit: NEWS_PAGE + 1 },
      { kind: 'statement', unexpected: true },
    ]) {
      await expect(reads.newsListing(query), JSON.stringify(query)).rejects.toThrow();
      await expect(
        reads.newsListingFacets(query),
        JSON.stringify(query),
      ).rejects.toThrow();
    }
    expect(reader.newsListing).not.toHaveBeenCalled();
    expect(reader.newsListingFacets).not.toHaveBeenCalled();
  });

  it('asks a record’s neighbours only for a slug its family could hold', async () => {
    const { reader, reads } = stubReader();
    await reads.newsNeighbours('statement', 'a-statement');
    expect(reader.newsNeighbours).toHaveBeenCalledWith({
      kind: 'statement',
      slug: 'a-statement',
    });
    for (const [kind, slug] of [
      ['statement', 'Not-Lower'],
      ['statement', "x' OR 1=1"],
      ['statement', ''],
      // A NewsArticle can never hold a static sibling's slug.
      ['news-article', 'archive'],
    ] as const)
      expect(await reads.newsNeighbours(kind, slug), slug).toEqual({
        newer: null,
        older: null,
      });
    await expect(reads.newsNeighbours('event' as never, 'a-slug')).rejects.toThrow();
    expect(reader.newsNeighbours).toHaveBeenCalledTimes(1);
  });
});

describe('the reading time of a long record', () => {
  it('counts the words of the body as text, at least a minute, and nothing for no words', () => {
    const words = (count: number) =>
      Array.from({ length: count }, (_, index) => `word${index}`).join(' ');
    expect(readingMinutes(`<p>${words(10)}</p>`)).toBe(1);
    expect(readingMinutes(`<p>${words(WORDS_PER_MINUTE * 3)}</p>`)).toBe(3);
    // Block boundaries separate words; markup and punctuation alone are not words.
    expect(
      readingMinutes(
        `<h2>${words(WORDS_PER_MINUTE)}</h2><p>${words(WORDS_PER_MINUTE)}</p>`,
      ),
    ).toBe(2);
    for (const html of ['', '<p></p>', '<p> — … </p>', '<br><hr>'])
      expect(readingMinutes(html), html).toBeNull();
    // Urdu and Arabic words count as words.
    expect(readingMinutes('<p>یہ ایک خبر ہے</p><p>هذا خبر</p>')).toBe(1);
  });
});
