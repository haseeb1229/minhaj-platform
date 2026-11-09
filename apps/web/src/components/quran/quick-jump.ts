import { QURAN_JUZ_MAX } from '@minhaj/contracts/quran';

/**
 * QUICK JUMP — "18", "18:10", "kahf", "juz 15", "hizb 30", "page 50" → one place in the Quran
 * (R2; benchmark pattern 10a). PURE and free of React, so the landing's GET
 * form (`/quran/read?q=`) and its client island answer the same input the same
 * way, and both are unit-tested here.
 *
 * NOTHING HERE KNOWS WHAT THE QURAN SAYS. Which Surahs exist, how many ayat
 * each has and what each is called all arrive in the `index` the caller read
 * from the public reader; a number the index does not have, or an Ayah past a
 * Surah's own count, matches nothing. A name matches only a name the corpus
 * recorded — none is written here — and a hizb only one the corpus recorded,
 * opened in the Juz the reader says holds it (Quran Part 3).
 *
 * FOLDING IS FOR MATCHING ONLY. The input and the recorded names are folded
 * (case, marks, letter variants, punctuation) solely to compare them; nothing
 * folded is ever shown, and no Quran text passes through this module.
 */

export interface JumpSurah {
  readonly number: number;
  readonly ayahCount: number;
  /** Every name the corpus recorded for the Surah, in any script, and their meanings. */
  readonly names: readonly string[];
}

export type QuickJump =
  | { readonly kind: 'surah'; readonly surah: number }
  | { readonly kind: 'ayah'; readonly surah: number; readonly ayah: number }
  | { readonly kind: 'juz'; readonly juz: number }
  | { readonly kind: 'hizb'; readonly hizb: number; readonly juz: number }
  | { readonly kind: 'page'; readonly page: number }
  | { readonly kind: 'unknown' };

/** The longest input worth reading; anything longer matches nothing. */
export const QUICK_JUMP_MAX_LENGTH = 60;

const UNKNOWN: QuickJump = Object.freeze({ kind: 'unknown' });

/** Arabic-Indic (U+0660…) and Extended Arabic-Indic (U+06F0…) digits as ASCII. */
export function asciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/** Letter variants that differ in spelling but not in what a reader means. */
const VARIANTS: Readonly<Record<string, string>> = Object.freeze({
  آ: 'ا', // آ → ا
  أ: 'ا', // أ → ا
  إ: 'ا', // إ → ا
  ٱ: 'ا', // ٱ → ا
  ى: 'ي', // ى → ي
  ی: 'ي', // ی → ي
  ے: 'ي', // ے → ي
  ة: 'ه', // ة → ه
  ہ: 'ه', // ہ → ه
  ھ: 'ه', // ھ → ه
  ک: 'ك', // ک → ك
});

/** Words a visitor may put before a name ("Surah Al-Kahf") — never part of it. */
const NAME_PREFIXES = Object.freeze(['surah', 'surat', 'sura', 'سوره', 'سورت']);

/**
 * A text folded for comparison only: lower case, marks and tatweel removed,
 * letter variants unified, everything that is not a letter or digit dropped,
 * and a doubled Latin letter written once — so "Fatiha" meets the recorded
 * transliteration "Al-Faatiha" (Quran Part 2). Nothing folded is ever shown.
 */
export function foldText(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/ـ/g, '')
    .replace(/./gu, (letter) => VARIANTS[letter] ?? letter)
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/([a-z])\1+/g, '$1');
}

/**
 * A name, or what a visitor typed, folded for comparison (`foldText`), with a
 * leading "Surah" and a leading article ("al", "ال") set aside.
 */
export function foldName(value: string): string {
  let folded = foldText(value);
  for (const prefix of NAME_PREFIXES) {
    if (folded.startsWith(prefix) && folded.length > prefix.length) {
      folded = folded.slice(prefix.length);
      break;
    }
  }
  if (folded.startsWith('al') && folded.length > 4) folded = folded.slice(2);
  else if (folded.startsWith('ال') && folded.length > 3) folded = folded.slice(2);
  return folded;
}

/** The Juz keywords a visitor may type, in the three interface languages. */
const JUZ_PATTERN =
  /^(?:juz|juzz|juza|para|parah|sipara|پارہ|پاره|جزء|الجزء|جز)\s*(\d{1,2})$/u;

/** The same keywords before a bare number ("Juz 15") — the Juz index's filter sets them aside. */
export const JUZ_PREFIX =
  /^(?:juz|juzz|juza|para|parah|sipara|پارہ|پاره|جزء|الجزء|جز)\s*/u;

/** The hizb keywords, in the three interface languages (Quran Part 3). */
export const HIZB_PATTERN = /^(?:hizb|hizbs|ahzab|حزب|الحزب)\s*(\d{1,2})$/u;

/** No hizb recorded: what a corpus without hizb numbers answers. */
const NO_HIZB: ReadonlyMap<number, number> = new Map();

/** The mushaf-page keywords, in the three interface languages (Quran Part 1). */
const PAGE_PATTERN = /^(?:page|pg|p|safha|safhah|صفحہ|صفحه|صفحة|الصفحة)\.?\s*(\d{1,3})$/u;

/** "18:10", "18 10", "18.10", "18-10", "18/10", "18،10". */
const CITATION_PATTERN = /^(\d{1,3})\s*(?:[:.\-/,،]\s*|\s+)(\d{1,3})$/u;

/** "Surah 18", "surah 18:10", "سورة 2" — the word set aside, the rest read again (Quran Part 4). */
const SURAH_KEYWORD = /^(?:surah|surat|sura|soorah|سورة|سوره|سورہ|سورت)\s*/u;

/** "Al-Baqarah 255", "البقرة ٢٥٥", "kahf:10" — a name, then an Ayah number (Quran Part 4). */
const NAMED_CITATION = /^(.*[^\d\s:.\-/,،])\s*(?:[:.\-/,،]\s*|\s+)(\d{1,3})$/u;

/**
 * How a name must match: `loose` — the quick jump's — the whole name, then
 * its start, then (for three letters or more) anywhere in it; `whole` — the
 * Quran search's, where every query is also a text search — the whole name,
 * or one of four letters or more that begins the other ("baqarah" and the
 * recorded "Al-Baqara"), so an ordinary word is not mistaken for a name.
 */
export type NameMatch = 'loose' | 'whole';

/** The Surah a typed name names, or `null` — the lowest-numbered wins a tie. */
function surahNamed(
  raw: string,
  index: readonly JumpSurah[],
  mode: NameMatch,
): JumpSurah | null {
  const wanted = foldName(raw);
  if (wanted.length < 2) return null;
  const folded = index.map((surah) => ({
    surah,
    names: surah.names.map(foldName).filter((name) => name !== ''),
  }));
  const tests: readonly ((name: string) => boolean)[] =
    mode === 'whole'
      ? [
          (name) => name === wanted,
          (name) =>
            Math.min(name.length, wanted.length) >= 4 &&
            (name.startsWith(wanted) || wanted.startsWith(name)),
        ]
      : [
          (name) => name === wanted,
          (name) => name.startsWith(wanted),
          ...(wanted.length >= 3 ? [(name: string) => name.includes(wanted)] : []),
        ];
  for (const test of tests) {
    const found = folded.find((entry) => entry.names.some(test));
    if (found !== undefined) return found.surah;
  }
  return null;
}

/**
 * One place in the Quran, or `unknown` — never a guess beyond the index.
 * `lastPage` is the highest mushaf page the corpus records (0: none), so a
 * page past it, or any page in a corpus without pages, matches nothing.
 * `hizbs` maps each hizb the corpus records to the Juz it begins in
 * (`hizbJuzOf`), so a hizb it does not record matches nothing.
 */
export function parseQuickJump(
  raw: string,
  index: readonly JumpSurah[],
  lastPage = 0,
  hizbs: ReadonlyMap<number, number> = NO_HIZB,
  names: NameMatch = 'loose',
): QuickJump {
  if (raw.length > QUICK_JUMP_MAX_LENGTH) return UNKNOWN;
  const input = asciiDigits(raw).trim().replace(/\s+/g, ' ').toLowerCase();
  if (input === '') return UNKNOWN;
  const surahOf = (number: number) => index.find((surah) => surah.number === number);

  if (/^\d{1,3}$/.test(input)) {
    const surah = surahOf(Number(input));
    return surah === undefined ? UNKNOWN : { kind: 'surah', surah: surah.number };
  }

  const citation = CITATION_PATTERN.exec(input);
  if (citation !== null) {
    const surah = surahOf(Number(citation[1]));
    const ayah = Number(citation[2]);
    return surah === undefined || ayah < 1 || ayah > surah.ayahCount
      ? UNKNOWN
      : { kind: 'ayah', surah: surah.number, ayah };
  }

  const juz = JUZ_PATTERN.exec(input);
  if (juz !== null) {
    const number = Number(juz[1]);
    return number >= 1 && number <= QURAN_JUZ_MAX
      ? { kind: 'juz', juz: number }
      : UNKNOWN;
  }

  const hizb = HIZB_PATTERN.exec(input);
  if (hizb !== null) {
    const number = Number(hizb[1]);
    const juz = hizbs.get(number);
    return juz === undefined ? UNKNOWN : { kind: 'hizb', hizb: number, juz };
  }

  const page = PAGE_PATTERN.exec(input);
  if (page !== null) {
    const number = Number(page[1]);
    return number >= 1 && number <= lastPage ? { kind: 'page', page: number } : UNKNOWN;
  }

  const keyword = SURAH_KEYWORD.exec(input);
  if (keyword !== null && keyword[0].length > 0 && keyword[0].length < input.length) {
    return parseQuickJump(input.slice(keyword[0].length), index, lastPage, hizbs, names);
  }

  // A name and an Ayah number. The whole name first, then the start of one,
  // then — loosely, for three letters or more — anywhere in one; the
  // lowest-numbered Surah wins a tie, so the same input opens the same place.
  const named = NAMED_CITATION.exec(input);
  if (named !== null) {
    const surah = surahNamed(named[1] ?? '', index, names);
    const ayah = Number(named[2]);
    if (surah !== null)
      return ayah >= 1 && ayah <= surah.ayahCount
        ? { kind: 'ayah', surah: surah.number, ayah }
        : UNKNOWN;
  }

  const surah = surahNamed(input, index, names);
  return surah === null ? UNKNOWN : { kind: 'surah', surah: surah.number };
}

/**
 * Each hizb the reader recorded, mapped to the Juz it begins in — from the
 * Juz list's own `hizbs`, in Juz order, so a hizb that ran across two Juz
 * would open where it starts.
 */
export function hizbJuzOf(
  list: readonly { readonly number: number; readonly hizbs: readonly number[] }[],
): ReadonlyMap<number, number> {
  const map = new Map<number, number>();
  for (const juz of [...list].sort((a, b) => a.number - b.number))
    for (const hizb of juz.hizbs) if (!map.has(hizb)) map.set(hizb, juz.number);
  return map;
}

/**
 * The LOCALE-FREE address a jump opens: a Surah, a canonical Ayah citation, a
 * Juz, a hizb in its Juz or a mushaf page — built from numbers the index
 * confirmed, never from the input.
 */
export function quickJumpPathOf(jump: QuickJump): string | null {
  switch (jump.kind) {
    case 'surah':
      return `/quran/surah/${String(jump.surah)}`;
    case 'ayah':
      return `/quran/surah/${String(jump.surah)}/${String(jump.ayah)}`;
    case 'juz':
      return `/quran/juz/${String(jump.juz)}`;
    case 'hizb':
      return `/quran/juz/${String(jump.juz)}?hizb=${String(jump.hizb)}`;
    case 'page':
      return `/quran/page/${String(jump.page)}`;
    case 'unknown':
      return null;
  }
}
