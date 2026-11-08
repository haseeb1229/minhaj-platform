'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { Sheet } from '@/components/ui/dialog';
import { Icon } from '@/components/ui/icon';
import { ayahCopyText, citationLine } from './citation';
import {
  DEFAULT_PREFERENCES,
  LAST_READ_KEY,
  PREFERENCES_KEY,
  SCALE,
  availableShows,
  readPreferences,
  resolveShow,
  stepScale,
  writeLastRead,
  writePreferences,
  type ReaderPreferences,
  type TranslationLanguage,
  type TranslationShow,
} from './reader-preferences';

/**
 * THE READER'S CONTROLS (R2; benchmark patterns 4, 5, 6 and 25) — the one
 * client island of a Quran reading page, sitting in its sticky context bar.
 *
 * THE TEXT NEVER PASSES THROUGH IT. The ayat, the translations and their
 * attribution are server-rendered; this island receives labels and numbers
 * only. It reaches the reader element by identifier and changes three things
 * on it: a `data-translations` attribute (which default translations show),
 * two CSS custom properties (the Arabic and translation sizes, set through the
 * CSSOM — the platform's `style-src 'self'` CSP refuses a style attribute but
 * permits `style.setProperty`) and `data-enhanced`, which reveals the per-Ayah
 * Copy and Share buttons only once there is script to run them.
 *
 * WHAT IT REMEMBERS, AND WHERE: presentation preferences and the last Ayah in
 * view, in `localStorage` only (`./reader-preferences`). Every access is
 * guarded — a private window or blocked storage forgets, it never breaks the
 * page — and nothing is read during render, so the first client render is the
 * server's (no hydration mismatch, and the shared document is the same for
 * every visitor).
 *
 * COPY AND SHARE BY DELEGATION. One listener on the reader serves every Ayah's
 * buttons, reading the Arabic from the element that rendered it — so the
 * copied Arabic is the stored text, byte for byte (`./citation`).
 *
 * NO MOTION. The position line is a native `<progress>`; nothing animates.
 */

export interface ReaderControlLabels {
  readonly translationSwitch: string;
  readonly settings: string;
  readonly settingsTitle: string;
  readonly close: string;
  readonly translationHeading: string;
  /** The label of every choice; the two languages by their own names. */
  readonly shows: Readonly<Record<TranslationShow, string>>;
  readonly arabicSize: string;
  readonly translationSize: string;
  readonly decrease: string;
  readonly increase: string;
  readonly reset: string;
  readonly kept: string;
  readonly moreOptions: string;
  readonly useDefault: string;
  /** "Juz {number}". */
  readonly position: string;
  readonly copied: string;
  readonly linkCopied: string;
  readonly copyFailed: string;
}

export interface ReaderControlsProps {
  /** The element that holds the ayat and receives the preferences. */
  readonly readerId: string;
  readonly labels: ReaderControlLabels;
  /** The languages of the default translations the server rendered. */
  readonly languages: readonly TranslationLanguage[];
  /** What the server showed, for the interface language. */
  readonly fallbackShow: TranslationShow;
  /** The address chose one translation itself: the quick choice steps aside. */
  readonly fixedTranslation: { readonly text: string; readonly resetHref: string } | null;
  /** The address set a size (`?size=`): a stored size does not override it. */
  readonly explicitSize: boolean;
  readonly initialJuz: number;
  /** Named sources of the Arabic, for the copied citation ("Tanzil Uthmani"). */
  readonly arabicSources: readonly string[];
  /** Each Surah on the page by number: its recorded name, or null. */
  readonly surahLabels: Readonly<Record<string, string | null>>;
  /** Remember the Ayah in view as "last read" (a reading page, not a citation). */
  readonly remember: boolean;
  /** Where the full GET reading form lives on the page, if it does. */
  readonly moreOptionsHref: string | null;
}

function load(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function save(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Not saved: still applied for this visit. */
  }
}

const percent = (scale: number) => `${String(Math.round(scale * 100))}%`;

const CONTROL =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control border border-border-strong bg-surface-raised px-3 text-sm font-medium text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-surface-raised';

export function QuranReaderControls({
  readerId,
  labels,
  languages,
  fallbackShow,
  fixedTranslation,
  explicitSize,
  initialJuz,
  arabicSources,
  surahLabels,
  remember,
  moreOptionsHref,
}: ReaderControlsProps) {
  const [preferences, setPreferences] = useState<ReaderPreferences>(DEFAULT_PREFERENCES);
  const [arabicTouched, setArabicTouched] = useState(false);
  const [open, setOpen] = useState(false);
  const [juz, setJuz] = useState(initialJuz);
  const [progress, setProgress] = useState({ value: 0, max: 1 });
  const [status, setStatus] = useState('');
  const lastOn = useRef<TranslationShow | null>(null);
  const statusTimer = useRef<number | null>(null);
  const base = useId();

  const show: TranslationShow = resolveShow(
    preferences.translations,
    languages,
    fallbackShow,
  );
  const choices = availableShows(languages);
  const quickChoice = fixedTranslation === null && languages.length > 0;

  // Restored after hydration, never during render.
  useEffect(() => {
    setPreferences(readPreferences(load(PREFERENCES_KEY)));
    document.getElementById(readerId)?.setAttribute('data-enhanced', '');
  }, [readerId]);

  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return;
    if (quickChoice) reader.setAttribute('data-translations', show);
    if (!explicitSize || arabicTouched)
      reader.style.setProperty('--quran-arabic-scale', String(preferences.arabicScale));
    reader.style.setProperty(
      '--quran-translation-scale',
      String(preferences.translationScale),
    );
  }, [readerId, show, quickChoice, explicitSize, arabicTouched, preferences]);

  const update = useCallback((next: Partial<ReaderPreferences>) => {
    setPreferences((previous) => {
      const merged = { ...previous, ...next };
      save(PREFERENCES_KEY, writePreferences(merged));
      return merged;
    });
  }, []);

  const say = useCallback((text: string) => {
    setStatus(text);
    if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(''), 4000);
  }, []);

  // The Ayah in view: the Juz it is in, the position line and "last read".
  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null || typeof IntersectionObserver === 'undefined') return;
    const rows = [...reader.querySelectorAll<HTMLElement>('[data-ayah]')];
    if (rows.length === 0) return;
    let timer: number | null = null;
    // The rows inside the reading band now — kept across callbacks, because
    // each callback reports only the rows that crossed its edges.
    const visible = new Set<number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = rows.indexOf(entry.target as HTMLElement);
          if (index < 0) continue;
          if (entry.isIntersecting) visible.add(index);
          else visible.delete(index);
        }
        if (visible.size === 0) return;
        const index = Math.min(...visible);
        const row = rows[index];
        if (row === undefined) return;
        setProgress({ value: index + 1, max: rows.length });
        const rowJuz = Number(row.dataset['juz']);
        if (Number.isInteger(rowJuz) && rowJuz > 0) setJuz(rowJuz);
        if (!remember) return;
        const [surah, ayah] = (row.dataset['ayah'] ?? '').split(':').map(Number);
        if (surah === undefined || ayah === undefined) return;
        if (timer !== null) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          save(LAST_READ_KEY, writeLastRead({ surah, ayah }));
        }, 800);
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    );
    for (const row of rows) observer.observe(row);
    return () => {
      observer.disconnect();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [readerId, remember]);

  // Copy and Share for every Ayah, by delegation.
  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return;

    function textOf(row: HTMLElement) {
      const [surah = 0, ayah = 0] = (row.dataset['ayah'] ?? '').split(':').map(Number);
      const ref = { surah, ayah };
      const visible = [
        ...row.querySelectorAll<HTMLElement>('[data-translation-work]'),
      ].filter((group) => group.getClientRects().length > 0);
      const citation = citationLine({
        label: surahLabels[String(surah)] ?? null,
        ref,
        sources: [
          ...arabicSources,
          ...visible.map((group) => group.dataset['translationWork'] ?? ''),
        ],
      });
      const url = new URL(row.dataset['canonical'] ?? '', window.location.origin).href;
      const arabic = row.querySelector('[data-ayah-arabic]')?.textContent ?? '';
      const translations = visible.map(
        (group) => group.querySelector('[data-translation-text]')?.textContent ?? '',
      );
      return { citation, url, arabic, translations };
    }

    async function onClick(event: MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLElement>('[data-ayah-action]');
      const row = button?.closest<HTMLElement>('[data-ayah]');
      if (button === null || button === undefined || row === null || row === undefined)
        return;
      const { citation, url, arabic, translations } = textOf(row);
      const action = button.dataset['ayahAction'];
      try {
        if (action === 'copy') {
          await navigator.clipboard.writeText(
            ayahCopyText({ arabic, translations, citation, url }),
          );
          say(labels.copied);
        } else if (action === 'share') {
          if (typeof navigator.share === 'function') {
            await navigator.share({ title: citation, text: citation, url });
          } else {
            await navigator.clipboard.writeText(url);
            say(labels.linkCopied);
          }
        }
      } catch (error) {
        // A visitor closing the share sheet is not a failure.
        if (error instanceof DOMException && error.name === 'AbortError') return;
        say(labels.copyFailed);
      }
    }

    const listener = (event: MouseEvent) => {
      void onClick(event);
    };
    reader.addEventListener('click', listener);
    return () => reader.removeEventListener('click', listener);
  }, [readerId, arabicSources, surahLabels, labels, say]);

  useEffect(
    () => () => {
      if (statusTimer.current !== null) window.clearTimeout(statusTimer.current);
    },
    [],
  );

  function toggleTranslation(on: boolean) {
    if (!on) {
      lastOn.current = show === 'none' ? lastOn.current : show;
      update({ translations: 'none' });
      return;
    }
    const restored =
      lastOn.current ??
      (fallbackShow === 'none'
        ? (choices.find((c) => c !== 'none') ?? 'none')
        : fallbackShow);
    update({ translations: restored });
  }

  function openMoreOptions() {
    setOpen(false);
    if (moreOptionsHref === null) return;
    const details = document.getElementById(moreOptionsHref.replace(/^#/, ''));
    if (details instanceof HTMLDetailsElement) details.open = true;
  }

  const switchId = `${base}-translation`;

  return (
    <div className="flex min-w-0 items-center gap-2 sm:gap-3">
      <p className="hidden text-sm text-foreground-muted tabular-nums sm:block">
        {labels.position.replace('{number}', String(juz))}
      </p>
      <p
        role="status"
        className="max-w-[12rem] truncate text-caption font-medium text-action sm:max-w-none"
      >
        {status}
      </p>
      {quickChoice ? (
        <label
          htmlFor={switchId}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium"
        >
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            checked={show !== 'none'}
            onChange={(event) => toggleTranslation(event.currentTarget.checked)}
            className="size-4 accent-action"
          />
          <span className="hidden sm:inline">{labels.translationSwitch}</span>
          <span className="sr-only sm:hidden">{labels.translationSwitch}</span>
        </label>
      ) : null}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={CONTROL}
      >
        <Icon name="settings" size={20} />
        <span className="sr-only sm:not-sr-only">{labels.settings}</span>
      </button>
      <Sheet
        title={labels.settingsTitle}
        closeLabel={labels.close}
        open={open}
        onOpenChange={setOpen}
      >
        <div className="flex flex-col gap-7">
          {quickChoice ? (
            <fieldset className="flex flex-col gap-2">
              <legend className="pb-2 text-sm font-semibold">
                {labels.translationHeading}
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {choices.map((choice) => (
                  <label
                    key={choice}
                    className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-control border border-border px-3 text-sm has-[:checked]:border-action has-[:checked]:bg-surface-sunken has-[:checked]:font-semibold"
                  >
                    <input
                      type="radio"
                      name={`${base}-show`}
                      value={choice}
                      checked={show === choice}
                      onChange={() => update({ translations: choice })}
                      className="size-4 accent-action"
                    />
                    {labels.shows[choice]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : fixedTranslation === null ? null : (
            <div className="flex flex-col gap-2 text-sm">
              <p className="font-semibold">{labels.translationHeading}</p>
              <p className="text-foreground-muted">{fixedTranslation.text}</p>
              <a
                href={fixedTranslation.resetHref}
                className="inline-flex min-h-11 items-center self-start font-semibold text-action underline-offset-4 hover:underline"
              >
                {labels.useDefault}
              </a>
            </div>
          )}

          <Stepper
            label={labels.arabicSize}
            value={preferences.arabicScale}
            labels={labels}
            onStep={(direction) => {
              setArabicTouched(true);
              update({ arabicScale: stepScale(preferences.arabicScale, direction) });
            }}
          />
          {languages.length > 0 || fixedTranslation !== null ? (
            <Stepper
              label={labels.translationSize}
              value={preferences.translationScale}
              labels={labels}
              onStep={(direction) =>
                update({
                  translationScale: stepScale(preferences.translationScale, direction),
                })
              }
            />
          ) : null}

          <div className="flex flex-col gap-3 border-t border-border pt-5">
            <button
              type="button"
              onClick={() => {
                setArabicTouched(true);
                update(DEFAULT_PREFERENCES);
              }}
              className={`${CONTROL} self-start`}
            >
              {labels.reset}
            </button>
            <p className="text-caption text-foreground-muted">{labels.kept}</p>
            {moreOptionsHref === null ? null : (
              <a
                href={moreOptionsHref}
                onClick={openMoreOptions}
                className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-action underline-offset-4 hover:underline"
              >
                {labels.moreOptions}
                <Icon name="arrow-end" size={16} />
              </a>
            )}
          </div>
        </div>
      </Sheet>
      <progress
        aria-hidden="true"
        value={progress.value}
        max={progress.max}
        className="quran-progress absolute inset-x-0 bottom-0 h-0.5 w-full"
      />
    </div>
  );
}

function Stepper({
  label,
  value,
  labels,
  onStep,
}: {
  readonly label: string;
  readonly value: number;
  readonly labels: Pick<ReaderControlLabels, 'decrease' | 'increase'>;
  readonly onStep: (direction: 1 | -1) => void;
}): ReactNode {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <p className="text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`${labels.decrease}: ${label}`}
          disabled={value <= SCALE.min}
          onClick={() => onStep(-1)}
          className={`${CONTROL} min-w-11 px-0`}
        >
          <Icon name="minus" size={20} />
        </button>
        <output aria-live="polite" className="min-w-14 text-center text-sm tabular-nums">
          {percent(value)}
        </output>
        <button
          type="button"
          aria-label={`${labels.increase}: ${label}`}
          disabled={value >= SCALE.max}
          onClick={() => onStep(1)}
          className={`${CONTROL} min-w-11 px-0`}
        >
          <Icon name="plus" size={20} />
        </button>
      </div>
    </div>
  );
}
