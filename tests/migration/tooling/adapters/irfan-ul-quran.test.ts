import { SURAH_AYAH_COUNTS } from '@minhaj/contracts/migration';
import { describe, expect, it } from 'vitest';

import {
  createIrfanUlQuranTranslationAdapter,
  IRFAN_UL_QURAN_ADAPTER_KEY,
  IRFAN_UL_QURAN_SURAH_SLUGS,
  irfanUlQuranSurahPath,
  translatorNotes,
  withoutAyahPrefix,
  type IrfanUlQuranTranslation,
} from '../../../../scripts/migration/adapters/irfan-ul-quran.ts';

import { evidenceOf, fakeSite, htmlPage, pendingItem, textFile } from './fake-site.ts';
import {
  AL_AHZAB_37_ROW,
  AL_AHZAB_6_ROW,
  AL_IKHLAS_PAGE,
  AL_KAWTHAR_PAGE,
  AL_MUNAFIQUN_PAGE,
  AN_NAJM_39_ROW,
  AN_NISA_34_ROW,
  AN_NUR_35_ROW,
  ASH_SHURA_52_ROW,
  AT_TAWBAH_101_ROW,
  AT_TAWBAH_29_ROW,
  AZ_ZUMAR_31_ROW,
  MUHAMMAD_19_ROW,
} from './irfan-ul-quran-pages.ts';

/**
 * The Irfan-ul-Quran translation adapter (REVIEW-ONLY kind) over SYNTHETIC
 * surah pages shaped like the real one — the "translations" there are
 * synthetic placeholder words, never Quran text — and over two TRIMMED REAL
 * pages (`irfan-ul-quran-pages.ts`) for the translator's-note structure.
 */

const SITE = 'https://www.irfan-ul-quran.com';
const SELECTION = { pages: 1, limit: 3 };
const FATIHAH_URL = `${SITE}/english/Surah-al-Fatihah-with-english-translation`;

interface RowOptions {
  sura?: number;
  urdu?: string;
  english?: string;
  extraUrdu?: string;
}

function row(ayah: number, options: RowOptions = {}): string {
  const sura = options.sura ?? 1;
  return `<div class="brows-job-list ayatno_" id="ayatno_${ayah}">
<div class="ayat-row-controls"><button type=button class="ayat-menu-trigger" data-sura="${sura}" data-ayat="${ayah}" data-share-text="Synthetic share words ${ayah}"></button></div>
<span class="ayat-hidden-actions"><span class="copy" data-clipboard-text="Synthetic copy payload ${ayah}"></span></span>
<div id="joo${ayah}"><a class="ayat-div" href="/english/Surah-x/${ayah}/">
<div class="ar ayat-ar-wrap"><div data-indopak="مصنوعی" data-uthmani="&amp;#xfb51;&amp;#xfb52;" data-uthmani-page="p1" class="ar ayat-ar">مصنوعی عربی ${ayah}</div>
<div class="tajweed-text" id="tajweed_${sura}_${ayah}">مصنوعی</div></div>
<h2 class="ur dir-rtl">${options.urdu ?? `${ayah}. مصنوعی ترجمہ نمبر ${ayah}<span class="page_speed_1">o</span>`}</h2>
<h2 class="ur dir-rtl">${options.extraUrdu ?? ''}</h2>
<h2 class="en page_speed_2">${options.english ?? `${ayah}. Synthetic rendering number ${ayah}.`}</h2>
<p class="en page_speed_3"></p>
<h2 class="en_g page_speed_2">${ayah}. Synthetic other English ${ayah}.</h2>
<h2 class="tr">${ayah}. Synthetic transliteration</h2>
<h2 class="text_withoud_arabic" hidden>مصنوعی</h2>
</a><h5>(Synthetic, ${sura} : ${ayah})</h5></div></div>`;
}

function surahPage(rows: string[], labels = true): string {
  const settings = labels
    ? `<div class="wrapperr">
<div data-type="ar" class="item sortable-item"><button type=button></button><span class="text">Arabic</span></div>
<div data-type="ur" class="item sortable-item"><button type=button></button><span class="text">Synthetic Urdu Label</span></div>
<div data-type="en" class="item sortable-item"><button type=button></button><span class="text">Synthetic - English Label</span></div>
<div data-type="en_g" class="item sortable-item"><button type=button></button><span class="text">Synthetic - Other Label</span></div>
</div>`
    : '';
  return `<!DOCTYPE html><html lang="en"><head>
<link rel="canonical" href="https://sandbox.irfan-ul-quran.com/english/Surah-al-Fatihah-with-english-translation">
<meta property="og:locale" content="en_US"></head><body>
<h1 id="main_heading">Synthetic surah heading</h1>
<div id="bismillah" title="مصنوعی">مصنوعی</div>
${rows.join('\n')}
${settings}
</body></html>`;
}

const fullFatihah = (options: (ayah: number) => RowOptions = () => ({})) =>
  surahPage(Array.from({ length: 7 }, (_, index) => row(index + 1, options(index + 1))));

const adapter = (
  translation: IrfanUlQuranTranslation = 'ur',
  surahs: number[] = [1, 36, 67],
  selection = SELECTION,
) => createIrfanUlQuranTranslationAdapter({ translation, surahs, selection });

const parse = (
  html: string,
  translation: IrfanUlQuranTranslation = 'ur',
  url = FATIHAH_URL,
) => adapter(translation).parse(evidenceOf(html, url));

describe('identity and construction', () => {
  it('declares what it is', () => {
    expect(adapter()).toMatchObject({
      adapterKey: IRFAN_UL_QURAN_ADAPTER_KEY,
      adapterVersion: '1',
      parserKey: 'cheerio-irfan-ul-quran-translation',
      parserVersion: '3',
      contentKind: 'quran.translation',
      accessMethod: 'http',
    });
  });

  it('refuses another host, a bad translation, surah or selection', () => {
    const make =
      (options: Partial<Parameters<typeof createIrfanUlQuranTranslationAdapter>[0]>) =>
      () =>
        createIrfanUlQuranTranslationAdapter({
          translation: 'ur',
          surahs: [1],
          selection: SELECTION,
          ...options,
        });
    expect(make({ baseUrl: 'https://irfan-ul-quran.com/' })).toThrow();
    expect(make({ baseUrl: 'https://sandbox.irfan-ul-quran.com/' })).toThrow();
    expect(make({ translation: 'en_g' as IrfanUlQuranTranslation })).toThrow();
    expect(make({ surahs: [0] })).toThrow();
    expect(make({ surahs: [115] })).toThrow();
    expect(make({ surahs: [1.5] })).toThrow();
    expect(make({ surahs: [] })).toThrow();
    expect(make({ selection: { pages: 1, limit: -1 } })).toThrow();
    expect(make({})).not.toThrow();
  });

  it('has a fixed page for every surah, 1–114', () => {
    expect(IRFAN_UL_QURAN_SURAH_SLUGS).toHaveLength(114);
    expect(SURAH_AYAH_COUNTS).toHaveLength(114);
    expect(new Set(IRFAN_UL_QURAN_SURAH_SLUGS).size).toBe(114);
    expect(irfanUlQuranSurahPath(1)).toBe(
      '/english/Surah-al-Fatihah-with-english-translation',
    );
    expect(irfanUlQuranSurahPath(36)).toBe(
      '/english/Surah-Yasin-with-english-translation',
    );
    expect(irfanUlQuranSurahPath(67)).toBe(
      '/english/Surah-al-Mulk-with-english-translation',
    );
    expect(irfanUlQuranSurahPath(114)).toBe(
      '/english/Surah-al-Nas-with-english-translation',
    );
  });
});

describe('discovery', () => {
  it('maps the selected surahs to their pages, one record per translation source', async () => {
    const site = fakeSite({});
    const urdu = await adapter('ur').discover(null, site.fetcher);
    expect(urdu).toEqual({
      kind: 'page',
      items: [
        {
          externalKey: FATIHAH_URL,
          originalUrl: FATIHAH_URL,
          legacyIdentifier: 'surah-1-ur',
        },
        {
          externalKey: `${SITE}/english/Surah-Yasin-with-english-translation`,
          originalUrl: `${SITE}/english/Surah-Yasin-with-english-translation`,
          legacyIdentifier: 'surah-36-ur',
        },
        {
          externalKey: `${SITE}/english/Surah-al-Mulk-with-english-translation`,
          originalUrl: `${SITE}/english/Surah-al-Mulk-with-english-translation`,
          legacyIdentifier: 'surah-67-ur',
        },
      ],
      next: null,
    });
    const english = await adapter('en').discover(null, site.fetcher);
    if (english.kind !== 'page' || urdu.kind !== 'page')
      throw new Error('expected pages');
    // The same page, keyed identically — a separate record in a separate source.
    expect(english.items.map((item) => item.externalKey)).toEqual(
      urdu.items.map((item) => item.externalKey),
    );
    expect(english.items.map((item) => item.legacyIdentifier)).toEqual([
      'surah-1-en',
      'surah-36-en',
      'surah-67-en',
    ]);
    expect(english.items.every((item) => !item.externalKey.includes('#'))).toBe(true);
    // No listing is fetched: only robots.txt.
    expect(site.requested.every((url) => url === `${SITE}/robots.txt`)).toBe(true);
  });

  it('caps by the limit, dedups, and validates the cursor', async () => {
    const result = await adapter('ur', [67, 1, 67, 36], { pages: 1, limit: 2 }).discover(
      null,
      fakeSite({}).fetcher,
    );
    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.items.map((item) => item.legacyIdentifier)).toEqual([
      'surah-67-ur',
      'surah-1-ur',
    ]);
    await expect(adapter().discover('1', fakeSite({}).fetcher)).rejects.toThrow('cursor');
  });

  it('honours robots.txt', async () => {
    const partly = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /english/Surah-Yasin'),
    });
    const result = await adapter().discover(null, partly.fetcher);
    if (result.kind !== 'page') throw new Error('expected a page');
    expect(result.items.map((item) => item.legacyIdentifier)).toEqual([
      'surah-1-ur',
      'surah-67-ur',
    ]);

    const all = fakeSite({
      [`${SITE}/robots.txt`]: textFile('User-agent: *\nDisallow: /english/'),
    });
    expect(await adapter().discover(null, all.fetcher)).toMatchObject({
      kind: 'outcome',
      outcome: {
        kind: 'refused',
        classification: 'scope-refused',
        detail: 'robots-disallowed',
      },
    });
  });

  it('retrieves once and hands a non-200 back', async () => {
    const site = fakeSite({ [FATIHAH_URL]: htmlPage(fullFatihah()) });
    expect(
      await adapter().retrieve(pendingItem(FATIHAH_URL, 'surah-1-ur'), site.fetcher),
    ).toMatchObject({
      kind: 'evidence',
      httpStatus: 200,
    });
    const missing = `${SITE}/english/Surah-al-Nas-with-english-translation`;
    expect(
      await adapter().retrieve(pendingItem(missing, null), site.fetcher),
    ).toMatchObject({
      kind: 'outcome',
      outcome: { status: 404 },
    });
  });
});

describe('parse', () => {
  it('reads the Urdu translation of every ayah exactly, minus the site prefix', () => {
    const result = parse(fullFatihah(), 'ur');
    expect(result).toEqual({
      kind: 'parsed',
      record: {
        kind: 'quran.translation',
        title: 'Synthetic Urdu Label',
        primaryLocale: 'ur',
        languageCode: 'ur',
        publishedOn: null,
        legacyIdentifier: 'surah-1-ur',
        categories: [],
        links: [],
        assets: [],
        work: 'Synthetic Urdu Label',
        surah: 1,
        // The site's trailing end-of-ayah ornament (`<span>o</span>`) is not text.
        ayat: Array.from({ length: 7 }, (_, index) => ({
          ayah: index + 1,
          text: `مصنوعی ترجمہ نمبر ${index + 1}`,
        })),
        notes: [],
      },
    });
  });

  it('reads the English translation from h2.en only', () => {
    const result = parse(fullFatihah(), 'en');
    if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
      throw new Error('expected a translation');
    expect(result.record).toMatchObject({
      work: 'Synthetic - English Label',
      title: 'Synthetic - English Label',
      primaryLocale: 'en',
      languageCode: 'en',
      legacyIdentifier: 'surah-1-en',
    });
    expect(result.record.ayat[0]).toEqual({
      ayah: 1,
      text: 'Synthetic rendering number 1.',
    });
  });

  it('never carries the Arabic, glyph codes, other translations or copy payloads', () => {
    for (const translation of ['ur', 'en'] as const) {
      const text = JSON.stringify(parse(fullFatihah(), translation));
      for (const leaked of [
        'fb51',
        'مصنوعی عربی',
        'Synthetic other English',
        'Synthetic transliteration',
        'Synthetic copy payload',
        'Synthetic share words',
        'Synthetic - Other Label',
      ])
        expect(text).not.toContain(leaked);
    }
  });

  it('removes the leading number only when it is the row ayah', () => {
    expect(withoutAyahPrefix('3. Synthetic', 3)).toBe('Synthetic');
    expect(withoutAyahPrefix('2. Synthetic', 3)).toBe('2. Synthetic');
    expect(withoutAyahPrefix('Synthetic 3. words', 3)).toBe('Synthetic 3. words');
    expect(withoutAyahPrefix('3.Synthetic', 3)).toBe('Synthetic');
    const kept = parse(fullFatihah((ayah) => (ayah === 3 ? { urdu: '2. مصنوعی' } : {})));
    if (kept.kind !== 'parsed' || kept.record.kind !== 'quran.translation')
      throw new Error('expected a translation');
    expect(kept.record.ayat[2]).toEqual({ ayah: 3, text: '2. مصنوعی' });
  });

  it('strips the end-of-ayah ornament only as the trailing span "o"', () => {
    const texts = (urdu: string) => {
      const result = parse(fullFatihah((ayah) => (ayah === 1 ? { urdu } : {})));
      if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
        throw new Error('expected a translation');
      return result.record.ayat[0]?.text;
    };
    // Stripped: the last child, a span whose text is exactly "o", nothing after
    // it but whitespace.
    expect(texts('1. مصنوعی<span>o</span>')).toBe('مصنوعی');
    // (the whitespace after it is the site's own text, and is kept as written)
    expect(texts('1. مصنوعی<span class="page_speed_9">o</span>  \n')).toBe('مصنوعی  \n');
    // Kept: text follows it, it is not a span, or its text is not just "o".
    expect(texts('1. مصنوعی <span>o</span> مزید')).toBe('مصنوعی o مزید');
    expect(texts('1. مصنوعی <b>o</b>')).toBe('مصنوعی o');
    expect(texts('1. مصنوعی <span>oo</span>')).toBe('مصنوعی oo');
    expect(texts('1. مصنوعی<span> o </span>')).toBe('مصنوعی o ');
    expect(texts('1. مصنوعی <span>o</span><span>x</span>')).toBe('مصنوعی ox');
  });

  it('passes an empty translation on for validation to name', () => {
    const result = parse(fullFatihah((ayah) => (ayah === 2 ? { urdu: '' } : {})));
    if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
      throw new Error('expected a translation');
    expect(result.record.ayat[1]).toEqual({ ayah: 2, text: '' });
  });

  it('fails rather than return a partial or mixed surah', () => {
    const six = surahPage(Array.from({ length: 6 }, (_, index) => row(index + 1)));
    expect(parse(six)).toEqual({ kind: 'failed', detail: 'ayat-incomplete' });
    const shuffled = surahPage([2, 1, 3, 4, 5, 6, 7].map((ayah) => row(ayah)));
    expect(parse(shuffled)).toEqual({ kind: 'failed', detail: 'ayat-incomplete' });
    const otherSurah = fullFatihah((ayah) => (ayah === 4 ? { sura: 2 } : {}));
    expect(parse(otherSurah)).toEqual({ kind: 'failed', detail: 'surah-mismatch' });
    const footnote = fullFatihah((ayah) =>
      ayah === 5 ? { extraUrdu: 'Synthetic extra' } : {},
    );
    expect(parse(footnote)).toEqual({
      kind: 'failed',
      detail: 'translation-structure-unexpected',
    });
    const noReference = fullFatihah().replace('data-ayat="6"', 'data-ayat="six"');
    expect(parse(noReference)).toEqual({
      kind: 'failed',
      detail: 'ayah-reference-missing',
    });
    const noEnglish = fullFatihah().replace(
      /<h2 class="en page_speed_2">[^<]*<\/h2>/,
      '',
    );
    expect(parse(noEnglish, 'en')).toEqual({
      kind: 'failed',
      detail: 'translation-missing',
    });
  });

  it('fails a page without its label or rows, excludes what is not a surah page', () => {
    expect(parse(surahPage([row(1)], false))).toEqual({
      kind: 'failed',
      detail: 'translation-label-missing',
    });
    expect(parse(surahPage([]))).toEqual({
      kind: 'failed',
      detail: 'record-structure-missing',
    });
    expect(parse(fullFatihah(), 'ur', `${FATIHAH_URL}/1`)).toEqual({
      kind: 'excluded',
      reason: 'not-a-surah-page',
    });
    expect(
      parse(
        fullFatihah(),
        'ur',
        `${SITE}/english/Surah-Unknown-with-english-translation`,
      ),
    ).toEqual({
      kind: 'excluded',
      reason: 'not-a-surah-page',
    });
    // The page URL names surah 1; rows naming another surah do not pass.
    expect(
      parse(
        fullFatihah(),
        'ur',
        `${SITE}/english/Surah-al-Mulk-with-english-translation`,
      ),
    ).toEqual({ kind: 'failed', detail: 'surah-mismatch' });
  });

  it('fails a later heading that is not a note of a marked translation', () => {
    // The synthetic rows' translations carry no "٭" mark.
    const unmarked = fullFatihah((ayah) =>
      ayah === 5 ? { extraUrdu: '٭ مصنوعی حاشیہ' } : {},
    );
    expect(parse(unmarked)).toEqual({
      kind: 'failed',
      detail: 'translation-structure-unexpected',
    });
    const marked = fullFatihah((ayah) =>
      ayah === 5 ? { urdu: '5. مصنوعی٭', extraUrdu: '٭ مصنوعی حاشیہ' } : {},
    );
    const result = parse(marked);
    if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
      throw new Error('expected a translation');
    expect(result.record.ayat[4]).toEqual({ ayah: 5, text: 'مصنوعی٭' });
    // Parser version 3: the note is read into its own place; the mark stays.
    expect(result.record.notes).toEqual([{ ayah: 5, marker: '٭', text: 'مصنوعی حاشیہ' }]);
    expect(JSON.stringify(result.record.ayat)).not.toContain('حاشیہ');
  });

  it('turns decoding refusals into parse failures', () => {
    expect(adapter().parse(evidenceOf(fullFatihah(), FATIHAH_URL, null))).toEqual({
      kind: 'failed',
      detail: 'unsupported-content-type',
    });
    expect(
      adapter().parse({
        body: new Uint8Array([0xc3, 0x28]),
        contentType: 'text/html',
        finalUrl: FATIHAH_URL,
      }),
    ).toEqual({ kind: 'failed', detail: 'invalid-utf8' });
  });
});

describe('real pages (trimmed)', () => {
  const MUNAFIQUN_URL = `${SITE}${irfanUlQuranSurahPath(63)}`;
  const IKHLAS_URL = `${SITE}${irfanUlQuranSurahPath(112)}`;
  const real = (
    html: string,
    surah: number,
    url: string,
    translation: IrfanUlQuranTranslation = 'ur',
  ) => adapter(translation, [surah]).parse(evidenceOf(html, url));
  const recordOf = (result: ReturnType<typeof real>) => {
    if (result.kind !== 'parsed' || result.record.kind !== 'quran.translation')
      throw new Error(`expected a translation, got ${JSON.stringify(result)}`);
    return result.record;
  };
  const ayatOf = (result: ReturnType<typeof real>) => recordOf(result).ayat;
  const notesOf = (result: ReturnType<typeof real>) => recordOf(result).notes ?? [];
  // The translator's note on 63:5, as the second `h2.ur` of its row opens it.
  const NOTE_OPENING = '٭ یہ آیت عبد اللہ بن اُبیّ';

  it('reads a surah without notes exactly, minus the prefix and the ornament', () => {
    const result = real(AL_IKHLAS_PAGE, 112, IKHLAS_URL);
    expect(result).toMatchObject({
      kind: 'parsed',
      record: { work: 'Urdu', surah: 112, legacyIdentifier: 'surah-112-ur' },
    });
    expect(ayatOf(result)).toEqual([
      { ayah: 1, text: '(اے نبئ مکرّم!) آپ فرما دیجئے: وہ اللہ ہے جو یکتا ہے' },
      { ayah: 2, text: 'اللہ سب سے بے نیاز، سب کی پناہ اور سب پر فائق ہے' },
      { ayah: 3, text: 'نہ اس سے کوئی پیدا ہوا ہے اور نہ ہی وہ پیدا کیا گیا ہے' },
      { ayah: 4, text: 'اور نہ ہی اس کا کوئی ہمسر ہے' },
    ]);
  });

  it("reads every ayah of a surah with the Urdu translator's note, the note in its own place", () => {
    const ayat = ayatOf(real(AL_MUNAFIQUN_PAGE, 63, MUNAFIQUN_URL));
    expect(ayat.map((entry) => entry.ayah)).toEqual(
      Array.from({ length: SURAH_AYAH_COUNTS[62] ?? 0 }, (_, index) => index + 1),
    );
    expect(ayat).toHaveLength(11);
    expect(ayat.every((entry) => entry.text.trim().length > 0)).toBe(true);
    expect(ayat.every((entry) => !/^\s*[0-9]/.test(entry.text))).toBe(true);
    // The mark stays exactly where the translation sets it; the note is not read.
    expect(ayat[4]?.text.startsWith('اور جب اُن سے کہا جاتا ہے کہ آؤ رسول اللہ')).toBe(
      true,
    );
    expect(ayat[4]?.text.endsWith('گریز کرتے ہیں٭')).toBe(true);
    expect(
      ayat.filter((entry) => entry.text.includes('٭')).map((entry) => entry.ayah),
    ).toEqual([5]);
    expect(JSON.stringify(ayat)).not.toContain('عبد اللہ بن اُبیّ');
    expect(AL_MUNAFIQUN_PAGE).toContain(NOTE_OPENING);
    // Parser version 3: the note is read verbatim, its mark as written.
    const notes = notesOf(real(AL_MUNAFIQUN_PAGE, 63, MUNAFIQUN_URL));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ayah: 5, marker: '٭' });
    expect(notes[0]?.text.startsWith('یہ آیت عبد اللہ بن اُبیّ')).toBe(true);
    expect(AL_MUNAFIQUN_PAGE).toContain(`٭ ${notes[0]?.text ?? ''}</h2>`);
  });

  it('reads the English of the same page, whose note is in p.en, beside the ayat', () => {
    const result = real(AL_MUNAFIQUN_PAGE, 63, MUNAFIQUN_URL, 'en');
    const ayat = ayatOf(result);
    expect(ayat).toHaveLength(11);
    expect(JSON.stringify(ayat)).not.toContain('This verse was sent down');
    // The English translation of 63:5 carries no mark: the note is the ayah's.
    expect(ayat[4]?.text).not.toMatch(/[*٭]/);
    const notes = notesOf(result);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ ayah: 5, marker: '*' });
    expect(notes[0]?.text.startsWith('This verse was sent down')).toBe(true);
    expect(ayatOf(real(AL_IKHLAS_PAGE, 112, IKHLAS_URL, 'en'))).toHaveLength(4);
    expect(notesOf(real(AL_IKHLAS_PAGE, 112, IKHLAS_URL, 'en'))).toEqual([]);
    expect(notesOf(real(AL_IKHLAS_PAGE, 112, IKHLAS_URL))).toEqual([]);
  });

  it('still fails the real page when its note is not exactly a note of a mark', () => {
    const fails = (html: string, translation: IrfanUlQuranTranslation = 'ur') =>
      expect(real(html, 63, MUNAFIQUN_URL, translation)).toEqual({
        kind: 'failed',
        detail: 'translation-structure-unexpected',
      });
    // The translation without its mark.
    fails(AL_MUNAFIQUN_PAGE.replace('گریز کرتے ہیں٭', 'گریز کرتے ہیں'));
    // The note without its opening mark, and no English note to corroborate it.
    fails(
      AL_MUNAFIQUN_PAGE.replace(NOTE_OPENING, 'یہ آیت عبد اللہ بن اُبیّ').replace(
        /<p class="en page_speed_1425939351">\* This verse[\s\S]*?<\/p>/,
        '<p class="en page_speed_1425939351"></p>',
      ),
    );
    // A second note for the one mark.
    fails(
      AL_MUNAFIQUN_PAGE.replace(
        '<h2 class="ur dir-rtl">٭ یہ',
        '<h2 class="ur dir-rtl">٭ مصنوعی</h2><h2 class="ur dir-rtl">٭ یہ',
      ),
    );
    // A note in an empty slot of another row (whose translation has no mark).
    fails(
      AL_MUNAFIQUN_PAGE.replace(
        '<h2 class="ur dir-rtl"></h2>',
        '<h2 class="ur dir-rtl">٭ مصنوعی</h2>',
      ),
    );
    // The English page has no note heading: a later `h2.en` is never one.
    fails(
      AL_MUNAFIQUN_PAGE.replace(
        '<p class="en page_speed_1425939351">* This verse',
        '<h2 class="en">* Synthetic note</h2><p class="en page_speed_1425939351">* This verse',
      ),
      'en',
    );
  });

  it('reads a surah whose note opens with no mark, corroborated by its English note', () => {
    const url = `${SITE}${irfanUlQuranSurahPath(108)}`;
    const ayat = ayatOf(real(AL_KAWTHAR_PAGE, 108, url));
    expect(ayat.map((entry) => entry.ayah)).toEqual([1, 2, 3]);
    expect(ayat[0]).toEqual({
      ayah: 1,
      text: 'بیشک ہم نے آپ کو (ہر خیر و فضیلت میں) بے انتہا کثرت بخشی ہے٭',
    });
    expect(JSON.stringify(ayat)).not.toContain('کوثر سے مراد');
    expect(ayatOf(real(AL_KAWTHAR_PAGE, 108, url, 'en'))).toHaveLength(3);
    // The unmarked note is read with NO marker; the English one with its "*".
    const urdu = notesOf(real(AL_KAWTHAR_PAGE, 108, url));
    expect(urdu).toHaveLength(1);
    expect(urdu[0]).toMatchObject({ ayah: 1, marker: '' });
    expect(urdu[0]?.text.startsWith('کوثر سے مراد حوض کوثر')).toBe(true);
    const english = notesOf(real(AL_KAWTHAR_PAGE, 108, url, 'en'));
    expect(english).toHaveLength(1);
    expect(english[0]).toMatchObject({ ayah: 1, marker: '*' });
    // The italic's words are kept, its markup is not.
    expect(english[0]?.text.startsWith('There are numerous meanings of al-Kawthar')).toBe(
      true,
    );
    // Without the English note, or without the mark, it is not a known note.
    const fails = (html: string) =>
      expect(real(html, 108, url)).toEqual({
        kind: 'failed',
        detail: 'translation-structure-unexpected',
      });
    fails(
      AL_KAWTHAR_PAGE.replace(
        /<p class="en page_speed_1483626782">[\s\S]*?<\/p>/,
        '<p class="en page_speed_1483626782"></p>',
      ),
    );
    fails(AL_KAWTHAR_PAGE.replace('کثرت بخشی ہے٭', 'کثرت بخشی ہے'));
    // Two marks leave an unmarked note unattributable.
    fails(AL_KAWTHAR_PAGE.replace('کثرت بخشی ہے٭', 'کثرت٭ بخشی ہے٭'));
  });

  describe('a long surah’s real note row among synthetic rows', () => {
    const among = (surah: number, ayah: number, realRow: string) =>
      surahPage(
        Array.from({ length: SURAH_AYAH_COUNTS[surah - 1] ?? 0 }, (_, index) =>
          index + 1 === ayah ? realRow : row(index + 1, { sura: surah }),
        ),
      );
    const read = (surah: number, html: string) =>
      real(html, surah, `${SITE}${irfanUlQuranSurahPath(surah)}`);
    const unexpected = { kind: 'failed', detail: 'translation-structure-unexpected' };

    it('reads an ASCII "*" mark and its "*" note (39:31)', () => {
      const ayat = ayatOf(read(39, among(39, 31, AZ_ZUMAR_31_ROW)));
      expect(ayat).toHaveLength(75);
      expect(ayat[30]).toEqual({
        ayah: 31,
        text: 'پھر بلاشبہ تم لوگ قیامت کے دن اپنے رب کے حضور باہم جھگڑا کروگے*',
      });
      expect(JSON.stringify(ayat)).not.toContain('ایک گروہ دوسرے کو');
      const notes = notesOf(read(39, among(39, 31, AZ_ZUMAR_31_ROW)));
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ ayah: 31, marker: '*' });
      expect(notes[0]?.text.startsWith('ایک گروہ دوسرے کو کہے گا')).toBe(true);
      const unmarked = AZ_ZUMAR_31_ROW.replace('جھگڑا کروگے*', 'جھگڑا کروگے');
      expect(read(39, among(39, 31, unmarked))).toEqual(unexpected);
    });

    it('reads an ASCII "*" mark whose note opens with "٭" (47:19)', () => {
      const ayat = ayatOf(read(47, among(47, 19, MUHAMMAD_19_ROW)));
      expect(ayat).toHaveLength(38);
      expect(ayat[18]?.ayah).toBe(19);
      expect(
        ayat[18]?.text.startsWith('پس جان لیجیے کہ اللہ کے سوا کوئی معبود نہیں'),
      ).toBe(true);
      expect(ayat[18]?.text).toContain('صادر نہ ہو جائے* اور مومن مردوں');
      expect(JSON.stringify(ayat)).not.toContain('حالانکہ وہ فعل');
      // The note keeps the mark it opens with ("٭"), not the translation's ("*").
      const notes = notesOf(read(47, among(47, 19, MUHAMMAD_19_ROW)));
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([[19, '٭']]);
      expect(notes[0]?.text.startsWith('(حالانکہ وہ فعل')).toBe(true);
      const unmarked = MUHAMMAD_19_ROW.replace('صادر نہ ہو جائے*', 'صادر نہ ہو جائے');
      expect(read(47, among(47, 19, unmarked))).toEqual(unexpected);
    });

    it('reads numbered marks and their one numbered note (42:52)', () => {
      const ayat = ayatOf(read(42, among(42, 52, ASH_SHURA_52_ROW)));
      expect(ayat).toHaveLength(53);
      expect(ayat[51]?.ayah).toBe(52);
      expect(ayat[51]?.text.startsWith('سو اسی طرح ہم نے آپ کی طرف اپنے حکم سے')).toBe(
        true,
      );
      expect(ayat[51]?.text).toContain('مقرر ہوئیں)(1) مگر ہم نے');
      expect(ayat[51]?.text.endsWith('صراطِ مستقیم کی طرف ہدایت عطا فرماتے ہیں(2)')).toBe(
        true,
      );
      expect(JSON.stringify(ayat)).not.toContain('شانِ اُمّیت');
      // ONE numbered note holds both entries: each is its own note.
      const notes = notesOf(read(42, among(42, 52, ASH_SHURA_52_ROW)));
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([
        [52, '1:-'],
        [52, '2:-'],
      ]);
      expect(notes[0]?.text.startsWith('آپ صلی اللہ علیہ وآلہ وسلم کی شانِ اُمّیت')).toBe(
        true,
      );
      expect(notes.every((note) => !/[0-9]:-/.test(note.text))).toBe(true);
      // The entries must be exactly the marks, 1…m, in order.
      for (const broken of [
        ASH_SHURA_52_ROW.replace(' 2:- ', ' '),
        ASH_SHURA_52_ROW.replace('عطا فرماتے ہیں(2)', 'عطا فرماتے ہیں'),
        ASH_SHURA_52_ROW.replace('مقرر ہوئیں)(1)', 'مقرر ہوئیں)(3)'),
        ASH_SHURA_52_ROW.replace('1:- آپ', '2:- آپ'),
      ])
        expect(read(42, among(42, 52, broken))).toEqual(unexpected);
    });

    const readIn = (surah: number, html: string, translation: IrfanUlQuranTranslation) =>
      real(html, surah, `${SITE}${irfanUlQuranSurahPath(surah)}`, translation);

    it('reads two English notes of one p.en for the marks "*" and "**" (9:29)', () => {
      const result = readIn(9, among(9, 29, AT_TAWBAH_29_ROW), 'en');
      expect(
        ayatOf(result)[28]?.text.endsWith('submit to the command of the state.**'),
      ).toBe(true);
      const notes = notesOf(result);
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([
        [29, '*'],
        [29, '**'],
      ]);
      expect(notes[0]?.text.startsWith('Jizya legally refers to an indemnity tax')).toBe(
        true,
      );
      expect(notes[1]?.text.startsWith('This verse refers to a retributive')).toBe(true);
      // A note whose run answers no mark of its length fails the page.
      expect(
        readIn(
          9,
          among(9, 29, AT_TAWBAH_29_ROW.replace('state.**</h2>', 'state.*</h2>')),
          'en',
        ),
      ).toEqual(unexpected);
    });

    it('reads an English note whose translation carries no mark as the ayah’s (9:101)', () => {
      const english = readIn(9, among(9, 101, AT_TAWBAH_101_ROW), 'en');
      expect(ayatOf(english)[100]?.text).not.toMatch(/[*٭]/);
      const notes = notesOf(english);
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([[101, '*']]);
      expect(notes[0]?.text.startsWith('Firstly, they were identified')).toBe(true);
      // The Urdu of the same row marks its note, and is read too.
      const urdu = notesOf(readIn(9, among(9, 101, AT_TAWBAH_101_ROW), 'ur'));
      expect(urdu.map((note) => [note.ayah, note.marker])).toEqual([[101, '٭']]);
      expect(urdu[0]?.text.startsWith('ایک بار')).toBe(true);
      // Without its mark the Urdu note is not tied: the Urdu page has no such form.
      const unmarkedUrdu = AT_TAWBAH_101_ROW.replace('عذاب دیں گے٭', 'عذاب دیں گے');
      expect(readIn(9, among(9, 101, unmarkedUrdu), 'ur')).toEqual(unexpected);
    });

    it('keeps the paragraphs of one English note (24:35)', () => {
      const notes = notesOf(readIn(24, among(24, 35, AN_NUR_35_ROW), 'en'));
      expect(notes).toHaveLength(1);
      expect(notes[0]?.marker).toBe('*');
      expect(notes[0]?.text.startsWith('The likeness of Allah’s')).toBe(true);
      expect(notes[0]?.text).toContain('reality of His Light.\n\n‘Abd Allah b. ‘Abbas');
      expect(notes[0]?.text.split('\n\n')).toHaveLength(2);
    });

    it('records no note for a slot that holds only its mark (33:6)', () => {
      const result = readIn(33, among(33, 6, AL_AHZAB_6_ROW), 'en');
      expect(ayatOf(result)[5]?.text).toContain('their (own) souls,*');
      expect(notesOf(result)).toEqual([]);
    });

    it('reads an Urdu note opened "٭:" with its marker as written (33:37)', () => {
      const notes = notesOf(readIn(33, among(33, 37, AL_AHZAB_37_ROW), 'ur'));
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([[37, '٭:']]);
      expect(notes[0]?.text.startsWith('(کہ')).toBe(true);
    });

    it('reads an English note opened with no mark, for the one mark (53:39)', () => {
      const notes = notesOf(readIn(53, among(53, 39, AN_NAJM_39_ROW), 'en'));
      expect(notes.map((note) => [note.ayah, note.marker])).toEqual([[39, '']]);
      expect(
        notes[0]?.text.startsWith('As for Allah’s Grace, there are no limits.'),
      ).toBe(true);
      // With no mark to answer, or two, it is not a known note.
      const unmarked = AN_NAJM_39_ROW.replace('strives for.*</h2>', 'strives for.</h2>');
      expect(readIn(53, among(53, 39, unmarked), 'en')).toEqual(unexpected);
      const twice = AN_NAJM_39_ROW.replace('strives for.*</h2>', 'strives* for.*</h2>');
      expect(readIn(53, among(53, 39, twice), 'en')).toEqual(unexpected);
    });

    it('reads a note’s words and never the address of its link (4:34)', () => {
      const result = readIn(4, among(4, 34, AN_NISA_34_ROW), 'en');
      expect(notesOf(result)).toEqual([
        {
          ayah: 34,
          marker: '*',
          text: 'For details about this translation and the linguistic and legal implications of ‘wadribuhunna’, see appendix.',
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('tid/57724');
    });
  });

  it('accepts notes only as the marks admit them', () => {
    // Each string is one note slot of one paragraph.
    const notesOnly = (
      notes: string[],
      translationText: string,
      translation: IrfanUlQuranTranslation = 'ur',
      englishNoteSlotFilled = true,
    ) =>
      translatorNotes(
        { slots: notes.map((note) => [note]), translationText, englishNoteSlotFilled },
        translation,
      ) !== null;
    const marked = 'مصنوعی٭ مزید';
    expect(notesOnly([], 'مصنوعی')).toBe(true);
    expect(notesOnly([], 'Synthetic*', 'en')).toBe(true);
    // Star notes: "٭" or "*", either way round, no more notes than star marks.
    expect(notesOnly(['٭ مصنوعی'], marked)).toBe(true);
    expect(notesOnly(['٭ مصنوعی'], marked, 'ur', false)).toBe(true);
    // The site also opens a note "٭:" (an-Ahzab 33:37) or "٭" with no space (39:30).
    expect(notesOnly(['٭: (مصنوعی)'], marked)).toBe(true);
    expect(notesOnly(['٭مصنوعی'], marked)).toBe(true);
    expect(notesOnly(['* مصنوعی'], 'مصنوعی*')).toBe(true);
    expect(notesOnly(['٭ مصنوعی'], 'مصنوعی*')).toBe(true);
    expect(notesOnly(['٭ ایک', '* دو'], 'ایک٭ دو*')).toBe(true);
    expect(notesOnly(['٭ ایک', '٭ دو'], marked)).toBe(false);
    expect(notesOnly(['٭ مصنوعی'], 'مصنوعی')).toBe(false);
    // Numbered: one note, entries exactly the marks 1…m in order.
    expect(notesOnly(['1:- ایک 2:- دو'], 'ایک(1) دو(2)')).toBe(true);
    expect(notesOnly(['1:- ایک'], 'ایک(1)')).toBe(true);
    expect(notesOnly(['1:- ایک'], 'ایک(1) دو(2)')).toBe(false);
    expect(notesOnly(['1:- ایک 2:- دو'], 'ایک(1)')).toBe(false);
    expect(notesOnly(['1:- ایک 3:- دو'], 'ایک(1) دو(3)')).toBe(false);
    expect(notesOnly(['1:- ایک', '1:- ایک'], 'ایک(1)')).toBe(false);
    expect(notesOnly(['1:- ایک'], 'مصنوعی')).toBe(false);
    expect(notesOnly(['1:- ایک'], marked)).toBe(false);
    // Unmarked: the only note, one mark of any form, and the English note slot filled.
    expect(notesOnly(['مصنوعی حاشیہ'], marked)).toBe(true);
    expect(notesOnly(['مصنوعی حاشیہ'], 'ایک(1)')).toBe(true);
    expect(notesOnly(['مصنوعی حاشیہ'], marked, 'ur', false)).toBe(false);
    expect(notesOnly(['مصنوعی حاشیہ'], 'مصنوعی')).toBe(false);
    expect(notesOnly(['مصنوعی حاشیہ'], 'ایک٭ دو٭')).toBe(false);
    expect(notesOnly(['مصنوعی حاشیہ', '٭ دو'], 'ایک٭ دو٭')).toBe(false);
    // English notes (parser version 3, from `p.en`): tied to a star run of
    // their length, or the ayah's when the translation carries no star at all.
    expect(notesOnly(['* Synthetic'], 'Synthetic*', 'en')).toBe(true);
    expect(notesOnly(['* Synthetic'], 'Synthetic', 'en')).toBe(true);
    expect(notesOnly(['* Synthetic'], 'Synthetic', 'ur')).toBe(false);
    expect(notesOnly(['* One', '** Two'], 'One* two**', 'en')).toBe(true);
    expect(notesOnly(['** Two', '* One'], 'One* two**', 'en')).toBe(false);
    expect(notesOnly(['** Two'], 'One*', 'en')).toBe(false);
    expect(notesOnly(['Synthetic'], 'Synthetic*', 'en', false)).toBe(true);
    expect(notesOnly(['Synthetic'], 'Synthetic', 'en')).toBe(false);
    expect(notesOnly(['Synthetic', '* Two'], 'One* two*', 'en')).toBe(false);
    // Numbered entries are an Urdu form only.
    expect(notesOnly(['1:- One'], 'One(1)', 'en')).toBe(false);
    // A marker with no words is no note; continuations join their note.
    expect(notesOnly(['*'], 'Synthetic', 'ur')).toBe(true);
    expect(
      translatorNotes(
        {
          slots: [['* One', 'continued'], ['** Two']],
          translationText: 'One* two**',
          englishNoteSlotFilled: true,
        },
        'en',
      ),
    ).toEqual([
      { marker: '*', text: 'One\n\ncontinued' },
      { marker: '**', text: 'Two' },
    ]);
    expect(
      translatorNotes(
        {
          slots: [['1:- ایک 2:- دو']],
          translationText: 'ایک(1) دو(2)',
          englishNoteSlotFilled: true,
        },
        'ur',
      ),
    ).toEqual([
      { marker: '1:-', text: 'ایک' },
      { marker: '2:-', text: 'دو' },
    ]);
    // More than twenty notes on one ayah is not a note list.
    expect(
      notesOnly(
        Array.from({ length: 21 }, () => '* Synthetic'),
        'Synthetic',
        'en',
      ),
    ).toBe(false);
  });
});
