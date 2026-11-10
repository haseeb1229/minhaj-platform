import { SURAH_AYAH_COUNTS } from '@minhaj/contracts/migration';
import { tieTranslationNotes } from '@minhaj/contracts/quran';
import { describe, expect, it } from 'vitest';

import {
  QURANENC_ADAPTER_KEY,
  QURANENC_TRANSLATIONS,
  createQuranEncTranslationAdapter,
  quranEncAttribution,
  quranEncListUrl,
  quranEncNotes,
  quranEncSourceKey,
  quranEncSurahUrl,
  quranEncTranslation,
} from '../../../../scripts/migration/adapters/quranenc.ts';

import { evidenceOf, fakeSite, htmlPage, textFile } from './fake-site.ts';
import {
  AL_KAWTHAR,
  JUNAGARHI_2_285,
  JUNAGARHI_5_8,
  RWWAD_2_255,
  RWWAD_2_3,
  SAHEEH_1_2,
} from './quranenc-fixtures.ts';

/**
 * The QuranEnc translation adapter (REVIEW-ONLY kind; owner decision
 * 2026-11-10) over TRIMMED REAL API answers (`quranenc-fixtures.ts`): the run
 * is refused unless QuranEnc still lists the pinned edition, each Surah is read
 * strictly, its translation verbatim, and its footnotes become notes only where
 * every mark is explained — anything else fails the Surah.
 */

const SITE = 'https://quranenc.com';
const SELECTION = { pages: 1, limit: 114 };
const JSON_TYPE = 'application/json; charset=utf-8';
const SAHEEH = quranEncTranslation('english_saheeh');

const adapter = (key = 'english_saheeh', surahs: number[] = [1, 108]) =>
  createQuranEncTranslationAdapter({ key, surahs, selection: SELECTION });

const parse = (key: string, surah: number, body: unknown, contentType = JSON_TYPE) =>
  adapter(key).parse(
    evidenceOf(
      typeof body === 'string' ? body : JSON.stringify(body),
      quranEncSurahUrl(key, surah),
      contentType,
    ),
  );

/** QuranEnc's list of one language's translations, as its API answers. */
const listing = (entries: readonly Record<string, unknown>[]) =>
  htmlPage(JSON.stringify({ translations: entries }), { contentType: JSON_TYPE });

const listed = (translation = SAHEEH, overrides: Record<string, unknown> = {}) => ({
  key: translation?.key,
  direction: 'ltr',
  language_iso_code: translation?.language,
  version: translation?.version,
  last_update: translation?.lastUpdate,
  title: translation?.title,
  ...overrides,
});

describe('identity and construction', () => {
  it('declares what it is, its parser version naming the pinned edition', () => {
    expect(adapter()).toMatchObject({
      adapterKey: QURANENC_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'json-quranenc-translation',
      parserVersion: `1-${SAHEEH?.version ?? ''}`,
      contentKind: 'quran.translation',
      accessMethod: 'http',
    });
  });

  it('pins each famous translation once, to a version and an update time', () => {
    expect(QURANENC_TRANSLATIONS.map((entry) => [entry.key, entry.language])).toEqual([
      ['urdu_junagarhi', 'ur'],
      ['english_saheeh', 'en'],
      ['english_rwwad', 'en'],
      ['english_hilali_khan', 'en'],
    ]);
    for (const entry of QURANENC_TRANSLATIONS) {
      expect(entry.version).toMatch(/^[0-9]+(?:\.[0-9]+){1,3}$/);
      expect(Number.isSafeInteger(entry.lastUpdate)).toBe(true);
      expect(quranEncSourceKey(entry)).toBe(`quranenc-${entry.key.replaceAll('_', '-')}`);
    }
    expect(quranEncTranslation('urdu_maududi')).toBeNull();
  });

  it('refuses an unpinned translation, a bad surah or selection', () => {
    expect(() =>
      createQuranEncTranslationAdapter({
        key: 'urdu_maududi',
        surahs: [1],
        selection: SELECTION,
      }),
    ).toThrow(/not pinned/);
    expect(() => adapter('english_saheeh', [])).toThrow(/at least one surah/);
    expect(() => adapter('english_saheeh', [0])).toThrow(/1–114/);
    expect(() => adapter('english_saheeh', [115])).toThrow(/1–114/);
    expect(() =>
      createQuranEncTranslationAdapter({
        key: 'english_saheeh',
        surahs: [1],
        selection: { pages: 0, limit: 1 },
      }),
    ).toThrow(/selection/);
  });

  it('attributes the publisher, the version and the source, as external', () => {
    const urdu = quranEncTranslation('urdu_junagarhi');
    expect(urdu === null ? null : quranEncAttribution(urdu, '1.1.3')).toBe(
      'Translation: Urdu — Muhammad Ibrahim Junagarhi (revised under the Rowwad Translation Center), ' +
        'v1.1.3, via QuranEnc.com (https://quranenc.com/en/browse/urdu_junagarhi). An external reference ' +
        "translation — not Minhaj-ul-Quran International's, and not reviewed by its religious authority.",
    );
    for (const entry of QURANENC_TRANSLATIONS)
      expect(quranEncAttribution(entry, entry.version).length).toBeLessThanOrEqual(400);
  });
});

describe('discovery', () => {
  const list = quranEncListUrl('en');

  it('lists the selected surahs’ API addresses once QuranEnc lists the pinned edition', async () => {
    const site = fakeSite({ [list]: listing([listed()]) });
    const result = await adapter('english_saheeh', [108, 1, 108]).discover(
      null,
      site.fetcher,
    );
    expect(result).toEqual({
      kind: 'page',
      next: null,
      items: [
        {
          externalKey: `${SITE}/api/v1/translation/sura/english_saheeh/108`,
          originalUrl: `${SITE}/api/v1/translation/sura/english_saheeh/108`,
          legacyIdentifier: 'english_saheeh-108',
        },
        {
          externalKey: `${SITE}/api/v1/translation/sura/english_saheeh/1`,
          originalUrl: `${SITE}/api/v1/translation/sura/english_saheeh/1`,
          legacyIdentifier: 'english_saheeh-1',
        },
      ],
    });
    // robots.txt, then the language's list — nothing else, nothing guessed.
    expect(site.requested).toEqual([`${SITE}/robots.txt`, list]);
    expect(list).toBe('https://quranenc.com/api/v1/translations/list/en?localization=en');
  });

  it.each([
    ['a newer version', [listed(SAHEEH, { version: '1.1.3' })]],
    ['another update time', [listed(SAHEEH, { last_update: 1 })]],
    ['a version as a number', [listed(SAHEEH, { version: 1.12 })]],
    ['no such translation', [listed(SAHEEH, { key: 'english_other' })]],
    ['an empty list', []],
  ])('refuses the run on %s, staging nothing', async (_label, entries) => {
    const site = fakeSite({ [list]: listing(entries) });
    expect(await adapter().discover(null, site.fetcher)).toEqual({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        requestedUrl: list,
        detail: 'edition-changed',
      },
    });
  });

  it('refuses a list that is not JSON, and hands back a failed list request', async () => {
    const html = fakeSite({ [list]: htmlPage('<html></html>') });
    expect(await adapter().discover(null, html.fetcher)).toMatchObject({
      outcome: { detail: 'edition-changed' },
    });
    const missing = fakeSite({});
    expect(await adapter().discover(null, missing.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'response', status: 404 },
    });
  });

  it('honours robots.txt', async () => {
    const site = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /api/'),
      [list]: listing([listed()]),
    });
    expect(await adapter().discover(null, site.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: { kind: 'refused', detail: 'robots-disallowed' },
    });
  });

  it('accepts no cursor', async () => {
    await expect(adapter().discover('1', fakeSite({}).fetcher)).rejects.toThrow('cursor');
  });
});

describe('parse', () => {
  it.each(QURANENC_TRANSLATIONS.map((entry) => [entry.key, entry] as const))(
    'reads %s’s Surah 108 verbatim, its footnotes as tied notes, with its edition',
    (key, translation) => {
      const body = AL_KAWTHAR[key];
      const result = parse(key, 108, body);
      if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
        throw new Error(JSON.stringify(result));
      const { record } = result;
      expect(record).toMatchObject({
        title: translation.title,
        work: translation.title,
        primaryLocale: translation.language,
        languageCode: translation.language,
        legacyIdentifier: `${key}-108`,
        surah: 108,
        edition: {
          key,
          version: translation.version,
          lastUpdate: translation.lastUpdate,
        },
      });
      const rows = body?.result ?? [];
      expect(record.ayat).toEqual(
        rows.map((row, index) => ({ ayah: index + 1, text: row['translation'] })),
      );
      // Every note opens with a mark of its ayah's translation, and ties to it.
      for (const entry of record.ayat) {
        const own = (record.notes ?? []).filter((note) => note.ayah === entry.ayah);
        for (const note of own) expect(entry.text).toContain(note.marker);
        const ties = tieTranslationNotes(entry.text, own);
        expect(ties).not.toBeNull();
        expect(ties?.every((tie) => tie !== null)).toBe(true);
      }
      expect(record.notes?.length).toBeGreaterThan(0);
    },
  );

  it.each([
    [
      'not this translation’s address',
      `${SITE}/api/v1/translation/sura/english_rwwad/108`,
    ],
    ['another host', 'https://example.com/api/v1/translation/sura/english_saheeh/108'],
    ['not a surah', `${SITE}/api/v1/translation/sura/english_saheeh/115`],
    ['the list', quranEncListUrl('en')],
  ])('excludes %s', (_label, url) => {
    expect(
      adapter().parse(
        evidenceOf(JSON.stringify(AL_KAWTHAR['english_saheeh']), url, JSON_TYPE),
      ),
    ).toEqual({ kind: 'excluded', reason: 'not-a-surah-address' });
  });

  const rows = () =>
    (AL_KAWTHAR['english_saheeh']?.result ?? []).map((row) => ({ ...row }));

  it.each([
    [
      'unsupported-content-type',
      AL_KAWTHAR['english_saheeh'],
      'text/html; charset=utf-8',
    ],
    [
      'unsupported-charset',
      AL_KAWTHAR['english_saheeh'],
      'application/json; charset=latin1',
    ],
    ['invalid-json', '{"result": [', JSON_TYPE],
    ['record-structure-missing', { result: 'none' }, JSON_TYPE],
    ['ayat-incomplete', { result: rows().slice(0, 2) }, JSON_TYPE],
    ['ayat-incomplete', { result: [...rows(), rows()[2]] }, JSON_TYPE],
    ['ayat-incomplete', { result: rows().reverse() }, JSON_TYPE],
    [
      'surah-mismatch',
      { result: rows().map((row) => ({ ...row, sura: '107' })) },
      JSON_TYPE,
    ],
    [
      'ayah-reference-missing',
      { result: rows().map((row, index) => (index === 1 ? { ...row, aya: 2 } : row)) },
      JSON_TYPE,
    ],
    [
      'translation-missing',
      {
        result: rows().map((row, index) =>
          index === 0 ? { ...row, footnotes: null } : row,
        ),
      },
      JSON_TYPE,
    ],
    [
      'translation-structure-unexpected',
      {
        result: rows().map((row, index) =>
          index === 2
            ? { ...row, footnotes: `${row['footnotes'] ?? ''}\n[99] NON_QURAN_FIXTURE` }
            : row,
        ),
      },
      JSON_TYPE,
    ],
    [
      'translation-structure-unexpected',
      {
        result: rows().map((row, index) =>
          index === 2 ? { ...row, footnotes: '' } : row,
        ),
      },
      JSON_TYPE,
    ],
  ])('fails the Surah as %s', (detail, body, contentType) => {
    expect(parse('english_saheeh', 108, body, contentType)).toEqual({
      kind: 'failed',
      detail,
    });
  });

  it('never repairs a count: a Surah is exactly its ayat', () => {
    expect(SURAH_AYAH_COUNTS[107]).toBe(3);
  });
});

describe('footnotes become notes only where every mark is explained', () => {
  it('keeps a bracketed interpolation as text, beside the footnote mark', () => {
    const notes = quranEncNotes(SAHEEH_1_2.translation, SAHEEH_1_2.footnotes);
    expect(notes?.map((note) => note.marker)).toEqual(['[4]']);
    expect(notes?.[0]?.text).toBe(SAHEEH_1_2.footnotes.slice('[4] '.length));
  });

  it('reads two footnotes set on one line as two notes', () => {
    const notes = quranEncNotes(RWWAD_2_3.translation, RWWAD_2_3.footnotes);
    expect(notes?.map((note) => note.marker)).toEqual(['[3]', '[4]']);
    expect(notes?.map((note) => `${note.marker} ${note.text}`).join(' ')).toBe(
      RWWAD_2_3.footnotes,
    );
  });

  it('reads eight footnotes, one a line, their words verbatim', () => {
    const notes = quranEncNotes(RWWAD_2_255.translation, RWWAD_2_255.footnotes);
    expect(notes?.map((note) => note.marker)).toEqual(
      ['143', '144', '145', '146', '147', '148', '149', '150'].map((n) => `[${n}]`),
    );
    expect(notes?.map((note) => `${note.marker} ${note.text}`).join('\n ')).toBe(
      RWWAD_2_255.footnotes,
    );
  });

  it('reads one footnote for two marks as ONE note opened by the first', () => {
    const notes = quranEncNotes(JUNAGARHI_5_8.translation, JUNAGARHI_5_8.footnotes);
    expect(notes).toHaveLength(1);
    expect(notes?.[0]?.marker).toBe('[1]');
    expect(`[1] ${notes?.[0]?.text ?? ''}`).toBe(JUNAGARHI_5_8.footnotes);
  });

  it('reads a field with no mark as the ayah’s one note, only where the translation has none', () => {
    expect(quranEncNotes(JUNAGARHI_2_285.translation, JUNAGARHI_2_285.footnotes)).toEqual(
      [{ marker: '', text: JUNAGARHI_2_285.footnotes }],
    );
    expect(
      quranEncNotes(`${JUNAGARHI_2_285.translation}[1]`, JUNAGARHI_2_285.footnotes),
    ).toBeNull();
  });

  it.each([
    [
      'a mark with no footnote',
      'NON_QURAN_FIXTURE words[1] more[2]',
      '[1] NON_QURAN_FIXTURE one',
    ],
    [
      'a footnote with no mark',
      'NON_QURAN_FIXTURE words[1]',
      '[1] one\n[2] NON_QURAN_FIXTURE two',
    ],
    ['marks but no footnotes', 'NON_QURAN_FIXTURE words[1]', ''],
    ['a mark twice', 'NON_QURAN_FIXTURE[1] words[1]', '[1] NON_QURAN_FIXTURE one'],
    [
      'footnotes out of order',
      'NON_QURAN_FIXTURE[1] words[2]',
      '[2] two\n[1] NON_QURAN_FIXTURE one',
    ],
    ['a footnote with no words', 'NON_QURAN_FIXTURE words[1]', '[1]  '],
    ['words before the first footnote', 'NON_QURAN_FIXTURE words[1]', 'preface\n[1] one'],
  ])('refuses %s', (_label, translation, footnotes) => {
    expect(quranEncNotes(translation, footnotes)).toBeNull();
  });

  it('reads an ayah with neither marks nor footnotes as having no notes', () => {
    expect(quranEncNotes('NON_QURAN_FIXTURE words', '')).toEqual([]);
    expect(quranEncNotes('NON_QURAN_FIXTURE [all] words', ' \n')).toEqual([]);
  });

  it('keeps a mark-like reference inside a footnote as its words', () => {
    expect(
      quranEncNotes(
        'NON_QURAN_FIXTURE[1] words[2]',
        '[1] see note[2] below\n[2] NON_QURAN_FIXTURE',
      ),
    ).toEqual([
      { marker: '[1]', text: 'see note[2] below' },
      { marker: '[2]', text: 'NON_QURAN_FIXTURE' },
    ]);
  });
});
