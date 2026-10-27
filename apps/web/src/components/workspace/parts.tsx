import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';

import { PageHeading } from '@/components/ui';
import { PRODUCT_NAME } from '@/shell/product';

/**
 * The private workspaces' frame — My Minhaj, the Teacher area and the
 * administration (ARCHITECTURE.md §13).
 *
 * PRESENTATION ONLY. Nothing here reads a session, a permission or a record:
 * each area's layout decides what may be shown and hands the shell finished
 * links and words. A workspace is not a bounded context, and this frame owns
 * no domain — it is the one place the three areas agree on a header band, a
 * navigation column and a page header, built from the shared tokens and
 * primitives rather than restyled per area (§13.1).
 *
 * NO HORIZONTAL OVERFLOW. Every column is `minmax(0, 1fr)` and every content
 * wrapper `min-w-0`, so a wide administrative table scrolls inside its own
 * wrapper instead of widening the page at 320 pixels (§13.5).
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`), so the same markup is right in
 * English, Urdu and Arabic. SERVER COMPONENTS: the only client code in a
 * workspace frame is the navigation island, which needs the current path.
 */

const WIDTHS = {
  /** A personal area: a reading column beside its navigation. */
  standard: 'max-w-6xl',
  /** An operational area: room for wide tables on a wide desktop. */
  wide: 'max-w-screen-2xl',
} as const;

/**
 * A workspace's header band, navigation column and content column.
 *
 * `areaIsHeading` keeps the administration's established outline — the area
 * name is the document's first heading and each page's own `h1` sits inside its
 * `main`. My Minhaj and the Teacher area name themselves in text instead, so
 * each of their pages has exactly one `h1`.
 *
 * The skip link is the first stop on every workspace page and moves past the
 * band and the navigation to the content column — a sidebar of two dozen links
 * is exactly the block a keyboard user must be able to bypass (WCAG 2.4.1).
 */
export function WorkspaceShell({
  locale,
  skipLabel,
  area,
  areaIsHeading = false,
  description,
  width = 'standard',
  nav,
  children,
}: {
  readonly locale: Locale;
  readonly skipLabel: string;
  readonly area: string;
  readonly areaIsHeading?: boolean;
  readonly description?: string;
  readonly width?: keyof typeof WIDTHS;
  readonly nav?: ReactNode;
  readonly children: ReactNode;
}) {
  const column = `mx-auto w-full ${WIDTHS[width]} px-4 sm:px-6 lg:px-8`;
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#workspace-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface-raised focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:shadow-panel"
      >
        {skipLabel}
      </a>

      <header className="border-b border-border bg-surface-raised">
        <div className={`${column} flex flex-col gap-1 py-4`}>
          <a
            href={`/${locale}`}
            lang="en"
            className="inline-flex min-h-11 items-center self-start text-sm font-semibold text-action underline-offset-2 hover:underline"
          >
            {PRODUCT_NAME}
          </a>
          {areaIsHeading ? (
            <PageHeading>{area}</PageHeading>
          ) : (
            <p className="text-lg font-semibold">{area}</p>
          )}
          {description === undefined ? null : (
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {description}
            </p>
          )}
        </div>
      </header>

      <div
        className={`${column} grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-6 py-6 lg:gap-10 lg:py-8 ${
          nav === undefined || nav === null ? '' : 'lg:grid-cols-[15rem_minmax(0,1fr)]'
        }`}
      >
        {nav === undefined || nav === null ? null : (
          <div className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto">
            {nav}
          </div>
        )}
        <div id="workspace-content" className="flex min-w-0 flex-col gap-6">
          {children}
        </div>
      </div>
    </div>
  );
}

/**
 * A workspace page: its `main`, and a header with the title, an optional
 * introduction and an optional primary action (an `ActionLink` or a form).
 *
 * `reading` bounds a personal page to a comfortable measure; operational pages
 * use the content column's full width.
 */
export function WorkspacePage({
  title,
  description,
  action,
  measure = 'full',
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly measure?: 'full' | 'reading';
  readonly children: ReactNode;
}) {
  return (
    <main
      className={`flex w-full min-w-0 flex-col gap-6 ${measure === 'reading' ? 'max-w-3xl' : ''}`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex max-w-[var(--measure-prose)] min-w-0 flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          {description === undefined ? null : (
            <div className="flex flex-col gap-2 text-foreground-muted">{description}</div>
          )}
        </div>
        {action === undefined ? null : (
          <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>
        )}
      </header>
      {children}
    </main>
  );
}

/**
 * One section of a workspace overview: a heading, a short status and the
 * links onward.
 *
 * A plain `<section>` with no accessible name, so a dashboard of a dozen cards
 * is a dozen headings to jump between rather than a dozen landmarks.
 */
export function WorkspaceCard({
  heading,
  level = 2,
  wide = false,
  links,
  children,
}: {
  readonly heading: ReactNode;
  readonly level?: 2 | 3;
  /** Spans both columns of a two-column overview. */
  readonly wide?: boolean;
  readonly links?: readonly { readonly href: string; readonly text: string }[];
  readonly children?: ReactNode;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <section
      className={`flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-5 shadow-panel ${
        wide ? 'md:col-span-2' : ''
      }`}
    >
      <Heading
        className={level === 2 ? 'text-lg font-semibold' : 'text-base font-semibold'}
      >
        {heading}
      </Heading>
      {children === undefined ? null : (
        <div className="flex min-w-0 flex-col gap-2 text-sm">{children}</div>
      )}
      {links === undefined || links.length === 0 ? null : (
        <WorkspaceLinks links={links} />
      )}
    </section>
  );
}

/**
 * The links onward from a card or a page, each a 44-pixel target. A real list,
 * so a screen reader announces how many there are before reading them.
 */
export function WorkspaceLinks({
  links,
}: {
  readonly links: readonly { readonly href: string; readonly text: string }[];
}) {
  return (
    <ul className="mt-auto flex flex-wrap gap-x-5 border-t border-border pt-1">
      {links.map((link) => (
        <li key={link.href}>
          <a
            href={link.href}
            className="inline-flex min-h-11 items-center text-sm font-medium text-action underline underline-offset-2"
          >
            {link.text}
          </a>
        </li>
      ))}
    </ul>
  );
}
