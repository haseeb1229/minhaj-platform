import {
  QURAN_SURAH_MAX,
  RECITATION_TIMING_MAX_MS,
  recitationStreamSchema,
  type AyahTiming,
  type RecitationStream,
} from '@minhaj/contracts/quran';

/**
 * mp3quran.net, READ — the pure half of the `recitations-mp3quran` import
 * (Quran Part 5; owner decision 2026-11-09, OPEN_DECISIONS.md §1.2; licence
 * register §G1 / study sources §R1). Everything here turns the API's JSON into
 * what Quran records, or refuses it; nothing here fetches or writes.
 *
 * ONLY WHAT THE SOURCE SAYS. A reciter's names are mp3quran's own English and
 * Arabic names, verbatim; a recitation's name, style and riwayah are its
 * moshaf's own English name; the stream is the moshaf's own CDN folder, and is
 * admitted only if the allowlist admits exactly that folder. No biography,
 * portrait or rank is invented.
 *
 * ONLY `start_time` AND `end_time`. The timing entries also carry `polygon`,
 * `x`, `y` and `page` fields pointing at mp3quran's mushaf page images, which
 * are not licensed for reuse here (study sources §R1); they are never read.
 *
 * NEVER ADJUSTED. A Surah whose timing does not cover each of the corpus's
 * ayat exactly once, monotonically, is SKIPPED with its reason, never
 * repaired: an operator sees which Surahs a recitation lacks, and why.
 */

/** The API's own host — the only one the import's fetcher may reach. */
export const MP3QURAN_API_HOST = 'www.mp3quran.net';
export const MP3QURAN_API = `https://${MP3QURAN_API_HOST}/api/v3`;

export const MP3QURAN_ENDPOINTS = Object.freeze({
  timedReads: `${MP3QURAN_API}/ayat_timing/reads`,
  reciters: (language: 'eng' | 'ar') => `${MP3QURAN_API}/reciters?language=${language}`,
  timing: (read: number, surah: number) =>
    `${MP3QURAN_API}/ayat_timing?surah=${String(surah)}&read=${String(read)}`,
});

/** Hafs ʿan ʿĀṣim as the API writes it — the riwayah the Tanzil corpus is numbered in. */
export const HAFS = 'حفص عن عاصم';

/**
 * "The mujawwad mushaf", as the timed-reads list names the riwayah of its
 * mujawwad editions — a style, which names no riwayah. Such a read is Hafs
 * only where its own moshaf says so (`riwayahOf`).
 */
export const MUJAWWAD = 'المصحف المجود';

/**
 * THE CURATED READS: well-known recitations of Hafs ʿan ʿĀṣim — murattal, and
 * the mujawwad editions of the great Egyptian qaris — that mp3quran TIMES Ayah
 * by Ayah (`/ayat_timing/reads`), each pinned to its moshaf id AND its CDN
 * folder, so a changed API can neither substitute another recording nor move
 * one to another host. The first twelve were checked 2026-11-09, the rest
 * 2026-11-10 (owner direction: Alafasy "and some other famous qaris too");
 * every one is timed for all 114 Surahs. A reciter with two reads (Abdul
 * Basit, Al-Husary) is one Person with two recitations, told apart by their
 * moshaf names.
 */
export const CURATED_READS: readonly {
  readonly read: number;
  readonly folder: string;
}[] = Object.freeze([
  { read: 123, folder: 'audio/mishary-alafasy/r1' },
  { read: 53, folder: 'audio/abdulbasit-abdulsamad/r3' },
  { read: 118, folder: 'audio/mahmoud-husary/r1' },
  { read: 112, folder: 'audio/muhammad-minshawi/r1' },
  { read: 30, folder: 'audio/saad-ghamdi/r1' },
  { read: 54, folder: 'audio/abdulrahman-sudais/r1' },
  { read: 31, folder: 'audio/saud-shuraim/r1' },
  { read: 4, folder: 'audio/abubakr-shatri/r1' },
  { read: 5, folder: 'audio/ahmad-ajmi/r1' },
  { read: 92, folder: 'audio/yasser-dosari/r1' },
  { read: 74, folder: 'audio/ali-hudhaifi/r1' },
  { read: 81, folder: 'audio/fares-abbad/r1' },
  { read: 106, folder: 'audio/muhammad-tablawi/r1' },
  { read: 86, folder: 'audio/nasser-qatami/r1' },
  { read: 12, folder: 'audio/idrees-abkar/r1' },
  { read: 60, folder: 'audio/abdullah-basfar/r1' },
  { read: 20, folder: 'audio/khalid-jalil/r1' },
  { read: 109, folder: 'audio/muhammad-ayyub/r1' },
  { read: 76, folder: 'audio/ali-jaber/r1' },
  { read: 217, folder: 'audio/bandar-baleela/r1' },
  { read: 89, folder: 'audio/hani-rifai/r1' },
  { read: 46, folder: 'audio/salah-bukhatir/r1' },
  { read: 62, folder: 'audio/abdullah-juhani/r1' },
  { read: 49, folder: 'audio/abdulbari-thubaiti/r1' },
  { read: 133, folder: 'audio/maher-muaiqly/r3' },
  { read: 51, folder: 'audio/abdulbasit-abdulsamad/r1' },
  { read: 119, folder: 'audio/mahmoud-husary/r2' },
  { read: 288, folder: 'audio/mustafa-ismail/r2' },
  { read: 122, folder: 'audio/mahmoud-banna/r2' },
]);

/** What Quran and People record for one curated read. */
export interface PlannedRead {
  readonly read: number;
  readonly stream: RecitationStream;
  /** The People slug: the reciter's own CDN folder name. */
  readonly personSlug: string;
  /** The recitation slug: folder and moshaf, e.g. `mishary-alafasy-r1`. */
  readonly recitationSlug: string;
  readonly nameEnglish: string;
  readonly nameArabic: string;
  /** The moshaf's own English name, e.g. "Rewayat Hafs A'n Assem - Murattal". */
  readonly moshaf: string;
  /** The part of the moshaf name after its riwayah, e.g. "Murattal". */
  readonly style: string | null;
}

/** Why a curated read cannot be imported — a category, never content. */
export type ReadSkip =
  | 'not-timed'
  | 'not-hafs'
  | 'not-complete'
  | 'folder-changed'
  | 'no-reciter'
  | 'names-unusable';

interface TimedRead {
  readonly id: number;
  readonly rewaya: string;
  readonly folderUrl: string;
  readonly surahs: number;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function integer(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null;
}

/** Does the text carry a C0 control character or DEL? */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** A name as the source gives it: trimmed of nothing, refused when unusable. */
function name(value: unknown): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 200 &&
    value === value.trim() &&
    !hasControlCharacter(value)
    ? value
    : null;
}

/** `/ayat_timing/reads` → the timed reads, by moshaf id. */
export function readTimedReads(body: unknown): ReadonlyMap<number, TimedRead> {
  const reads = new Map<number, TimedRead>();
  if (!Array.isArray(body)) return reads;
  for (const entry of body) {
    const item = record(entry);
    const id = integer(item?.['id']);
    const surahs = integer(item?.['soar_count']);
    const rewaya = item?.['rewaya'];
    const folderUrl = item?.['folder_url'];
    if (id === null || surahs === null) continue;
    if (typeof rewaya !== 'string' || typeof folderUrl !== 'string') continue;
    reads.set(id, { id, rewaya: rewaya.replace(/\s+/g, ' ').trim(), folderUrl, surahs });
  }
  return reads;
}

interface Moshaf {
  readonly reciter: string;
  readonly moshaf: string;
  readonly server: string;
}

/** `/reciters?language=…` → each moshaf id's reciter name, moshaf name and server. */
export function readMoshafs(body: unknown): ReadonlyMap<number, Moshaf> {
  const moshafs = new Map<number, Moshaf>();
  const reciters = record(body)?.['reciters'];
  if (!Array.isArray(reciters)) return moshafs;
  for (const entry of reciters) {
    const reciter = record(entry);
    const reciterName = name(reciter?.['name']);
    const list = reciter?.['moshaf'];
    if (reciterName === null || !Array.isArray(list)) continue;
    for (const item of list) {
      const moshaf = record(item);
      const id = integer(moshaf?.['id']);
      const moshafName = name(moshaf?.['name']);
      const server = moshaf?.['server'];
      if (id === null || moshafName === null || typeof server !== 'string') continue;
      moshafs.set(id, { reciter: reciterName, moshaf: moshafName, server });
    }
  }
  return moshafs;
}

/**
 * The riwayah a moshaf's own name gives — the words before its " - " (the
 * Arabic list writes "حفص عن عاصم - مرتل"), or the whole name when it has
 * none.
 */
export function riwayahOf(moshaf: string): string {
  const separator = moshaf.indexOf(' - ');
  return separator > 0 ? moshaf.slice(0, separator) : moshaf;
}

/** The CDN folder of a full folder URL, or null when it is not the allowlisted CDN's. */
export function streamOfFolderUrl(folderUrl: string): RecitationStream | null {
  const match = /^https:\/\/cdn\.mp3quran\.net\/(audio\/[a-z0-9-]+\/r[0-9]+)\/$/.exec(
    folderUrl,
  );
  if (match === null) return null;
  const parsed = recitationStreamSchema.safeParse({
    provider: 'mp3quran',
    path: match[1],
  });
  return parsed.success ? parsed.data : null;
}

/** Plans one curated read from the three API answers, or says why it cannot be. */
export function planRead(
  curated: { readonly read: number; readonly folder: string },
  timed: ReadonlyMap<number, TimedRead>,
  english: ReadonlyMap<number, Moshaf>,
  arabic: ReadonlyMap<number, Moshaf>,
): PlannedRead | { readonly skip: ReadSkip } {
  const read = timed.get(curated.read);
  if (read === undefined) return { skip: 'not-timed' };
  // Hafs twice over: the timed read's riwayah is Hafs (or the mujawwad
  // edition's, which names none), AND its own Arabic moshaf says Hafs.
  if (read.rewaya !== HAFS && read.rewaya !== MUJAWWAD) return { skip: 'not-hafs' };
  if (read.surahs !== QURAN_SURAH_MAX) return { skip: 'not-complete' };
  const stream = streamOfFolderUrl(read.folderUrl);
  if (stream === null || stream.path !== curated.folder)
    return { skip: 'folder-changed' };
  const en = english.get(curated.read);
  const ar = arabic.get(curated.read);
  if (en === undefined || ar === undefined) return { skip: 'no-reciter' };
  if (riwayahOf(ar.moshaf) !== HAFS) return { skip: 'not-hafs' };
  if (streamOfFolderUrl(en.server)?.path !== curated.folder)
    return { skip: 'folder-changed' };
  const [, folderName, moshaf] =
    /^audio\/([a-z0-9-]+)\/(r[0-9]+)$/.exec(curated.folder) ?? [];
  if (folderName === undefined || moshaf === undefined) return { skip: 'folder-changed' };
  const separator = en.moshaf.lastIndexOf(' - ');
  const style = separator > 0 ? en.moshaf.slice(separator + 3) : null;
  if (style !== null && name(style) === null) return { skip: 'names-unusable' };
  return {
    read: curated.read,
    stream,
    personSlug: folderName,
    recitationSlug: `${folderName}-${moshaf}`,
    nameEnglish: en.reciter,
    nameArabic: ar.reciter,
    moshaf: en.moshaf,
    style,
  };
}

/** The recitation's attribution, in the licence register's form. */
export function attributionOf(plan: PlannedRead): string {
  return `Recitation: ${plan.nameEnglish} (${plan.moshaf}). Audio and timings: mp3quran.net`;
}

/** Why a Surah's timing cannot be recorded — a category, never a number. */
export type TimingSkip = 'unreadable' | 'coverage' | 'empty-span' | 'overlap' | 'bounds';

/**
 * `/ayat_timing?surah=N&read=R` → the timing of each of the Surah's
 * `ayahCount` ayat, or why not. An entry numbered 0 (some reads mark the
 * opening so) is not an Ayah and is set aside; every other entry must be
 * exactly ayat 1..ayahCount, each non-empty, none starting before the
 * previous one ends, all within the structural ceiling. Only `ayah`,
 * `start_time` and `end_time` are read.
 */
export function readSurahTiming(
  body: unknown,
  ayahCount: number,
): { readonly timings: readonly AyahTiming[] } | { readonly skip: TimingSkip } {
  if (!Array.isArray(body)) return { skip: 'unreadable' };
  const entries: AyahTiming[] = [];
  for (const entry of body) {
    const item = record(entry);
    const ayah = integer(item?.['ayah']);
    const startMs = integer(item?.['start_time']);
    const endMs = integer(item?.['end_time']);
    if (ayah === null || startMs === null || endMs === null)
      return { skip: 'unreadable' };
    if (ayah === 0) continue;
    entries.push({ ayah, startMs, endMs });
  }
  entries.sort((a, b) => a.ayah - b.ayah);
  if (entries.length !== ayahCount || entries.some((entry, i) => entry.ayah !== i + 1))
    return { skip: 'coverage' };
  let previousEnd = 0;
  for (const entry of entries) {
    if (entry.startMs < 0 || entry.endMs > RECITATION_TIMING_MAX_MS)
      return { skip: 'bounds' };
    if (entry.endMs <= entry.startMs) return { skip: 'empty-span' };
    if (entry.startMs < previousEnd) return { skip: 'overlap' };
    previousEnd = entry.endMs;
  }
  return { timings: entries };
}
