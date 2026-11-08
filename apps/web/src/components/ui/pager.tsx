import { Icon } from './icon';

/**
 * THE ONE PAGER (R2) — previous and next, and page numbers when the total is
 * known.
 *
 * Most public listings page by offset with a "has more" flag and know no total,
 * so `previous`/`next` are the whole contract and a null one is simply absent
 * (never a disabled link: a link that cannot be followed is not rendered). A
 * listing that DOES know its total passes `pages`, and a numbered row with the
 * current page marked `aria-current="page"` appears between the two.
 *
 * Each link is a 44-pixel target. The arrows are logical icons: "previous"
 * points back along the reading direction in every script, and "next" keeps to
 * the end side even when there is no "previous".
 */

/**
 * Which page numbers to show: all of them up to seven, otherwise the first, the
 * last, and the current page with its neighbours, a `gap` standing for each
 * run left out.
 */
export function pagerWindow(current: number, total: number): readonly (number | 'gap')[] {
  if (!Number.isInteger(total) || total < 1) return [];
  const page = Math.min(Math.max(1, Math.trunc(current)), total);
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const start = Math.max(2, Math.min(page - 1, total - 4));
  const end = Math.min(total - 1, Math.max(page + 1, 5));
  const middle = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return [
    1,
    ...(start > 2 ? (['gap'] as const) : []),
    ...middle,
    ...(end < total - 1 ? (['gap'] as const) : []),
    total,
  ];
}

const LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)]';

export function Pager({
  label,
  previous,
  next,
  previousLabel,
  nextLabel,
  pages,
}: {
  /** The navigation's accessible name ("Pages of news"). */
  readonly label: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly previousLabel: string;
  readonly nextLabel: string;
  readonly pages?: {
    readonly current: number;
    readonly total: number;
    readonly href: (page: number) => string;
    /** The accessible name of one page's link ("Page 3"). */
    readonly label: (page: number) => string;
    /** How a page number is written; plain digits by default. */
    readonly format?: (page: number) => string;
  };
}) {
  const numbers = pages === undefined ? [] : pagerWindow(pages.current, pages.total);
  if (previous === null && next === null && numbers.length <= 1) return null;
  const format = pages?.format ?? ((page: number) => String(page));

  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5"
    >
      {previous === null ? (
        <span />
      ) : (
        <a
          href={previous}
          rel="prev"
          className={`${LINK} border border-border-strong text-foreground hover:bg-surface-sunken active:bg-border`}
        >
          <Icon name="chevron-start" size={16} />
          {previousLabel}
        </a>
      )}

      {pages === undefined || numbers.length <= 1 ? null : (
        <ol className="flex list-none flex-wrap items-center gap-1 p-0">
          {numbers.map((entry, index) =>
            entry === 'gap' ? (
              <li
                key={`gap-${String(index)}`}
                aria-hidden="true"
                className="px-1 text-foreground-muted max-sm:hidden"
              >
                …
              </li>
            ) : entry === pages.current ? (
              <li key={entry}>
                <span
                  aria-current="page"
                  aria-label={pages.label(entry)}
                  className={`${LINK} bg-action text-action-foreground tabular-nums`}
                >
                  {format(entry)}
                </span>
              </li>
            ) : (
              <li key={entry} className="max-sm:hidden">
                <a
                  href={pages.href(entry)}
                  aria-label={pages.label(entry)}
                  className={`${LINK} text-foreground tabular-nums hover:bg-surface-sunken active:bg-border`}
                >
                  {format(entry)}
                </a>
              </li>
            ),
          )}
        </ol>
      )}

      {next === null ? null : (
        <a
          href={next}
          rel="next"
          className={`${LINK} border border-border-strong text-foreground hover:bg-surface-sunken active:bg-border`}
        >
          {nextLabel}
          <Icon name="chevron-end" size={16} />
        </a>
      )}
    </nav>
  );
}
