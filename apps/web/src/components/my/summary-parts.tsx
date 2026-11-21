import type { ReactNode } from 'react';

import { Stat } from '@/components/ui';

/**
 * TWO SHAPES MY MINHAJ PART 2 PAGES SHARE — a row of true figures at the head
 * of a page, and the numbered steps a first-run page teaches with.
 *
 * PRESENTATION ONLY. Every figure is the server's, read for the signed-in
 * account; a page passes a figure only when it is TRUE (a count over the whole
 * list, never over one page of it). The steps are words, and promise nothing
 * the service does not do.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`); every column `minmax(0, 1fr)`, so
 * nothing scrolls sideways at 320 pixels.
 */

export interface MyFigure {
  readonly key: string;
  readonly value: string;
  readonly label: ReactNode;
  /** Where the counted things are listed, when they are. */
  readonly href?: string;
}

/** "3 Courses · 1 Completed · …" — one raised surface, each figure a list item. */
export function MyFigures({
  label,
  figures,
}: {
  readonly label: string;
  readonly figures: readonly MyFigure[];
}) {
  if (figures.length === 0) return null;
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-5 rounded-panel border border-border bg-surface-raised p-5 shadow-panel sm:grid-cols-[repeat(4,minmax(0,1fr))]"
    >
      {figures.map((figure) => (
        <li key={figure.key} className="min-w-0">
          <Stat
            value={figure.value}
            label={figure.label}
            {...(figure.href === undefined ? {} : { href: figure.href })}
          />
        </li>
      ))}
    </ul>
  );
}

export interface MyStep {
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

/** What happens, in order — a numbered list whose numbers are also in the markup. */
export function MySteps({
  label,
  steps,
}: {
  readonly label: string;
  readonly steps: readonly MyStep[];
}) {
  return (
    <ol
      aria-label={label}
      className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]"
    >
      {steps.map((step, index) => (
        <li
          key={step.key}
          className="flex min-w-0 gap-3 rounded-panel bg-surface-sunken p-4 text-sm"
        >
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action font-semibold text-action-foreground tabular-nums"
          >
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="font-semibold">{step.title}</span>
            <span className="text-foreground-muted">{step.body}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
