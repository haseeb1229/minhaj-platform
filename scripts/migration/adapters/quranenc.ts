import {
  SURAH_AYAH_COUNTS,
  canonicalSourceUrl,
  type FetchOutcome,
  type MigrationSourceAdapter,
  type ParseResult,
  type ParsedQuranTranslation,
  type StagedTranslationEdition,
} from '@minhaj/contracts/migration';

import {
  checkSelection,
  robotsDisallowed,
  robotsReader,
  retrieveOnce,
  siteRoot,
  type SourceSelection,
} from './source-support.ts';

/**
 * QURANENC.COM — `quran.translation`, REVIEW-ONLY (MIGRATION_STRATEGY.md
 * §3.2; owner decision OWNER-DECISION-2026-11-10-EXTERNAL-REFERENCE-
 * TRANSLATIONS, OPEN_DECISIONS.md §1.2): a famous Urdu or English translation
 * of the meanings, taken from QuranEnc's own public API under its published
 * re-publication terms (https://quranenc.com/en/home/api/) — no modification,
 * addition or deletion; the publisher, the source and the VERSION named; the
 * translation kept up to date. EXTERNAL REFERENCE: not Minhaj-ul-Quran's
 * translation, and not accepted by its religious authority.
 *
 * Each translation is its own registration, pinned below to the edition its
 * import was checked against, and each Surah is one record, its external key
 * the API's own Surah address.
 *
 *   discover — robots.txt, then QuranEnc's own list of the language's
 *              translations: the run is REFUSED (`edition-changed`) unless
 *              that list still names this translation at exactly the pinned
 *              version and last update, so nothing is staged under a version
 *              it is not. Then the selected Surah numbers: no address guessed.
 *   parse    — the API's JSON for one Surah, strictly: exactly the Surah's
 *              ayat, 1…count, each row numbered as its Surah and Ayah;
 *                ayat   each row's `translation`, VERBATIM;
 *                notes  each row's `footnotes`, read into Part 6 notes — the
 *                       mark as the source writes it ("[8]") and the words
 *                       after it, verbatim (`quranEncNotes`). Every mark in
 *                       the translation must be explained by a note, and
 *                       every note must answer a mark, in order — or the
 *                       Surah FAILS: nothing is ever placed by guesswork.
 *              NOT READ: `arabic_text` (not this kind), `id`.
 *              The record carries the pinned edition (key, version, last
 *              update), and the parser version names it, so a new edition
 *              re-reads even unchanged bytes into revisions that say so.
 */

export const QURANENC_ADAPTER_KEY = 'quranenc-translation';
export const QURANENC_HOST = 'quranenc.com';
export const QURANENC_BASE_URL = `https://${QURANENC_HOST}/`;

/** One QuranEnc translation as the platform takes it: its own key, pinned edition and words. */
export interface QuranEncTranslation extends StagedTranslationEdition {
  /** The interface language it is IN, which also names QuranEnc's list of it. */
  readonly language: 'ur' | 'en';
  /** QuranEnc's own title, in the translation's language (its list, localised so). */
  readonly title: string;
  /** QuranEnc's own English description of the translation, verbatim. */
  readonly description: string;
  /** Who publishes it, for the attribution the terms require. */
  readonly publisher: string;
}

/**
 * THE PINNED EDITIONS (QuranEnc's list, checked 2026-11-10). A new version on
 * QuranEnc refuses the next run until the pin is moved here — the terms'
 * update obligation made a deliberate, reviewed act (MIGRATION_STRATEGY.md).
 */
export const QURANENC_TRANSLATIONS: readonly QuranEncTranslation[] = Object.freeze([
  {
    key: 'urdu_junagarhi',
    language: 'ur',
    version: '1.1.3',
    lastUpdate: 1755085049,
    title: 'اردو ترجمہ - محمد جوناگڑھی',
    description:
      'Translated by Muhammad Ibrahim Junagarhi, developed under the supervision of the Rowwad Translation Center. The original translation is available for the purpose of expressing opinion, evaluation, and continuous development.',
    publisher: 'Muhammad Ibrahim Junagarhi (revised under the Rowwad Translation Center)',
  },
  {
    key: 'english_saheeh',
    language: 'en',
    version: '1.1.2',
    lastUpdate: 1750772247,
    title: 'English Translation - Noor International Center',
    description: 'Issued by Noor International Center.',
    publisher: 'Noor International Center (Saheeh International)',
  },
  {
    key: 'english_rwwad',
    language: 'en',
    version: '1.0.21',
    lastUpdate: 1794213356,
    title: 'English Translation - Rowwad Translation Center',
    description:
      'Translated by the team of the Rowwad Translation Center, in cooperation with the Rabwah Dawah Association, the Islamic Content Service Association in Languages, and the IslamHouse.com website.',
    publisher: 'Rowwad Translation Center',
  },
  {
    key: 'english_hilali_khan',
    language: 'en',
    version: '1.1.3',
    lastUpdate: 1793779302,
    title: 'English Translation - Hilali and Khan',
    description: 'Translated by Taqi-ud-Din al-Hilali and Muhammad Muhsin Khan.',
    publisher: 'Taqi-ud-Din al-Hilali and Muhammad Muhsin Khan',
  },
]);

/** A pinned translation by its QuranEnc key, or null. */
export function quranEncTranslation(key: string): QuranEncTranslation | null {
  return QURANENC_TRANSLATIONS.find((entry) => entry.key === key) ?? null;
}

/** QuranEnc's list of one language's translations, its words in English. */
export function quranEncListUrl(language: QuranEncTranslation['language']): string {
  return `${QURANENC_BASE_URL}api/v1/translations/list/${language}?localization=en`;
}

/** The API's address of one Surah of one translation — the record's external key. */
export function quranEncSurahUrl(key: string, surah: number): string {
  if (!Number.isInteger(surah) || surah < 1 || surah > SURAH_AYAH_COUNTS.length)
    throw new Error('a surah is 1–114');
  return `${QURANENC_BASE_URL}api/v1/translation/sura/${key}/${String(surah)}`;
}

/** The translation's public page on QuranEnc — the source the attribution links. */
export function quranEncBrowseUrl(key: string): string {
  return `${QURANENC_BASE_URL}en/browse/${key}`;
}

/** A pinned translation's registration key: `quranenc-` and its QuranEnc key, dashed. */
export function quranEncSourceKey(translation: Pick<QuranEncTranslation, 'key'>): string {
  return `quranenc-${translation.key.replaceAll('_', '-')}`;
}

/**
 * What every view of the translation says of it, as QuranEnc's terms require
 * — its language, publisher, the VERSION its text is, and the source with a
 * link — and that it is an external reference, not Minhaj-ul-Quran's.
 */
export function quranEncAttribution(
  translation: Pick<QuranEncTranslation, 'key' | 'language' | 'publisher'>,
  version: string,
): string {
  const language = translation.language === 'ur' ? 'Urdu' : 'English';
  return (
    `Translation: ${language} — ${translation.publisher}, v${version}, via QuranEnc.com ` +
    `(${quranEncBrowseUrl(translation.key)}). An external reference translation — not ` +
    `Minhaj-ul-Quran International's, and not reviewed by its religious authority.`
  );
}

/* ===========================================================================
 * Footnotes → notes
 * ========================================================================= */

/** A footnote mark as QuranEnc writes it, in a translation or opening a footnote. */
const MARK = /\[([1-9][0-9]{0,3})\]/g;
/** "، [2]" or ", [2]" right after a footnote's own mark: one footnote for several marks. */
const JOINT = /^[\t ]*(?:[،,][\t ]*\[[1-9][0-9]{0,3}\][\t ]*)+/;
/** ASCII whitespace at either end — the separation between footnotes, never their words. */
const ENDS = /^[\t\n\r ]+|[\t\n\r ]+$/g;
/** The most notes one ayah may carry (Quran's own ceiling). */
const NOTES_PER_AYAH = 20;

export interface QuranEncNote {
  readonly marker: string;
  readonly text: string;
}

/**
 * One ayah's `footnotes` as notes, against its `translation` — or `null`,
 * which fails the Surah. The rule, surveyed on every ayah of the four pinned
 * editions (2026-11-10: 6,236 ayat each; 7,603, 1,904, 2,640 and 760 notes):
 *
 *   - a footnote opens with its mark "[n]" at the start of the field, a line,
 *     or after a space (Rowwad sets two on one line), where "[n]" is a mark of
 *     the translation and n is greater than the footnote's before it — and a
 *     mark that opens a line must be such a footnote; its words are everything
 *     up to the next footnote, verbatim, only the separating whitespace at
 *     either end left out;
 *   - a footnote may explain several marks at once — "[1] ، [2] …" (Urdu
 *     5:8): it is ONE note, opened by its first mark, its words verbatim from
 *     after that mark;
 *   - a field that opens with no mark is ONE note on the ayah as a whole, only
 *     where the translation carries no mark (Urdu 2:285);
 *   - every mark of the translation is explained, no mark appears twice, and
 *     the notes follow their marks' order. Anything else is not read.
 */
export function quranEncNotes(
  translation: string,
  footnotes: string,
): readonly QuranEncNote[] | null {
  const marks = [...translation.matchAll(MARK)].map((match) => match[0]);
  if (new Set(marks).size !== marks.length) return null;
  if (footnotes.replace(ENDS, '') === '') return marks.length === 0 ? [] : null;

  const translationMarks = new Set(marks);
  const starts: { index: number; marker: string }[] = [];
  let last = 0;
  for (const match of footnotes.matchAll(MARK)) {
    const before = match.index === 0 ? ' ' : (footnotes[match.index - 1] ?? '');
    const lineStart = /(?:^|\n)[\t ]*$/.test(footnotes.slice(0, match.index));
    const number = Number(match[1]);
    const opens = translationMarks.has(match[0]) && number > last;
    // A mark opening a line always opens a footnote: one the translation does
    // not set, or out of order, is not read.
    if (lineStart && !opens) return null;
    if (!/\s/.test(before) || !opens) continue;
    last = number;
    // "، [2]" right after a footnote's mark belongs to that footnote.
    if (starts.length > 0 && /\][\t ]*[،,][\t ]*$/.test(footnotes.slice(0, match.index)))
      continue;
    starts.push({ index: match.index, marker: match[0] });
  }

  const head = footnotes.slice(0, starts[0]?.index ?? footnotes.length);
  if (head.replace(ENDS, '') !== '') {
    if (starts.length > 0 || marks.length > 0) return null;
    return [{ marker: '', text: footnotes.replace(ENDS, '') }];
  }

  const explained = new Set<string>();
  const notes: QuranEncNote[] = [];
  for (const [index, start] of starts.entries()) {
    const words = footnotes.slice(
      start.index + start.marker.length,
      starts[index + 1]?.index ?? footnotes.length,
    );
    explained.add(start.marker);
    for (const joint of JOINT.exec(words)?.[0].matchAll(MARK) ?? [])
      explained.add(joint[0]);
    const text = words.replace(ENDS, '');
    if (text === '') return null;
    notes.push({ marker: start.marker, text });
  }
  if (notes.length > NOTES_PER_AYAH) return null;
  const order = notes.map((note) => marks.indexOf(note.marker));
  if (order.some((position, index) => index > 0 && position <= (order[index - 1] ?? -1)))
    return null;
  if (marks.some((mark) => !explained.has(mark))) return null;
  return notes;
}

/* ===========================================================================
 * The adapter
 * ========================================================================= */

export interface QuranEncTranslationAdapterOptions {
  /** The pinned translation's QuranEnc key (`QURANENC_TRANSLATIONS`). */
  readonly key: string;
  /** The selected surah numbers. */
  readonly surahs: readonly number[];
  readonly selection: SourceSelection;
}

const SURAH_PATH = /^\/api\/v1\/translation\/sura\/([a-z0-9_]+)\/([1-9][0-9]{0,2})$/;
const NUMBER = /^[1-9][0-9]{0,2}$/;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A JSON body as its UTF-8 text says, or why not. */
function json(
  body: Uint8Array,
  contentType: string | null,
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly detail: string } {
  const type = (contentType ?? '').toLowerCase();
  if ((type.split(';', 1)[0] ?? '').trim() !== 'application/json')
    return { ok: false, detail: 'unsupported-content-type' };
  const charset = /;\s*charset\s*=\s*"?([^";\s]+)"?/.exec(type)?.[1];
  if (charset !== undefined && charset !== 'utf-8' && charset !== 'utf8')
    return { ok: false, detail: 'unsupported-charset' };
  try {
    return {
      ok: true,
      value: JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(body),
      ) as unknown,
    };
  } catch {
    return { ok: false, detail: 'invalid-json' };
  }
}

/** The run's refusal when QuranEnc no longer lists the pinned edition. */
function editionChanged(requestedUrl: string): FetchOutcome {
  return {
    kind: 'refused',
    classification: 'scope-refused',
    requestedUrl,
    detail: 'edition-changed',
  };
}

export function createQuranEncTranslationAdapter(
  options: QuranEncTranslationAdapterOptions,
): MigrationSourceAdapter {
  const base = siteRoot(QURANENC_BASE_URL, QURANENC_HOST);
  const translation = quranEncTranslation(options.key);
  if (translation === null) throw new Error('this QuranEnc translation is not pinned');
  checkSelection(options.selection);
  if (options.surahs.length === 0) throw new Error('select at least one surah');
  // Validates every number before anything is discovered.
  const items = [...new Set(options.surahs)].map((surah) => {
    const externalKey = canonicalSourceUrl(
      new URL(quranEncSurahUrl(translation.key, surah)),
    );
    return {
      externalKey,
      originalUrl: externalKey,
      legacyIdentifier: `${translation.key}-${String(surah)}`,
    };
  });
  const robots = robotsReader(base);
  const edition: StagedTranslationEdition = {
    key: translation.key,
    version: translation.version,
    lastUpdate: translation.lastUpdate,
  };

  return {
    adapterKey: QURANENC_ADAPTER_KEY,
    adapterVersion: '1',
    parserKey: 'json-quranenc-translation',
    // The edition is part of the reading: a new pin re-reads every Surah.
    parserVersion: `1-${translation.version}`,
    contentKind: 'quran.translation',
    accessMethod: 'http',

    async discover(cursor, fetcher) {
      if (cursor !== null) throw new Error('invalid discovery cursor');
      const gate = await robots(fetcher);
      if (gate.kind === 'outcome') return gate;
      const listUrl = quranEncListUrl(translation.language);
      const listed = await fetcher.fetch(listUrl);
      if (listed.kind !== 'response' || listed.status !== 200)
        return { kind: 'outcome', outcome: listed };
      const body = json(listed.body, listed.contentType);
      const entries = body.ok ? record(body.value)?.['translations'] : undefined;
      const entry = Array.isArray(entries)
        ? entries.map(record).find((each) => each?.['key'] === translation.key)
        : undefined;
      if (
        entry === null ||
        entry === undefined ||
        entry['version'] !== translation.version ||
        entry['last_update'] !== translation.lastUpdate
      )
        return { kind: 'outcome', outcome: editionChanged(listUrl) };
      const allowed = items
        .slice(0, options.selection.limit)
        .filter((item) => gate.policy.allows(item.originalUrl));
      if (allowed.length === 0)
        return {
          kind: 'outcome',
          outcome: robotsDisallowed(items[0]?.externalKey ?? base.toString()),
        };
      return { kind: 'page', items: allowed, next: null };
    },

    retrieve: retrieveOnce,

    parse(evidence): ParseResult {
      let url: URL;
      try {
        url = new URL(evidence.finalUrl);
      } catch {
        return { kind: 'excluded', reason: 'not-a-surah-address' };
      }
      const address = url.host === QURANENC_HOST ? SURAH_PATH.exec(url.pathname) : null;
      const surah = Number(address?.[2]);
      const count = SURAH_AYAH_COUNTS[surah - 1];
      if (address?.[1] !== translation.key || count === undefined)
        return { kind: 'excluded', reason: 'not-a-surah-address' };

      const body = json(evidence.body, evidence.contentType);
      if (!body.ok) return { kind: 'failed', detail: body.detail };
      const rows = record(body.value)?.['result'];
      if (!Array.isArray(rows))
        return { kind: 'failed', detail: 'record-structure-missing' };
      if (rows.length !== count) return { kind: 'failed', detail: 'ayat-incomplete' };

      const ayat: { ayah: number; text: string }[] = [];
      const notes: { ayah: number; marker: string; text: string }[] = [];
      for (const [index, entry] of rows.entries()) {
        const row = record(entry);
        const sura = row?.['sura'];
        const aya = row?.['aya'];
        const text = row?.['translation'];
        const footnotes = row?.['footnotes'];
        if (
          typeof sura !== 'string' ||
          typeof aya !== 'string' ||
          !NUMBER.test(sura) ||
          !NUMBER.test(aya)
        )
          return { kind: 'failed', detail: 'ayah-reference-missing' };
        if (Number(sura) !== surah) return { kind: 'failed', detail: 'surah-mismatch' };
        if (Number(aya) !== index + 1)
          return { kind: 'failed', detail: 'ayat-incomplete' };
        if (typeof text !== 'string' || typeof footnotes !== 'string')
          return { kind: 'failed', detail: 'translation-missing' };
        const read = quranEncNotes(text, footnotes);
        if (read === null)
          return { kind: 'failed', detail: 'translation-structure-unexpected' };
        const ayah = index + 1;
        ayat.push({ ayah, text });
        for (const note of read) notes.push({ ayah, ...note });
      }

      const parsed: ParsedQuranTranslation = {
        kind: 'quran.translation',
        title: translation.title,
        primaryLocale: translation.language,
        languageCode: translation.language,
        publishedOn: null,
        legacyIdentifier: `${translation.key}-${String(surah)}`,
        categories: [],
        links: [],
        assets: [],
        work: translation.title,
        surah,
        ayat,
        notes,
        edition,
      };
      return { kind: 'parsed', record: parsed };
    },
  };
}
