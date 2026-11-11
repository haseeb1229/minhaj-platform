import {
  QURAN_PASSAGES_MAX,
  canonicalPassageOrder,
  passageKey,
  type QuranPassage,
} from '@minhaj/contracts/passage';

/**
 * PROPOSING QURAN PASSAGES FROM A TITLE (Quran Part 8) — the strict,
 * conservative reader behind `docker/staging/bin/tafsir-passages.sh`.
 *
 * A Library Work or a Media Video whose TITLE names a Surah — "Tafseer Sura
 * al-Fatiha", "Dars Surah Maryam", "Sura Aal Imran (verse 13 to 18) ke Batini
 * Ma`arif" — is proposed the passage it names: the whole Surah, or the ayat
 * the title states. Nothing is inferred from a description, a topic, a word
 * that happens to be a Surah's name, or a picture; the staging survey of
 * 2026-11-10 (615 books, 2,020 videos, every title Latin-script) showed why:
 * "Hajj", "Noor", "Qadr", "Muhammad", "Insan", "Tauba", "Asr" and "Juma" are
 * ordinary words in hundreds of titles that explain no Surah.
 *
 * THE RULES — each refusal is a reason code, and a refused title gets nothing:
 *
 *   1. A Surah is named only AFTER A MARKER WORD — `surah`, `sura`, `surat`,
 *      `soorah`, `soora`, `soorat` — optionally followed by the Urdu/Persian
 *      connective `e`/`i`/`ul`/`tul` and the article (`al-`, `an-`, `at-`…).
 *      "Surat-e-Hal" (state of affairs) names nothing: "hal" is no Surah.
 *   2. The name must be ONE Surah's: the canonical names the Quran reader
 *      exposes (the English display names, Tanzil's transliterations), folded
 *      by one spelling rule (`foldName`), plus the small table of common Urdu
 *      and English spellings below (`SPELLINGS`). A folded spelling two Surahs
 *      share is dropped from both, so it can never be matched.
 *   3. A second Surah may follow a matched one after `aur`/`awr`/`and`/`wa`
 *      only when it carries the article ("Surah at-Tur aur an-Najm").
 *   4. Ayat are read only after `verse(s)`/`ayat`/`ayah`/`aayat` with a number
 *      and an optional `to`/`-` number, and only when the title names exactly
 *      ONE Surah; the range must lie within that Surah. A number after any other
 *      word — "Part: 1 - 2", "Volume 3", "Episode: 29", "Session 6" — is never
 *      an Ayah.
 *   5. "Ayat al-Kursi" (in its spellings) is the one named Ayah: 2:255.
 *   6. A marker followed by no Surah name, two Surahs with a range, a range
 *      outside its Surah, or two of an owner's titles that disagree is
 *      AMBIGUOUS, and nothing is proposed.
 *
 * Pure: the operator command reads the names and the titles, this decides.
 */

export interface SurahNameInput {
  readonly number: number;
  readonly ayahCount: number;
  /** The reader's display names in every locale it holds (e.g. Tanzil's `tname`). */
  readonly names: readonly string[];
}

export type TitleRefusal =
  | 'marker-without-surah'
  | 'range-without-one-surah'
  | 'range-outside-surah'
  | 'too-many-passages';

export type TitleReading =
  | { readonly kind: 'none' }
  | { readonly kind: 'passages'; readonly passages: readonly QuranPassage[] }
  | { readonly kind: 'refused'; readonly reason: TitleRefusal };

const MARKERS = new Set(['surah', 'sura', 'surat', 'soorah', 'soora', 'soorat']);
const CONNECTIVES = new Set(['e', 'i', 'ul', 'tul']);
const ARTICLES = new Set([
  'al',
  'an',
  'at',
  'as',
  'ad',
  'ar',
  'az',
  'ash',
  'adh',
  'ath',
  'aal',
  'ale',
]);
const CONJUNCTIONS = new Set(['aur', 'awr', 'and', 'wa', 'o']);
const AYAH_WORDS = new Set([
  'verse',
  'verses',
  'ayat',
  'ayah',
  'aayat',
  'aayah',
  'ayaat',
  'aya',
  'aaya',
]);
const RANGE_WORDS = new Set(['to', 'ta', 'tak', 'se']);

/**
 * Common spellings of Surah names in Minhaj titles that the canonical names do
 * not fold to (survey 2026-11-10), by Surah number. Each is a SPELLING of that
 * Surah's own name, folded like any other; a spelling another Surah shares is
 * dropped by the collision rule.
 */
export const SPELLINGS: Readonly<Record<number, readonly string[]>> = Object.freeze({
  3: ['Al Imran', 'Aal Imran', 'Ale Imran', 'Imran'],
  9: ['Tauba', 'Taubah', 'Tawbah', 'Toba'],
  36: ['Yasin', 'Yaseen', 'Ya Sin'],
  76: ['Dahr', 'Dhar'],
});

/**
 * One spelling rule for a name: lower case, letters only, the article dropped,
 * `ee`→`i` and `oo`→`u`, doubled letters single, `aw`→`au`, and a final `h`
 * after a vowel dropped — so "Al-Faatiha", "Fatihah" and "al-Fatiha" agree.
 */
export function foldName(text: string): string {
  const tokens = tokensOf(text);
  while (tokens.length > 1 && ARTICLES.has(tokens[0] ?? '')) tokens.shift();
  return foldLetters(tokens.join(''));
}

function foldLetters(letters: string): string {
  return letters
    .replace(/ee/gu, 'i')
    .replace(/oo/gu, 'u')
    .replace(/(.)\1+/gu, '$1')
    .replace(/aw/gu, 'au')
    .replace(/([aeiou])h$/u, '$1');
}

/** Lower-case Latin words and numbers, punctuation and apostrophes dropped. */
export function tokensOf(text: string): string[] {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’‘`´ʼʿʾ]/gu, '')
    .split(/[^a-z0-9]+/u)
    .filter((token) => token !== '');
}

/** The folded spellings of every Surah's names, each kept only when unique. */
export function nameIndex(
  surahs: readonly SurahNameInput[],
): ReadonlyMap<string, number> {
  const seen = new Map<string, Set<number>>();
  const add = (spelling: string, surah: number) => {
    const folded = foldName(spelling);
    if (folded.length < 2) return;
    const owners = seen.get(folded) ?? new Set<number>();
    owners.add(surah);
    seen.set(folded, owners);
  };
  for (const surah of surahs) {
    for (const name of surah.names) add(name, surah.number);
    for (const spelling of SPELLINGS[surah.number] ?? []) add(spelling, surah.number);
  }
  const index = new Map<string, number>();
  for (const [folded, owners] of seen)
    if (owners.size === 1) index.set(folded, [...owners][0] ?? 0);
  return index;
}

/** The Surah a span of tokens names, trying the article glued on ("alasr") too. */
function surahAt(
  tokens: readonly string[],
  start: number,
  index: ReadonlyMap<string, number>,
): { readonly surah: number; readonly end: number } | null {
  for (let length = 3; length >= 1; length -= 1) {
    const span = tokens.slice(start, start + length);
    if (span.length < length) continue;
    // A span never runs into a range word or a number.
    if (span.some((token) => /\d/u.test(token) || AYAH_WORDS.has(token))) continue;
    const folded = foldName(span.join(' '));
    const found = index.get(folded);
    if (found !== undefined) return { surah: found, end: start + length };
    if (length === 1) {
      const glued = /^(al|aal)(.{2,})$/u.exec(span[0] ?? '');
      const bare = glued === null ? undefined : index.get(foldLetters(glued[2] ?? ''));
      if (bare !== undefined) return { surah: bare, end: start + 1 };
    }
  }
  return null;
}

/** "Ayat al-Kursi" in its spellings: ayat/aaya/aayat [ul|tul|al] kursi. */
function namesAyatAlKursi(tokens: readonly string[]): boolean {
  return tokens.some(
    (token, position) =>
      (token === 'ayat' ||
        token === 'aaya' ||
        token === 'aayat' ||
        token === 'ayatul' ||
        token === 'ayatulkursi') &&
      (token === 'ayatulkursi' ||
        tokens[position + 1] === 'kursi' ||
        (['ul', 'tul', 'al', 'e'].includes(tokens[position + 1] ?? '') &&
          tokens[position + 2] === 'kursi')),
  );
}

const AYAT_AL_KURSI: QuranPassage = Object.freeze({
  surah: 2,
  ayahFrom: 255,
  ayahTo: 255,
});

/** Reads one title. */
export function readTitle(
  title: string,
  surahs: readonly SurahNameInput[],
  index: ReadonlyMap<string, number> = nameIndex(surahs),
): TitleReading {
  const tokens = tokensOf(title);
  const named: number[] = [];
  let markerMissed = false;

  for (let position = 0; position < tokens.length; position += 1) {
    if (!MARKERS.has(tokens[position] ?? '')) continue;
    let start = position + 1;
    while (CONNECTIVES.has(tokens[start] ?? '')) start += 1;
    const found = surahAt(tokens, start, index);
    if (found === null) {
      markerMissed = true;
      continue;
    }
    named.push(found.surah);
    // Rule 3: "… aur an-Najm" — a second name after a conjunction, with its article.
    let next = found.end;
    while (
      CONJUNCTIONS.has(tokens[next] ?? '') &&
      ARTICLES.has(tokens[next + 1] ?? '') &&
      !MARKERS.has(tokens[next + 1] ?? '')
    ) {
      const following = surahAt(tokens, next + 1, index);
      if (following === null) break;
      named.push(following.surah);
      next = following.end;
    }
    position = next - 1;
  }

  // Rule 4: a stated range.
  let range: { from: number; to: number } | null = null;
  for (let position = 0; position < tokens.length; position += 1) {
    if (!AYAH_WORDS.has(tokens[position] ?? '')) continue;
    const first = tokens[position + 1] ?? '';
    if (!/^\d{1,3}$/u.test(first)) continue;
    let second = tokens[position + 2] ?? '';
    if (RANGE_WORDS.has(second)) second = tokens[position + 3] ?? '';
    const from = Number(first);
    const to = /^\d{1,3}$/u.test(second) ? Number(second) : from;
    if (range !== null) return { kind: 'refused', reason: 'range-without-one-surah' };
    range = { from, to };
  }

  const distinct = [...new Set(named)];
  const passages: QuranPassage[] = [];
  if (range !== null) {
    const [only] = distinct;
    if (only === undefined || distinct.length !== 1)
      return { kind: 'refused', reason: 'range-without-one-surah' };
    const count = surahs.find((surah) => surah.number === only)?.ayahCount ?? 0;
    if (range.from < 1 || range.from > range.to || range.to > count)
      return { kind: 'refused', reason: 'range-outside-surah' };
    passages.push({ surah: only, ayahFrom: range.from, ayahTo: range.to });
  } else
    for (const surah of distinct) {
      const count = surahs.find((entry) => entry.number === surah)?.ayahCount ?? 0;
      if (count > 0) passages.push({ surah, ayahFrom: 1, ayahTo: count });
    }

  if (namesAyatAlKursi(tokens)) passages.push(AYAT_AL_KURSI);
  if (passages.length === 0)
    return markerMissed
      ? { kind: 'refused', reason: 'marker-without-surah' }
      : { kind: 'none' };
  if (passages.length > QURAN_PASSAGES_MAX)
    return { kind: 'refused', reason: 'too-many-passages' };
  const unique = new Map(passages.map((passage) => [passageKey(passage), passage]));
  return { kind: 'passages', passages: canonicalPassageOrder([...unique.values()]) };
}

/**
 * An owner's titles (one per locale) read together: the same passages from
 * every title that names any, else nothing; two that disagree are ambiguous.
 */
export function readTitles(
  titles: readonly string[],
  surahs: readonly SurahNameInput[],
  index: ReadonlyMap<string, number> = nameIndex(surahs),
): TitleReading | { readonly kind: 'refused'; readonly reason: 'titles-disagree' } {
  const readings = titles.map((title) => readTitle(title, surahs, index));
  const refused = readings.find((reading) => reading.kind === 'refused');
  if (refused !== undefined) return refused;
  const found = readings.flatMap((reading) =>
    reading.kind === 'passages' ? [reading.passages] : [],
  );
  const keys = new Set(found.map((passages) => passages.map(passageKey).join(' ')));
  if (keys.size > 1) return { kind: 'refused', reason: 'titles-disagree' };
  const [passages] = found;
  return passages === undefined ? { kind: 'none' } : { kind: 'passages', passages };
}

/* ===========================================================================
 * The plan the operator confirms
 * ========================================================================= */

export interface TitledOwner {
  readonly kind: 'work' | 'video';
  readonly id: string;
  readonly version: number;
  /** Only published records are proposed: the titles the public reads. */
  readonly published: boolean;
  readonly titles: readonly string[];
  /** Whether the record already carries a passage — then it is never touched. */
  readonly hasPassages: boolean;
}

export interface PlannedPassages {
  readonly kind: 'work' | 'video';
  readonly id: string;
  readonly version: number;
  readonly passages: readonly QuranPassage[];
}

export interface PassagePlan {
  readonly planned: readonly PlannedPassages[];
  /** Counts only — never a title. */
  readonly counts: Readonly<Record<string, number>>;
}

/**
 * What the command would apply: every published record whose titles name a
 * passage and that carries none yet, in a stable order (kind, identifier).
 */
export function planPassages(
  owners: readonly TitledOwner[],
  surahs: readonly SurahNameInput[],
): PassagePlan {
  const index = nameIndex(surahs);
  const counts: Record<string, number> = {
    worksRead: 0,
    videosRead: 0,
    unpublished: 0,
    kept: 0,
    works: 0,
    videos: 0,
    passages: 0,
  };
  const planned: PlannedPassages[] = [];
  for (const owner of owners) {
    counts[owner.kind === 'work' ? 'worksRead' : 'videosRead'] =
      (counts[owner.kind === 'work' ? 'worksRead' : 'videosRead'] ?? 0) + 1;
    if (!owner.published) {
      counts['unpublished'] = (counts['unpublished'] ?? 0) + 1;
      continue;
    }
    const reading = readTitles(owner.titles, surahs, index);
    if (reading.kind === 'none') continue;
    if (reading.kind === 'refused') {
      const key = `refused:${reading.reason}`;
      counts[key] = (counts[key] ?? 0) + 1;
      continue;
    }
    if (owner.hasPassages) {
      counts['kept'] = (counts['kept'] ?? 0) + 1;
      continue;
    }
    planned.push({
      kind: owner.kind,
      id: owner.id,
      version: owner.version,
      passages: reading.passages,
    });
    counts[owner.kind === 'work' ? 'works' : 'videos'] =
      (counts[owner.kind === 'work' ? 'works' : 'videos'] ?? 0) + 1;
    counts['passages'] = (counts['passages'] ?? 0) + reading.passages.length;
  }
  planned.sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  return { planned, counts };
}

/**
 * The plan's size and fingerprint: SHA-256 over each planned record's kind,
 * identifier, version and passages, one line each in plan order. A record
 * edited, a title changed or a passage added since the preview changes it.
 */
export function planFingerprint(
  planned: readonly PlannedPassages[],
  digest: (text: string) => string,
): { readonly count: number; readonly fingerprint: string } {
  return {
    count: planned.length,
    fingerprint: digest(
      planned
        .map(
          (entry) =>
            `${entry.kind}:${entry.id}:${String(entry.version)}:${entry.passages.map(passageKey).join(',')}`,
        )
        .join('\n'),
    ),
  };
}
