'use client';

import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';

import { localizedPath, splitLocalePath } from '@minhaj/contracts';

import { Icon } from '@/components/ui/icon';
import {
  PLAYBACK_RATES,
  PLAY_REQUEST,
  REPEAT_MAX,
  playbackRate,
} from './recitation-plan';
import { RecitationOptions } from './recitation-listen';
import {
  chooseRecitation,
  closePlayer,
  initialisePlayer,
  onPlayer,
  pause,
  playFrom,
  playSurah,
  playerState,
  seekTo,
  setContinuous,
  setFollow,
  setRange,
  setRate,
  setRepeat,
  stepAyah,
  togglePlay,
  usePlayer,
  type CatalogueEntry,
  type PlayerState,
} from './recitation-store';
import { ayahElementId } from './reading-layout';

/**
 * THE RECITATION DOCK (Quran Part 5) — the mini-player that stays at the foot
 * of every Quran page while a recitation plays, mounted once by the Quran
 * layout so it survives navigation between Quran pages.
 *
 * NOTHING PLAYS UNTIL ASKED, and nothing is drawn until then: the dock appears
 * when the listener presses Play on an Ayah, a Surah or a Juz, and it closes
 * when they close it. Its controls are native buttons, selects and a range
 * input — operable by keyboard and named for a screen reader — and its
 * shortcuts (Space, J, K, L) act ONLY while focus is inside the dock, so they
 * never take a key from a screen reader's own commands or from the page.
 *
 * IT FOLLOWS THE TEXT. The Ayah being heard is marked on the page
 * (`data-recited`) and, while "Follow along" is on, scrolled into view —
 * instantly when the visitor prefers reduced motion, and never while they are
 * scrolling themselves. When the recitation carries on into the next Surah
 * from that Surah's own page, the page follows it there.
 *
 * NAVIGATION KEEPS THE AUDIO. While a recitation is loaded, a link or a GET
 * form to another Quran page in the same language is followed by the client
 * router instead of a full load, so the layout — and this dock — stay. Every
 * other link behaves exactly as it always does.
 *
 * THE LOCK SCREEN KNOWS WHAT PLAYS. The Media Session names the Surah, the
 * Ayah and the reciter, and its play, pause, previous, next and seek controls
 * drive the same commands as the dock's buttons.
 */

export interface DockLabels {
  readonly region: string;
  readonly play: string;
  readonly pause: string;
  readonly previous: string;
  readonly next: string;
  readonly close: string;
  readonly options: string;
  readonly loading: string;
  readonly buffering: string;
  readonly ended: string;
  readonly failed: string;
  readonly noAudio: string;
  readonly untimed: string;
  /** "{surah} · Ayah {ayah}" */
  readonly now: string;
  readonly position: string;
  /** "{position} of {duration}" */
  readonly positionValue: string;
  /** "Ayah {ayah}" */
  readonly ayah: string;
  readonly recitation: string;
  readonly speed: string;
  /** "{rate}×" */
  readonly rate: string;
  readonly repeat: string;
  /** "{count}×" */
  readonly repeatTimes: string;
  readonly range: string;
  readonly rangeFrom: string;
  readonly rangeTo: string;
  readonly rangeTimes: string;
  readonly rangeForever: string;
  readonly rangeApply: string;
  readonly rangeClear: string;
  /** "Repeating ayat {from}–{to}" */
  readonly rangeActive: string;
  readonly follow: string;
  readonly continuous: string;
  readonly shortcuts: string;
  /** Each Surah's display label, by number. */
  readonly surahs: Readonly<Record<string, string>>;
  /** "Surah {number}" — when no label is recorded. */
  readonly surahFallback: string;
}

function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match,
  );
}

function clock(ms: number, locale: string): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) =>
    new Intl.NumberFormat(locale, { minimumIntegerDigits: 2 }).format(value);
  const plain = new Intl.NumberFormat(locale);
  return hours > 0
    ? `${plain.format(hours)}:${pad(minutes)}:${pad(seconds)}`
    : `${plain.format(minutes)}:${pad(seconds)}`;
}

export function surahLabel(labels: DockLabels, surah: number): string {
  return labels.surahs[String(surah)] ?? fill(labels.surahFallback, { number: surah });
}

/** The words the dock says about where playback is. */
function statusText(state: PlayerState, labels: DockLabels): string | null {
  if (state.problem === 'failed') return labels.failed;
  if (state.problem === 'no-audio') return labels.noAudio;
  if (state.status === 'loading') return labels.loading;
  if (state.status === 'buffering') return labels.buffering;
  if (state.status === 'ended') return labels.ended;
  return null;
}

/* ===========================================================================
 * Page effects: the Ayah being heard, navigation, the lock screen
 * ========================================================================= */

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** How long the visitor's own scrolling suspends following, in milliseconds. */
const SCROLL_PAUSE_MS = 6000;
const NAVIGATION_KEYS = new Set([
  'PageDown',
  'PageUp',
  'Home',
  'End',
  'ArrowDown',
  'ArrowUp',
]);

/** Is `row` comfortably inside the reading area (below the sticky bar, above the dock)? */
function inView(row: Element): boolean {
  const box = row.getBoundingClientRect();
  const dock = document.querySelector('[data-quran-dock]')?.getBoundingClientRect();
  const bottom = dock === undefined ? window.innerHeight : dock.top;
  return box.top >= 72 && box.bottom <= bottom - 8;
}

function useFollowAlong(): void {
  useEffect(() => {
    let marked: string | null = null;
    let suspendedUntil = 0;
    const suspend = () => {
      suspendedUntil = Date.now() + SCROLL_PAUSE_MS;
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (NAVIGATION_KEYS.has(event.key)) suspend();
    };
    function apply() {
      const state = playerState();
      const id =
        state.playing !== null && state.surah !== null && state.ayah !== null
          ? ayahElementId({ surah: state.surah, ayah: state.ayah })
          : null;
      if (id !== marked && marked !== null)
        document.getElementById(marked)?.removeAttribute('data-recited');
      const row = id === null ? null : document.getElementById(id);
      if (row === null) {
        marked = null;
        return;
      }
      if (!row.hasAttribute('data-recited')) row.setAttribute('data-recited', '');
      const moved = id !== marked;
      marked = id;
      if (
        moved &&
        state.follow &&
        state.status === 'playing' &&
        Date.now() >= suspendedUntil &&
        !inView(row)
      )
        row.scrollIntoView({
          block: 'center',
          behavior: window.matchMedia(REDUCED_MOTION).matches ? 'auto' : 'smooth',
        });
    }
    const stop = onPlayer(apply);
    // A navigation or a loaded window brings new rows: mark the one being heard.
    const observer = new MutationObserver(() => apply());
    const main = document.getElementById('main-content') ?? document.body;
    observer.observe(main, { childList: true, subtree: true });
    window.addEventListener('wheel', suspend, { passive: true });
    window.addEventListener('touchmove', suspend, { passive: true });
    window.addEventListener('keydown', onKey);
    apply();
    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener('wheel', suspend);
      window.removeEventListener('touchmove', suspend);
      window.removeEventListener('keydown', onKey);
      if (marked !== null)
        document.getElementById(marked)?.removeAttribute('data-recited');
    };
  }, []);
}

/** A same-origin Quran address in this interface language, or null. */
function quranDestination(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, window.location.href);
  } catch {
    return null;
  }
  if (url.origin !== window.location.origin) return null;
  const target = splitLocalePath(url.pathname);
  const here = splitLocalePath(window.location.pathname);
  if (target.locale !== here.locale) return null;
  if (target.rest !== '/quran' && !target.rest.startsWith('/quran/')) return null;
  // A fragment on this same page is the browser's own business.
  if (
    url.pathname === window.location.pathname &&
    url.search === window.location.search &&
    url.hash !== ''
  )
    return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

function useKeepPlayingAcrossPages(active: boolean): void {
  const router = useRouter();
  useEffect(() => {
    if (!active) return undefined;
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (anchor === null || anchor.hasAttribute('download')) return;
      if (anchor.target !== '' && anchor.target !== '_self') return;
      const destination = quranDestination(anchor.href);
      if (destination === null) return;
      event.preventDefault();
      router.push(destination);
    };
    const onSubmit = (event: SubmitEvent) => {
      const form = event.target;
      if (event.defaultPrevented || !(form instanceof HTMLFormElement)) return;
      if (form.method.toLowerCase() !== 'get' || form.target !== '') return;
      const destination = quranDestination(form.action);
      if (destination === null) return;
      const query = new URLSearchParams();
      for (const [key, value] of new FormData(form, event.submitter))
        if (typeof value === 'string') query.append(key, value);
      event.preventDefault();
      const path = destination.split(/[?#]/, 1)[0] ?? destination;
      const search = query.toString();
      router.push(search === '' ? path : `${path}?${search}`);
    };
    document.addEventListener('click', onClick);
    document.addEventListener('submit', onSubmit);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('submit', onSubmit);
    };
  }, [active, router]);
}

/**
 * Into the next Surah from that Surah's own page, with following on: the page
 * follows the recitation, carrying its reading choices along.
 */
function usePageFollowsSurah(locale: string): void {
  const router = useRouter();
  useEffect(() => {
    let previous = playerState().surah;
    return onPlayer(() => {
      const state = playerState();
      const surah = state.surah;
      if (surah === previous) return;
      const from = previous;
      previous = surah;
      if (surah === null || from === null || !state.follow || state.playing === null)
        return;
      const { rest } = splitLocalePath(window.location.pathname);
      if (rest !== `/quran/surah/${String(from)}`) return;
      const query = new URLSearchParams(window.location.search);
      query.delete('from');
      const search = query.toString();
      const path = localizedPath(locale, `/quran/surah/${String(surah)}`);
      router.push(search === '' ? path : `${path}?${search}`);
    });
  }, [locale, router]);
}

function useMediaSession(labels: DockLabels): void {
  const state = usePlayer();
  const entry = state.catalogue.find((item) => item.slug === state.playing);
  const title =
    state.surah === null
      ? null
      : state.ayah === null
        ? surahLabel(labels, state.surah)
        : fill(labels.now, { surah: surahLabel(labels, state.surah), ayah: state.ayah });

  useEffect(() => {
    if (!('mediaSession' in navigator)) return undefined;
    const session = navigator.mediaSession;
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      // Play and pause are answered for what they say, never as a toggle: a
      // lock screen may send Play to a recitation that is already playing.
      [
        'play',
        () => {
          if (playerState().status !== 'playing') togglePlay();
        },
      ],
      ['pause', () => pause()],
      ['previoustrack', () => stepAyah(-1)],
      ['nexttrack', () => stepAyah(1)],
      ['seekto', (details) => seekTo((details.seekTime ?? 0) * 1000)],
      ['stop', () => closePlayer()],
    ];
    for (const [action, handler] of handlers) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        /* An action this browser does not support. */
      }
    }
    return () => {
      for (const [action] of handlers) {
        try {
          session.setActionHandler(action, null);
        } catch {
          /* As above. */
        }
      }
    };
  }, []);

  useEffect(() => {
    if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
    navigator.mediaSession.metadata =
      title === null
        ? null
        : new MediaMetadata({
            title,
            artist: entry?.reciter ?? entry?.name ?? '',
            album: entry?.name ?? '',
          });
  }, [title, entry]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState =
      state.status === 'playing' || state.status === 'buffering'
        ? 'playing'
        : state.playing === null
          ? 'none'
          : 'paused';
    if (
      state.durationMs > 0 &&
      typeof navigator.mediaSession.setPositionState === 'function'
    ) {
      try {
        navigator.mediaSession.setPositionState({
          duration: state.durationMs / 1000,
          position: Math.min(state.positionMs, state.durationMs) / 1000,
          playbackRate: state.rate,
        });
      } catch {
        /* A position the browser will not take is left as it was. */
      }
    }
  }, [state.status, state.playing, state.durationMs, state.positionMs, state.rate]);
}

/** Plays what the page's own controls ask for, by delegation. */
function usePlayRequests(): void {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const control = target?.closest<HTMLElement>(
        '[data-ayah-action="play"], [data-quran-play]',
      );
      if (control === null || control === undefined) return;
      const surah = Number(control.dataset['surah']);
      const ayah = Number(control.dataset['ayah']);
      const citation =
        control.dataset['ayahAction'] === 'play'
          ? control.closest<HTMLElement>('[data-ayah]')?.dataset['ayah']
          : undefined;
      if (citation !== undefined) {
        const [s, a] = citation.split(':').map(Number);
        if (s !== undefined && a !== undefined && s > 0 && a > 0) {
          event.preventDefault();
          playFrom({ surah: s, ayah: a });
        }
        return;
      }
      if (Number.isInteger(surah) && surah > 0) {
        event.preventDefault();
        if (control.dataset['recitation'] !== undefined)
          chooseRecitation(control.dataset['recitation']);
        if (Number.isInteger(ayah) && ayah > 0) playFrom({ surah, ayah });
        else playSurah(surah);
      }
    };
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail as {
        readonly surah?: unknown;
        readonly ayah?: unknown;
      } | null;
      const surah = Number(detail?.surah);
      const ayah = Number(detail?.ayah);
      if (Number.isInteger(surah) && Number.isInteger(ayah) && surah > 0 && ayah > 0)
        playFrom({ surah, ayah });
    };
    document.addEventListener('click', onClick);
    window.addEventListener(PLAY_REQUEST, onRequest);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener(PLAY_REQUEST, onRequest);
    };
  }, []);
}

/* ===========================================================================
 * The dock
 * ========================================================================= */

const CONTROL =
  'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken disabled:opacity-40';

export function RecitationDock({
  catalogue,
  labels,
  locale,
}: {
  readonly catalogue: readonly CatalogueEntry[];
  readonly labels: DockLabels;
  readonly locale: string;
}) {
  const state = usePlayer();
  const [open, setOpen] = useState(false);
  const base = useId();
  const optionsId = `${base}-options`;

  useEffect(() => {
    const preferred = new URLSearchParams(window.location.search).get('reciter');
    initialisePlayer(catalogue, preferred);
  }, [catalogue]);

  // What the page's own controls show depends on the chosen recitation: a
  // per-Ayah play button only where the recitation is timed.
  const chosen = state.catalogue.find((entry) => entry.slug === state.choice);
  useEffect(() => {
    const root = document.documentElement;
    if (!state.ready || chosen === undefined) {
      root.removeAttribute('data-quran-player');
      return undefined;
    }
    root.setAttribute('data-quran-player', chosen.timed ? 'timed' : 'untimed');
    return () => root.removeAttribute('data-quran-player');
  }, [state.ready, chosen]);

  usePlayRequests();
  useFollowAlong();
  useKeepPlayingAcrossPages(state.playing !== null);
  usePageFollowsSurah(locale);
  useMediaSession(labels);

  const visible =
    state.playing !== null || state.status === 'loading' || state.problem !== null;
  if (!visible) return null;

  const playing = state.status === 'playing' || state.status === 'buffering';
  const entry = state.catalogue.find(
    (item) => item.slug === (state.playing ?? state.choice),
  );
  const title =
    state.surah === null
      ? ''
      : state.ayah === null
        ? surahLabel(labels, state.surah)
        : fill(labels.now, { surah: surahLabel(labels, state.surah), ayah: state.ayah });
  const status = statusText(state, labels);
  const positionText = fill(labels.positionValue, {
    position: clock(state.positionMs, locale),
    duration: clock(state.durationMs, locale),
  });

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    const typing =
      target instanceof HTMLSelectElement ||
      // Every field but the seek bar keeps its own keys (Space ticks a switch).
      (target instanceof HTMLInputElement && target.type !== 'range');
    if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
    const key = event.key.toLowerCase();
    const onButton = target instanceof HTMLButtonElement;
    if ((key === ' ' && !onButton) || key === 'k') {
      event.preventDefault();
      togglePlay();
    } else if (key === 'j') {
      event.preventDefault();
      stepAyah(-1);
    } else if (key === 'l') {
      event.preventDefault();
      stepAyah(1);
    } else if (key === 'escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <section
      data-quran-dock=""
      // Where playback is, as plain data on the dock itself — for styling
      // and for the browser suite's proofs; nothing reads it back.
      data-status={state.status}
      data-playing-surah={state.surah ?? undefined}
      data-playing-ayah={state.ayah ?? undefined}
      data-position={Math.round(state.positionMs / 100) * 100}
      aria-label={labels.region}
      onKeyDown={onKeyDown}
      className="quran-dock fixed inset-x-0 bottom-0 z-[var(--layer-dock)] border-t border-border bg-surface-raised shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)]"
    >
      <div className="mx-auto flex w-full max-w-4xl min-w-0 flex-col gap-1.5 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
        <div className="flex min-w-0 items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => stepAyah(-1)}
            disabled={!state.timed}
            aria-label={labels.previous}
            className={`${CONTROL} max-sm:hidden`}
          >
            <Icon name="skip-previous" size={20} />
          </button>
          <button
            type="button"
            onClick={() => togglePlay()}
            disabled={state.playing === null}
            aria-label={playing ? labels.pause : labels.play}
            className="inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-action text-action-foreground transition-colors duration-[var(--duration-fast)] hover:bg-action-hover disabled:opacity-50"
          >
            <Icon name={playing ? 'pause' : 'play'} size={24} />
          </button>
          <button
            type="button"
            onClick={() => stepAyah(1)}
            disabled={!state.timed}
            aria-label={labels.next}
            className={CONTROL}
          >
            <Icon name="skip-next" size={20} />
          </button>
          <div className="flex min-w-0 flex-1 flex-col ps-1">
            <p className="truncate text-sm font-semibold" dir="auto">
              {title}
            </p>
            <p className="truncate text-caption text-foreground-muted" dir="auto">
              {entry?.reciter ?? entry?.name ?? ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            aria-controls={optionsId}
            aria-label={labels.options}
            className={CONTROL}
          >
            <Icon name="settings" size={20} />
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              closePlayer();
            }}
            aria-label={labels.close}
            className={CONTROL}
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <SeekBar state={state} labels={labels} valueText={positionText} />

        <p className="flex min-h-5 flex-wrap items-center justify-between gap-x-3 text-caption text-foreground-muted">
          <span role="status" className="font-medium text-action">
            {status ?? ''}
          </span>
          {state.timed || state.playing === null ? null : <span>{labels.untimed}</span>}
          {state.plan.range === null ? null : (
            <span className="inline-flex items-center gap-1">
              <Icon name="repeat" size={16} />
              {fill(labels.rangeActive, {
                from: state.plan.range.from,
                to: state.plan.range.to,
              })}
            </span>
          )}
          <span className="tabular-nums">{positionText}</span>
        </p>

        {open ? <DockOptions id={optionsId} state={state} labels={labels} /> : null}
      </div>
    </section>
  );
}

/** The seek bar, with a tick where each timed Ayah begins. */
function SeekBar({
  state,
  labels,
  valueText,
}: {
  readonly state: PlayerState;
  readonly labels: DockLabels;
  readonly valueText: string;
}) {
  const ayahText =
    state.ayah === null ? '' : `, ${fill(labels.ayah, { ayah: state.ayah })}`;
  return (
    <div className="quran-dock-seek relative flex h-6 items-center">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 h-full">
        {state.ticks.map((tick) => (
          <span
            key={tick.ayah}
            className="quran-dock-tick"
            ref={(element) => element?.style.setProperty('--at', String(tick.at))}
          />
        ))}
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(1, Math.round(state.durationMs))}
        step={1000}
        value={Math.min(Math.round(state.positionMs), Math.round(state.durationMs))}
        disabled={!(state.durationMs > 0)}
        onChange={(event) => seekTo(Number(event.currentTarget.value))}
        aria-label={labels.position}
        aria-valuetext={`${valueText}${ayahText}`}
        className="quran-dock-range relative w-full accent-action"
      />
    </div>
  );
}

/** The dock's settings: recitation, speed, repeats, a range, following. */
function DockOptions({
  id,
  state,
  labels,
}: {
  readonly id: string;
  readonly state: PlayerState;
  readonly labels: DockLabels;
}) {
  const [from, setFrom] = useState(state.plan.range?.from ?? state.ayah ?? 1);
  const [to, setTo] = useState(state.plan.range?.to ?? state.ayah ?? 1);
  const [times, setTimes] = useState(state.plan.range?.times ?? 3);
  const field = 'flex min-w-0 flex-col gap-1 text-caption font-medium';
  const select =
    'min-h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-sm text-foreground';
  const surahHeard = state.surah;

  return (
    <div
      id={id}
      className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto border-t border-border py-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className={field}>
          {labels.recitation}
          <select
            className={select}
            value={state.choice ?? ''}
            onChange={(event) => chooseRecitation(event.currentTarget.value)}
          >
            <RecitationOptions catalogue={state.catalogue} />
          </select>
        </label>
        <label className={field}>
          {labels.speed}
          <select
            className={select}
            value={String(state.rate)}
            onChange={(event) => setRate(playbackRate(Number(event.currentTarget.value)))}
          >
            {PLAYBACK_RATES.map((rate) => (
              <option key={rate} value={String(rate)}>
                {fill(labels.rate, { rate })}
              </option>
            ))}
          </select>
        </label>
        <label className={field}>
          {labels.repeat}
          <select
            className={select}
            value={String(state.plan.repeat)}
            disabled={!state.timed}
            onChange={(event) => setRepeat(Number(event.currentTarget.value))}
          >
            {[1, 2, 3, 5, REPEAT_MAX].map((count) => (
              <option key={count} value={String(count)}>
                {fill(labels.repeatTimes, { count })}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state.timed && surahHeard !== null ? (
        <fieldset className="flex min-w-0 flex-col gap-2">
          <legend className="text-caption font-semibold">{labels.range}</legend>
          <div className="grid grid-cols-3 gap-2">
            <label className={field}>
              {labels.rangeFrom}
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className={select}
                value={from}
                onChange={(event) => setFrom(Number(event.currentTarget.value))}
              />
            </label>
            <label className={field}>
              {labels.rangeTo}
              <input
                type="number"
                min={1}
                inputMode="numeric"
                className={select}
                value={to}
                onChange={(event) => setTo(Number(event.currentTarget.value))}
              />
            </label>
            <label className={field}>
              {labels.rangeTimes}
              <select
                className={select}
                value={String(times)}
                onChange={(event) => setTimes(Number(event.currentTarget.value))}
              >
                {[2, 3, 5, REPEAT_MAX].map((count) => (
                  <option key={count} value={String(count)}>
                    {fill(labels.repeatTimes, { count })}
                  </option>
                ))}
                <option value="0">{labels.rangeForever}</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (from > 0 && to > 0) {
                  setRange({ from, to, times });
                  playFrom({ surah: surahHeard, ayah: Math.min(from, to) });
                }
              }}
              className="inline-flex min-h-11 items-center gap-2 rounded-control border border-border-strong px-4 text-sm font-semibold hover:bg-surface-sunken"
            >
              <Icon name="repeat" size={16} />
              {labels.rangeApply}
            </button>
            {state.plan.range === null ? null : (
              <button
                type="button"
                onClick={() => setRange(null)}
                className="inline-flex min-h-11 items-center rounded-control px-4 text-sm font-medium text-action hover:bg-surface-sunken"
              >
                {labels.rangeClear}
              </button>
            )}
          </div>
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-2">
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={state.follow}
            onChange={(event) => setFollow(event.currentTarget.checked)}
            className="size-4 accent-action"
          />
          {labels.follow}
        </label>
        <label className="inline-flex min-h-11 cursor-pointer items-center gap-3 text-sm">
          <input
            type="checkbox"
            role="switch"
            checked={state.plan.continuous}
            onChange={(event) => setContinuous(event.currentTarget.checked)}
            className="size-4 accent-action"
          />
          {labels.continuous}
        </label>
      </div>
      <p className="text-caption text-foreground-muted">{labels.shortcuts}</p>
    </div>
  );
}
