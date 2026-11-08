'use client';

import { localizedPath } from '@minhaj/contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { Icon } from '@/components/ui/icon';
import {
  QUICK_JUMP_MAX_LENGTH,
  parseQuickJump,
  quickJumpPathOf,
  type JumpSurah,
  type QuickJump,
} from './quick-jump';
import { LAST_READ_KEY, readLastRead } from './reader-preferences';

/**
 * The Quran landing's two small islands (R2; benchmark patterns 4 and 10a).
 *
 * BOTH WORK WITHOUT THEM. The quick jump is a real GET form to `/quran/read`,
 * which parses the same input on the server and redirects; this island only
 * says, as the visitor types, where Enter will go, and goes there without the
 * round trip. "Continue reading" exists only in this browser's storage, so
 * without script — or without a stored place — it is simply absent.
 *
 * Labels are plain strings with `{placeholder}`s, filled here; this module
 * reaches no server code and no translation provider.
 */

/** "{name}" placeholders filled from a record — the labels' only formatting. */
function fill(template: string, values: Readonly<Record<string, string | number>>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}

export interface QuickJumpLabels {
  readonly label: string;
  readonly help: string;
  readonly submit: string;
  /** "Opens {target}". */
  readonly opens: string;
  readonly none: string;
  /** "Surah {number}", "Surah {surah}, Ayah {ayah}", "Juz {number}". */
  readonly surah: string;
  readonly ayah: string;
  readonly juz: string;
}

function targetText(jump: QuickJump, labels: QuickJumpLabels): string | null {
  switch (jump.kind) {
    case 'surah':
      return fill(labels.surah, { number: jump.surah });
    case 'ayah':
      return fill(labels.ayah, { surah: jump.surah, ayah: jump.ayah });
    case 'juz':
      return fill(labels.juz, { number: jump.juz });
    case 'unknown':
      return null;
  }
}

export function QuickJumpForm({
  locale,
  action,
  index,
  labels,
}: {
  readonly locale: string;
  readonly action: string;
  readonly index: readonly JumpSurah[];
  readonly labels: QuickJumpLabels;
}) {
  const [value, setValue] = useState('');
  const jump = useMemo(() => parseQuickJump(value, index), [value, index]);
  const target = targetText(jump, labels);
  const id = 'quran-quick-jump';

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const path = quickJumpPathOf(jump);
    if (path === null) return; // The server says why, in words.
    event.preventDefault();
    window.location.assign(localizedPath(locale, path));
  }

  return (
    <form
      method="get"
      action={action}
      onSubmit={onSubmit}
      className="flex w-full max-w-2xl flex-col gap-2 pt-2"
    >
      <label htmlFor={id} className="text-sm font-semibold">
        {labels.label}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            size={20}
            className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-foreground-muted"
          />
          <input
            id={id}
            name="q"
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={QUICK_JUMP_MAX_LENGTH}
            required
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            aria-describedby={`${id}-help ${id}-hint`}
            className="min-h-12 w-full rounded-control border border-border-strong bg-surface-raised ps-10 pe-3 text-base"
          />
        </div>
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-action-foreground transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
        >
          {labels.submit}
          <Icon name="arrow-end" size={16} />
        </button>
      </div>
      <p id={`${id}-help`} className="text-sm text-foreground-muted">
        {labels.help}
      </p>
      <p id={`${id}-hint`} aria-live="polite" className="min-h-6 text-sm font-medium">
        {value.trim() === ''
          ? ''
          : target === null
            ? labels.none
            : fill(labels.opens, { target })}
      </p>
    </form>
  );
}

/**
 * "Continue reading" — the last Ayah read in THIS browser, checked against the
 * corpus's own counts, linked to its place in its Surah. No account and no
 * request: an anonymous reader's continuity (benchmark pattern 4).
 */
export function ContinueReading({
  locale,
  ayahCounts,
  labels,
}: {
  readonly locale: string;
  /** `[surah, ayahCount]` for every public Surah. */
  readonly ayahCounts: readonly (readonly [number, number])[];
  readonly labels: {
    /** "Continue reading" */
    readonly heading: string;
    /** "Surah {surah}, Ayah {ayah}" */
    readonly place: string;
  };
}) {
  const [place, setPlace] = useState<{ surah: number; ayah: number } | null>(null);

  useEffect(() => {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(LAST_READ_KEY);
    } catch {
      raw = null; // Unavailable storage: no place to continue from.
    }
    setPlace(readLastRead(raw, new Map(ayahCounts)));
  }, [ayahCounts]);

  if (place === null) return null;
  return (
    <a
      href={localizedPath(
        locale,
        `/quran/surah/${String(place.surah)}#ayah-${String(place.ayah)}`,
      )}
      className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-control bg-action px-5 py-2 text-sm font-semibold text-action-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
    >
      <Icon name="bookmark" size={20} />
      <span className="flex min-w-0 flex-col leading-tight">
        <span>{labels.heading}</span>
        <span className="text-caption font-medium opacity-90">
          {fill(labels.place, place)}
        </span>
      </span>
    </a>
  );
}
