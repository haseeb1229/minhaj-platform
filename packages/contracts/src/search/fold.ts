/**
 * The MATCHING FOLD — how Search compares text, applied identically to what is
 * indexed, to what a visitor types and to what a results page highlights
 * (Phase 17; Arabic-script orthography, Quran Part 4).
 *
 * ENGINE-INDEPENDENT AND PURE. No engine grammar, no catalogue, no database:
 * it maps text to text. It lives in the Layer-0 search vocabulary so the
 * Search foundation (index and query) and the results pages (highlighting)
 * run ONE implementation — a highlight that folded differently from the
 * engine would mark words the engine did not match, and miss ones it did.
 *
 * MATCHING TEXT ONLY. Nothing folded is ever displayed or stored as content.
 * Stored text — and above all the canonical Quran text, which is compared by
 * exact code points (DOMAIN_MODEL.md §8.3) — is never touched: the fold runs
 * on a derived copy inside the index and on the visitor's query.
 *
 * TWO FOLDS OF ONE TEXT.
 *
 *   - The PLAIN fold, used for everything a visitor types and for every
 *     indexed text: composed (NFC), lower-cased, Arabic-script harakat and
 *     Quranic annotation marks removed, joiners and tatweel removed, and the
 *     letters that ordinary typing writes interchangeably unified (alef forms and alef wasla; alef maqsura,
 *     Arabic and Urdu/Farsi yeh and yeh with hamza; waw with hamza; Arabic kaf
 *     and keheh; taa marbuta and the Arabic and Urdu heh forms).
 *
 *   - The READING fold, used only to ADD words to an indexed text. The Uthmani
 *     orthography writes some long vowels as small marks rather than letters:
 *     a superscript (dagger) alef, a small waw or yeh, a waw that carries the
 *     dagger alef (ṣalāh written ṣalawāh), a hamza on a tatweel or on the
 *     line where ordinary spelling gives it a seat (ءامنوا for آمنوا). Ordinary
 *     spelling sometimes writes those vowels as letters (al-kitāb: الكتاب) and
 *     sometimes does not (al-raḥmān: الرحمن), so neither fold alone matches
 *     every typed word. The plain fold drops the marks; the reading fold reads
 *     them as the letters they stand for; an indexed text carries the words of
 *     both. A query is folded plainly, and so meets either spelling.
 *
 * A fold is lossy on purpose — "كاتب" and "كتب" are different words that fold
 * apart, but a word typed with or without its marks, its hamza seat or its
 * Urdu letter forms folds together. Precision is the engine's ranking's job;
 * the fold's job is that what a visitor types can be found at all.
 */

/**
 * Arabic-script combining marks removed by both folds (except where the
 * reading fold reads one as a letter first): harakat, tanwin, shadda, sukun,
 * the superscript alef, and the Quranic annotation signs.
 */
const ARABIC_MARK =
  /^[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]$/u;

/** Letters ordinary typing writes interchangeably, and the one each folds to. */
const LETTERS: Readonly<Record<string, string>> = Object.freeze({
  '\u0622': '\u0627', // آ alef with madda → ا
  '\u0623': '\u0627', // أ alef with hamza above → ا
  '\u0625': '\u0627', // إ alef with hamza below → ا
  '\u0671': '\u0627', // ٱ alef wasla → ا
  '\u0672': '\u0627', // ٲ alef with wavy hamza above → ا
  '\u0673': '\u0627', // ٳ alef with wavy hamza below → ا
  '\u0649': '\u064A', // ى alef maqsura → ي
  '\u06CC': '\u064A', // ی Farsi/Urdu yeh → ي
  '\u0626': '\u064A', // ئ yeh with hamza → ي
  '\u0624': '\u0648', // ؤ waw with hamza → و
  '\u06A9': '\u0643', // ک keheh → ك
  '\u0629': '\u0647', // ة taa marbuta → ه
  '\u06C1': '\u0647', // ہ heh goal → ه
  '\u06C2': '\u0647', // ۂ heh goal with hamza → ه
  '\u06C3': '\u0647', // ۃ taa marbuta goal → ه
  '\u06BE': '\u0647', // ھ heh doachashmee → ه
});

/**
 * Characters that change no word: the zero-width non-joiner and joiner Urdu
 * uses inside compounds, tatweel, and the small waw and yeh of the Uthmani
 * text (letters in Unicode, marks in the reading). The hamza on the line is a
 * letter and stays: the Arabic word breaker reads a word by it (a word typed
 * with it is found behind a joined preposition only while both keep it).
 */
const SILENT = new Set(['\u200C', '\u200D', '\u0640', '\u06E5', '\u06E6']);

const TATWEEL = '\u0640';
const ALEF = '\u0627';
const ALEF_WASLA = '\u0671';
const ALEF_MAQSURA = '\u0649';
const YEH = '\u064A';
const FARSI_YEH = '\u06CC';
const WAW = '\u0648';
const HEH = '\u0647';
const LAM = '\u0644';
const FEH = '\u0641';
const HAMZA = '\u0621';
const SMALL_WAW = '\u06E5';
const SMALL_YEH = '\u06E6';

const FATHA = '\u064E';
const DAMMA = '\u064F';
const KASRA = '\u0650';
const SHADDA = '\u0651';
const FATHATAN = '\u064B';
const DAMMATAN = '\u064C';
const KASRATAN = '\u064D';
const HAMZA_ABOVE = '\u0654';
const DAGGER_ALEF = '\u0670';
const SMALL_HIGH_YEH = '\u06E7';

/** One base character with the combining marks that follow it. */
interface Cluster {
  /** UTF-16 offsets of the cluster in the ORIGINAL text. */
  readonly start: number;
  readonly end: number;
  /** The base, composed (NFC) with its marks where Unicode composes them. */
  readonly base: string;
  readonly marks: readonly string[];
}

const COMBINING = /^\p{M}$/u;
const LETTER = /^\p{L}$/u;

/**
 * The text as clusters, each composed on its own — so a fold can say which
 * stretch of the ORIGINAL text every folded character came from (what the
 * highlighter needs) while folding exactly as a whole-text NFC would.
 */
function clustersOf(text: string): Cluster[] {
  const clusters: Cluster[] = [];
  let start = 0;
  let current = '';
  const flush = (end: number) => {
    if (current === '') return;
    const [base = '', ...marks] = [...current.normalize('NFC')];
    clusters.push({ start, end, base, marks });
  };
  let offset = 0;
  for (const point of text) {
    if (!COMBINING.test(point) && current !== '') {
      flush(offset);
      start = offset;
      current = '';
    }
    current += point;
    offset += point.length;
  }
  flush(offset);
  return clusters;
}

/** The plain fold of one base character. */
function baseFold(base: string): string {
  if (SILENT.has(base) || ARABIC_MARK.test(base)) return '';
  return LETTERS[base] ?? base.toLowerCase();
}

/** Marks that are not Arabic-script marks survive both folds, as they always have. */
function otherMarks(marks: readonly string[]): string {
  return marks.filter((mark) => !ARABIC_MARK.test(mark)).join('');
}

const isLetter = (cluster: Cluster | undefined): cluster is Cluster =>
  cluster !== undefined && LETTER.test(cluster.base) && !SILENT.has(cluster.base);

/** One-letter prefixes joined to a word: a hamza after one begins the word. */
const PREFIXES = new Set(['\u0628', '\u0644', '\u0643', WAW, '\u0641']);

/**
 * Where a hamza written apart from its seat (on the line, or on a tatweel)
 * sits in ordinary spelling, as the letter that seat folds to: at the start
 * of a word — after a joined prefix too — on an alef; after or under a kasra,
 * or after a yeh, on a yeh (شيئا, سيئات, إسرائيل); under a damma on a waw;
 * otherwise on an alef (يسألون). After a long alef it stays on the line
 * (أشياءهم); an alef seat before an alef is that alef itself (بآيات, الآن),
 * which adds nothing.
 */
function hamzaSeat(clusters: readonly Cluster[], index: number): string {
  const own = clusters[index]?.marks ?? [];
  const previous = clusters[index - 1];
  const next = clusters[index + 1];
  const before = previous?.marks ?? [];
  const prefixed =
    previous !== undefined &&
    PREFIXES.has(previous.base) &&
    !isLetter(clusters[index - 2]);
  let seat = ALEF;
  if (prefixed || !isLetter(previous)) seat = ALEF;
  else if (previous.base === ALEF) return HAMZA;
  else if (own.includes(KASRA) || own.includes(KASRATAN) || before.includes(KASRA))
    seat = YEH;
  else if (previous.base === YEH || previous.base === ALEF_MAQSURA) seat = YEH;
  else if (own.includes(DAMMA) || own.includes(DAMMATAN)) seat = WAW;
  return seat === ALEF && next?.base === ALEF ? '' : seat;
}

/**
 * The reading fold of one cluster: the Uthmani marks that stand for letters
 * read as those letters, before the plain fold removes the rest.
 */
function readingFold(clusters: readonly Cluster[], index: number): string {
  const cluster = clusters[index];
  if (cluster === undefined) return '';
  const previous = clusters[index - 1];
  const next = clusters[index + 1];
  const { base, marks } = cluster;
  const has = (mark: string) => marks.includes(mark);
  const wordStart = !isLetter(previous);
  // A word's start, or just after the conjunction joined to it (وَ, فَ).
  const startsAt = (at: number) => {
    const before = clusters[at - 1];
    return (
      !isLetter(before) ||
      ((before?.base === WAW || before?.base === FEH) && !isLetter(clusters[at - 2]))
    );
  };

  // A small waw or yeh lengthens a pronoun's vowel after heh (bihī, lahū) —
  // never written in ordinary spelling — and is a written letter elsewhere.
  if (base === SMALL_WAW || base === SMALL_YEH) {
    if (previous?.base === HEH) return '';
    return base === SMALL_WAW ? WAW : YEH;
  }
  // A hamza on the line is written with the alef after it at a word's start
  // (ءامنوا is آمنوا), and on its seat inside a word (إسرائيل); otherwise it
  // stays on the line, as typed.
  if (base === HAMZA) {
    const voweled = [FATHA, DAMMA, KASRA, FATHATAN, DAMMATAN, KASRATAN].some(has);
    if (wordStart) return next?.base === ALEF ? '' : HAMZA;
    return isLetter(next) && voweled ? hamzaSeat(clusters, index) : HAMZA;
  }

  let core = baseFold(base);
  // A hamza carried by a tatweel, or by a letter it does not compose with, is
  // written on its seat.
  if (has(HAMZA_ABOVE)) core += hamzaSeat(clusters, index);
  if (has(SMALL_HIGH_YEH)) core += YEH;

  if (has(DAGGER_ALEF)) {
    // The Uthmani text often sets the dagger alef on a tatweel after the
    // letter it lengthens; the letter it belongs to is then the one before.
    const bearer = base === TATWEEL ? previous : cluster;
    const bearerAt = base === TATWEEL ? index - 1 : index;
    const vocative =
      // يَـٰٓأَيُّهَا, يَـٰقَوْمِ: the vocative particle joined to its noun → يا أيها.
      (bearer?.base === YEH && startsAt(bearerAt) && isLetter(next)) ||
      // هَـٰٓأَنتُمْ: the attention particle joined to a pronoun → ها أنتم.
      (bearer?.base === HEH && startsAt(bearerAt) && next?.base === '\u0623');
    if (vocative) {
      core = base === TATWEEL ? `${ALEF} ` : `${core}${ALEF} `;
    } else if (base === WAW && !has(FATHA)) {
      // A waw that carries the dagger alef IS the alef (الصلاة, الحياة).
      core = ALEF;
    } else if (base === ALEF_MAQSURA) {
      // Inside a word the alef maqsura is written as an alef (أدراك).
      core = isLetter(next) ? ALEF : YEH;
    } else if (base !== YEH && base !== FARSI_YEH) {
      core += ALEF;
    }
  }

  // The article's lam assimilated into a lam that follows it (الليل).
  if (base === LAM && has(SHADDA) && previous?.base === ALEF_WASLA) core = `${LAM}${LAM}`;

  return core + otherMarks(marks);
}

/**
 * One fold of a text, as segments: what each cluster of the ORIGINAL text
 * folds to, with the cluster's offsets — so a match found in the folded text
 * can be traced to the exact characters, marks included, it came from.
 */
export interface FoldedSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

export function foldSegments(text: string, reading = false): readonly FoldedSegment[] {
  const clusters = clustersOf(text);
  return clusters.map((cluster, index) => ({
    text: reading
      ? readingFold(clusters, index)
      : baseFold(cluster.base) + otherMarks(cluster.marks),
    start: cluster.start,
    end: cluster.end,
  }));
}

/** The plain fold: what every query and every indexed text is matched as. */
export function foldForMatching(text: string): string {
  return foldSegments(text)
    .map((segment) => segment.text)
    .join('');
}

/** The reading fold: the Uthmani marks read as letters, otherwise plain. */
export function foldForReading(text: string): string {
  return foldSegments(text, true)
    .map((segment) => segment.text)
    .join('');
}

/** A word: letters, combining marks and digits. Everything else separates. */
export const MATCH_WORD = /[\p{L}\p{M}\p{N}]+/gu;

/**
 * The words the reading fold adds to a text: those its reading spells
 * differently from its plain fold, each once, in order of appearance.
 */
export function readingWords(text: string): readonly string[] {
  const plain = new Set(foldForMatching(text).match(MATCH_WORD) ?? []);
  const added: string[] = [];
  for (const word of foldForReading(text).match(MATCH_WORD) ?? []) {
    if (plain.has(word)) continue;
    plain.add(word);
    added.push(word);
  }
  return added;
}
