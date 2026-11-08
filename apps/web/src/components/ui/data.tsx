import type { ReactNode } from 'react';

import { Panel } from './layout';

/* ===========================================================================
 * Lists
 * ========================================================================= */

/** A description list row, for account and session detail. */
export function DetailRow({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-2">
      <dt className="text-xs text-foreground-muted">{term}</dt>
      <dd className="min-w-0 text-sm wrap-anywhere">{children}</dd>
    </div>
  );
}

/**
 * The list of a person's active sessions.
 *
 * A real `<ul>`, so a screen reader announces how many there are before
 * reading them — "list, 3 items" is the difference between orientation and
 * a wall of text.
 */
export function SessionList({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {children}
    </ul>
  );
}

/**
 * One session.
 *
 * The current session is marked in TEXT rather than by styling alone, so the
 * one row a person must not sign out of is identifiable without colour and
 * without sight (SECURITY_BASELINE.md §16.1).
 */
export function SessionRow({
  current,
  currentLabel,
  detail,
  action,
}: {
  readonly current: boolean;
  readonly currentLabel: string;
  readonly detail: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <Panel as="li">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {current ? (
            <span className="text-xs font-semibold uppercase tracking-wide text-action">
              {currentLabel}
            </span>
          ) : null}
          {detail}
        </div>
        {action === undefined ? null : <div className="shrink-0">{action}</div>}
      </div>
    </Panel>
  );
}

/* ===========================================================================
 * Tabular data — the administrative surfaces
 * ========================================================================= */

/**
 * A bounded data table.
 *
 * A REAL `<table>` with a `<caption>`, because that is what makes a grid of
 * values navigable to a screen reader: it announces the caption, the column
 * count and the header for each cell. A grid of `<div>`s reads as a wall of
 * unrelated text (SECURITY_BASELINE.md §16.1).
 *
 * The horizontal scroll lives on the WRAPPER rather than the page. A table is
 * one of the three things allowed to be wider than the viewport; the document
 * itself is not, and an administrative screen on a phone is a real case for an
 * audience this platform serves.
 */
export function DataTable({
  caption,
  columns,
  children,
}: {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly children: ReactNode;
}) {
  return (
    /*
     * The scroll wrapper is a NAMED, FOCUSABLE region: a keyboard user can
     * reach it and scroll it with the arrow keys when the table is wider than
     * the screen, and a screen reader announces what the region holds rather
     * than an anonymous scrolling box (WCAG 2.1.1, 4.1.2).
     */
    <div
      role="region"
      aria-label={caption}
      tabIndex={0}
      className="w-full overflow-x-auto rounded-control"
    >
      <table className="w-full min-w-[32rem] border-collapse text-sm">
        <caption className="pb-2 text-start text-xs text-foreground-muted">
          {caption}
        </caption>
        <thead>
          <tr className="border-b border-border-strong">
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-3 py-2 text-start text-xs font-semibold tracking-wide uppercase"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** One table row. Bordered rather than striped, so it survives a dark theme. */
export function DataRow({ children }: { readonly children: ReactNode }) {
  return <tr className="border-b border-border align-top">{children}</tr>;
}

/** One table cell. */
export function DataCell({
  children,
  wrap = false,
}: {
  readonly children: ReactNode;
  readonly wrap?: boolean;
}) {
  return (
    <td className={`px-3 py-2 ${wrap ? 'break-words' : 'whitespace-nowrap'}`}>
      {children}
    </td>
  );
}

/**
 * A short status word.
 *
 * Text, never colour alone. A badge that said "active" only by being green
 * would say nothing in monochrome, nothing to a screen reader and nothing to a
 * reader with colour-vision deficiency — and account status is exactly the kind
 * of security state that must survive all three (§16.1).
 */
export function StatusBadge({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'positive' | 'caution';
  readonly children: ReactNode;
}) {
  const tones = {
    neutral: 'border-border-strong text-foreground-muted',
    positive: 'border-success text-success',
    caution: 'border-warning text-warning',
  } as const;

  return (
    <span
      className={`inline-block rounded-control border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
