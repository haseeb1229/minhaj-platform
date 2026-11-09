import { createHash } from 'node:crypto';

/**
 * THE TANZIL READER — operator tooling for Rebaseline R2's staging reference
 * preview (owner decision 2026-11-06; OPEN_DECISIONS.md §1.1).
 *
 * It reads the two files an operator downloaded ONCE from the Tanzil Project —
 * the Uthmani text (`uthmani.xml`) and the Quran metadata (`quran-data.xml`) —
 * and either returns the corpus EXACTLY as published or refuses. Nothing is
 * fetched; nothing is repaired.
 *
 * VERBATIM. Tanzil's licence permits verbatim copies only ("CHANGING IT IS NOT
 * ALLOWED"), and the Quran context compares code points, so no text is
 * normalised, trimmed, re-encoded or rewritten for a font. An attribute that
 * would need decoding (an entity, a quote, a bracket) is REFUSED rather than
 * interpreted; the file's exact SHA-256 must equal the digest the operator
 * recorded when downloading it.
 *
 * STRUCTURE IS CHECKED HERE, IN TOOLING. The Quran context deliberately holds
 * no corpus constant (tests/architecture/phase18-quran-boundaries); the counts
 * below describe the Tanzil edition this tool imports and refuse any file that
 * is not it: 114 Surahs, 6,236 ayat, 30 Juz, 240 quarters (60 hizb), 604 pages
 * and 15 prostrations — and the text and the metadata must agree with each
 * other.
 *
 * HOW THE TWO FILES MUST AGREE:
 *   - every Surah: the same Arabic name, the same ayah count, and the
 *     metadata's running start equal to the ayat before it;
 *   - Juz and hizb: every Juz and every hizb (each fourth quarter) that does not
 *     begin a Surah begins with the text's own rub-el-hizb mark (U+06DE);
 *   - prostrations: the ayat carrying the text's sajdah mark (U+06E9) are
 *     exactly the metadata's 15, and each takes the metadata's type;
 *   - pages: 604 starts, strictly in reading order, from 1:1.
 * The text also marks quarters that are not hizb boundaries; those marks are
 * not compared quarter by quarter, because Tanzil text 1.1 marks 15:49 where
 * metadata 1.0 starts its quarter at 15:50 — a known difference inside a hizb
 * that changes no Juz, hizb or page this tool derives.
 *
 * HIZB IS DERIVED, NOT INVENTED. The schema stores hizb 1–60; Tanzil publishes
 * 240 quarters. An Ayah's hizb is the quarter it lies in, divided by four,
 * rounded up — Tanzil's own boundaries, four quarters to a hizb.
 */

export const TANZIL_EDITION = Object.freeze({
  title: 'Tanzil Quran Text (Uthmani, Version 1.1)',
  version: '1.1',
  script: 'uthmani',
  surahs: 114,
  ayat: 6236,
  juz: 30,
  quarters: 240,
  pages: 604,
  sajdahs: 15,
});

/** The rub-el-hizb mark Tanzil writes at the start of a quarter's first Ayah. */
const RUB_EL_HIZB = '۞';
/** The sajdah mark Tanzil writes in an Ayah of prostration. */
const SAJDAH_MARK = '۩';
/** A byte-order mark, which a verbatim file must not begin with. */
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);
/** The canonical text column: NVARCHAR(4000), counted in UTF-16 units. */
const AYAH_TEXT_MAX = 4000;

export type TanzilRevelation = 'meccan' | 'medinan';
export type TanzilSajdah = 'recommended' | 'obligatory';

export interface TanzilSurah {
  readonly number: number;
  readonly ayahCount: number;
  readonly revelation: TanzilRevelation;
  /** Exactly as both files give it. */
  readonly nameArabic: string;
}

export interface TanzilAyah {
  readonly surah: number;
  readonly ayah: number;
  readonly juz: number;
  readonly hizb: number;
  readonly page: number;
  readonly sajdah: TanzilSajdah | null;
  /** Exactly as the file gives it: never normalised. */
  readonly text: string;
}

export interface TanzilCorpus {
  readonly title: string;
  readonly version: string;
  readonly script: string;
  /** SHA-256 of the text file, lowercase hex — the digest the operator recorded. */
  readonly textSha256: string;
  readonly metadataSha256: string;
  /** The text file's own copyright block, verbatim (its licence requires it in every copy). */
  readonly notice: string;
  readonly surahs: readonly TanzilSurah[];
  readonly ayat: readonly TanzilAyah[];
}

/** A refusal this tool wrote itself: it names a position or a rule, never text. */
export class TanzilCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TanzilCorpusError';
  }
}

function refuse(message: string): never {
  throw new TanzilCorpusError(message);
}

const SHA256 = /^[0-9a-f]{64}$/;

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Bytes to text, refusing anything that is not clean UTF-8 without a BOM. */
function decode(bytes: Uint8Array, label: string): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    refuse(`The ${label} file is not valid UTF-8.`);
  }
  if (text.startsWith(BYTE_ORDER_MARK))
    refuse(`The ${label} file begins with a byte-order mark.`);
  return text;
}

/** An attribute value that needs no decoding: no entity, quote or bracket. */
const PLAIN = '[^"&<>]*';

interface Position {
  readonly surah: number;
  readonly ayah: number;
}

const key = ({ surah, ayah }: Position) => `${surah}:${ayah}`;

/* ===========================================================================
 * The text file
 * ========================================================================= */

interface ParsedText {
  readonly notice: string;
  readonly surahs: readonly { readonly number: number; readonly name: string }[];
  readonly ayat: readonly {
    readonly surah: number;
    readonly ayah: number;
    readonly text: string;
  }[];
}

const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8" ?>';

function parseText(source: string): ParsedText {
  if (!source.startsWith(XML_DECLARATION))
    refuse('The text file does not begin with the expected XML declaration.');
  const open = source.indexOf('<!--', XML_DECLARATION.length);
  const close = source.indexOf('-->', open);
  if (
    open === -1 ||
    close === -1 ||
    source.slice(XML_DECLARATION.length, open).trim() !== ''
  )
    refuse('The text file does not carry its copyright block.');
  const notice = source.slice(open + 4, close).trim();
  if (
    !notice.includes(TANZIL_EDITION.title) ||
    !notice.includes('License: Creative Commons Attribution 3.0')
  )
    refuse('The text file is not Tanzil Uthmani 1.1 under its stated licence.');

  const token = new RegExp(
    [
      String.raw`(\s+)`,
      String.raw`(<quran>)`,
      String.raw`(</quran>)`,
      String.raw`<sura index="(\d{1,3})" name="(${PLAIN})">`,
      String.raw`<aya index="(\d{1,3})" text="(${PLAIN})"(?: bismillah="${PLAIN}")? />`,
      String.raw`(</sura>)`,
    ].join('|'),
    'uy',
  );

  const surahs: { number: number; name: string }[] = [];
  const ayat: { surah: number; ayah: number; text: string }[] = [];
  let state: 'before' | 'quran' | 'sura' | 'after' = 'before';
  let at = close + 3;
  while (at < source.length) {
    token.lastIndex = at;
    const match = token.exec(source);
    if (match === null) refuse(`The text file has unexpected content at offset ${at}.`);
    at = token.lastIndex;
    const [
      ,
      space,
      quranOpen,
      quranClose,
      suraIndex,
      suraName,
      ayaIndex,
      ayaText,
      suraClose,
    ] = match;
    if (space !== undefined) continue;
    if (quranOpen !== undefined) {
      if (state !== 'before') refuse('The text file opens its corpus twice.');
      state = 'quran';
    } else if (quranClose !== undefined) {
      if (state !== 'quran') refuse('The text file closes its corpus out of place.');
      state = 'after';
    } else if (suraIndex !== undefined) {
      if (state !== 'quran') refuse('The text file opens a Surah out of place.');
      const number = Number(suraIndex);
      if (number !== surahs.length + 1)
        refuse(`The text file numbers Surah ${number} out of order.`);
      if (suraName === undefined || suraName === '')
        refuse(`Surah ${number} has no name.`);
      surahs.push({ number, name: suraName });
      state = 'sura';
    } else if (ayaIndex !== undefined) {
      if (state !== 'sura') refuse('The text file has an Ayah outside a Surah.');
      const surah = surahs.length;
      const ayah = Number(ayaIndex);
      const previous = ayat.at(-1);
      const expected =
        previous !== undefined && previous.surah === surah ? previous.ayah + 1 : 1;
      if (ayah !== expected)
        refuse(`The text file numbers ${surah}:${ayah} out of order.`);
      const text = ayaText ?? '';
      if (text === '') refuse(`Ayah ${surah}:${ayah} has no text.`);
      if (text.length > AYAH_TEXT_MAX)
        refuse(`Ayah ${surah}:${ayah} is longer than the store holds.`);
      ayat.push({ surah, ayah, text });
    } else if (suraClose !== undefined) {
      if (state !== 'sura') refuse('The text file closes a Surah out of place.');
      state = 'quran';
    }
  }
  if (state !== 'after') refuse('The text file ends before its corpus is closed.');
  return { notice, surahs, ayat };
}

/* ===========================================================================
 * The metadata file
 * ========================================================================= */

interface ParsedMetadata {
  readonly surahs: readonly {
    readonly number: number;
    readonly ayas: number;
    readonly start: number;
    readonly name: string;
    readonly revelation: TanzilRevelation;
  }[];
  readonly juz: readonly Position[];
  readonly quarters: readonly Position[];
  readonly pages: readonly Position[];
  readonly sajdahs: readonly (Position & { readonly type: TanzilSajdah })[];
}

/** Every `<element …/>` of a kind, each matching the strict shape, numbered 1..n. */
function elements<T>(
  source: string,
  element: string,
  shape: RegExp,
  expected: number,
  build: (match: RegExpExecArray) => T,
): T[] {
  const occurrences = source.split(`<${element} `).length - 1;
  const found: T[] = [];
  for (const match of source.matchAll(shape)) {
    if (Number(match[1]) !== found.length + 1)
      refuse(`The metadata numbers its ${element} entries out of order.`);
    found.push(build(match));
  }
  if (found.length !== occurrences || found.length !== expected)
    refuse(
      `The metadata has ${occurrences} ${element} entries (${found.length} well formed); ` +
        `this edition has ${expected}.`,
    );
  return found;
}

function parseMetadata(source: string): ParsedMetadata {
  if (!/<quran type="metadata" version="1\.0" [^>]*license="cc-by">/u.test(source))
    refuse(
      'The metadata file is not Tanzil Quran Metadata 1.0 under its stated licence.',
    );

  const position = (match: RegExpExecArray): Position => ({
    surah: Number(match[2]),
    ayah: Number(match[3]),
  });
  const boundary = (element: string) =>
    new RegExp(`<${element} index="(\\d+)" sura="(\\d+)" aya="(\\d+)" />`, 'gu');

  return {
    surahs: elements(
      source,
      'sura',
      new RegExp(
        `<sura index="(\\d+)" ayas="(\\d+)" start="(\\d+)" name="(${PLAIN})" tname="${PLAIN}" ` +
          `ename="${PLAIN}" type="(Meccan|Medinan)" order="\\d+" rukus="\\d+" />`,
        'gu',
      ),
      TANZIL_EDITION.surahs,
      (match) => ({
        number: Number(match[1]),
        ayas: Number(match[2]),
        start: Number(match[3]),
        name: match[4] ?? '',
        revelation: match[5] === 'Meccan' ? 'meccan' : 'medinan',
      }),
    ),
    juz: elements(source, 'juz', boundary('juz'), TANZIL_EDITION.juz, position),
    quarters: elements(
      source,
      'quarter',
      boundary('quarter'),
      TANZIL_EDITION.quarters,
      position,
    ),
    pages: elements(source, 'page', boundary('page'), TANZIL_EDITION.pages, position),
    sajdahs: elements(
      source,
      'sajda',
      /<sajda index="(\d+)" sura="(\d+)" aya="(\d+)" type="(recommended|obligatory)" \/>/gu,
      TANZIL_EDITION.sajdahs,
      (match) => ({
        ...position(match),
        type: match[4] === 'obligatory' ? 'obligatory' : 'recommended',
      }),
    ),
  };
}

/* ===========================================================================
 * The Surah names (Quran Part 2)
 * ========================================================================= */

/** One Surah's names exactly as the metadata gives them. */
export interface TanzilSurahNames {
  readonly number: number;
  /** The Arabic name — the corpus's own `nameArabic`, compared before anything is saved. */
  readonly nameArabic: string;
  /** `tname`, verbatim ("Al-Faatiha"): Tanzil's transliteration, never respelled. */
  readonly transliteration: string;
  /** `ename`, verbatim ("The Opening"): the name's English meaning. */
  readonly meaning: string;
}

export interface TanzilNames {
  /** SHA-256 of the metadata file, lowercase hex — the digest the operator recorded. */
  readonly metadataSha256: string;
  readonly surahs: readonly TanzilSurahNames[];
}

/** The longest display name or meaning the store holds (SurahName, NVARCHAR(100)). */
const SURAH_NAME_MAX = 100;

/**
 * Reads the 114 Surahs' names from the Tanzil metadata file — `name`, `tname`
 * and `ename`, each EXACTLY as written — or refuses. The file's SHA-256 must be
 * the digest the operator recorded; every `sura` element must have the strict
 * shape the corpus import already accepts, numbered 1–114 in order; and no
 * value may be empty, need decoding, or exceed what the store holds. Nothing
 * is trimmed, respelled or translated.
 */
export function readTanzilSurahNames(input: {
  readonly metadata: Uint8Array;
  readonly expectedSha256: string;
}): TanzilNames {
  const expected = input.expectedSha256.trim().toLowerCase();
  if (!SHA256.test(expected)) refuse('The expected digest is not a SHA-256 in hex.');
  const metadataSha256 = sha256Hex(input.metadata);
  if (metadataSha256 !== expected)
    refuse(
      'The metadata file is not the one recorded: its SHA-256 differs from the expected digest.',
    );
  const source = decode(input.metadata, 'metadata');
  if (!/<quran type="metadata" version="1\.0" [^>]*license="cc-by">/u.test(source))
    refuse(
      'The metadata file is not Tanzil Quran Metadata 1.0 under its stated licence.',
    );

  const surahs = elements(
    source,
    'sura',
    new RegExp(
      `<sura index="(\\d+)" ayas="\\d+" start="\\d+" name="(${PLAIN})" tname="(${PLAIN})" ` +
        `ename="(${PLAIN})" type="(?:Meccan|Medinan)" order="\\d+" rukus="\\d+" />`,
      'gu',
    ),
    TANZIL_EDITION.surahs,
    (match): TanzilSurahNames => ({
      number: Number(match[1]),
      nameArabic: match[2] ?? '',
      transliteration: match[3] ?? '',
      meaning: match[4] ?? '',
    }),
  );
  for (const surah of surahs) {
    for (const value of [surah.nameArabic, surah.transliteration, surah.meaning]) {
      if (value === '' || value.trim() !== value)
        refuse(`Surah ${surah.number} has an empty or padded name in the metadata.`);
      if (value.length > SURAH_NAME_MAX)
        refuse(`Surah ${surah.number} has a name longer than the store holds.`);
    }
  }
  return { metadataSha256, surahs };
}

/* ===========================================================================
 * The corpus
 * ========================================================================= */

/**
 * The 1-based number of the division each Ayah lies in, given the divisions'
 * starts: each start must name an Ayah of the text, the first must be 1:1 and
 * every one must follow the one before it in reading order.
 */
function divisions(
  label: string,
  starts: readonly Position[],
  order: ReadonlyMap<string, number>,
  total: number,
): number[] {
  const indices = starts.map((start) => {
    const index = order.get(key(start));
    if (index === undefined)
      refuse(`A ${label} starts at ${key(start)}, which the text does not have.`);
    return index;
  });
  if (indices[0] !== 0) refuse(`The first ${label} does not start at 1:1.`);
  for (let i = 1; i < indices.length; i += 1)
    if ((indices[i] ?? 0) <= (indices[i - 1] ?? 0))
      refuse(`The ${label} starts are not in reading order.`);
  const of: number[] = new Array<number>(total);
  let current = 0;
  for (let i = 0; i < total; i += 1) {
    while (current + 1 < indices.length && (indices[current + 1] ?? total) <= i)
      current += 1;
    of[i] = current + 1;
  }
  return of;
}

/**
 * Parses and verifies the two Tanzil files. Returns the corpus exactly as
 * published, or throws `TanzilCorpusError` naming the first rule it breaks.
 */
export function readTanzilCorpus(input: {
  readonly text: Uint8Array;
  readonly metadata: Uint8Array;
  readonly expectedSha256: string;
}): TanzilCorpus {
  const expected = input.expectedSha256.trim().toLowerCase();
  if (!SHA256.test(expected)) refuse('The expected digest is not a SHA-256 in hex.');
  const textSha256 = sha256Hex(input.text);
  if (textSha256 !== expected)
    refuse(
      'The text file is not the one recorded: its SHA-256 differs from the expected digest.',
    );

  const text = parseText(decode(input.text, 'text'));
  const meta = parseMetadata(decode(input.metadata, 'metadata'));

  if (text.surahs.length !== TANZIL_EDITION.surahs)
    refuse(
      `The text has ${text.surahs.length} Surahs; this edition has ${TANZIL_EDITION.surahs}.`,
    );
  if (text.ayat.length !== TANZIL_EDITION.ayat)
    refuse(
      `The text has ${text.ayat.length} ayat; this edition has ${TANZIL_EDITION.ayat}.`,
    );

  // ---- Surahs: names, counts and running starts agree ----------------------
  const counts = new Map<number, number>();
  for (const { surah } of text.ayat) counts.set(surah, (counts.get(surah) ?? 0) + 1);
  let running = 0;
  const surahs: TanzilSurah[] = text.surahs.map((surah, index) => {
    const described = meta.surahs[index];
    const ayahCount = counts.get(surah.number) ?? 0;
    if (described === undefined || described.number !== surah.number)
      refuse(`The metadata does not describe Surah ${surah.number}.`);
    if (described.name !== surah.name)
      refuse(`The two files name Surah ${surah.number} differently.`);
    if (described.ayas !== ayahCount || described.start !== running)
      refuse(`The two files disagree on the ayat of Surah ${surah.number}.`);
    running += ayahCount;
    return {
      number: surah.number,
      ayahCount,
      revelation: described.revelation,
      nameArabic: surah.name,
    };
  });

  // ---- Juz, hizb and page of every Ayah -----------------------------------
  const order = new Map(text.ayat.map((ayah, index) => [key(ayah), index]));
  const total = text.ayat.length;
  const juzOf = divisions('Juz', meta.juz, order, total);
  const quarterOf = divisions('quarter', meta.quarters, order, total);
  const pageOf = divisions('page', meta.pages, order, total);

  const marked = (start: Position, label: string) => {
    if (start.ayah === 1) return;
    const ayah = text.ayat[order.get(key(start)) ?? -1];
    if (ayah === undefined || !ayah.text.startsWith(RUB_EL_HIZB))
      refuse(`The ${label} starting at ${key(start)} is not marked in the text.`);
  };
  meta.juz.forEach((start, index) => marked(start, `Juz ${index + 1}`));
  meta.quarters.forEach((start, index) => {
    if (index % 4 === 0) marked(start, `hizb ${index / 4 + 1}`);
  });

  // ---- Prostrations: the text's marks are exactly the metadata's -----------
  const sajdahs = new Map(meta.sajdahs.map((entry) => [key(entry), entry.type]));
  for (const ayah of text.ayat)
    if (ayah.text.includes(SAJDAH_MARK) !== sajdahs.has(key(ayah)))
      refuse(`The two files disagree on the prostration at ${key(ayah)}.`);

  const ayat: TanzilAyah[] = text.ayat.map((ayah, index) => ({
    surah: ayah.surah,
    ayah: ayah.ayah,
    juz: juzOf[index] ?? 0,
    hizb: Math.ceil((quarterOf[index] ?? 0) / 4),
    page: pageOf[index] ?? 0,
    sajdah: sajdahs.get(key(ayah)) ?? null,
    text: ayah.text,
  }));

  return {
    title: TANZIL_EDITION.title,
    version: TANZIL_EDITION.version,
    script: TANZIL_EDITION.script,
    textSha256,
    metadataSha256: sha256Hex(input.metadata),
    notice: text.notice,
    surahs,
    ayat,
  };
}
