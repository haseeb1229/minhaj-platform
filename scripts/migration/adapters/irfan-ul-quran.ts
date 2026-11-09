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
 *                        ayah. Every later `h2` of the class in the row must
 *                        be empty or, on the Urdu page only, the
 *                        translator's note tied to a mark the translation
 *                        carries — a star, numbered or single unmarked note
 *                        (`translatorNotesOnly`; parser version 2). The rows
 *                        must be exactly ayat 1…count of the surah, or the
 *                        page FAILS: religious text is never silently partial.
 *              NOT READ: the Arabic in any script (not this kind; the
 *              `data-uthmani` attribute is font glyph codes, not text), the
 *              other translations, the copy payloads, recitation audio, the
 *              translator's notes (commentary, not the translation: the marks
 *              stay in the ayah's text as written) — of the English note slot
 *              `p.en` only whether it is filled.
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

/** The star marks the Urdu translation sets in an ayah: "٭", or the ASCII "*". */
const STAR_MARK = /[٭*]/g;
/** A numbered mark in the translation: "(1)", "(2)" … */
const NUMBERED_MARK = /\(([0-9]{1,2})\)/g;
/** A numbered entry of a note: "1:-", "2:-" … */
const NUMBERED_ENTRY = /([0-9]{1,2}):-/g;

/** Whether the numbers are exactly 1, 2, … in order (and at least one). */
function countsFromOne(numbers: readonly number[]): boolean {
  return numbers.length > 0 && numbers.every((value, index) => value === index + 1);
}

/** What a row needs, to tell its translator's notes from anything else. */
export interface IrfanUlQuranNoteRow {
  /** The row's later `h2.{ur|en}` texts that are not empty, whitespace-collapsed. */
  readonly notes: readonly string[];
  /** The row's translation, the first `h2` (where its marks are). */
  readonly translationText: string;
  /** Whether the row's English note slot, `p.en`, holds anything (its text is never read). */
  readonly englishNoteSlotFilled: boolean;
}

/**
 * Whether a row's later, non-empty `h2` texts are the translator's own notes
 * and nothing else. Only the Urdu page has them: each row carries a second
 * `h2.ur`, empty unless the translation sets a note mark, and then holding
 * the note (the English page keeps the same notes in `p.en`, never read). A
 * note is commentary, not the ayah's translation: it is recognised and NOT
 * read, and its mark stays in the translation exactly as written. A note is
 * admitted in exactly one of three forms, each tied to the translation's own
 * marks (surveyed on the live pages, 2026-11-09/10):
 *
 *   star      the note opens with "٭" or "*" (the site mixes the two between
 *             a mark and its note, 47:19), and the row has no more star notes
 *             than the translation has star marks;
 *   numbered  the translation's numbered marks are exactly "(1)" … "(m)" in
 *             order, and ONE note opens "1:-" with exactly the entries
 *             "1:-" … "m:-" in order (42:52);
 *   unmarked  the note opens with no mark (108:1) — only as the row's ONLY
 *             note, when the translation carries exactly ONE mark of any
 *             form, and the English note slot of the same row is filled.
 *
 * Anything else is not a note and fails the page. Every row version 2 of the
 * rule admitted ("٭" notes, no more than "٭" marks) is admitted unchanged.
 */
export function translatorNotesOnly(
  row: IrfanUlQuranNoteRow,
  translation: IrfanUlQuranTranslation,
): boolean {
  const { notes, translationText } = row;
  if (notes.length === 0) return true;
  if (translation !== 'ur') return false;
  const starMarks = translationText.match(STAR_MARK)?.length ?? 0;
  const numberedMarks = [...translationText.matchAll(NUMBERED_MARK)].map((match) =>
    Number(match[1]),
  );
  let starNotes = 0;
  let numberedNotes = 0;
  let unmarkedNotes = 0;
  for (const note of notes) {
    if (note.startsWith('٭') || note.startsWith('*')) starNotes += 1;
    else if (note.startsWith('1:-')) {
      const entries = [...note.matchAll(NUMBERED_ENTRY)].map((match) => Number(match[1]));
      if (
        numberedNotes > 0 ||
        !countsFromOne(numberedMarks) ||
        !countsFromOne(entries) ||
        entries.length !== numberedMarks.length
      )
        return false;
      numberedNotes += 1;
    } else unmarkedNotes += 1;
  }
  if (starNotes > starMarks) return false;
  if (unmarkedNotes === 0) return true;
  return (
    notes.length === 1 &&
    starMarks + numberedMarks.length === 1 &&
    row.englishNoteSlotFilled
  );
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
    parserVersion: '2',
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
        const notes = headings
          .slice(1)
          .toArray()
          .map((extra) => cleanText($(extra).text()))
          .filter((text) => text.length > 0);
        const noteRow = {
          notes,
          translationText: headings.first().text(),
          englishNoteSlotFilled: row
            .find('p.en')
            .toArray()
            .some((slot) => cleanText($(slot).text()).length > 0),
        };
        if (!translatorNotesOnly(noteRow, translation))
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
      };
      return { kind: 'parsed', record };
    },
  };
}
