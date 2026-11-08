/**
 * ROUTE TABS (R2) — sibling views of one record or listing that each have their
 * own address ("Episodes · About", "Books · Magazines · Research").
 *
 * LINKS, NOT AN ARIA TABLIST. Each tab is a page; following one is navigation,
 * so it is a `<nav>` of links with the current one marked `aria-current="page"`
 * (and by weight and an accent rule, never colour alone). In-page panels that
 * share one address use `Tabs` from `@/components/ui/tabs` instead.
 *
 * The row scrolls sideways on a narrow screen rather than wrapping into a
 * second row of tabs; the page itself never scrolls sideways.
 */
export function LinkTabs({
  label,
  tabs,
}: {
  /** The navigation's accessible name. */
  readonly label: string;
  readonly tabs: readonly {
    readonly href: string;
    readonly text: string;
    readonly current: boolean;
    /** A count shown after the label ("Episodes 24"). */
    readonly count?: string;
  }[];
}) {
  return (
    <nav aria-label={label} className="border-b border-border">
      <ul className="-mb-px flex list-none gap-1 overflow-x-auto p-0">
        {tabs.map((tab) => (
          <li key={tab.href} className="shrink-0">
            <a
              href={tab.href}
              {...(tab.current ? { 'aria-current': 'page' as const } : {})}
              className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm no-underline transition-colors duration-[var(--duration-fast)] hover:text-foreground ${
                tab.current
                  ? 'border-accent font-semibold text-foreground'
                  : 'border-transparent font-medium text-foreground-muted hover:border-border-strong'
              }`}
            >
              {tab.text}
              {tab.count === undefined ? null : (
                <span className="text-caption text-foreground-muted tabular-nums">
                  {tab.count}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
