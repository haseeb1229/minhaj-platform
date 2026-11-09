'use client';

import { localizedPath } from '@minhaj/contracts';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

import { readQuranPosition } from '@/components/personal-island/requests';
import { Icon } from '@/components/ui/icon';
import {
  QUICK_JUMP_MAX_LENGTH,
  parseQuickJump,
  quickJumpPathOf,
  type JumpSurah,
  type QuickJump,
} from './quick-jump';
import { LAST_READ_KEY, readLastRead } from './reader-preferences';
import { surahPlacePath } from './reading-layout';

/**
 * The Quran landing's and reader entry's two small islands (R2; benchmark
 * patterns 4 and 10a; Quran Part 1).
 *
 * BOTH WORK WITHOUT THEM. The quick jump is a real GET form to `/quran/read`,
 * which parses the same input on the server and redirects; this island only
 * says, as the visitor types, where Enter will go, and goes there without the
 * round trip. "Continue where you stopped" is the signed-in person's own
 * reading position — asked of the private `/api/my/quran-position` AFTER the
 * shared page has rendered — or else the last place read in this browser; with
 * neither, or without script, it is simply absent, and the public document is
 * the same for every visitor either way.
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
  /** "Surah {number}", "Surah {surah}, Ayah {ayah}", "Juz {number}", "Page {number}". */
  readonly surah: string;
  readonly ayah: string;
  readonly juz: string;
  readonly page: string;
}

function targetText(jump: QuickJump, labels: QuickJumpLabels): string | null {
  switch (jump.kind) {
    case 'surah':
      return fill(labels.surah, { number: jump.surah });
    case 'ayah':
      return fill(labels.ayah, { surah: jump.surah, ayah: jump.ayah });
    case 'juz':
      return fill(labels.juz, { number: jump.juz });
    case 'page':
      return fill(labels.page, { number: jump.page });
    case 'unknown':
      return null;
  }
}

export function QuickJumpForm({
  locale,
  action,
  index,
  lastPage,
  labels,
}: {
  readonly locale: string;
  readonly action: string;
  readonly index: readonly JumpSurah[];
  /** The highest mushaf page the corpus records (0: none). */
  readonly lastPage: number;
  readonly labels: QuickJumpLabels;
}) {
  const [value, setValue] = useState('');
  const jump = useMemo(
    () => parseQuickJump(value, index, lastPage),
    [value, index, lastPage],
  );
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
 * "CONTINUE WHERE YOU STOPPED" (Quran Part 1). After render, the island asks
 * the private `/api/my/quran-position` for the signed-in person's own reading
 * position; signed out, without one, or if that answer fails, it uses the last
 * Ayah read in THIS browser. Either place is checked against the corpus's own
 * counts and linked to where it is read — its window of its Surah, at its own
 * element. Nothing is rendered on the server, so the shared document is the
 * same for every visitor; with no place at all the card is absent.
 */
export function ContinueReading({
  locale,
  ayahCounts,
  surahNames,
  labels,
  card = false,
}: {
  readonly locale: string;
  /** `[surah, ayahCount]` for every public Surah. */
  readonly ayahCounts: readonly (readonly [number, number])[];
  /** Each Surah's recorded display name for the interface, or null. */
  readonly surahNames: Readonly<Record<string, string | null>>;
  readonly labels: {
    /** "Continue where you stopped" */
    readonly heading: string;
    /** "Your reading position" */
    readonly account: string;
    /** "Last read on this device" */
    readonly device: string;
    /** "Surah {surah}, Ayah {ayah}" */
    readonly place: string;
  };
  /** A full-width card (the reader entry) rather than a hero button (the landing). */
  readonly card?: boolean;
}) {
  const [found, setFound] = useState<{
    readonly place: { readonly surah: number; readonly ayah: number };
    readonly source: 'account' | 'device';
  } | null>(null);

  useEffect(() => {
    const counts = new Map(ayahCounts);
    const controller = new AbortController();
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(LAST_READ_KEY);
    } catch {
      raw = null; // Unavailable storage: no place on this device.
    }
    const device = readLastRead(raw, counts);
    void readQuranPosition(controller.signal).then((read) => {
      if (controller.signal.aborted) return;
      const own =
        read.state === 'signed-in' && read.position !== null
          ? readLastRead(JSON.stringify(read.position), counts)
          : null;
      if (own !== null) setFound({ place: own, source: 'account' });
      else if (device !== null) setFound({ place: device, source: 'device' });
    });
    return () => controller.abort();
  }, [ayahCounts]);

  if (found === null) return null;
  const { place, source } = found;
  const name = surahNames[String(place.surah)] ?? null;
  const href = surahPlacePath(locale, place);
  const where = fill(labels.place, place);

  if (!card)
    return (
      <a
        href={href}
        className="inline-flex min-h-11 max-w-full items-center gap-3 rounded-control bg-action px-5 py-2 text-sm font-semibold text-action-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
      >
        <Icon name="bookmark" size={20} />
        <span className="flex min-w-0 flex-col leading-tight">
          <span>{labels.heading}</span>
          <span className="text-caption font-medium opacity-90">
            {name === null ? where : `${where} · ${name}`}
          </span>
        </span>
      </a>
    );
  return (
    <section
      aria-label={labels.heading}
      className="relative flex min-w-0 items-center gap-4 rounded-panel border border-accent-rule bg-accent-surface px-5 py-4"
    >
      <Icon name="bookmark" size={24} className="shrink-0 text-accent" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-caption font-semibold text-accent">
          {source === 'account' ? labels.account : labels.device}
        </span>
        <a
          href={href}
          className="text-lg font-semibold text-foreground no-underline after:absolute after:inset-0 hover:text-action"
        >
          {labels.heading}
        </a>
        <span className="text-sm text-foreground-muted">
          {where}
          {name === null ? null : (
            <>
              {' · '}
              <bdi>{name}</bdi>
            </>
          )}
        </span>
      </span>
      <Icon name="arrow-end" size={20} className="shrink-0 text-foreground-muted" />
    </section>
  );
}
