'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * The reader's PRESENTATION controls and its within-document position bar.
 *
 * THE ONLY CLIENT COMPONENT THE READER HAS, and it is a narrow island by
 * design: the book's text is server-rendered and this component never receives
 * it, never fetches it and never re-renders it. It reaches the reader element by
 * identifier and sets three CSS custom properties on it, so a visitor with
 * JavaScript disabled still gets the whole edition at the server's default
 * typography (ARCHITECTURE.md §7, §13.8). It receives the sections' in-page
 * identifiers only — never their words — so its position bar renders on the
 * server too and its links work without script.
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
 * THE POSITION BAR (Library Part 1) stays at the top of the screen while the
 * edition is read: "section n of m", how far through the text the reader is,
 * the previous and the next section, and the way back to the contents — each
 * a plain in-page link, so it is keyboard-operable with Tab and Enter. The
 * section being read is the last whose top has passed a reading line (or the
 * section just arrived at by its address, while it stays at the top) and is
 * also marked in the contents with `aria-current="location"`. It is a VISUAL aid and is
 * deliberately NOT a live region: an announcement on every scroll step would
 * talk over the text being read. The structure assistive technology actually
 * navigates by is the server-rendered headings, each of which states its own
 * position.
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
  line: { min: 1.4, max: 2.4, step: 0.1, initial: 1.8 },
  measure: { min: 40, max: 90, step: 5, initial: 68 },
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
  /** The position bar's name ("Reading position"). */
  readonly positionBar: string;
  readonly contents: string;
  readonly nextSection: string;
  readonly previousSection: string;
}

/** How far through `element` the top of the viewport is, 0–100. */
function percentThrough(element: HTMLElement): number {
  const box = element.getBoundingClientRect();
  const travel = box.height - window.innerHeight;
  if (travel <= 0) return box.top <= 0 ? 100 : 0;
  return Math.round(Math.min(1, Math.max(0, -box.top / travel)) * 100);
}

export function ReaderControls({
  readerId,
  contentsId,
  sectionIds,
  labels,
}: {
  readonly readerId: string;
  readonly contentsId: string;
  /** Each section's in-page identifier, in reading order. */
  readonly sectionIds: readonly string[];
  readonly labels: ReaderControlLabels;
}) {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULTS);
  const [current, setCurrent] = useState(1);
  const [percent, setPercent] = useState(0);
  const total = sectionIds.length;

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
    if (reader === null) return;

    const sections = [...reader.querySelectorAll<HTMLElement>('[data-reader-index]')];
    if (sections.length === 0) return;
    const indexOf = (element: Element) => {
      const index = Number(element.getAttribute('data-reader-index'));
      return Number.isInteger(index) && index >= 1 ? index : null;
    };
    // The reading line: a section is being read once its top has passed it.
    const line = () => Math.max(window.innerHeight * 0.3, 96);

    // Arriving at a section by its address (a contents entry, Next section, a
    // shared link) marks THAT section while it stays at the top of the view,
    // even when the end of the one before still shows above it.
    let pinned: HTMLElement | null = null;
    const arrive = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      pinned = sections.find((section) => section.id === id) ?? null;
      schedule();
    };

    // The LAST section whose top has passed the line is the one being read:
    // scrolling back up moves the indicator back, and a section that leaves
    // while the next is already in view hands over to it.
    const pick = () => {
      frame = 0;
      if (pinned !== null) {
        const top = pinned.getBoundingClientRect().top;
        const index = indexOf(pinned);
        if (index !== null && top >= -1 && top <= line()) {
          setCurrent(index);
          return;
        }
        pinned = null;
      }
      let chosen: number | null = null;
      for (const section of sections) {
        if (section.getBoundingClientRect().top > line()) break;
        chosen = indexOf(section) ?? chosen;
      }
      setCurrent(chosen ?? 1);
    };
    let frame = 0;
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(pick);
    };

    arrive();
    window.addEventListener('hashchange', arrive);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('hashchange', arrive);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [readerId]);

  // How far through the text, recomputed at most once a frame while scrolling.
  useEffect(() => {
    const reader = document.getElementById(readerId);
    if (reader === null) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      setPercent(percentThrough(reader));
    };
    const schedule = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [readerId, preferences]);

  // The contents entry of the section in view says so, in the accessibility tree too.
  useEffect(() => {
    const contents = document.getElementById(contentsId);
    if (contents === null) return;
    const target = sectionIds[current - 1];
    for (const link of contents.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      if (link.getAttribute('href') === `#${target ?? ''}`)
        link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }, [contentsId, sectionIds, current]);

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
    .replace('{total}', String(total));
  const previous = sectionIds[current - 2];
  const next = sectionIds[current];

  return (
    <>
      <div
        role="group"
        aria-label={labels.heading}
        className="flex flex-wrap items-center gap-x-5 gap-y-2"
      >
        <span className="text-sm font-medium">{labels.heading}</span>
        {(
          [
            ['font', labels.fontSize],
            ['line', labels.lineHeight],
            ['measure', labels.measure],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span className="pe-1 text-xs text-foreground-muted">{label}</span>
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
       * THE POSITION BAR, kept at the top of the screen while the edition is
       * on it. The bar is hidden from assistive technology because the words
       * beside it say where the reader is, and the headings say it again.
       *
       * A NATIVE `<progress>`, not a styled span with a width: an inline `style`
       * attribute is refused by the platform's `style-src 'self'` CSP, and the
       * native element needs none — and it has no motion to reduce.
       */}
      <nav
        aria-label={labels.positionBar}
        className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-border bg-surface py-1.5"
      >
        <p className="flex min-w-0 grow items-center gap-3 text-sm">
          <span className="font-medium whitespace-nowrap tabular-nums">
            {progressText}
          </span>
          <progress
            aria-hidden="true"
            value={percent}
            max={100}
            className="h-1.5 w-full max-w-48 min-w-16 grow accent-action"
          />
        </p>
        <span className="flex items-center gap-1 text-sm">
          {previous === undefined ? null : (
            <a href={`#${previous}`} className={STEP_LINK}>
              {labels.previousSection}
            </a>
          )}
          {next === undefined ? null : (
            <a href={`#${next}`} className={STEP_LINK}>
              {labels.nextSection}
            </a>
          )}
          <a href={`#${contentsId}`} className={STEP_LINK}>
            {labels.contents}
          </a>
        </span>
      </nav>
    </>
  );
}

const STEP_LINK =
  'inline-flex min-h-11 items-center rounded-control px-2.5 font-medium text-action no-underline underline-offset-4 hover:underline';

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
      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-control border border-border-strong bg-surface-raised px-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}
