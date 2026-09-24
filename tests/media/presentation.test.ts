import { describe, expect, it } from 'vitest';

import {
  formatOfView,
  mediaLabel,
  playlistPathOf,
  readOffset,
  readVideoQuery,
  readWatchSort,
  seriesPathOf,
  videoPathOf,
  videoQueryPath,
  videoStructuredData,
  viewOfFormat,
  WATCH_VIEWS,
} from '../../apps/web/src/components/media/presentation.ts';

/**
 * Phase 10 — the Watch presentation decisions.
 *
 * PURE FUNCTIONS, proved without a server: which address a record has, what a
 * URL's query means, and what structured data a Video may truthfully claim. The
 * player's privacy gate is proved in the browser suite, where the requests a
 * page makes can actually be observed.
 */

const YT = 'dQw4w9WgXcQ';
const UUID = '00000000-0000-4000-8000-000000000001';

describe('addresses', () => {
  it('gives each record ONE canonical path, each segment encoded', () => {
    expect(videoPathOf('a-lecture')).toBe('/watch/videos/a-lecture');
    expect(seriesPathOf('series', 'a-series')).toBe('/watch/series/a-series');
    expect(seriesPathOf('program', 'a-series')).toBe('/watch/programs/a-series');
    expect(playlistPathOf('a b')).toBe('/watch/playlists/a%20b');
  });

  it('maps the five curated views to formats and back', () => {
    expect(WATCH_VIEWS).toEqual([
      'lectures',
      'events',
      'highlights',
      'interviews',
      'documentaries',
    ]);
    for (const view of WATCH_VIEWS) {
      const format = formatOfView(view);
      expect(format).not.toBeNull();
      expect(viewOfFormat(format!)).toBe(view);
    }
    expect(formatOfView('videos')).toBeNull();
    expect(formatOfView('audio')).toBeNull();
  });
});

describe('query state', () => {
  it('tolerates a malformed or repeated parameter as the unfiltered listing', () => {
    expect(
      readVideoQuery({
        topic: 'not-a-uuid',
        speaker: [UUID, UUID],
        series: '',
        language: 'english language',
        offset: '-4',
      }),
    ).toEqual({ offset: 0, topic: null, speaker: null, series: null, language: null });
  });

  it('keeps valid filters and omits neutral values from the address', () => {
    const filters = readVideoQuery({ topic: UUID, language: 'ur', offset: '24' });
    expect(filters).toEqual({
      offset: 24,
      topic: UUID,
      speaker: null,
      series: null,
      language: 'ur',
    });
    expect(videoQueryPath('/en/watch/videos', filters, { offset: 0 })).toBe(
      `/en/watch/videos?topic=${UUID}&language=ur`,
    );
    expect(videoQueryPath('/en/watch/videos', readVideoQuery({}))).toBe(
      '/en/watch/videos',
    );
  });

  it('reads the landing sort and a bounded offset', () => {
    expect(readWatchSort({})).toBe('featured');
    expect(readWatchSort({ sort: 'latest' })).toBe('latest');
    expect(readWatchSort({ sort: 'popular' })).toBe('featured');
    expect(readOffset({ offset: '48' })).toBe(48);
    expect(readOffset({ offset: '999999999' })).toBe(0);
  });

  it('resolves a label in the reader’s locale, then the primary one', () => {
    const record = {
      primaryLocale: 'ur' as const,
      labels: [
        { locale: 'ur' as const, title: 'آزمائشی', description: '' },
        { locale: 'en' as const, title: 'Synthetic', description: '' },
      ],
    };
    expect(mediaLabel(record, 'en').title).toBe('Synthetic');
    expect(mediaLabel(record, 'ar').title).toBe('آزمائشی');
  });
});

describe('VideoObject — only what is true', () => {
  const record = {
    provider: 'youtube' as const,
    providerVideoId: YT,
    availability: 'available' as const,
    thumbnailUrl: `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
    publishedOn: '2021-02-03',
    durationSeconds: 3723,
    languageCode: 'ur',
  };
  const label = {
    locale: 'en' as const,
    title: 'Synthetic lecture',
    description: 'A proof.',
  };

  it('claims the recorded facts and the privacy-enhanced embed', () => {
    expect(
      videoStructuredData(record, label, 'https://example.test/en/watch/videos/x'),
    ).toEqual({
      '@type': 'VideoObject',
      name: 'Synthetic lecture',
      description: 'A proof.',
      thumbnailUrl: record.thumbnailUrl,
      uploadDate: '2021-02-03',
      duration: 'PT1H2M3S',
      embedUrl: `https://www.youtube-nocookie.com/embed/${YT}?rel=0`,
      inLanguage: 'ur',
      url: 'https://example.test/en/watch/videos/x',
    });
  });

  it('omits an unknown fact rather than inventing one', () => {
    const minimal = videoStructuredData(
      { ...record, durationSeconds: null },
      { ...label, description: '' },
      'https://example.test/x',
    );
    expect(minimal).not.toHaveProperty('duration');
    expect(minimal).not.toHaveProperty('description');
  });

  it('claims NOTHING without a thumbnail, a date, or a provider that serves it', () => {
    for (const broken of [
      { ...record, thumbnailUrl: null },
      { ...record, publishedOn: null },
      { ...record, availability: 'unavailable' as const },
    ]) {
      expect(videoStructuredData(broken, label, 'https://example.test/x')).toBeNull();
    }
    expect(
      videoStructuredData(record, { ...label, title: '' }, 'https://x.test'),
    ).toBeNull();
  });
});
