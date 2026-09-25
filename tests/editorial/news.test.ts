import { describe, expect, it } from 'vitest';

import {
  NEWS_KINDS,
  editorialContentSchemaFor,
  isReservedNewsSlug,
  mediaCoverageSourceSchema,
  newsKindOfSegment,
  newsListPathOf,
  newsPathOf,
  newsSourceUrlSchema,
  safeSourceHref,
} from '../../packages/contracts/src/editorial/index.ts';

/**
 * Phase 13 — the News contract's pure rules: the outbound source policy, the
 * reserved `/news` siblings, each family's strict content shape and the
 * canonical address helpers. The workflow, SQL and Search behaviour is proved
 * against real SQL Server in `news.integration.test.ts` and
 * `tests/search/news.integration.test.ts`.
 */

const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
const translation = {
  languageCode: 'en',
  title: 'Synthetic title',
  excerpt: '',
  seoTitle: '',
  seoDescription: '',
  document,
};
const base = {
  slug: 'synthetic-news',
  primaryLanguage: 'en',
  translations: [translation],
  topicIds: [],
  contributors: [],
};

describe('the coverage source address', () => {
  it('accepts an HTTPS address and stores its normalised form', () => {
    expect(newsSourceUrlSchema.parse('  HTTPS://Outlet.Example.Invalid/a b  ')).toBe(
      'https://outlet.example.invalid/a%20b',
    );
    expect(safeSourceHref('https://outlet.example.invalid/story?id=1#part')).toBe(
      'https://outlet.example.invalid/story?id=1#part',
    );
  });

  it.each([
    'http://outlet.example.invalid/story',
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,hello',
    'file:///etc/passwd',
    '//outlet.example.invalid/story',
    '/relative/path',
    'https://user:secret@outlet.example.invalid/',
    'https://:secret@outlet.example.invalid/',
    'mailto:someone@example.invalid',
    'https://',
    '',
  ])('refuses %j', (value) => {
    expect(safeSourceHref(value)).toBeNull();
    expect(newsSourceUrlSchema.safeParse(value).success).toBe(false);
  });

  it('never throws on malformed input', () => {
    expect(() => newsSourceUrlSchema.safeParse('http://[::1')).not.toThrow();
    expect(newsSourceUrlSchema.safeParse('https://[::1').success).toBe(false);
  });

  it('requires an outlet, and a real calendar date where a date is given', () => {
    const ok = { outlet: 'Synthetic Outlet', sourceUrl: null, sourceDate: null };
    expect(mediaCoverageSourceSchema.safeParse(ok).success).toBe(true);
    expect(mediaCoverageSourceSchema.safeParse({ ...ok, outlet: ' ' }).success).toBe(
      false,
    );
    expect(
      mediaCoverageSourceSchema.safeParse({ ...ok, sourceDate: '2031-02-30' }).success,
    ).toBe(false);
    expect(
      mediaCoverageSourceSchema.safeParse({ ...ok, sourceDate: '2031-02-28' }).success,
    ).toBe(true);
    expect(mediaCoverageSourceSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('each family’s content is strict', () => {
  it('refuses another family’s fields and unknown fields', () => {
    const issuer = { ...base, translations: [{ ...translation, issuer: 'Office' }] };
    const coverage = {
      ...base,
      coverage: { outlet: 'Outlet', sourceUrl: null, sourceDate: null },
    };
    for (const kind of ['article', 'page', 'news-article', 'press-release'] as const) {
      expect(editorialContentSchemaFor(kind).safeParse(base).success, kind).toBe(true);
      expect(editorialContentSchemaFor(kind).safeParse(issuer).success, kind).toBe(false);
      expect(editorialContentSchemaFor(kind).safeParse(coverage).success, kind).toBe(
        false,
      );
    }
    expect(editorialContentSchemaFor('statement').safeParse(issuer).success).toBe(true);
    expect(editorialContentSchemaFor('statement').safeParse(base).success).toBe(false);
    expect(editorialContentSchemaFor('media-coverage').safeParse(coverage).success).toBe(
      true,
    );
    expect(editorialContentSchemaFor('media-coverage').safeParse(base).success).toBe(
      false,
    );
    for (const kind of NEWS_KINDS)
      expect(
        editorialContentSchemaFor(kind).safeParse({ ...base, isFeatured: true }).success,
        kind,
      ).toBe(false);
  });

  it('keeps a NewsArticle out of the reserved /news siblings, and only a NewsArticle', () => {
    for (const reserved of [
      'archive',
      'press-releases',
      'statements',
      'media-coverage',
    ]) {
      expect(isReservedNewsSlug(reserved)).toBe(true);
      expect(
        editorialContentSchemaFor('news-article').safeParse({ ...base, slug: reserved })
          .success,
      ).toBe(false);
      expect(
        editorialContentSchemaFor('press-release').safeParse({ ...base, slug: reserved })
          .success,
      ).toBe(true);
    }
    expect(isReservedNewsSlug('latest-developments')).toBe(false);
  });
});

describe('canonical addresses', () => {
  it('places each family beneath its own listing, and a NewsArticle at /news/{slug}', () => {
    expect(newsPathOf('news-article', 'a-b')).toBe('/news/a-b');
    expect(newsPathOf('press-release', 'a-b')).toBe('/news/press-releases/a-b');
    expect(newsPathOf('statement', 'a-b')).toBe('/news/statements/a-b');
    expect(newsPathOf('media-coverage', 'a-b')).toBe('/news/media-coverage/a-b');
    expect(newsPathOf('statement', 'خبر-ایک')).toBe(
      `/news/statements/${encodeURIComponent('خبر-ایک')}`,
    );
    expect(newsListPathOf('news-article')).toBe('/news');
    expect(newsKindOfSegment('statements')).toBe('statement');
    expect(newsKindOfSegment('archive')).toBeNull();
    expect(newsKindOfSegment('latest')).toBeNull();
  });
});
