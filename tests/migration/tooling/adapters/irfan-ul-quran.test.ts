import { SURAH_AYAH_COUNTS } from '@minhaj/contracts/migration';
import { describe, expect, it } from 'vitest';

import {
  createIrfanUlQuranTranslationAdapter,
  IRFAN_UL_QURAN_ADAPTER_KEY,
  IRFAN_UL_QURAN_SURAH_SLUGS,
  irfanUlQuranSurahPath,
  withoutAyahPrefix,
  type IrfanUlQuranTranslation,
} from '../../../../scripts/migration/adapters/irfan-ul-quran.ts';

import { evidenceOf, fakeSite, htmlPage, pendingItem, textFile } from './fake-site.ts';

/**
 * The Irfan-ul-Quran translation adapter (REVIEW-ONLY kind) over SYNTHETIC
 * surah pages shaped like the real one. The "translations" here are
 * synthetic placeholder words, never Quran text.
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
      parserVersion: '1',
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
