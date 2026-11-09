'use client';

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_PLAN,
  afterSegment,
  audioSource,
  ayahAt,
  neighbourAyah,
  playbackRate,
  readSurahAudio,
  repeatCount,
  segmentFor,
  spanOf,
  startMsOf,
  tick,
  ticksOf,
  timingFits,
  untimed,
  type Cursor,
  type PlayPlan,
  type PlaybackRate,
  type PlayableSegment,
  type SurahAudio,
} from './recitation-plan';

/**
 * THE RECITATION PLAYER'S STATE AND ITS ONE AUDIO ELEMENT (Quran Part 5).
 *
 * A MODULE, NOT A COMPONENT, so it outlives every page: the Quran layout's
 * dock and each page's listen controls read and drive the same state, and a
 * client navigation between Quran pages leaves the audio playing.
 *
 * ONE ELEMENT, NEVER IN THE DOCUMENT. The element is created by the
 * listener's first press of Play — never on load — and is not attached to the
 * page, so no page carries a second `<audio>` beside its own native fallback.
 * That first press also calls `play()` inside the gesture, which is what a
 * browser requires before later tracks may begin by themselves (the next Ayah,
 * the next Surah); nothing plays until then.
 *
 * WHAT IS DECIDED IS DECIDED IN `./recitation-plan.ts`. This module moves the
 * audio and records where it is; the plan says what to do at each position.
 *
 * KEPT IN THIS BROWSER: the reciter chosen, the speed, follow-along and
 * continuous play — guarded, so a private window forgets rather than breaks.
 */

/** A public recitation as the player offers it. */
export interface CatalogueEntry {
  readonly slug: string;
  readonly name: string;
  readonly reciter: string | null;
  readonly languageCode: string | null;
  readonly timed: boolean;
}

export type PlayerStatus =
  'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';
export type PlayerProblem = 'failed' | 'no-audio' | null;

export interface PlayerState {
  /** The dock has mounted with the catalogue: the controls may show. */
  readonly ready: boolean;
  readonly catalogue: readonly CatalogueEntry[];
  /** The recitation chosen (remembered), or null when none is offered. */
  readonly choice: string | null;
  readonly status: PlayerStatus;
  readonly problem: PlayerProblem;
  /** The recitation actually loaded, which a later choice does not change until played. */
  readonly playing: string | null;
  readonly surah: number | null;
  /** The Ayah being heard, or null (an untimed segment, or a segment's opening). */
  readonly ayah: number | null;
  readonly timed: boolean;
  readonly positionMs: number;
  readonly durationMs: number;
  readonly ticks: readonly { readonly ayah: number; readonly at: number }[];
  readonly rate: PlaybackRate;
  readonly follow: boolean;
  readonly plan: PlayPlan;
}

const PREFERENCES_KEY = 'minhaj.quran.player';

const INITIAL: PlayerState = {
  ready: false,
  catalogue: [],
  choice: null,
  status: 'idle',
  problem: null,
  playing: null,
  surah: null,
  ayah: null,
  timed: false,
  positionMs: 0,
  durationMs: 0,
  ticks: [],
  rate: 1,
  follow: true,
  plan: DEFAULT_PLAN,
};

let state: PlayerState = INITIAL;
const listeners = new Set<() => void>();

function set(next: Partial<PlayerState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot = (): PlayerState => INITIAL;

/** The player's state, for a component. The server render sees the initial state. */
export function usePlayer(): PlayerState {
  return useSyncExternalStore(subscribe, () => state, serverSnapshot);
}

/** The player's state now, outside React. */
export function playerState(): PlayerState {
  return state;
}

/** Subscribe outside React (the dock's page effects). */
export function onPlayer(listener: () => void): () => void {
  return subscribe(listener);
}

/* ===========================================================================
 * Preferences
 * ========================================================================= */

interface Preferences {
  readonly choice: string | null;
  readonly rate: PlaybackRate;
  readonly follow: boolean;
  readonly continuous: boolean;
}

function readPreferences(): Partial<Preferences> {
  try {
    const raw = window.localStorage.getItem(PREFERENCES_KEY);
    if (raw === null) return {};
    const value = JSON.parse(raw) as Record<string, unknown>;
    return {
      choice: typeof value['choice'] === 'string' ? value['choice'] : null,
      rate: playbackRate(value['rate']),
      follow: value['follow'] !== false,
      continuous: value['continuous'] !== false,
    };
  } catch {
    return {};
  }
}

function keepPreferences(): void {
  try {
    window.localStorage.setItem(
      PREFERENCES_KEY,
      JSON.stringify({
        choice: state.choice,
        rate: state.rate,
        follow: state.follow,
        continuous: state.plan.continuous,
      }),
    );
  } catch {
    /* Not kept: still applied for this visit. */
  }
}

/**
 * The dock hands the catalogue over once mounted. The remembered choice is
 * kept only while it is still public; `preferred` (the page's `?reciter=`)
 * wins when it names a public recitation.
 */
export function initialisePlayer(
  catalogue: readonly CatalogueEntry[],
  preferred: string | null,
): void {
  const kept = readPreferences();
  const known = (slug: string | null | undefined) =>
    slug !== null && slug !== undefined && catalogue.some((entry) => entry.slug === slug)
      ? slug
      : null;
  const choice =
    known(state.choice) ??
    known(preferred) ??
    known(kept.choice) ??
    // None is privileged: the first TIMED recitation in the catalogue's own
    // order, else the first of any kind.
    catalogue.find((entry) => entry.timed)?.slug ??
    catalogue[0]?.slug ??
    null;
  set({
    ready: true,
    catalogue,
    choice,
    rate: state.ready ? state.rate : (kept.rate ?? 1),
    follow: state.ready ? state.follow : (kept.follow ?? true),
    plan: state.ready
      ? state.plan
      : { ...state.plan, continuous: kept.continuous ?? true },
  });
}

/* ===========================================================================
 * Data
 * ========================================================================= */

const cache = new Map<string, Promise<SurahAudio | null>>();

/** One recitation's audio for one Surah, asked once per visit. */
function load(recitation: string, surah: number): Promise<SurahAudio | null> {
  const key = `${recitation}:${String(surah)}`;
  let pending = cache.get(key);
  if (pending === undefined) {
    pending = fetch(
      `/api/quran/recitations/${encodeURIComponent(recitation)}/${String(surah)}`,
      // Same-origin, not `omit`: a deployment behind an HTTP authentication
      // gate (staging's edge) refuses a request that withholds the browser's
      // credentials. The route reads no session, so nothing personal changes.
      { credentials: 'same-origin', headers: { accept: 'application/json' } },
    )
      .then(async (response) => {
        if (response.status === 404) return null;
        if (!response.ok) throw new Error('unavailable');
        return readSurahAudio(await response.json(), { recitation, surah });
      })
      .catch((error: unknown) => {
        // A failure is not remembered: the next press asks again.
        cache.delete(key);
        throw error;
      });
    cache.set(key, pending);
  }
  return pending;
}

/* ===========================================================================
 * The engine
 * ========================================================================= */

let element: HTMLAudioElement | null = null;
let current: { readonly audio: SurahAudio; readonly index: number } | null = null;
let cursor: Cursor | null = null;
/** A seek this module made, so its `seeking` is not mistaken for the listener's. */
let ownSeek = false;
/** Where to start once the new file's metadata has loaded. */
let pendingStartMs: number | null = null;
let frame = 0;
/** Bumped by every new request, so a slow load cannot start an older one. */
let generation = 0;

function segmentNow(): PlayableSegment | null {
  return current === null ? null : (current.audio.segments[current.index] ?? null);
}

function audioElement(): HTMLAudioElement {
  if (element !== null) return element;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('timeupdate', onPosition);
  audio.addEventListener('playing', () => {
    set({ status: 'playing', problem: null });
    startFrames();
  });
  audio.addEventListener('pause', () => {
    if (state.status === 'playing' || state.status === 'buffering')
      set({ status: 'paused' });
  });
  audio.addEventListener('waiting', () => {
    if (!audio.paused) set({ status: 'buffering' });
  });
  audio.addEventListener('loadedmetadata', () => {
    const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    let segment = segmentNow();
    // A timing that runs past the file is not this file's: play it untimed.
    if (segment !== null && current !== null && !timingFits(segment, durationMs)) {
      segment = untimed(segment);
      const segments = [...current.audio.segments];
      segments[current.index] = segment;
      current = { audio: { ...current.audio, segments }, index: current.index };
      if (cursor !== null) cursor = { ...cursor, ayah: null, heard: 0 };
      set({ timed: false, ayah: null });
    }
    set({ durationMs, ticks: segment === null ? [] : ticksOf(segment, durationMs) });
    if (pendingStartMs !== null) {
      const start = pendingStartMs;
      pendingStartMs = null;
      if (start > 0) seekOwn(start);
    }
  });
  audio.addEventListener('seeking', () => {
    if (ownSeek) return;
    // The listener moved: follow them, and start the counts again.
    const segment = segmentNow();
    if (segment !== null && cursor !== null) {
      const ayah = ayahAt(segment, audio.currentTime * 1000);
      cursor = { ...cursor, ayah, heard: 0 };
      set({ ayah });
    }
  });
  audio.addEventListener('seeked', () => {
    ownSeek = false;
  });
  audio.addEventListener('ended', () => void onEnded());
  audio.addEventListener('error', () => {
    // An element with no source yet reports nothing worth saying.
    if (audio.getAttribute('src') === null) return;
    stopFrames();
    set({ status: 'paused', problem: 'failed' });
  });
  element = audio;
  return audio;
}

function seekOwn(ms: number): void {
  const audio = audioElement();
  ownSeek = true;
  audio.currentTime = ms / 1000;
}

function startFrames(): void {
  if (frame !== 0 || typeof requestAnimationFrame !== 'function') return;
  const step = () => {
    frame = 0;
    if (element === null || element.paused) return;
    onPosition();
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

function stopFrames(): void {
  if (frame !== 0) cancelAnimationFrame(frame);
  frame = 0;
}

/** Every position report — a frame while visible, `timeupdate` always. */
function onPosition(): void {
  const audio = element;
  const segment = segmentNow();
  if (audio === null || segment === null || cursor === null) return;
  const ms = audio.currentTime * 1000;
  const decision = tick(state.plan, segment, cursor, ms);
  cursor = decision.cursor;
  if (decision.kind === 'seek') seekOwn(decision.ms);
  if (decision.kind === 'stop') {
    audio.pause();
    stopFrames();
    set({ status: 'ended' });
  }
  if (state.ayah !== cursor.ayah || Math.abs(state.positionMs - ms) >= 200)
    set({ ayah: cursor.ayah, positionMs: ms });
}

async function onEnded(): Promise<void> {
  const audio = element;
  const segment = segmentNow();
  if (audio === null || segment === null || current === null || cursor === null) return;
  // The file's end is a position too: a repeat of its last Ayah, or a range
  // ending with it, is decided exactly as any other end of an Ayah.
  const decision = tick(state.plan, segment, cursor, Number.MAX_SAFE_INTEGER);
  cursor = decision.cursor;
  if (decision.kind === 'seek') {
    seekOwn(decision.ms);
    await audio.play().catch(() => set({ status: 'paused', problem: 'failed' }));
    return;
  }
  if (decision.kind === 'stop') {
    set({ status: 'ended' });
    return;
  }
  const next = afterSegment(state.plan, current.audio, current.index);
  if (next.kind === 'segment') {
    const following = current.audio.segments[next.index];
    if (following !== undefined)
      await begin(current.audio, next.index, following.startAyah, generation);
    return;
  }
  if (next.kind === 'surah' && state.playing !== null) {
    const ticket = ++generation;
    set({ status: 'loading' });
    try {
      const audioData = await load(state.playing, next.surah);
      if (ticket !== generation) return;
      const first = audioData?.segments[0];
      if (audioData === null || first === undefined) {
        set({ status: 'ended' });
        return;
      }
      await begin(audioData, 0, first.startAyah, ticket);
    } catch {
      if (ticket === generation) set({ status: 'paused', problem: 'failed' });
    }
    return;
  }
  stopFrames();
  set({ status: 'ended' });
}

/** Loads a segment (if it is not the one loaded) and plays from an Ayah. */
async function begin(
  audio: SurahAudio,
  index: number,
  ayah: number,
  ticket: number,
): Promise<void> {
  const segment = audio.segments[index];
  if (segment === undefined || ticket !== generation) return;
  const media = audioElement();
  const source = audioSource(segment.audio);
  const startMs = startMsOf(segment, ayah);
  current = { audio, index };
  cursor = {
    surah: audio.surah,
    ayah: segment.timings === null || startMs === 0 ? null : ayah,
    heard: 0,
    passes: 0,
  };
  set({
    playing: audio.recitation,
    surah: audio.surah,
    ayah: cursor.ayah,
    timed: segment.timings !== null,
    problem: null,
    status: 'loading',
  });
  if (media.getAttribute('src') !== source) {
    pendingStartMs = startMs;
    media.src = source;
    set({ positionMs: startMs, durationMs: 0, ticks: [] });
  } else if (startMs > 0 || media.currentTime > 0) {
    seekOwn(startMs);
  }
  media.playbackRate = state.rate;
  try {
    await media.play();
    // Already playing (a new place in the same file) fires no 'playing'.
    if (ticket === generation && !media.paused) set({ status: 'playing', problem: null });
  } catch (error) {
    if (ticket !== generation) return;
    // A browser that would not start without the listener's own press says
    // NotAllowed: that is a pause, not a fault.
    const refused = error instanceof DOMException && error.name === 'NotAllowedError';
    set({ status: 'paused', problem: refused ? null : 'failed' });
  }
}

/**
 * The listener's own press: called synchronously inside the click, so the
 * element is created and permitted to play within the gesture, before any
 * data is fetched.
 */
function unlock(): void {
  const media = audioElement();
  if (media.getAttribute('src') === null) void media.play().catch(() => undefined);
}

/* ===========================================================================
 * Commands
 * ========================================================================= */

/** Plays the chosen recitation from an Ayah. */
export function playFrom(ref: { readonly surah: number; readonly ayah: number }): void {
  const choice = state.choice;
  if (choice === null) return;
  unlock();
  const ticket = ++generation;
  set({ status: 'loading', problem: null, surah: ref.surah });
  void load(choice, ref.surah)
    .then(async (audio) => {
      if (ticket !== generation) return;
      const found = audio === null ? null : segmentFor(audio, ref.ayah);
      if (audio === null || found === null) {
        // Not a fault: this recitation has nothing for that Ayah.
        set({ status: state.playing === null ? 'idle' : 'paused', problem: 'no-audio' });
        return;
      }
      // An untimed segment can only be played from its start.
      const ayah = found.segment.timings === null ? found.segment.startAyah : ref.ayah;
      await begin(audio, found.index, ayah, ticket);
    })
    .catch(() => {
      if (ticket === generation) set({ status: 'paused', problem: 'failed' });
    });
}

/** Plays a whole Surah from its first Ayah with audio. */
export function playSurah(surah: number): void {
  playFrom({ surah, ayah: 1 });
}

export function togglePlay(): void {
  const media = element;
  if (media === null || state.playing === null) return;
  if (media.paused) {
    if (state.status === 'ended' && cursor !== null && current !== null) {
      // After the plan ended, Play starts it again from where it began.
      const segment = segmentNow();
      const range = state.plan.range;
      if (segment !== null && range !== null && range.surah === segment.surah)
        seekOwn(spanOf(segment, range.from)?.startMs ?? 0);
      else if (media.ended) seekOwn(0);
      cursor = { ...cursor, heard: 0, passes: 0 };
    }
    media.playbackRate = state.rate;
    void media.play().catch(() => set({ status: 'paused', problem: 'failed' }));
  } else {
    media.pause();
  }
}

export function pause(): void {
  element?.pause();
}

/** The previous or next Ayah this audio holds (timed audio only). */
export function stepAyah(step: -1 | 1): void {
  if (current === null || !state.timed) return;
  const loaded = current.audio.segments[current.index];
  // In a segment's opening no Ayah is being heard yet: "next" is its first.
  const target =
    state.ayah === null
      ? step === 1
        ? (loaded?.startAyah ?? null)
        : null
      : neighbourAyah(current.audio, state.ayah, step);
  if (target === null) return;
  const found = segmentFor(current.audio, target);
  if (found === null) return;
  const ticket = ++generation;
  if (found.index === current.index) {
    const span = spanOf(found.segment, target);
    if (span === null) return;
    cursor = { surah: current.audio.surah, ayah: target, heard: 0, passes: 0 };
    seekOwn(span.startMs);
    set({ ayah: target });
    if (element?.paused === true) void element.play().catch(() => undefined);
    return;
  }
  void begin(current.audio, found.index, target, ticket);
}

/** Seeks within the loaded file, to a fraction of its duration. */
export function seekTo(ms: number): void {
  const media = element;
  if (media === null || !(state.durationMs > 0)) return;
  media.currentTime = Math.min(Math.max(0, ms), state.durationMs) / 1000;
}

export function chooseRecitation(slug: string): void {
  if (!state.catalogue.some((entry) => entry.slug === slug)) return;
  set({ choice: slug, problem: null });
  keepPreferences();
}

export function setRate(rate: PlaybackRate): void {
  set({ rate });
  if (element !== null) element.playbackRate = rate;
  keepPreferences();
}

export function setFollow(follow: boolean): void {
  set({ follow });
  keepPreferences();
}

export function setContinuous(continuous: boolean): void {
  set({ plan: { ...state.plan, continuous } });
  keepPreferences();
}

/** How many times each Ayah is heard (1 = once). */
export function setRepeat(times: number): void {
  set({ plan: { ...state.plan, repeat: repeatCount(times) } });
}

/** Loops `from`–`to` of the Surah being heard, `times` times (0 = until stopped); null clears. */
export function setRange(
  range: { readonly from: number; readonly to: number; readonly times: number } | null,
): void {
  if (range === null || state.surah === null) {
    set({ plan: { ...state.plan, range: null } });
    return;
  }
  const from = Math.min(range.from, range.to);
  const to = Math.max(range.from, range.to);
  set({
    plan: {
      ...state.plan,
      range: {
        surah: state.surah,
        from,
        to,
        times: Math.max(0, Math.trunc(range.times)),
      },
    },
  });
  if (cursor !== null) cursor = { ...cursor, passes: 0 };
}

/** Stops and forgets what was playing; the dock closes. */
export function closePlayer(): void {
  generation += 1;
  stopFrames();
  if (element !== null) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }
  current = null;
  cursor = null;
  pendingStartMs = null;
  set({
    status: 'idle',
    problem: null,
    playing: null,
    surah: null,
    ayah: null,
    timed: false,
    positionMs: 0,
    durationMs: 0,
    ticks: [],
    plan: { ...DEFAULT_PLAN, continuous: state.plan.continuous },
  });
}
