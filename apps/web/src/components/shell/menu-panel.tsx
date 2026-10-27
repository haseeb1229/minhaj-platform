import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import type { DomainMenu, DomainMenuKey, MenuColumn } from '@/shell/menus';
import { pathFor } from '@/shell/registry';

/**
 * A mega menu's contents — the desktop panel and the mobile drawer section.
 *
 * ONE GROUPING, TWO HOSTS. The desktop disclosure and the mobile drawer differ
 * in how they open and how much room they have, not in what they contain: both
 * render the same resolved `DomainMenu` from `@/shell/menus`, so a column
 * cannot exist on one and be missing from the other. They are Server
 * Components, so neither host ships the labels or the route list to the
 * browser.
 *
 * COLUMN HEADINGS ARE LABELS, NOT HEADINGS. A panel is navigation inside the
 * banner; promoting its column titles to `h2`s would put forty headings into
 * the outline of every page each time a menu opened. Each list is instead
 * NAMED by its column title (`aria-labelledby`), which is what a screen reader
 * needs to know where it is — "Study, list, 4 items".
 */

/** The domain description each panel's overview carries, from its own catalogue. */
const DESCRIPTIONS = {
  explore: 'shell.explore.description',
  quran: 'quran.description',
  hadith: 'hadith.description',
  learn: 'learn.description',
  library: 'library.description',
  watch: 'watch.description',
  fatwa: 'fatwa.description',
  'news-events': 'news.description',
  global: 'global.intro',
} as const satisfies Record<DomainMenuKey, string>;

type ShellTranslator = Awaited<ReturnType<typeof getTranslations<'shell'>>>;

/** A registry or menu label, resolved in the `shell` namespace. */
function labelOf(t: ShellTranslator, key: string): string {
  return t(key as 'nav.home');
}

function ColumnHeading({
  id,
  column,
  locale,
  t,
  tall = false,
}: {
  readonly id: string;
  readonly column: MenuColumn;
  readonly locale: Locale;
  readonly t: ShellTranslator;
  /** A 44-pixel target, for the touch-first drawer. */
  readonly tall?: boolean;
}) {
  const text = labelOf(t, column.heading.label);

  return (
    <p
      id={id}
      className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase"
    >
      {column.heading.route === null ? (
        text
      ) : (
        <a
          href={pathFor(locale, column.heading.route)}
          className={`inline-flex ${tall ? 'min-h-11' : 'min-h-8'} items-center underline decoration-[color:var(--color-accent-rule)] underline-offset-4 hover:decoration-[color:var(--color-accent)]`}
        >
          {text}
        </a>
      )}
    </p>
  );
}

/** The desktop mega-menu panel: the columns, then the domain's description. */
export async function MegaMenuPanel({
  locale,
  menu,
}: {
  readonly locale: Locale;
  readonly menu: DomainMenu;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const all = await getTranslations({ locale });
  const domain = labelOf(t, menu.landing.label);

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,16rem)]">
      <div className="grid grid-cols-2 gap-x-8 gap-y-6 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {menu.columns.map((column, index) => {
          const id = `menu-${menu.key}-${String(index)}`;
          return (
            <div key={column.key} className="flex min-w-0 flex-col gap-2">
              <ColumnHeading id={id} column={column} locale={locale} t={t} />
              <ul aria-labelledby={id} className="flex list-none flex-col gap-0.5 p-0">
                {column.links.map((link) => (
                  <li key={link.key}>
                    <a
                      href={pathFor(locale, link.route)}
                      className="inline-flex min-h-8 items-center rounded-[var(--radius-control)] py-1 text-sm wrap-anywhere no-underline transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--color-action)] hover:underline hover:underline-offset-4 active:text-[color:var(--color-action-hover)]"
                    >
                      {labelOf(t, link.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col gap-3 rounded-[var(--radius-panel)] border-s-2 border-[color:var(--color-accent-rule)] bg-[color:var(--color-surface-sunken)] p-5">
        <p className="text-subheading font-semibold">{domain}</p>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {all(DESCRIPTIONS[menu.key])}
        </p>
        {/* No overview link here: the domain's landing link sits beside the
            disclosure button that opened this panel, and a second copy would
            give the navigation two identical destinations. The drawer keeps
            its own, because there the domain heading only toggles. */}
      </div>
    </div>
  );
}

/**
 * One domain in the mobile drawer: a native disclosure.
 *
 * `<details>` gives the open and closed state, the keyboard behaviour and the
 * announced expanded state with no script at all, and its closed contents have
 * no box — so they are out of the tab order exactly as a closed desktop panel
 * is. Every target is at least 44 pixels tall.
 */
export async function DrawerSection({
  locale,
  menu,
}: {
  readonly locale: Locale;
  readonly menu: DomainMenu;
}) {
  const t = await getTranslations({ locale, namespace: 'shell' });
  const domain = labelOf(t, menu.landing.label);

  return (
    <details className="group border-b border-[color:var(--color-border)]">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 py-2 text-base font-semibold transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--color-action)] [&::-webkit-details-marker]:hidden">
        {domain}
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 12 12"
          className="size-3.5 shrink-0 text-[color:var(--color-foreground-muted)] transition-transform duration-[var(--duration-fast)] group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M2.5 4.5 6 8l3.5-3.5" />
        </svg>
      </summary>

      <div className="flex flex-col gap-4 pb-5">
        <a
          href={pathFor(locale, menu.landing)}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[color:var(--color-action)] underline underline-offset-4"
        >
          {t('menu.overview', { section: domain })}
        </a>

        {menu.columns.map((column, index) => {
          const id = `drawer-${menu.key}-${String(index)}`;
          return (
            <div key={column.key} className="flex flex-col gap-1">
              <ColumnHeading id={id} column={column} locale={locale} t={t} tall />
              <ul
                aria-labelledby={id}
                className="flex list-none flex-col border-s border-[color:var(--color-border)] p-0 ps-3"
              >
                {column.links.map((link) => (
                  <li key={link.key}>
                    <a
                      href={pathFor(locale, link.route)}
                      className="flex min-h-11 items-center text-sm wrap-anywhere no-underline hover:text-[color:var(--color-action)] hover:underline active:text-[color:var(--color-action-hover)]"
                    >
                      {labelOf(t, link.label)}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </details>
  );
}
