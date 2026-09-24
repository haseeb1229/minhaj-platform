import { describe, expect, it } from 'vitest';

import {
  applyPlaylistChange,
  formatDuration,
  isoDuration,
  isProviderThumbnail,
  MEDIA_LIMITS,
  parseDuration,
  parseProviderReference,
  playlistChangeSchema,
  PROVIDER_EMBED_ORIGINS,
  providerEmbedUrl,
  providerWatchUrl,
  seriesInputSchema,
  videoInputSchema,
  videoQuerySchema,
} from '../../packages/contracts/src/media/index.ts';

/**
 * Phase 10 — the Media contracts at the trust boundary.
 *
 * THE PROVIDER BOUNDARY IS THE ONE THAT MATTERS MOST. An operator never supplies
 * a frame, an embed address or a player URL: only a provider and an identifier
 * or one of that provider's own ordinary watch addresses. Everything below
 * proves the hostile shapes are refused and every rendered address is derived.
 *
 * Every identifier and title here is synthetic.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const YT = 'dQw4w9WgXcQ';

describe('provider references', () => {
  it('accepts a bare identifier and the provider’s own ordinary addresses', () => {
    for (const input of [
      YT,
      `https://www.youtube.com/watch?v=${YT}`,
      `https://youtube.com/watch?v=${YT}&t=42`,
      `https://m.youtube.com/watch?v=${YT}`,
      `https://youtu.be/${YT}`,
      `https://www.youtube.com/embed/${YT}`,
      `https://www.youtube-nocookie.com/embed/${YT}`,
      `https://www.youtube.com/shorts/${YT}`,
      `https://www.youtube.com/live/${YT}`,
      `  https://youtu.be/${YT}  `,
    ]) {
      expect(parseProviderReference('youtube', input), input).toBe(YT);
    }
    for (const input of [
      '76979871',
      'https://vimeo.com/76979871',
      'https://www.vimeo.com/76979871',
      'https://player.vimeo.com/video/76979871',
    ]) {
      expect(parseProviderReference('vimeo', input), input).toBe('76979871');
    }
  });

  it('refuses every hostile or foreign shape rather than normalising it', () => {
    for (const input of [
      '',
      'javascript:alert(1)',
      `javascript://youtube.com/watch?v=${YT}`,
      `data:text/html,<iframe src="https://www.youtube.com/embed/${YT}">`,
      `<iframe src="https://www.youtube-nocookie.com/embed/${YT}"></iframe>`,
      `http://www.youtube.com/watch?v=${YT}`,
      `https://user:pass@www.youtube.com/watch?v=${YT}`,
      `https://www.youtube.com:8443/watch?v=${YT}`,
      `https://evil.example/watch?v=${YT}`,
      `https://youtube.com.evil.example/watch?v=${YT}`,
      `https://www.youtube.com/watch?v=${YT}x`,
      `https://www.youtube.com/watch?v=short`,
      `https://www.youtube.com/embed/${YT}/extra`,
      `https://www.youtube.com/playlist?list=PL123`,
      'dQw4w9WgXc!',
      `${YT} `.repeat(40),
    ]) {
      expect(parseProviderReference('youtube', input), input).toBeNull();
    }
    for (const input of [
      '0123',
      '1234567890123',
      'https://vimeo.com/76979871/abcdef1234',
      'https://vimeo.com/76979871?h=abcdef1234',
      'https://player.vimeo.com/video/76979871?h=abcdef1234',
      'https://vimeo.com/channels/staffpicks/76979871',
      'https://vimeo.evil.example/76979871',
      `https://www.youtube.com/watch?v=${YT}`,
    ]) {
      expect(parseProviderReference('vimeo', input), input).toBeNull();
    }
    // A YouTube identifier is not a Vimeo one, and the reverse.
    expect(parseProviderReference('vimeo', YT)).toBeNull();
    expect(parseProviderReference('youtube', '76979871')).toBeNull();
  });

  it('derives every rendered address, privacy-enhanced and without autoplay', () => {
    expect(providerEmbedUrl('youtube', YT)).toBe(
      `https://www.youtube-nocookie.com/embed/${YT}?rel=0`,
    );
    expect(providerEmbedUrl('vimeo', '76979871')).toBe(
      'https://player.vimeo.com/video/76979871?dnt=1',
    );
    expect(providerWatchUrl('youtube', YT)).toBe(`https://www.youtube.com/watch?v=${YT}`);
    expect(providerWatchUrl('vimeo', '76979871')).toBe('https://vimeo.com/76979871');
    for (const provider of ['youtube', 'vimeo'] as const) {
      const embed = new URL(
        providerEmbedUrl(provider, provider === 'youtube' ? YT : '1'),
      );
      expect(embed.origin).toBe(PROVIDER_EMBED_ORIGINS[provider]);
      expect(embed.searchParams.has('autoplay')).toBe(false);
    }
  });

  it('holds a thumbnail to the provider’s own image host, and to THIS video', () => {
    expect(
      isProviderThumbnail('youtube', YT, `https://i.ytimg.com/vi/${YT}/hqdefault.jpg`),
    ).toBe(true);
    expect(
      isProviderThumbnail(
        'vimeo',
        '1',
        'https://i.vimeocdn.com/video/452001751-8b1768af_640',
      ),
    ).toBe(true);
    for (const url of [
      `https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${YT}/hqdefault.jpg?x=1`,
      `http://i.ytimg.com/vi/${YT}/hqdefault.jpg`,
      `https://i.ytimg.com.evil.example/vi/${YT}/hqdefault.jpg`,
      `https://evil.example/vi/${YT}/hqdefault.jpg`,
      `https://i.ytimg.com/vi/${YT}/hqdefault.svg`,
    ]) {
      expect(isProviderThumbnail('youtube', YT, url), url).toBe(false);
    }
    expect(
      isProviderThumbnail(
        'youtube',
        YT,
        'https://i.vimeocdn.com/video/452001751-8b1768af_640',
      ),
    ).toBe(false);
  });
});

const video = (overrides: Record<string, unknown> = {}) => ({
  slug: 'synthetic-video',
  primaryLocale: 'en',
  state: 'published',
  isFeatured: false,
  provider: 'youtube',
  providerReference: `https://youtu.be/${YT}`,
  availability: 'available',
  format: 'lecture',
  languageCode: 'ur',
  labels: [{ locale: 'en', title: 'Synthetic lecture', description: '' }],
  durationSeconds: 3600,
  publishedOn: '2021-02-03',
  thumbnailUrl: null,
  captions: false,
  transcript: null,
  seriesId: null,
  seriesPosition: null,
  speakerIds: [ID(1)],
  topicIds: [ID(2)],
  ...overrides,
});

describe('the Video input', () => {
  it('reduces what was typed to provider + identifier, and nothing else', () => {
    const parsed = videoInputSchema.parse(video());
    expect(parsed.providerVideoId).toBe(YT);
    expect(parsed).not.toHaveProperty('providerReference');
  });

  it('refuses a reference that is not this provider’s, and any unnamed field', () => {
    expect(
      videoInputSchema.safeParse(video({ providerReference: 'javascript:alert(1)' }))
        .success,
    ).toBe(false);
    expect(
      videoInputSchema.safeParse(
        video({ provider: 'vimeo', providerReference: `https://youtu.be/${YT}` }),
      ).success,
    ).toBe(false);
    expect(
      videoInputSchema.safeParse(video({ embedHtml: '<iframe src="x">' })).success,
    ).toBe(false);
    expect(videoInputSchema.safeParse(video({ provider: 'dailymotion' })).success).toBe(
      false,
    );
  });

  it('keeps an episode position exactly when there is a Series', () => {
    expect(videoInputSchema.safeParse(video({ seriesId: ID(3) })).success).toBe(false);
    expect(videoInputSchema.safeParse(video({ seriesPosition: 2 })).success).toBe(false);
    expect(
      videoInputSchema.safeParse(video({ seriesId: ID(3), seriesPosition: 2 })).success,
    ).toBe(true);
  });

  it('bounds every fact and refuses a thumbnail from anywhere else', () => {
    for (const overrides of [
      { durationSeconds: 0 },
      { durationSeconds: MEDIA_LIMITS.durationSeconds + 1 },
      { durationSeconds: Number.NaN },
      { publishedOn: '2021-13-01' },
      { thumbnailUrl: 'https://evil.example/x.jpg' },
      { speakerIds: [ID(1), ID(1)] },
      {
        speakerIds: Array.from({ length: MEDIA_LIMITS.speakers + 1 }, (_, i) =>
          ID(i + 10),
        ),
      },
      { labels: [{ locale: 'ur', title: 'x', description: '' }] },
      { labels: [] },
      { format: 'sermon' },
      { availability: 'broken' },
      { slug: 'Not A Slug' },
      { transcript: '' },
    ]) {
      expect(
        videoInputSchema.safeParse(video(overrides)).success,
        JSON.stringify(overrides),
      ).toBe(false);
    }
    expect(
      videoInputSchema.safeParse(
        video({ thumbnailUrl: `https://i.ytimg.com/vi/${YT}/maxresdefault.jpg` }),
      ).success,
    ).toBe(true);
  });

  it('knows a Series kind is series or programme, and nothing else', () => {
    const base = {
      slug: 'synthetic-series',
      primaryLocale: 'en',
      state: 'draft',
      labels: [{ locale: 'en', title: 'Synthetic', description: '' }],
    };
    expect(seriesInputSchema.safeParse({ ...base, kind: 'program' }).success).toBe(true);
    expect(seriesInputSchema.safeParse({ ...base, kind: 'lecture' }).success).toBe(false);
  });

  it('narrows a public listing by known filters only', () => {
    expect(videoQuerySchema.parse({})).toMatchObject({ offset: 0, featured: false });
    expect(videoQuerySchema.safeParse({ state: 'draft' }).success).toBe(false);
    expect(videoQuerySchema.safeParse({ topic: 'not-a-uuid' }).success).toBe(false);
  });
});

describe('durations', () => {
  it('reads h:mm:ss, m:ss and seconds, and refuses anything else', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('1:02:03')).toBe(3723);
    expect(parseDuration('4:05')).toBe(245);
    expect(parseDuration('90')).toBe(90);
    for (const input of ['1:2:3', '4:61', 'an hour', '-5', '1.5']) {
      expect(Number.isNaN(parseDuration(input)), input).toBe(true);
    }
  });

  it('formats for the form and for structured data', () => {
    expect(formatDuration(3723)).toBe('1:02:03');
    expect(formatDuration(245)).toBe('4:05');
    expect(isoDuration(3723)).toBe('PT1H2M3S');
    expect(isoDuration(3600)).toBe('PT1H');
    expect(isoDuration(45)).toBe('PT45S');
  });
});

describe('a Playlist’s order', () => {
  const [a, b, c] = [ID(1), ID(2), ID(3)];

  it('adds at the end, moves one place, and removes', () => {
    expect(applyPlaylistChange([a, b], { op: 'add', videoId: c })).toEqual({
      videoIds: [a, b, c],
    });
    expect(
      applyPlaylistChange([a, b, c], { op: 'move', videoId: c, direction: 'earlier' }),
    ).toEqual({ videoIds: [a, c, b] });
    expect(
      applyPlaylistChange([a, b, c], { op: 'move', videoId: a, direction: 'later' }),
    ).toEqual({ videoIds: [b, a, c] });
    expect(applyPlaylistChange([a, b, c], { op: 'remove', videoId: b })).toEqual({
      videoIds: [a, c],
    });
  });

  it('refuses a duplicate, an absent member, a move past an end and a full list', () => {
    expect(applyPlaylistChange([a], { op: 'add', videoId: a })).toEqual({
      refusal: 'duplicate-member',
    });
    expect(applyPlaylistChange([a], { op: 'remove', videoId: b })).toEqual({
      refusal: 'invalid',
    });
    expect(
      applyPlaylistChange([a, b], { op: 'move', videoId: a, direction: 'earlier' }),
    ).toEqual({ refusal: 'invalid' });
    const full = Array.from({ length: MEDIA_LIMITS.playlistVideos }, (_, i) =>
      ID(i + 100),
    );
    expect(applyPlaylistChange(full, { op: 'add', videoId: a })).toEqual({
      refusal: 'limit',
    });
  });

  it('accepts only the three named changes', () => {
    expect(playlistChangeSchema.safeParse({ op: 'replace', videoIds: [a] }).success).toBe(
      false,
    );
    expect(
      playlistChangeSchema.safeParse({ op: 'move', videoId: a, direction: 'sideways' })
        .success,
    ).toBe(false);
  });
});
