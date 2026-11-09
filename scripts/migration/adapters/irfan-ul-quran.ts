import type { CheerioAPI } from 'cheerio';

import {
  SURAH_AYAH_COUNTS,
  canonicalSourceUrl,
  type MigrationSourceAdapter,
  type ParseResult,
  type ParsedQuranTranslation,
} from '@minhaj/contracts/migration';

import { cleanText, decodeHtml, loadHtml } from './html-source.ts';
import {
  checkSelection,
  fixedItemDiscovery,
  pathOf,
  retrieveOnce,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * IRFAN-UL-QURAN — `quran.translation`, REVIEW-ONLY (MIGRATION_STRATEGY.md
 * §3.2; payloads.ts): the translation of one surah is preserved, normalised
 * and reviewed as migration EVIDENCE and is never published by migration.
 *
 * Urdu (`h2.ur`, the Irfan-ul-Quran) and English (`h2.en`, which the site
 * labels "English - Manifest") are SEPARATE SOURCES, one registration each;
 * the same surah page is therefore one record per source, and the external
 * key is the surah page URL itself (a fragment would be dropped by
 * `canonicalSourceUrl`, so none is used).
 *
 *   discover — the selected surah NUMBERS through the fixed table below: no
 *              listing is fetched and no URL is guessed. One page.
 *   parse    — the surah page carries every translation of every ayah:
 *                work    the site's own label for the translation, exactly
 *                        (`.sortable-item[data-type=…] .text`);
 *                surah   `button.ayat-menu-trigger[data-sura]`, which every
 *                        row and the page URL must agree on;
 *                ayat    one per `div.brows-job-list` row: `data-ayat`, and
 *                        the FIRST `h2.{ur|en}` of the row exactly as the
 *                        site wrote it, minus only the leading "{n}." the
 *                        site prepends — and only when n IS that row's
 *                        ayah. The rows must be exactly ayat 1…count of the
 *                        surah, or the page FAILS: religious text is never
 *                        silently partial.
 *                notes   (parser version 3, Quran Part 6) the translator's
 *                        own notes, each READ verbatim into its own place —
 *                        the ayah, the mark it opens with as written, and
 *                        its words: on the Urdu page every later `h2.ur` of
 *                        the row, on the English page the row's `p.en`
 *                        (`translatorNotes`). A note is commentary BESIDE the
 *                        translation: its mark stays in the ayah's text
 *                        exactly as written and is never moved. Each note
 *                        must be tied to the translation's own marks in a
 *                        surveyed form, or the page FAILS; a later `h2.en`
 *                        holding anything still fails it.
 *              NOT READ: the Arabic in any script (not this kind; the
 *              `data-uthmani` attribute is font glyph codes, not text), the
 *              other translations, the copy payloads, recitation audio, and of
 *              a note its markup — an italic, a link's address — only its
 *              words are read.
 */

export const IRFAN_UL_QURAN_ADAPTER_KEY = 'irfan-ul-quran-translation';
export const IRFAN_UL_QURAN_HOST = 'www.irfan-ul-quran.com';
export const IRFAN_UL_QURAN_DEFAULT_BASE_URL = `https://${IRFAN_UL_QURAN_HOST}/`;

/**
 * Each surah's page slug, index = surah number − 1. Taken from the site's
 * own numbered surah selector ("1 - Al-Fatihah" … "114 - Al-Nas", the
 * `select.selectpicker` on every surah page; surveyed 2026-10-27) and
 * cross-checked against the 114 surah URLs of its sitemap. The page is
 * `/english/Surah-{slug}-with-english-translation` — the form of the
 * sitemap and of `og:url`, served with a 200.
 */
export const IRFAN_UL_QURAN_SURAH_SLUGS: readonly string[] = Object.freeze([
  'al-Fatihah',
  'al-Baqarah',
  'Al-i-Imran',
  'an-Nisa',
  'al-Maidah',
  'al-Anam',
  'al-Araf',
  'al-Anfal',
  'at-Tawbah',
  'Yunus',
  'Hud',
  'Yusuf',
  'ar-Rad',
  'Ibrahim',
  'al-Hijr',
  'an-Nahl',
  'al-Isra',
  'al-Kahf',
  'Maryam',
  'Taha',
  'al-Ambiya',
  'al-Hajj',
  'al-Muminun',
  'an-Nur',
  'al-Furqan',
  'ash-Shuara',
  'an-Naml',
  'al-Qasas',
  'al-Ankabut',
  'ar-Rum',
  'Luqman',
  'as-Sajdah',
  'al-Ahzab',
  'Saba',
  'Fatir',
  'Yasin',
  'as-Saffat',
  'Sad',
  'az-Zumar',
  'Ghafir',
  'Fussilat',
  'ash-Shura',
  'az-Zukhruf',
  'ad-Dukhan',
  'al-Jathiyah',
  'al-Ahqaf',
  'Muhammad',
  'al-Fath',
  'al-Hujurat',
  'Qaf',
  'adh-Dhariyat',
  'at-Tur',
  'an-Najm',
  'al-Qamar',
  'ar-Rahman',
  'al-Waqiah',
  'al-Hadid',
  'al-Mujadalah',
  'al-Hashr',
  'al-Mumtahinah',
  'as-Saff',
  'al-Jumuah',
  'al-Munafiqun',
  'at-Taghabun',
  'at-Talaq',
  'at-Tahrim',
  'al-Mulk',
  'al-Qalam',
  'al-Haqqah',
  'al-Maarij',
  'Nuh',
  'al-Jinn',
  'al-Muzzammil',
  'al-Muddaththir',
  'al-Qiyamah',
  'al-Insan',
  'al-Mursalat',
  'an-Naba',
  'an-Naziat',
  'Abasa',
  'at-Takwir',
  'al-Infitar',
  'al-Mutaffifin',
  'al-Inshiqaq',
  'al-Buruj',
  'at-Tariq',
  'al-Ala',
  'al-Ghashiyah',
  'al-Fajr',
  'al-Balad',
  'ash-Shams',
  'al-Layl',
  'ad-Duha',
  'ash-Sharh',
  'at-Tin',
  'al-Alaq',
  'al-Qadr',
  'al-Bayyinah',
  'az-Zalzalah',
  'al-adiyat',
  'al-Qariah',
  'at-Takathur',
  'al-Asr',
  'al-Humazah',
  'al-Fil',
  'al-Quraysh',
  'al-Maun',
  'al-Kawthar',
  'al-Kafirun',
  'an-Nasr',
  'al-masad',
  'al-Ikhlas',
  'al-Falaq',
  'al-Nas',
]);

export type IrfanUlQuranTranslation = 'ur' | 'en';

export interface IrfanUlQuranTranslationAdapterOptions {
  /** The site root; `https://www.irfan-ul-quran.com/` only. */
  readonly baseUrl?: string;
  /** `ur`: the Urdu Irfan-ul-Quran (`h2.ur`); `en`: "English - Manifest" (`h2.en`). */
  readonly translation: IrfanUlQuranTranslation;
  /** The selected surah numbers, e.g. `[1, 36, 67]`. */
  readonly surahs: readonly number[];
  readonly selection: SourceSelection;
}

const SURAH_PAGE_PATTERN = /^\/english\/Surah-([A-Za-z-]+)-with-english-translation\/?$/;
const AYAH_ATTRIBUTE = /^[1-9][0-9]{0,2}$/;

/** The page path of a surah number. */
export function irfanUlQuranSurahPath(surah: number): string {
  const slug = IRFAN_UL_QURAN_SURAH_SLUGS[surah - 1];
  if (!Number.isInteger(surah) || slug === undefined) throw new Error('a surah is 1–114');
  return `/english/Surah-${slug}-with-english-translation`;
}

/**
 * The translation's text with the site's leading "{n}." removed — only when
 * n equals the row's ayah; otherwise the text is returned untouched.
 */
export function withoutAyahPrefix(text: string, ayah: number): string {
  const match = /^\s*([0-9]{1,3})\.[^\S\r\n]*/.exec(text);
  if (match === null || Number(match[1]) !== ayah) return text;
  return text.slice(match[0].length);
}

/** A mark the translation sets for a note: a run of stars ("٭", "*", "**") or "(n)". */
const TRANSLATION_MARK = /[٭*]+|\(([0-9]{1,2})\)/g;
/** How a note slot's paragraph opens: a run of stars (with the ":" the site sometimes sets) … */
const STAR_OPENING = /^[٭*]+:?/;
/** … or a numbered entry "1:-", "2:-" … — every one of which in a paragraph is an entry. */
const NUMBERED_OPENING = /^[0-9]{1,2}:-/;
const NUMBERED_ENTRY = /([0-9]{1,2}):-/g;
/** A paragraph break inside a note slot: a `<br>` run (made a blank line) or a blank source line. */
const BLANK_LINE = /\n[\t\f\r ]*\n/;
/** The most notes one ayah may carry (Quran's own ceiling). */
const NOTES_PER_AYAH = 20;

/** ASCII whitespace collapsed to one space and trimmed — every other character kept exactly. */
function collapsed(text: string): string {
  return text.replace(/[\t\n\f\r ]+/g, ' ').replace(/^ | $/g, '');
}

/** Whether the numbers are exactly 1, 2, … in order (and at least one). */
function countsFromOne(numbers: readonly number[]): boolean {
  return numbers.length > 0 && numbers.every((value, index) => value === index + 1);
}

/** One translator's note as the page sets it: its opening mark ('' for none) and its words. */
export interface IrfanUlQuranNote {
  readonly marker: string;
  readonly text: string;
}

/** What a row needs, to read its translator's notes and tell them from anything else. */
export interface IrfanUlQuranNoteRow {
  /**
   * The row's note slots in order — on the Urdu page each later `h2.ur`, on
   * the English page each `p.en` — each as its paragraphs (`<br>` runs and
   * blank source lines break them), ASCII whitespace collapsed, empty ones
   * dropped.
   */
  readonly slots: readonly (readonly string[])[];
  /** The row's translation, the first `h2` (where its marks are). */
  readonly translationText: string;
  /** Whether the row's English note slot, `p.en`, holds anything. */
  readonly englishNoteSlotFilled: boolean;
}

/**
 * A note slot's paragraphs as notes. A paragraph that opens with a star run
 * begins a note with that run (and its ":") as its marker; one that opens
 * "1:-" holds numbered entries, each its own note marked "n:-"; one that
 * opens with no mark continues the note before it in the same slot (a
 * paragraph break, kept as one blank line) or, first in its slot, is a note
 * opened with no mark. A marker with no words after it is not a note.
 */
function slotNotes(paragraphs: readonly string[]): IrfanUlQuranNote[] {
  const notes: { marker: string; text: string }[] = [];
  for (const paragraph of paragraphs) {
    if (NUMBERED_OPENING.test(paragraph)) {
      const entries = [...paragraph.matchAll(NUMBERED_ENTRY)];
      entries.forEach((entry, index) => {
        const from = entry.index + entry[0].length;
        const to = entries[index + 1]?.index ?? paragraph.length;
        notes.push({ marker: entry[0], text: collapsed(paragraph.slice(from, to)) });
      });
      continue;
    }
    const star = STAR_OPENING.exec(paragraph);
    if (star !== null) {
      notes.push({ marker: star[0], text: collapsed(paragraph.slice(star[0].length)) });
      continue;
    }
    const last = notes.at(-1);
    if (last === undefined) notes.push({ marker: '', text: paragraph });
    else last.text = last.text === '' ? paragraph : `${last.text}\n\n${paragraph}`;
  }
  return notes.filter((note) => note.text !== '');
}

/**
 * The row's translator's notes, in order, when they are notes and nothing
 * else — or `null`, which fails the page. A note is commentary BESIDE the
 * ayah's translation: it is read into its own place, and its mark stays in
 * the translation exactly as written. Each note is tied to the translation's
 * own marks in one of the forms surveyed on all 114 live pages (2026-11-10):
 *
 *   star      the note opens with a run of stars ("٭" or "*", mixed between a
 *             mark and its note at 47:19; "٭:" at 33:37) and, in order, takes
 *             the next untaken star run of the same length in the translation
 *             ("*" and "**" at 9:29). On the English page only, a translation
 *             with NO star mark at all carries its star notes on the ayah as a
 *             whole (the site drops the English mark: 9:101, 24:11 …);
 *   numbered  Urdu only: entries "1:-" … "m:-" in order answering exactly the
 *             translation's "(1)" … "(m)", in order (42:52);
 *   unmarked  the note opens with no mark — only as the row's ONLY note, when
 *             the translation carries exactly ONE mark of any form, and on the
 *             Urdu page when the row's English note slot is filled (108:1;
 *             English 53:39).
 *
 * Anything else is not a note. Every row version 2 of the rule admitted is
 * admitted, and its ayah's text read is unchanged.
 */
export function translatorNotes(
  row: IrfanUlQuranNoteRow,
  translation: IrfanUlQuranTranslation,
): readonly IrfanUlQuranNote[] | null {
  const notes = row.slots.flatMap(slotNotes);
  if (notes.length === 0) return [];
  if (notes.length > NOTES_PER_AYAH) return null;
  const marks = [...row.translationText.matchAll(TRANSLATION_MARK)].map((match) => ({
    numbered: match[1] === undefined ? null : Number(match[1]),
    size: match[0].length,
  }));
  const starRuns = marks.flatMap((mark, index) =>
    mark.numbered === null ? [{ index, size: mark.size }] : [],
  );
  const numberedMarks = marks.flatMap((mark) =>
    mark.numbered === null ? [] : [mark.numbered],
  );

  const numbered = notes.filter((note) => NUMBERED_OPENING.test(note.marker));
  if (numbered.length > 0) {
    const entries = numbered.map((note) => Number(note.marker.slice(0, -2)));
    if (
      translation !== 'ur' ||
      !countsFromOne(entries) ||
      !countsFromOne(numberedMarks) ||
      entries.length !== numberedMarks.length
    )
      return null;
  }

  if (notes.some((note) => note.marker === '')) {
    if (
      notes.length !== 1 ||
      marks.length !== 1 ||
      (translation === 'ur' && !row.englishNoteSlotFilled)
    )
      return null;
    return notes;
  }

  let after = -1;
  for (const note of notes) {
    if (NUMBERED_OPENING.test(note.marker)) continue;
    const size = note.marker.replace(':', '').length;
    const run = starRuns.find((mark) => mark.index > after && mark.size === size);
    if (run !== undefined) {
      after = run.index;
      continue;
    }
    if (translation === 'en' && starRuns.length === 0) continue;
    return null;
  }
  return notes;
}

/**
 * A note slot's paragraphs, its words only: every `<br>` run and blank
 * source line breaks a paragraph, markup (an italic, a link) gives its words
 * and never its address, and each paragraph is collapsed (`collapsed`).
 */
function paragraphsOf(slot: ReturnType<CheerioAPI>): string[] {
  const words = slot.clone();
  words.find('br').replaceWith('\n\n');
  return words
    .text()
    .split(BLANK_LINE)
    .map(collapsed)
    .filter((paragraph) => paragraph.length > 0);
}

export function createIrfanUlQuranTranslationAdapter(
  options: IrfanUlQuranTranslationAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(
    options.baseUrl ?? IRFAN_UL_QURAN_DEFAULT_BASE_URL,
    IRFAN_UL_QURAN_HOST,
  );
  const translation = options.translation;
  if (translation !== 'ur' && translation !== 'en')
    throw new Error('the translation is ur or en');
  checkSelection(options.selection);
  if (options.surahs.length === 0) throw new Error('select at least one surah');
  const surahs = [...new Set(options.surahs)];
  // Validates every number before anything is discovered.
  const keys = surahs.map((surah) => ({
    surah,
    externalKey: canonicalSourceUrl(new URL(irfanUlQuranSurahPath(surah), base)),
  }));
  const surahBySlug = new Map(
    IRFAN_UL_QURAN_SURAH_SLUGS.map((slug, index) => [slug, index + 1] as const),
  );
  // The selected surahs' pages are the records: one page, no listing fetched.
  const discover = fixedItemDiscovery(
    base,
    keys.map(({ surah, externalKey }) => ({
      externalKey,
      originalUrl: externalKey,
      legacyIdentifier: `surah-${surah}-${translation}`,
    })),
    options.selection.limit,
  );

  return {
    adapterKey: IRFAN_UL_QURAN_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'cheerio-irfan-ul-quran-translation',
    parserVersion: '3',
    contentKind: 'quran.translation',
    accessMethod: 'http',

    discover,

    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      const decoded = decodeHtml(evidence.body, evidence.contentType);
      if (!decoded.ok) return { kind: 'failed', detail: decoded.detail };
      const slug = SURAH_PAGE_PATTERN.exec(pathOf(evidence.finalUrl) ?? '')?.[1];
      const pageSurah = slug === undefined ? undefined : surahBySlug.get(slug);
      if (pageSurah === undefined)
        return { kind: 'excluded', reason: 'not-a-surah-page' };

      const $ = loadHtml(decoded.html);
      const label = $(`.sortable-item[data-type="${translation}"] .text`);
      const work = cleanText(label.text());
      if (label.length !== 1 || work.length === 0)
        return { kind: 'failed', detail: 'translation-label-missing' };

      const rows = $('div.brows-job-list');
      if (rows.length === 0)
        return { kind: 'failed', detail: 'record-structure-missing' };

      const ayat: { ayah: number; text: string }[] = [];
      const notes: { ayah: number; marker: string; text: string }[] = [];
      for (const element of rows.toArray()) {
        const row = $(element);
        const trigger = row.find('button.ayat-menu-trigger').first();
        const sura = trigger.attr('data-sura') ?? '';
        const ayahText = trigger.attr('data-ayat') ?? '';
        if (!AYAH_ATTRIBUTE.test(sura) || !AYAH_ATTRIBUTE.test(ayahText))
          return { kind: 'failed', detail: 'ayah-reference-missing' };
        if (Number(sura) !== pageSurah)
          return { kind: 'failed', detail: 'surah-mismatch' };
        const headings = row.find(`h2.${translation}`);
        if (headings.length === 0)
          return { kind: 'failed', detail: 'translation-missing' };
        // The English page has no note heading: a later `h2.en` that holds
        // anything is not a note, and fails the page.
        const englishSlots = row.find('p.en').toArray();
        if (
          translation === 'en' &&
          headings
            .slice(1)
            .toArray()
            .some((extra) => cleanText($(extra).text()).length > 0)
        )
          return { kind: 'failed', detail: 'translation-structure-unexpected' };
        const slots = (
          translation === 'ur' ? headings.slice(1).toArray() : englishSlots
        ).map((slot) => paragraphsOf($(slot)));
        const rowNotes = translatorNotes(
          {
            slots,
            translationText: headings.first().text(),
            englishNoteSlotFilled: englishSlots.some(
              (slot) => cleanText($(slot).text()).length > 0,
            ),
          },
          translation,
        );
        if (rowNotes === null)
          return { kind: 'failed', detail: 'translation-structure-unexpected' };
        // Exactly the site's text (an empty one is left for validation to
        // name), minus only its own "{n}." prefix and its own end-of-ayah
        // marker — a trailing `<span>o</span>` the page renders as an ornament,
        // never part of a word. Nothing inside the translation is touched.
        const ayah = Number(ayahText);
        const heading = headings.first().clone();
        const marker = heading.children().last();
        const after = marker.get(0)?.nextSibling ?? null;
        if (
          marker.length === 1 &&
          marker.is('span') &&
          marker.text() === 'o' &&
          (after === null || (after.type === 'text' && $(after).text().trim() === ''))
        )
          marker.remove();
        ayat.push({ ayah, text: withoutAyahPrefix(heading.text(), ayah) });
        for (const note of rowNotes) notes.push({ ayah, ...note });
      }

      const count = SURAH_AYAH_COUNTS[pageSurah - 1] ?? 0;
      const numbers = ayat.map((entry) => entry.ayah);
      if (numbers.length !== count || numbers.some((ayah, index) => ayah !== index + 1))
        return { kind: 'failed', detail: 'ayat-incomplete' };

      const record: ParsedQuranTranslation = {
        kind: 'quran.translation',
        title: work,
        primaryLocale: translation,
        languageCode: translation,
        publishedOn: null,
        legacyIdentifier: `surah-${pageSurah}-${translation}`,
        categories: [],
        links: [],
        assets: [],
        work,
        surah: pageSurah,
        ayat,
        notes,
      };
      return { kind: 'parsed', record };
    },
  };
}
