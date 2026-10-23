import { describe, expect, it } from 'vitest';

import {
  stagedVideoPayloadSchema,
  type ParsedVideo,
} from '../../packages/contracts/src/migration/index.ts';
import {
  crossLanguage,
  normalizeVideo,
  providerVideoId,
  videoProvider,
} from '../../apps/web/src/contexts/migration-provenance/domain/video.ts';

const NOW = new Date('2026-10-20T00:00:00Z');

const PARSED: ParsedVideo = Object.freeze({
  kind: 'media.video',
  title: '  Lecture on Patience  ',
  primaryLocale: 'en',
  languageCode: 'en',
  provider: 'YouTube',
  providerReference: 'https://youtu.be/dQw4w9WgXcQ',
  labels: [
    {
      locale: 'ur',
      title: 'صبر پر خطاب',
      descriptionHtml: '<p>اردو <script>x</script>تفصیل</p>',
    },
  ],
  descriptionHtml: '<p>On <strong>patience</strong>.<script>alert(1)</script></p>',
  publishedOn: '2019-05-01',
  durationSeconds: 3600,
  legacyIdentifier: 'lec-42',
  categories: [],
  links: [],
  assets: [],
});

const normalise = (
  overrides: Partial<ParsedVideo> = {},
  defaultLanguageCode: string | null = null,
) =>
  normalizeVideo({
    parsed: { ...PARSED, ...overrides },
    defaultLanguageCode,
    legacyIdentifier: null,
    externalKey: 'https://videos.fixture.invalid/videos/42',
    rewrite: (href) => href,
    now: NOW,
  });

describe('provider references', () => {
  it('parses YouTube ids from an id, watch, youtu.be and embed URLs', () => {
    for (const reference of [
      'dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=10',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ])
      expect(providerVideoId('youtube', reference)).toBe('dQw4w9WgXcQ');
  });

  it('parses Vimeo numeric ids', () => {
    for (const reference of [
      '76979871',
      'https://vimeo.com/76979871',
      'https://player.vimeo.com/video/76979871',
    ])
      expect(providerVideoId('vimeo', reference)).toBe('76979871');
  });

  it('refuses look-alikes rather than guessing', () => {
    for (const reference of [
      'dQw4w9WgXc',
      'https://evil.example/watch?v=dQw4w9WgXcQ',
      'https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ',
      'https://user@www.youtube.com/watch?v=dQw4w9WgXcQ',
      'javascript:alert(1)',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ!',
    ])
      expect(providerVideoId('youtube', reference)).toBeNull();
    expect(providerVideoId('vimeo', 'https://vimeo.com/abc')).toBeNull();
    expect(providerVideoId('vimeo', 'https://youtu.be/76979871')).toBeNull();
  });

  it('names providers case-insensitively, and only the carried ones', () => {
    expect(videoProvider(' YouTube ')).toBe('youtube');
    expect(videoProvider('dailymotion')).toBeNull();
  });
});

describe('normalizeVideo', () => {
  it('produces a valid, sanitised payload', () => {
    const result = normalise();
    expect(result.issues).toEqual([]);
    expect(stagedVideoPayloadSchema.safeParse(result.payload).success).toBe(true);
    expect(result.payload).toMatchObject({
      slug: 'lec-42',
      provider: 'youtube',
      providerVideoId: 'dQw4w9WgXcQ',
      languageCode: 'en',
      descriptionHtml: '<p>On <strong>patience</strong>.</p>',
    });
    expect(result.payload.labels).toEqual([
      { locale: 'en', title: 'Lecture on Patience', description: 'On patience.' },
      { locale: 'ur', title: 'صبر پر خطاب', description: 'اردو تفصیل' },
    ]);
    expect(result.dedupeKey).toBe('youtube:dQw4w9WgXcQ');
    expect(result.personalData).toBe(false);
  });

  it.each<[string, Partial<ParsedVideo>, string]>([
    ['title-missing', { title: '   ' }, 'title-missing'],
    ['title-too-long', { title: 'x'.repeat(241) }, 'title-too-long'],
    ['language-missing', { languageCode: null }, 'language-missing'],
    ['language-invalid', { languageCode: 'English' }, 'language-invalid'],
    ['provider-missing', { provider: null }, 'provider-missing'],
    ['provider-invalid', { provider: 'dailymotion' }, 'provider-invalid'],
    [
      'provider-id-invalid',
      { providerReference: 'https://evil.example/v/1' },
      'provider-id-invalid',
    ],
    ['provider-id missing', { providerReference: null }, 'provider-id-invalid'],
    [
      'primary-label-missing',
      { primaryLocale: 'fr' as ParsedVideo['primaryLocale'] },
      'primary-label-missing',
    ],
    ['a future date', { publishedOn: '2027-01-01' }, 'date-implausible'],
    ['an impossible date', { publishedOn: '2019-02-30' }, 'date-implausible'],
    ['an unformatted date', { publishedOn: '01/05/2019' }, 'date-implausible'],
    ['an ancient date', { publishedOn: '1850-01-01' }, 'date-implausible'],
    ['a zero duration', { durationSeconds: 0 }, 'duration-invalid'],
    ['a fractional duration', { durationSeconds: 1.5 }, 'duration-invalid'],
    [
      'a long description',
      { descriptionHtml: `<p>${'w '.repeat(2100)}</p>` },
      'description-too-long',
    ],
  ])('reports %s as an issue', (_name, overrides, issue) => {
    expect(normalise(overrides).issues).toContain(issue);
  });

  it('never auto-corrects: an invalid value stays what the source said or absent', () => {
    const result = normalise({
      publishedOn: '01/05/2019',
      durationSeconds: 0,
      languageCode: 'English',
      provider: 'dailymotion',
    });
    expect(result.payload.publishedOn).toBe('01/05/2019');
    expect(result.payload.durationSeconds).toBe(0);
    expect(result.payload.languageCode).toBe('English');
    expect(result.languageCode).toBeNull();
    expect(result.payload.provider).toBe('dailymotion');
    expect(result.payload.providerVideoId).toBeNull();
    expect(result.dedupeKey).toBeNull();
  });

  it('uses the source declared default language only when the record names none', () => {
    expect(normalise({ languageCode: null }, 'ur').languageCode).toBe('ur');
    expect(normalise({ languageCode: 'en' }, 'ur').languageCode).toBe('en');
  });

  it('flags and redacts personal data in titles and descriptions', () => {
    const result = normalise({
      title: 'Call +92 300 1234567',
      descriptionHtml: '<p>Write to a.b@example.org</p>',
    });
    expect(result.personalData).toBe(true);
    expect(JSON.stringify(result.payload)).not.toMatch(/1234567|example\.org/);
    expect(result.title).toBe('Call [redacted]');
  });

  it('keeps a row title for an untitled record without inventing payload words', () => {
    const result = normalise({ title: '', legacyIdentifier: null });
    expect(result.title).toBe('https://videos.fixture.invalid/videos/42');
    expect(result.payload.labels[0]?.title).toBe('');
  });

  it('keeps the first label per locale', () => {
    const result = normalise({
      labels: [
        { locale: 'en', title: 'Duplicate English', descriptionHtml: '' },
        { locale: 'ar', title: 'محاضرة', descriptionHtml: '' },
        { locale: 'ar', title: 'ثانية', descriptionHtml: '' },
      ],
    });
    expect(result.payload.labels.map((label) => label.locale)).toEqual(['en', 'ar']);
    expect(result.payload.labels[1]?.title).toBe('محاضرة');
  });
});

describe('crossLanguage', () => {
  it('compares primary language subtags when both are known', () => {
    expect(crossLanguage('ur', 'en')).toBe(true);
    expect(crossLanguage('ur', 'ur-PK')).toBe(false);
    expect(crossLanguage(null, 'en')).toBe(false);
  });
});
