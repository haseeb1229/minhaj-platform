'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The reader's PRESENTATION controls and its within-document progress.
 *
 * THE ONLY CLIENT COMPONENT THE READER HAS, and it is a narrow island by
 * design: the book's text is server-rendered and this component never receives
 * it, never fetches it and never re-renders it. It reaches the reader element by
 * identifier and sets three CSS custom properties on it, so a visitor with
 * JavaScript disabled still gets the whole edition at the server's default
 * typography (ARCHITECTURE.md §7, §13.8).
 *
 * WHAT IT IS ALLOWED TO REMEMBER, AND WHERE. Font size, line height and measure
 * are PRESENTATION PREFERENCES, so they live in `localStorage` — per browser,
 * never sent anywhere, carrying no account identifier and no reading position
 * (§37). What it must NOT remember is WHERE somebody has read to: authenticated
 * reading history is Personalisation's (Phase 21 records which book was read,
 * never where in it), and this reader stores no per-user state at all, on the
 * server or here.
 *
 * EVERY STORAGE ACCESS IS GUARDED. A private window, blocked site data or a
 * quota refusal makes these calls throw; a reader that failed to render a book
 * because it could not save a font size would be a worse failure than forgetting
 * the font size. Reads are also validated rather than trusted — stored JSON is
 * data this component wrote, but it is data a person can edit.
 *
 * PROGRESS WITHOUT SERVER STATE. An `IntersectionObserver` reports which section
 * is currently in view and the component says "section n of m". It is a VISUAL
 * aid and is deliberately NOT a live region: an announcement on every scroll
 * step would talk over the text being read. The structure assistive technology
 * actually navigates by is the server-rendered headings, each of which states
 * its own position.
 *
 * NO MOTION AT ALL. The progress indicator is a native `<progress>` with no
 * transition, and nothing here animates — so there is nothing for
 * `prefers-reduced-motion` to reduce.
 *
 * NO `style` ATTRIBUTE, ANYWHERE. The platform's CSP is `style-src 'self'`, which
 * refuses inline style attributes. The reader's defaults live in the stylesheet
 * (`.library-reader`), and this island changes only three custom properties through
 * the CSSOM — `element.style.setProperty` — which that policy permits.
 */

/** How far the three controls may move, and where they start. */
const STEPS = {
  font: { min: 0.9375, max: 1.75, step: 0.0625, initial: 1.125 },
  line: { min: 1.4, max: 2.2, step: 0.1, initial: 1.75 },
  measure: { min: 40, max: 90, step: 5, initial: 66 },
} as const;

const STORAGE_KEY = 'minhaj.library.reader';

interface Preferences {
  font: number;
  line: number;
  measure: number;
}

const DEFAULTS: Preferences = {
  font: STEPS.font.initial,
  line: STEPS.line.initial,
  measure: STEPS.measure.initial,
};

/** One stored number, accepted only if it is inside the range this UI offers. */
function bounded(value: unknown, range: { min: number; max: number }): number | null {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
    ? value
    : null;
}

function readStored(): Preferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULTS;
    const record = parsed as Record<string, unknown>;
    return {
      font: bounded(record['font'], STEPS.font) ?? DEFAULTS.font,
      line: bounded(record['line'], STEPS.line) ?? DEFAULTS.line,
      measure: bounded(record['measure'], STEPS.measure) ?? DEFAULTS.measure,
    };
  } catch {
    // Unavailable or unreadable storage is not a reading failure.
    return DEFAULTS;
  }
}

function writeStored(preferences: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    /* A preference that cannot be saved is still applied for this visit. */
  }
}

export interface ReaderControlLabels {
  readonly heading: string;
  readonly fontSize: string;
  readonly lineHeight: string;
  readonly measure: string;
  readonly decrease: string;
  readonly increase: string;
  readonly reset: string;
  /** "Section {current} of {total}" with both placeholders present. */
  readonly progressValue: string;
}

export function ReaderControls({
  readerId,
  sectionCount,
  labels,
}: {
  readonly readerId: string;
  readonly sectionCount: number;
  readonly labels: ReaderControlLabels;
}) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [current, setCurrent] = useState(1);

  // Restored AFTER hydration, never during render: reading storage while
  // rendering would make the first client render disagree with the server's.
  useEffect(() => {
    setPreferences(readStored());
  }, []);

  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return;
    reader.style.setProperty('--reader-font-size', `${preferences.font}rem`);
    reader.style.setProperty('--reader-line-height', String(preferences.line));
    reader.style.setProperty('--reader-measure', `${preferences.measure}ch`);
  }, [readerId, preferences]);

  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null || typeof IntersectionObserver === 'undefined') return;

    const sections = [...reader.querySelectorAll<HTMLElement>('[data-reader-index]')];
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // The FIRST intersecting section wins, so scrolling back up moves the
        // indicator back rather than leaving it at the furthest point reached.
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.getAttribute('data-reader-index')))
          .filter((index) => Number.isInteger(index) && index >= 1);
        if (visible.length > 0) setCurrent(Math.min(...visible));
      },
      { rootMargin: '0px 0px -60% 0px', threshold: 0 },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, [readerId]);

  const adjust = useCallback((key: keyof Preferences, direction: 1 | -1) => {
    setPreferences((previous) => {
      const range = STEPS[key];
      const raw = previous[key] + direction * range.step;
      // Rounded to the step so repeated adjustment cannot accumulate a
      // floating-point tail into the stored value.
      const stepped = Math.round(raw / range.step) * range.step;
      const next = {
        ...previous,
        [key]: Math.min(range.max, Math.max(range.min, Number(stepped.toFixed(4)))),
      };
      writeStored(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setPreferences(DEFAULTS);
    writeStored(DEFAULTS);
  }, []);

  const progressText = labels.progressValue
    .replace('{current}', String(current))
    .replace('{total}', String(sectionCount));

  return (
    <div className="flex flex-col gap-3">
      <div
        role="group"
        aria-label={labels.heading}
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
      >
        {(
          [
            ['font', labels.fontSize],
            ['line', labels.lineHeight],
            ['measure', labels.measure],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span className="text-xs text-[color:var(--color-foreground-muted)]">
              {label}
            </span>
            <ControlButton
              label={`${labels.decrease}: ${label}`}
              onClick={() => adjust(key, -1)}
              disabled={preferences[key] <= STEPS[key].min}
            >
              −
            </ControlButton>
            <ControlButton
              label={`${labels.increase}: ${label}`}
              onClick={() => adjust(key, 1)}
              disabled={preferences[key] >= STEPS[key].max}
            >
              +
            </ControlButton>
          </div>
        ))}
        <ControlButton label={labels.reset} onClick={reset} disabled={false}>
          {labels.reset}
        </ControlButton>
      </div>

      {/*
       * A VISUAL indicator of position within THIS document. The bar is hidden
       * from assistive technology because the text beside it says the same thing
       * in words, and the headings say it again per section.
       *
       * A NATIVE `<progress>`, not a styled span with a width: an inline `style`
       * attribute is refused by the platform's `style-src 'self'` CSP, and the
       * native element needs none — and it has no motion to reduce.
       */}
      <p className="flex items-center gap-3 text-xs text-[color:var(--color-foreground-muted)]">
        <span>{progressText}</span>
        <progress
          aria-hidden="true"
          value={current}
          max={Math.max(1, sectionCount)}
          className="h-1 w-24 accent-[color:var(--color-action)]"
        />
      </p>
    </div>
  );
}

/**
 * One reader control.
 *
 * `min-h-11` and `min-w-11` are a TOUCH TARGET rather than a style: a reader on
 * a phone adjusting type size needs a button large enough to hit, and this is
 * the smallest control on the page (ARCHITECTURE.md §13.5).
 */
function ControlButton({
  label,
  onClick,
  disabled,
  children,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface-raised)] px-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
