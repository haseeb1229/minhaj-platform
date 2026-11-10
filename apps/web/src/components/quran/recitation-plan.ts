import {
  QURAN_SURAH_MAX,
  recitationStreamUrl,
  type RecitationStream,
} from '@minhaj/contracts/quran';

import { recitationAssetPath } from './presentation';

/**
 * THE RECITATION PLAYER'S RULES, PURE (Quran Part 5) — what plays next, which
 * Ayah is being heard and what a repeat or a range asks for, decided from the
 * position in the audio alone. The player island (`./recitation-dock.tsx`)
 * owns the audio element and the store; everything it DECIDES is decided
 * here, so it is tested without a browser.
 *
 * WHERE THE AUDIO COMES FROM IS DERIVED, NEVER CARRIED. A segment's address is
 * built here from what the public reader returned — the first-party asset
 * route's three identifiers, or an allowlisted stream and its Surah
 * (`recitationStreamUrl` refuses any other) — so no response field can point
 * the player anywhere else.
 */

/**
 * The event another island dispatches on `window` to play the chosen recitation
 * from an Ayah — `{ surah, ayah }` — so it never has to import the player.
 */
export const PLAY_REQUEST = 'quran-player:play';

/** How a segment's audio is addressed. */
export type SegmentAudio =
  | {
      readonly kind: 'asset';
      readonly recitationId: string;
      readonly segmentId: string;
      readonly assetId: string;
    }
  | {
      readonly kind: 'stream';
      readonly stream: RecitationStream;
      readonly surah: number;
    };

/** The one address of a segment's audio. */
export function audioSource(audio: SegmentAudio): string {
  return audio.kind === 'asset'
    ? recitationAssetPath(audio)
    : recitationStreamUrl(audio.stream, audio.surah);
}

/** `[ayah, startMs, endMs]` — one Ayah's span, as the data route sends it. */
export type TimingTuple = readonly [number, number, number];

/** One segment as the player holds it: its range, audio and timing, if any. */
export interface PlayableSegment {
  readonly id: string;
  readonly surah: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly audio: SegmentAudio;
  /** Every Ayah of the range in order, or `null` when the segment is untimed. */
  readonly timings: readonly TimingTuple[] | null;
}

/** One recitation's audio for one Surah. */
export interface SurahAudio {
  readonly recitation: string;
  readonly surah: number;
  readonly segments: readonly PlayableSegment[];
}

/* ===========================================================================
 * Reading a response
 * ========================================================================= */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function count(value: unknown, max: number): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
  );
}

/**
 * The data route's body as a `SurahAudio`, or `null` when it is anything else.
 * A response is DATA, checked field by field: a segment whose audio or timing
 * does not hold together is dropped rather than half-played, and a stream is
 * admitted only if the allowlist admits it (`audioSource` would throw).
 */
export function readSurahAudio(
  body: unknown,
  expected: { readonly recitation: string; readonly surah: number },
): SurahAudio | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  if (record['recitation'] !== expected.recitation || record['surah'] !== expected.surah)
    return null;
  const raw = record['segments'];
  if (!Array.isArray(raw)) return null;
  const segments: PlayableSegment[] = [];
  for (const entry of raw.slice(0, 1000)) {
    const segment = readSegment(entry, expected.surah);
    if (segment !== null) segments.push(segment);
  }
  segments.sort((a, b) => a.startAyah - b.startAyah);
  return { recitation: expected.recitation, surah: expected.surah, segments };
}

function readSegment(entry: unknown, surah: number): PlayableSegment | null {
  if (entry === null || typeof entry !== 'object') return null;
  const value = entry as Record<string, unknown>;
  const { id, startAyah, endAyah, audio, timings } = value;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (
    !count(startAyah, 999) ||
    !count(endAyah, 999) ||
    startAyah < 1 ||
    endAyah < startAyah
  )
    return null;
  const readAudio = readSegmentAudio(audio, surah);
  if (readAudio === null) return null;
  try {
    audioSource(readAudio);
  } catch {
    return null;
  }
  const readTimings = readTimingList(timings, startAyah, endAyah);
  if (readTimings === undefined) return null;
  return { id, surah, startAyah, endAyah, audio: readAudio, timings: readTimings };
}

function readSegmentAudio(value: unknown, surah: number): SegmentAudio | null {
  if (value === null || typeof value !== 'object') return null;
  const audio = value as Record<string, unknown>;
  if (audio['kind'] === 'asset') {
    const { recitationId, segmentId, assetId } = audio;
    return typeof recitationId === 'string' &&
      UUID.test(recitationId) &&
      typeof segmentId === 'string' &&
      UUID.test(segmentId) &&
      typeof assetId === 'string' &&
      UUID.test(assetId)
      ? { kind: 'asset', recitationId, segmentId, assetId }
      : null;
  }
  if (audio['kind'] === 'stream' && audio['surah'] === surah) {
    const stream = audio['stream'] as Record<string, unknown> | null | undefined;
    if (
      stream !== null &&
      typeof stream === 'object' &&
      stream['provider'] === 'mp3quran' &&
      typeof stream['path'] === 'string'
    )
      return {
        kind: 'stream',
        stream: { provider: 'mp3quran', path: stream['path'] },
        surah,
      };
  }
  return null;
}

/**
 * The timing as tuples covering the range exactly once and in order, `null`
 * for an untimed segment, or `undefined` for a timing that does not hold
 * together (the segment is then dropped).
 */
function readTimingList(
  value: unknown,
  startAyah: number,
  endAyah: number,
): readonly TimingTuple[] | null | undefined {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length !== endAyah - startAyah + 1) return undefined;
  const out: TimingTuple[] = [];
  let previousEnd = 0;
  for (const [index, tuple] of value.entries()) {
    if (!Array.isArray(tuple) || tuple.length !== 3) return undefined;
    const [ayah, start, end] = tuple as unknown[];
    if (
      ayah !== startAyah + index ||
      !count(start, 43_200_000) ||
      !count(end, 43_200_000) ||
      end <= start ||
      start < previousEnd
    )
      return undefined;
    previousEnd = end;
    out.push([ayah, start, end]);
  }
  return out;
}

/* ===========================================================================
 * Where things are
 * ========================================================================= */

/** The segment of a Surah's audio that holds an Ayah. */
export function segmentFor(
  audio: SurahAudio,
  ayah: number,
): { readonly index: number; readonly segment: PlayableSegment } | null {
  const index = audio.segments.findIndex(
    (segment) => segment.startAyah <= ayah && ayah <= segment.endAyah,
  );
  const segment = audio.segments[index];
  return segment === undefined ? null : { index, segment };
}

/** One Ayah's span in its segment, in milliseconds, or null when untimed. */
export function spanOf(
  segment: PlayableSegment,
  ayah: number,
): { readonly startMs: number; readonly endMs: number } | null {
  const tuple = segment.timings?.[ayah - segment.startAyah];
  return tuple === undefined ? null : { startMs: tuple[1], endMs: tuple[2] };
}

/**
 * Where playing FROM an Ayah begins. The first Ayah of a segment begins at the
 * very start of the file, so the reciter's own opening — the isti'adha and the
 * basmala before the Ayah — is heard as recorded; any other Ayah begins where
 * its timing says.
 */
export function startMsOf(segment: PlayableSegment, ayah: number): number {
  if (ayah <= segment.startAyah) return 0;
  return spanOf(segment, ayah)?.startMs ?? 0;
}

/**
 * The Ayah being heard at a position: the last Ayah that has begun. Before the
 * first begins (the opening) none is; in a pause after an Ayah it is still
 * that Ayah. Binary search — a long Surah's position is answered in a few steps.
 */
export function ayahAt(segment: PlayableSegment, ms: number): number | null {
  const timings = segment.timings;
  if (timings === null || timings.length === 0) return null;
  const first = timings[0];
  if (first === undefined || ms < first[1]) return null;
  let low = 0;
  let high = timings.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const tuple = timings[middle];
    if (tuple !== undefined && tuple[1] <= ms) low = middle;
    else high = middle - 1;
  }
  return timings[low]?.[0] ?? null;
}

/**
 * How far past the file's reported end a timing may reach and still be the
 * file's: an MP3's duration is an estimate, a few hundred milliseconds either
 * way.
 */
export const DURATION_TOLERANCE_MS = 1500;

/**
 * DOES THE TIMING FIT THE FILE? Only the player can know a file's duration —
 * once its metadata has loaded — and a timing that runs past it describes some
 * other recording: it is not followed, and the segment plays as untimed.
 */
export function timingFits(segment: PlayableSegment, durationMs: number): boolean {
  if (segment.timings === null) return true;
  if (!(durationMs > 0)) return true;
  const last = segment.timings.at(-1);
  return last === undefined || last[2] <= durationMs + DURATION_TOLERANCE_MS;
}

/** The segment with its timing set aside — what plays when the timing does not fit. */
export function untimed(segment: PlayableSegment): PlayableSegment {
  return { ...segment, timings: null };
}

/** Each timed Ayah's start as a fraction of the duration, for the seek bar's ticks. */
export function ticksOf(
  segment: PlayableSegment,
  durationMs: number,
): readonly { readonly ayah: number; readonly at: number }[] {
  if (segment.timings === null || !(durationMs > 0)) return [];
  return segment.timings.flatMap(([ayah, start]) =>
    start < durationMs ? [{ ayah, at: start / durationMs }] : [],
  );
}

/* ===========================================================================
 * What happens next
 * ========================================================================= */

/** How far before a target a seek may land and still be the Ayah sought. */
export const SEEK_TOLERANCE_MS = 400;

/** Playback speeds offered — 0.75× to 1.5×. */
export const PLAYBACK_RATES = Object.freeze([0.75, 1, 1.25, 1.5] as const);
export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** How many times one Ayah may be asked to repeat. */
export const REPEAT_MAX = 10;

/**
 * What the listener asked for. `repeat` is how many times EACH Ayah is heard
 * (1 = once). A `range` loops `from`–`to` of one Surah `times` times (`0` =
 * until stopped), then stops.
 */
export interface PlayPlan {
  readonly repeat: number;
  readonly range: {
    readonly surah: number;
    readonly from: number;
    readonly to: number;
    readonly times: number;
  } | null;
  /** Carry on into the next segment and the next Surah. */
  readonly continuous: boolean;
}

export const DEFAULT_PLAN: PlayPlan = { repeat: 1, range: null, continuous: true };

/** Where playback is, in plan terms. */
export interface Cursor {
  readonly surah: number;
  /** The Ayah being heard, or null in a segment's opening or an untimed segment. */
  readonly ayah: number | null;
  /** How many times the current Ayah has been heard IN FULL in this pass. */
  readonly heard: number;
  /** How many passes of the range are complete. */
  readonly passes: number;
}

export type Decision =
  /** Keep playing; the Ayah being heard is `cursor.ayah`. */
  | { readonly kind: 'continue'; readonly cursor: Cursor }
  /** Jump within the segment (a repeat, or the range again). */
  | { readonly kind: 'seek'; readonly ms: number; readonly cursor: Cursor }
  /** The plan is complete: pause where it ended. */
  | { readonly kind: 'stop'; readonly cursor: Cursor };

/**
 * A TICK: the audio reports its position; this answers what to do. Only a
 * timed segment ever seeks or stops on a tick — an untimed one plays to its
 * end, where `afterSegment` decides.
 *
 * An Ayah is HEARD IN FULL when the position reaches its end. Then, in order:
 * a pending repeat goes back to its start; the end of a range either loops the
 * range or stops; otherwise the next Ayah becomes current when it begins.
 */
export function tick(
  plan: PlayPlan,
  segment: PlayableSegment,
  cursor: Cursor,
  ms: number,
): Decision {
  const heardNow = ayahAt(segment, ms);
  if (segment.timings === null)
    return { kind: 'continue', cursor: { ...cursor, ayah: null } };
  const current = cursor.ayah;
  const span = current === null ? null : spanOf(segment, current);

  // A seek lands NEAR where it was asked, not exactly: a position just before
  // the current Ayah's start is still that Ayah, so a repeat never resets its
  // own count by landing a little early.
  if (span !== null && ms < span.startMs && ms >= span.startMs - SEEK_TOLERANCE_MS)
    return { kind: 'continue', cursor };

  // A position the current Ayah's own playing did not reach — the listener
  // seeking, the opening before the first Ayah, or the first tick — is
  // followed, and the counts start again.
  if (
    current === null ||
    span === null ||
    ms < span.startMs ||
    heardNow === null ||
    heardNow > current + 1
  ) {
    return {
      kind: 'continue',
      cursor: { ...cursor, ayah: heardNow, heard: 0 },
    };
  }

  if (ms < span.endMs) return { kind: 'continue', cursor };

  // The current Ayah has been heard in full.
  const heard = cursor.heard + 1;
  const repeat = Math.min(Math.max(1, Math.trunc(plan.repeat)), REPEAT_MAX);
  if (heard < repeat)
    return { kind: 'seek', ms: span.startMs, cursor: { ...cursor, heard } };

  const range = plan.range;
  if (range !== null && range.surah === segment.surah && current === range.to) {
    const passes = cursor.passes + 1;
    if (range.times !== 0 && passes >= range.times)
      return { kind: 'stop', cursor: { ...cursor, heard: 0, passes } };
    const from = spanOf(segment, range.from);
    if (from !== null)
      return {
        kind: 'seek',
        ms: from.startMs,
        cursor: { ...cursor, ayah: range.from, heard: 0, passes },
      };
  }

  // On to the next Ayah once it has begun; a pause between them keeps the
  // highlight on the one just heard.
  if (heardNow !== current)
    return { kind: 'continue', cursor: { ...cursor, ayah: heardNow, heard: 0 } };
  return { kind: 'continue', cursor: { ...cursor, heard: heard - 1 } };
}

/** What follows the end of a segment's audio. */
export type AfterSegment =
  | { readonly kind: 'segment'; readonly index: number }
  | { readonly kind: 'surah'; readonly surah: number }
  | { readonly kind: 'stop' };

/**
 * The file ended: the next segment of the Surah, else the next Surah when
 * playing continuously, else stop. A range never runs past its own end, and a
 * range that ended inside this segment was already decided by `tick`.
 */
export function afterSegment(
  plan: PlayPlan,
  audio: SurahAudio,
  index: number,
): AfterSegment {
  const range = plan.range;
  if (range !== null && range.surah === audio.surah) return { kind: 'stop' };
  if (!plan.continuous) return { kind: 'stop' };
  if (index + 1 < audio.segments.length) return { kind: 'segment', index: index + 1 };
  return audio.surah < QURAN_SURAH_MAX
    ? { kind: 'surah', surah: audio.surah + 1 }
    : { kind: 'stop' };
}

/** The Ayah before or after `ayah` that this Surah's audio can play, or null. */
export function neighbourAyah(
  audio: SurahAudio,
  ayah: number,
  step: -1 | 1,
): number | null {
  const target = ayah + step;
  return segmentFor(audio, target) === null ? null : target;
}

/** A repeat count as the plan holds it: an integer from 1 to `REPEAT_MAX`. */
export function repeatCount(value: unknown): number {
  const number = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(number) ? Math.min(Math.max(1, number), REPEAT_MAX) : 1;
}

/** A speed as offered, or 1×. */
export function playbackRate(value: unknown): PlaybackRate {
  return (PLAYBACK_RATES as readonly unknown[]).includes(value)
    ? (value as PlaybackRate)
    : 1;
}

/**
 * A recitation's label in a chooser: "{reciter} — {name}", or the name alone
 * when there is no reciter or the name already begins with the reciter's name
 * (an imported catalogue names each recitation after its qari).
 */
export function recitationLabel(entry: {
  readonly reciter: string | null;
  readonly name: string;
}): string {
  const reciter = entry.reciter?.trim() ?? '';
  if (reciter === '') return entry.name;
  const fold = (text: string) => text.trim().toLocaleLowerCase();
  return fold(entry.name).startsWith(fold(reciter))
    ? entry.name
    : `${reciter} — ${entry.name}`;
}

/** One style's recitations, in the order a chooser or the catalogue lists them. */
export interface RecitationGroup<T> {
  /** The style as the source names it, or null for the recitations that carry none. */
  readonly style: string | null;
  readonly entries: readonly T[];
}

/**
 * THE CATALOGUE'S ORDER — one rule for the player's chooser, the catalogue
 * page and a reciter's page, so ~30 recitations stay findable: grouped by
 * style, the style most recitations share first (on the curated catalogue,
 * Murattal, then the mujawwad editions), equal groups by their style's name,
 * and the recitations that name no style last; within a group by reciter,
 * then by name, in the interface language's collation. No recitation is
 * privileged: the order is read from the catalogue alone.
 */
export function recitationGroups<
  T extends {
    readonly style: string | null;
    readonly reciter: string | null;
    readonly name: string;
  },
>(entries: readonly T[], locale: string): readonly RecitationGroup<T>[] {
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const byStyle = new Map<string | null, T[]>();
  for (const entry of entries) {
    byStyle.set(entry.style, [...(byStyle.get(entry.style) ?? []), entry]);
  }
  const named = (entry: T) => {
    const reciter = entry.reciter?.trim() ?? '';
    return reciter === '' ? entry.name : reciter;
  };
  return [...byStyle.entries()]
    .map(([style, members]) => ({
      style,
      entries: [...members].sort(
        (a, b) =>
          collator.compare(named(a), named(b)) || collator.compare(a.name, b.name),
      ),
    }))
    .sort((a, b) => {
      if (a.style === null || b.style === null)
        return a.style === b.style ? 0 : a.style === null ? 1 : -1;
      return b.entries.length - a.entries.length || collator.compare(a.style, b.style);
    });
}
