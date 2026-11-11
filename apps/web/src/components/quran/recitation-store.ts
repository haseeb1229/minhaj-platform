'use client';

import { useSyncExternalStore } from 'react';

import {
  DEFAULT_PLAN,
  afterSegment,
  audioSource,
  ayahAt,
  neighbourAyah,
  passageFits,
  passagesOf,
  playbackRate,
  readSurahAudio,
  repeatCount,
  segmentFor,
  spanOf,
  startMsOf,
  tick,
  ticksOf,
  timingFits,
  translationOffer,
  untimed,
  type Cursor,
  type PlayPlan,
  type PlaybackRate,
  type PlayableSegment,
  type SurahAudio,
  type TranslationPassage,
} from './recitation-plan';

/**
 * THE RECITATION PLAYER'S STATE AND ITS ONE AUDIO ELEMENT (Quran Part 5).
 *
 * A MODULE, NOT A COMPONENT, so it outlives every page: the Quran layout's
 * dock and each page's listen controls read and drive the same state, and a
 * client navigation between Quran pages leaves the audio playing.
 *
 * ONE ELEMENT FOR THE RECITATION, NEVER IN THE DOCUMENT. The element is
 * created by the listener's first press of Play — never on load — and is not
 * attached to the page, so no page carries a second `<audio>` beside its own
 * native fallback. That first press also calls `play()` inside the gesture,
 * which is what a browser requires before later tracks may begin by themselves
 * (the next Ayah, the next Surah); nothing plays until then.
 *
 * AND ONE FOR THE TRANSLATION (translation audio, 2026-11-10). With
 * "translation after each passage" on, the narration's file is a SECOND
 * element, created and permitted in the same press. One element switching
 * between the qari's stream and the narration's file would drop each file's
 * buffer and position at every passage — a reload, and a gap, twice per
 * passage; two elements keep both, so the qari pauses exactly where the
 * passage ends, the narration (already preloaded) plays its span, and the qari
 * resumes. Only one of them ever plays at a time.
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
  /** The style as the source names it ("Murattal" …), which the chooser groups by. */
  readonly style: string | null;
  readonly languageCode: string | null;
  readonly timed: boolean;
  /** Surahs whose audio says where each passage's translation is heard. */
  readonly translatedSurahs: readonly number[];
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
  /** The passage whose translation is being heard now, or null. */
  readonly translating: { readonly from: number; readonly to: number } | null;
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
  translating: null,
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
  readonly translation: boolean;
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
      translation: value['translation'] === true,
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
        translation: state.plan.translation,
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
      : {
          ...state.plan,
          continuous: kept.continuous ?? true,
          translation: kept.translation ?? false,
        },
  });
}

/** The narration that can follow a passage with its translation, if one is public. */
export function translationSource(
  catalogue: readonly CatalogueEntry[] = state.catalogue,
): CatalogueEntry | undefined {
  return catalogue.find(
    (entry) => entry.languageCode === 'ur' && entry.translatedSurahs.length > 0,
  );
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

/** The translation's element, its passages for one Surah, and the one playing. */
let narrator: HTMLAudioElement | null = null;
let passages: readonly TranslationPassage[] = [];
let passagesFor: string | null = null;
let translatingNow: {
  readonly passage: TranslationPassage;
  readonly resumeMs: number;
  /** The passage ended the recitation's file: carry on as its end does. */
  readonly afterEnd: boolean;
} | null = null;
/** Where the narration starts once its file's metadata has loaded. */
let narratorPendingMs: number | null = null;

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
    // Paused for a passage's translation: the translation is playing.
    if (translatingNow !== null) return;
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
    if (translatingNow !== null) {
      if (narrator === null || narrator.paused) return;
      onNarrationPosition();
    } else {
      if (element === null || element.paused) return;
      onPosition();
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
}

/* ===========================================================================
 * The translation
 * ========================================================================= */

function narratorElement(): HTMLAudioElement {
  if (narrator !== null) return narrator;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.addEventListener('timeupdate', onNarrationPosition);
  audio.addEventListener('playing', () => {
    if (translatingNow === null) return;
    set({ status: 'playing', problem: null });
    startFrames();
  });
  audio.addEventListener('pause', () => {
    // The listener's own pause during a translation; its end is not a pause.
    if (translatingNow !== null && state.status !== 'ended') set({ status: 'paused' });
  });
  audio.addEventListener('waiting', () => {
    if (translatingNow !== null && !audio.paused) set({ status: 'buffering' });
  });
  audio.addEventListener('loadedmetadata', () => {
    const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 0;
    // A span that runs past the narration's file is not this file's: this
    // Surah's translation is set aside and the recitation carries on.
    if (translatingNow !== null && !passageFits(translatingNow.passage, durationMs)) {
      abandonTranslation();
      return;
    }
    if (narratorPendingMs !== null) {
      audio.currentTime = narratorPendingMs / 1000;
      narratorPendingMs = null;
    }
  });
  audio.addEventListener('ended', () => finishTranslation());
  audio.addEventListener('error', () => {
    if (audio.getAttribute('src') === null) return;
    // The translation could not be heard: the recitation goes on without it.
    abandonTranslation();
  });
  narrator = audio;
  return audio;
}

/**
 * This Surah's passages from the narration, when the plan asks for them and
 * they are offered for the recitation about to play; the narration's file is
 * then preloaded. A failure is not the recitation's: it plays without them.
 */
async function preparePassages(recitation: string, surah: number): Promise<void> {
  const key = `${recitation}:${String(surah)}`;
  if (passagesFor === key) return;
  const chosen = state.catalogue.find((entry) => entry.slug === recitation);
  const source = translationSource();
  passages = [];
  passagesFor = key;
  if (
    !state.plan.translation ||
    source === undefined ||
    translationOffer(chosen, source, surah) !== 'offered'
  )
    return;
  const found = await load(source.slug, surah)
    .then((audio) => (audio === null ? [] : passagesOf(audio)))
    .catch(() => []);
  if (passagesFor !== key) return;
  passages = found;
  const first = found[0];
  if (first === undefined) return;
  const media = narratorElement();
  const address = audioSource(first.audio);
  if (media.getAttribute('src') !== address) {
    narratorPendingMs = null;
    media.src = address;
  }
}

/** The passages that belong to what is loaded now. */
function passagesNow(): readonly TranslationPassage[] {
  return current !== null &&
    state.playing !== null &&
    passagesFor === `${state.playing}:${String(current.audio.surah)}`
    ? passages
    : [];
}

function startTranslation(
  passage: TranslationPassage,
  resumeMs: number,
  afterEnd: boolean,
): void {
  const media = narratorElement();
  translatingNow = { passage, resumeMs, afterEnd };
  element?.pause();
  set({ translating: { from: passage.from, to: passage.to } });
  const address = audioSource(passage.audio);
  if (media.getAttribute('src') !== address) {
    narratorPendingMs = passage.startMs;
    media.src = address;
  } else if (media.readyState >= HTMLMediaElement.HAVE_METADATA) {
    const durationMs = Number.isFinite(media.duration) ? media.duration * 1000 : 0;
    if (!passageFits(passage, durationMs)) {
      abandonTranslation();
      return;
    }
    media.currentTime = passage.startMs / 1000;
  } else {
    narratorPendingMs = passage.startMs;
  }
  media.playbackRate = state.rate;
  void media.play().catch(() => {
    if (translatingNow?.passage === passage) abandonTranslation();
  });
}

function onNarrationPosition(): void {
  const passage = translatingNow?.passage;
  if (passage === undefined || narrator === null || narratorPendingMs !== null) return;
  if (narrator.currentTime * 1000 >= passage.endMs) finishTranslation();
}

/** The passage's translation is over: the recitation carries on after it. */
function finishTranslation(): void {
  const done = translatingNow;
  if (done === null) return;
  translatingNow = null;
  narratorPendingMs = null;
  narrator?.pause();
  set({ translating: null });
  if (done.afterEnd) {
    void onEnded();
    return;
  }
  const media = element;
  if (media === null) return;
  if (Math.abs(media.currentTime * 1000 - done.resumeMs) > 50) seekOwn(done.resumeMs);
  media.playbackRate = state.rate;
  void media.play().catch(() => set({ status: 'paused', problem: 'failed' }));
}

/** This Surah's translation cannot be heard: set it aside and carry on. */
function abandonTranslation(): void {
  passages = [];
  finishTranslation();
}

/** The listener moved elsewhere: whatever translation was playing stops. */
function cancelTranslation(): void {
  if (translatingNow === null) return;
  translatingNow = null;
  narratorPendingMs = null;
  narrator?.pause();
  set({ translating: null });
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
  if (translatingNow !== null) return;
  const ms = audio.currentTime * 1000;
  const decision = tick(state.plan, segment, cursor, ms, passagesNow());
  cursor = decision.cursor;
  if (decision.kind === 'seek') seekOwn(decision.ms);
  if (decision.kind === 'stop') {
    audio.pause();
    stopFrames();
    set({ status: 'ended' });
  }
  if (state.ayah !== cursor.ayah || Math.abs(state.positionMs - ms) >= 200)
    set({ ayah: cursor.ayah, positionMs: ms });
  if (decision.kind === 'translate')
    startTranslation(decision.passage, decision.resumeMs, false);
}

async function onEnded(): Promise<void> {
  const audio = element;
  const segment = segmentNow();
  if (audio === null || segment === null || current === null || cursor === null) return;
  // The file's end is a position too: a repeat of its last Ayah, a range
  // ending with it or its passage's translation, is decided exactly as any
  // other end of an Ayah.
  const decision = tick(
    state.plan,
    segment,
    cursor,
    Number.MAX_SAFE_INTEGER,
    passagesNow(),
  );
  cursor = decision.cursor;
  if (decision.kind === 'translate') {
    startTranslation(decision.passage, decision.resumeMs, true);
    return;
  }
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
    const playing = state.playing;
    set({ status: 'loading' });
    try {
      const [audioData] = await Promise.all([
        load(playing, next.surah),
        preparePassages(playing, next.surah),
      ]);
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
  cancelTranslation();
  const media = audioElement();
  const source = audioSource(segment.audio);
  const startMs = startMsOf(segment, ayah);
  current = { audio, index };
  cursor = {
    surah: audio.surah,
    ayah: segment.timings === null || startMs === 0 ? null : ayah,
    heard: 0,
    passes: 0,
    translated: false,
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
  // The translation's element is permitted in the same press, so a passage's
  // translation may begin later without one.
  if (state.plan.translation) {
    const translation = narratorElement();
    if (translation.getAttribute('src') === null)
      void translation.play().catch(() => undefined);
  }
}

/* ===========================================================================
 * Commands
 * ========================================================================= */

/** Plays the chosen recitation from an Ayah. */
export function playFrom(ref: { readonly surah: number; readonly ayah: number }): void {
  const choice = state.choice;
  if (choice === null) return;
  unlock();
  cancelTranslation();
  const ticket = ++generation;
  set({ status: 'loading', problem: null, surah: ref.surah });
  void Promise.all([load(choice, ref.surah), preparePassages(choice, ref.surah)])
    .then(async ([audio]) => {
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
  // During a passage's translation, Play and Pause are the translation's.
  if (translatingNow !== null && narrator !== null) {
    if (narrator.paused) {
      narrator.playbackRate = state.rate;
      void narrator.play().catch(() => abandonTranslation());
    } else narrator.pause();
    return;
  }
  if (media.paused) {
    if (state.status === 'ended' && cursor !== null && current !== null) {
      // After the plan ended, Play starts it again from where it began.
      const segment = segmentNow();
      const range = state.plan.range;
      if (segment !== null && range !== null && range.surah === segment.surah)
        seekOwn(spanOf(segment, range.from)?.startMs ?? 0);
      else if (media.ended) seekOwn(0);
      cursor = { ...cursor, heard: 0, passes: 0, translated: false };
    }
    media.playbackRate = state.rate;
    void media.play().catch(() => set({ status: 'paused', problem: 'failed' }));
  } else {
    media.pause();
  }
}

export function pause(): void {
  if (translatingNow !== null) narrator?.pause();
  else element?.pause();
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
  cancelTranslation();
  if (found.index === current.index) {
    const span = spanOf(found.segment, target);
    if (span === null) return;
    cursor = {
      surah: current.audio.surah,
      ayah: target,
      heard: 0,
      passes: 0,
      translated: false,
    };
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
  // Seeking the recitation leaves any translation where it is: back to the qari.
  const resume = translatingNow !== null;
  cancelTranslation();
  media.currentTime = Math.min(Math.max(0, ms), state.durationMs) / 1000;
  if (resume) void media.play().catch(() => undefined);
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

/**
 * Hear each passage's translation after it. Turned on while playing, this
 * Surah's passages are fetched now (the press that turns it on also permits
 * the translation's element); turned off, a translation playing ends and the
 * recitation carries on.
 */
export function setTranslation(translation: boolean): void {
  set({ plan: { ...state.plan, translation } });
  keepPreferences();
  if (!translation) {
    finishTranslation();
    return;
  }
  const translationElement = narratorElement();
  if (translationElement.getAttribute('src') === null)
    void translationElement.play().catch(() => undefined);
  if (state.playing !== null && current !== null) {
    passagesFor = null;
    void preparePassages(state.playing, current.audio.surah);
  }
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
  if (cursor !== null) cursor = { ...cursor, passes: 0, translated: false };
}

/** Stops and forgets what was playing; the dock closes. */
export function closePlayer(): void {
  generation += 1;
  cancelTranslation();
  stopFrames();
  if (element !== null) {
    element.pause();
    element.removeAttribute('src');
    element.load();
  }
  if (narrator !== null) {
    narrator.removeAttribute('src');
    narrator.load();
  }
  passages = [];
  passagesFor = null;
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
    plan: {
      ...DEFAULT_PLAN,
      continuous: state.plan.continuous,
      translation: state.plan.translation,
    },
    translating: null,
  });
}
