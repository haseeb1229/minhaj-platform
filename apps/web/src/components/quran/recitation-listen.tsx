'use client';

import { useId } from 'react';

import { Icon } from '@/components/ui/icon';
import { recitationLabel } from './recitation-plan';
import {
  chooseRecitation,
  playFrom,
  usePlayer,
  type CatalogueEntry,
} from './recitation-store';

/**
 * A PAGE'S LISTEN CONTROLS (Quran Part 5): which recitation, and Play — from
 * the start of the Surah, or of the Juz — driving the one player the Quran
 * layout holds (`./recitation-dock.tsx`). Shown only once that player is
 * ready, so a page without JavaScript shows its plain fallback instead (the
 * native player or the link to it), never a control that cannot work.
 *
 * A recitation without per-Ayah timing is said to be one in words: it plays
 * whole Surahs, and no verse is highlighted.
 */

/**
 * A recitation chooser's options, in the catalogue's own order
 * (`recitationGroups`, applied where the catalogue is built): each style's run
 * an `<optgroup>` named as the source names the style, once two or more
 * styles are offered; recitations that name no style follow, ungrouped.
 */
export function RecitationOptions({
  catalogue,
}: {
  readonly catalogue: readonly CatalogueEntry[];
}) {
  const runs: { style: string | null; entries: CatalogueEntry[] }[] = [];
  for (const entry of catalogue) {
    const last = runs.at(-1);
    if (last?.style === entry.style) last.entries.push(entry);
    else runs.push({ style: entry.style, entries: [entry] });
  }
  const option = (entry: CatalogueEntry) => (
    <option key={entry.slug} value={entry.slug}>
      {recitationLabel(entry)}
    </option>
  );
  if (runs.filter((run) => run.style !== null).length < 2)
    return <>{catalogue.map(option)}</>;
  return (
    <>
      {runs.map((run, index) =>
        run.style === null ? (
          run.entries.map(option)
        ) : (
          <optgroup key={`${String(index)}-${run.style}`} label={run.style}>
            {run.entries.map(option)}
          </optgroup>
        ),
      )}
    </>
  );
}

export interface ListenLabels {
  readonly heading: string;
  readonly recitation: string;
  readonly play: string;
  readonly untimed: string;
  readonly timed: string;
}

export function RecitationListen({
  surah,
  ayah = 1,
  labels,
}: {
  readonly surah: number;
  /** Where Play begins: a Surah's first Ayah, or a Juz's first. */
  readonly ayah?: number;
  readonly labels: ListenLabels;
}) {
  const state = usePlayer();
  const id = useId();
  if (!state.ready || state.catalogue.length === 0) return null;
  const chosen = state.catalogue.find((entry) => entry.slug === state.choice);

  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label
        htmlFor={`${id}-recitation`}
        className="flex min-w-0 flex-1 flex-col gap-1 text-caption font-medium"
      >
        {labels.recitation}
        <select
          id={`${id}-recitation`}
          value={state.choice ?? ''}
          onChange={(event) => chooseRecitation(event.currentTarget.value)}
          className="min-h-11 w-full min-w-0 rounded-control border border-border-strong bg-surface px-3 text-sm text-foreground"
        >
          <RecitationOptions catalogue={state.catalogue} />
        </select>
      </label>
      <button
        type="button"
        onClick={() => playFrom({ surah, ayah })}
        disabled={chosen === undefined}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-5 text-sm font-semibold text-action-foreground transition-colors duration-[var(--duration-fast)] hover:bg-action-hover disabled:opacity-50"
      >
        <Icon name="play" size={20} />
        {labels.play}
      </button>
      {chosen === undefined ? null : (
        <p className="text-caption text-foreground-muted sm:basis-full">
          {chosen.timed ? labels.timed : labels.untimed}
        </p>
      )}
    </div>
  );
}
