import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';

import { ProductBar } from '@/components/shell/product-bar';
import { Icon } from '@/components/ui/icon';
import { LinkTabs } from '@/components/ui/link-tabs';
import { PageHeading } from '@/components/ui/layout';

/**
 * MY MINHAJ'S FRAME (R2) — the product bar, the area's navigation and the
 * page column, and the few shapes every My Minhaj page is built from.
 *
 * PRESENTATION ONLY. Nothing here reads a session, a permission or a record;
 * the layout hands it finished links and each page its own words.
 *
 * ONE PRODUCT. The shared product bar (wordmark, area name, the way back to the
 * public site, the language switcher) heads the area, as it heads Teaching
 * and the administration (R1). Below it, My Minhaj is a navigation column and
 * a page — no second band repeating the area's name, so each page's own `h1`
 * is the first heading the reader meets.
 *
 * NO HORIZONTAL OVERFLOW. Every column is `minmax(0, 1fr)` and every content
 * wrapper `min-w-0`, so the page never scrolls sideways at 320 pixels.
 * LOGICAL PROPERTIES ONLY (`check:rtl`).
 */

const COLUMN = 'mx-auto w-full max-w-7xl px-[var(--space-gutter)]';

export function MyShell({
  locale,
  area,
  skipLabel,
  nav,
  children,
}: {
  readonly locale: Locale;
  readonly area: string;
  readonly skipLabel: string;
  readonly nav: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <a
        href="#my-content"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface-raised focus:px-4 focus:py-3 focus:text-sm focus:font-medium focus:shadow-panel"
      >
        {skipLabel}
      </a>
      <ProductBar locale={locale} area={area} columnClassName={COLUMN} />
      <div
        className={`${COLUMN} grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-5 py-5 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-10 lg:py-10`}
      >
        <div className="min-w-0 lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:self-start lg:overflow-y-auto lg:pb-6">
          {nav}
        </div>
        <div id="my-content" className="flex min-w-0 flex-col">
          {children}
        </div>
      </div>
    </div>
  );
}

/** A link onward, named by where it goes. */
export interface MyLink {
  readonly href: string;
  readonly text: string;
}

/**
 * A My Minhaj page: its `main`, its one `h1` and introduction, an optional
 * primary action, and — when the page is one of several views of the same
 * thing — the tabs between them.
 *
 * `related` is the page's neighbours (owner direction 2026-11-08: the
 * cross-links between Learning, Classes, Teachers and Messages are always
 * offered), listed at the foot of the page. A neighbour the tabs already
 * offer is not repeated.
 *
 * `reading` bounds a page of prose and forms to a comfortable measure; lists
 * and the home page use the column's full width.
 */
export function MyPage({
  title,
  description,
  action,
  tabs,
  related,
  measure = 'full',
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly tabs?: {
    readonly label: string;
    readonly items: readonly {
      readonly href: string;
      readonly text: string;
      readonly current: boolean;
    }[];
  };
  readonly related?: { readonly label: string; readonly links: readonly MyLink[] };
  readonly measure?: 'full' | 'reading';
  readonly children: ReactNode;
}) {
  const tabbed = new Set(tabs?.items.map((tab) => tab.href) ?? []);
  const neighbours = related?.links.filter((link) => !tabbed.has(link.href)) ?? [];
  return (
    <main
      className={`flex w-full min-w-0 flex-col gap-8 ${measure === 'reading' ? 'max-w-3xl' : ''}`}
    >
      <div className="flex flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div className="flex max-w-[var(--measure-prose)] min-w-0 flex-col gap-2">
            <PageHeading>{title}</PageHeading>
            {description === undefined ? null : (
              <div className="flex flex-col gap-1.5 text-foreground-muted">
                {description}
              </div>
            )}
          </div>
          {action === undefined ? null : (
            <div className="flex shrink-0 flex-wrap items-center gap-3">{action}</div>
          )}
        </header>
        {tabs === undefined ? null : <LinkTabs label={tabs.label} tabs={tabs.items} />}
      </div>
      {children}
      {related === undefined || neighbours.length === 0 ? null : (
        <nav aria-label={related.label} className="border-t border-border pt-4">
          <MyLinks links={neighbours} />
        </nav>
      )}
    </main>
  );
}

/** A row of links onward — a home card's ways in, or a page's neighbours. */
export function MyLinks({ links }: { readonly links: readonly MyLink[] }) {
  return (
    <ul className="flex flex-wrap gap-x-6">
      {links.map((link) => (
        <li key={link.href}>
          <OnwardLink href={link.href}>{link.text}</OnwardLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * One titled part of a page: an `h2`, an optional one-line explanation, an
 * optional link onward ("See all"), then the content and, when given, its
 * further ways onward. Unboxed — the heading and a hairline carry the
 * structure, so a page of sections is not a stack of identical cards.
 */
export function MySection({
  id,
  heading,
  intro,
  link,
  links,
  children,
}: {
  readonly id: string;
  readonly heading: ReactNode;
  readonly intro?: ReactNode;
  readonly link?: MyLink;
  readonly links?: readonly MyLink[];
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-1 border-b border-border pb-2.5">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={id} className="text-subheading font-semibold text-balance">
            {heading}
          </h2>
          {intro === undefined ? null : (
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {intro}
            </p>
          )}
        </div>
        {link === undefined ? null : (
          <OnwardLink href={link.href}>{link.text}</OnwardLink>
        )}
      </div>
      {children}
      {links === undefined ? null : <MyLinks links={links} />}
    </section>
  );
}

/** A link onward from a section, named by where it goes, with a logical arrow. */
export function OnwardLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-action no-underline underline-offset-4 hover:underline active:text-action-hover"
    >
      {children}
      <Icon name="arrow-end" size={16} />
    </a>
  );
}

/**
 * The side column's modules on the home page: one raised surface, each module
 * a heading, its content and its way onward, divided by hairlines — one
 * container, not a card per module.
 */
export function MyRail({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className="flex min-w-0 flex-col divide-y divide-border self-start rounded-panel border border-border bg-surface-raised shadow-panel"
    >
      {children}
    </aside>
  );
}

/** One module of the rail: its heading, its content and its ways onward. */
export function MyRailModule({
  id,
  icon,
  heading,
  links,
  children,
}: {
  readonly id: string;
  readonly icon: Parameters<typeof Icon>[0]['name'];
  readonly heading: ReactNode;
  readonly links: readonly MyLink[];
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-3 p-5">
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
        <Icon name={icon} size={20} className="shrink-0 text-accent" />
        {heading}
      </h2>
      <div className="flex min-w-0 flex-col gap-3 text-sm">{children}</div>
      <MyLinks links={links} />
    </section>
  );
}

/**
 * A meter of how far along something is, with its words beside it — the
 * words carry the meaning; the bar is decoration for a sighted reader.
 */
export function ProgressMeter({
  percent,
  children,
}: {
  readonly percent: number;
  readonly children: ReactNode;
}) {
  const step = Math.round(Math.min(100, Math.max(0, percent)) / 5);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-caption text-foreground-muted tabular-nums">{children}</span>
      <span
        aria-hidden="true"
        className="block h-1.5 overflow-hidden rounded-full bg-surface-sunken"
      >
        <span className={`block h-full rounded-full bg-action ${METER_WIDTHS[step]}`} />
      </span>
    </div>
  );
}

/**
 * The meter's fill in twenty-one steps of five percent. The Content Security
 * Policy refuses inline styles, and Tailwind sees only classes written out in
 * full, so the widths are a fixed table rather than an interpolation.
 */
const METER_WIDTHS = [
  'w-0',
  'w-[5%]',
  'w-[10%]',
  'w-[15%]',
  'w-[20%]',
  'w-[25%]',
  'w-[30%]',
  'w-[35%]',
  'w-[40%]',
  'w-[45%]',
  'w-[50%]',
  'w-[55%]',
  'w-[60%]',
  'w-[65%]',
  'w-[70%]',
  'w-[75%]',
  'w-[80%]',
  'w-[85%]',
  'w-[90%]',
  'w-[95%]',
  'w-full',
] as const;
