import { localizedPath, type Locale } from '@minhaj/contracts';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { AccountEntry } from '@/components/shell/account-entry';
import { BrandWordmark } from '@/components/shell/brand-wordmark';
import { MegaNav } from '@/components/shell/disclosure-menu';
import { MobileNav } from '@/components/shell/mobile-nav';
import {
  readNavigationFeatures,
  type NavigationFeature,
} from '@/components/shell/navigation-features';
import { NavLink } from '@/components/shell/nav-link';
import { SearchPalette } from '@/components/shell/search-palette';
import { Container, Icon, MediaCard } from '@/components/ui';
import {
  domainMenus,
  headerUtility,
  type DomainMenu,
  type DomainMenuKey,
  type MenuColumn,
} from '@/shell/menus';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC HEADER — the nine domains, always (owner direction 2026-11-08).
 *
 * TWO ROWS ON A WIDE SCREEN, ONE ON A PHONE.
 *
 *   - A thin utility strip: Find a Centre, Membership and Contact & Help at
 *     the inline start; the language switcher, My Minhaj or Sign in, and
 *     Donate at the inline end (INFORMATION_ARCHITECTURE.md §2.1).
 *   - The main row: the One Minhaj wordmark; the nine domains — Explore,
 *     Quran, Hadith, Learn, Library, Watch, Fatwa, News & Events, Global — each
 *     a disclosure opening its full mega menu: a one-line purpose, the way to
 *     the domain's landing, its columns of links and, for Watch, Library and
 *     News & Events, a recent record with its real picture; and Search (a
 *     palette, Ctrl/⌘K).
 *   - Below 1280 px: wordmark, search, account and Menu, which opens a sheet
 *     with one accordion per domain holding every link of its menu, Donate,
 *     the utility links and the language switcher.
 *
 * WHY 1280 PX. Measured in a real browser in the shipped faces, the nine
 * domain buttons (14 px labels) with the wordmark and an icon-only Search fit
 * one row at 1280 px in English, Urdu and Arabic, but not at 1024 px in
 * English. Below 1280 px the sheet carries the same links, so exactly one
 * navigation is usable at any width.
 *
 * UNCONDITIONAL. Every domain and link is shown whatever the platform has
 * published (`@/shell/menus`); a destination with nothing published answers
 * with its own honest state. Nothing here reads who is looking either
 * (ARCHITECTURE.md §8.1): the account entry is a private island that asks one
 * boolean after the page loads.
 */

/** Each domain's one-line purpose, under `nav.intros`. */
const INTROS = {
  explore: 'nav.intros.explore',
  quran: 'nav.intros.quran',
  hadith: 'nav.intros.hadith',
  learn: 'nav.intros.learn',
  library: 'nav.intros.library',
  watch: 'nav.intros.watch',
  fatwa: 'nav.intros.fatwa',
  'news-events': 'nav.intros.newsEvents',
  global: 'nav.intros.global',
} as const satisfies Record<DomainMenuKey, string>;

type ShellTranslator = Awaited<ReturnType<typeof getTranslations<'shell'>>>;

/** A registry or menu label, resolved in the `shell` namespace. */
const labelOf = (t: ShellTranslator, key: string): string => t(key as 'nav.home');

export async function SiteHeader({ locale }: { readonly locale: Locale }) {
  const [t, features] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readNavigationFeatures(locale),
  ]);

  const menus = domainMenus();
  const utility = headerUtility();
  const searchAction = pathFor(locale, requireRoute('search'));
  const donateHref = pathFor(locale, requireRoute('donate'));

  const account = {
    myHref: pathFor(locale, requireRoute('my-minhaj')),
    signInHref: localizedPath(locale, '/signin'),
    myLabel: t('nav.myMinhaj'),
    signInLabel: t('nav.signIn'),
    signedInLabel: t('nav.signedIn'),
  };

  const featuredLabel = (feature: NavigationFeature) =>
    t(`nav.featured.${feature.kind}` as 'nav.featured.video');

  return (
    <header className="relative border-b border-border bg-surface-raised">
      {/* THE UTILITY STRIP — from a laptop up. */}
      <div className="hidden border-b border-border/70 bg-surface lg:block">
        <Container>
          <div className="flex min-h-9 items-center justify-between gap-6 text-sm">
            <nav aria-label={t('nav.utility')}>
              <ul className="flex list-none flex-wrap items-center gap-x-5 p-0">
                {utility.map((link) => (
                  <li key={link.key}>
                    <NavLink
                      href={pathFor(locale, link.route)}
                      className="inline-flex min-h-9 items-center text-foreground-muted no-underline underline-offset-4 hover:text-foreground hover:underline aria-[current]:text-foreground"
                    >
                      {labelOf(t, link.label)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex items-center gap-4">
              <LocaleSwitcher locale={locale} />
              <span aria-hidden="true" className="h-4 border-s border-border-strong/50" />
              <AccountEntry {...account} variant="strip" />
              <a
                href={donateHref}
                className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-action px-3 text-sm font-semibold text-action-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
              >
                <Icon name="heart" size={16} />
                {t('nav.donate')}
              </a>
            </div>
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex min-h-[4.25rem] items-center gap-2 sm:gap-3">
          <a
            href={pathFor(locale, requireRoute('home'))}
            className="inline-flex min-h-11 shrink-0 items-center rounded-control no-underline"
          >
            <BrandWordmark />
            <span className="sr-only"> — {t('nav.home')}</span>
          </a>

          {/* THE MEGA-NAVIGATION — the nine domains, from 1280 px up. */}
          <div className="hidden min-w-0 flex-1 xl:block">
            <MegaNav
              label={t('nav.primary')}
              currentLabel={t('nav.currentSection')}
              groups={menus.map((menu) => ({
                id: menu.key,
                label: labelOf(t, menu.landing.label),
                prefixes: hrefsOf(locale, menu),
                panel: (
                  <MegaPanel
                    locale={locale}
                    menu={menu}
                    t={t}
                    featured={features[menu.key]}
                    featuredLabel={featuredLabel}
                  />
                ),
              }))}
            />
          </div>

          <div className="ms-auto flex shrink-0 items-center gap-1 xl:gap-2">
            <SearchPalette
              action={searchAction}
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              labels={{
                open: t('nav.search'),
                title: t('nav.searchLabel'),
                field: t('nav.searchLabel'),
                placeholder: t('nav.searchPlaceholder'),
                submit: t('nav.search'),
                close: t('nav.closeMenu'),
                quickLinks: t('nav.quickLinks'),
                noQuickLinks: t('nav.noQuickLinks'),
              }}
              quickLinks={menus.map((menu) => ({
                href: pathFor(locale, menu.landing),
                label: labelOf(t, menu.landing.label),
              }))}
            />

            {/* BELOW 1280 PX — the account (until the strip carries it), then Menu. */}
            <div className="flex items-center gap-1 xl:hidden">
              <span className="lg:hidden">
                <AccountEntry {...account} variant="icon" />
              </span>
              <MobileNav
                openLabel={t('nav.openMenu')}
                closeLabel={t('nav.closeMenu')}
                title={t('nav.primary')}
              >
                <div className="flex flex-col gap-6">
                  <form
                    role="search"
                    action={searchAction}
                    method="get"
                    className="flex items-stretch"
                  >
                    <label className="sr-only" htmlFor="site-search-drawer">
                      {t('nav.searchLabel')}
                    </label>
                    <input
                      id="site-search-drawer"
                      type="search"
                      name="q"
                      required
                      maxLength={SEARCH_QUERY_MAX_LENGTH}
                      enterKeyHint="search"
                      placeholder={t('nav.searchPlaceholder')}
                      className="min-h-12 w-full min-w-0 rounded-s-control border border-e-0 border-border-strong bg-surface px-3 text-base text-foreground placeholder:text-foreground-muted focus-visible:border-action"
                    />
                    <button
                      type="submit"
                      className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-e-control border border-border-strong bg-surface-sunken text-foreground hover:bg-border"
                    >
                      <Icon name="search" />
                      <span className="sr-only">{t('nav.search')}</span>
                    </button>
                  </form>

                  <nav aria-label={t('nav.primary')}>
                    <ul className="flex list-none flex-col p-0">
                      {menus.map((menu) => (
                        <li key={menu.key} className="border-b border-border">
                          <DrawerSection locale={locale} menu={menu} t={t} />
                        </li>
                      ))}
                    </ul>
                  </nav>

                  <a
                    href={donateHref}
                    className="flex min-h-12 items-center justify-center gap-2 rounded-control bg-action px-4 text-base font-semibold text-action-foreground no-underline hover:bg-action-hover"
                  >
                    <Icon name="heart" size={16} />
                    {t('nav.donate')}
                  </a>

                  <nav aria-label={t('nav.utility')}>
                    <ul className="flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
                      {utility.map((link) => (
                        <li key={link.key}>
                          <a
                            href={pathFor(locale, link.route)}
                            className="inline-flex min-h-11 items-center text-foreground-muted no-underline hover:text-foreground hover:underline"
                          >
                            {labelOf(t, link.label)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </nav>

                  <div className="border-t border-border pt-4">
                    <LocaleSwitcher locale={locale} />
                  </div>
                </div>
              </MobileNav>
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}

/**
 * The addresses a domain owns, for its current-section marker: its landing
 * and every link of its menu. Where two domains list one address, the first
 * in the bar's order is marked.
 */
function hrefsOf(locale: Locale, menu: DomainMenu): string[] {
  return [
    pathFor(locale, menu.landing),
    ...menu.columns.flatMap((column) => [
      ...(column.heading.route === null ? [] : [pathFor(locale, column.heading.route)]),
      ...column.links.map((link) => pathFor(locale, link.route)),
    ]),
  ];
}

/**
 * A column heading: a label, or a link when the heading is itself a section.
 * NOT A REAL HEADING: a panel is navigation inside the banner, and forty
 * headings in every page's outline would bury its own. Each list is instead
 * NAMED by its heading (`aria-labelledby`) — "Study, list, 4 items".
 */
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
  /** A 44-pixel target, for the touch-first sheet. */
  readonly tall?: boolean;
}) {
  const text = labelOf(t, column.heading.label);
  // One height for a linked and a plain heading, so the columns' lists align.
  const height = `inline-flex ${tall ? 'min-h-11' : 'min-h-8'} items-center`;
  return (
    <p
      id={id}
      className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase"
    >
      {column.heading.route === null ? (
        <span className={height}>{text}</span>
      ) : (
        <a
          href={pathFor(locale, column.heading.route)}
          className={`${height} underline decoration-accent-rule underline-offset-4 hover:decoration-accent`}
        >
          {text}
        </a>
      )}
    </p>
  );
}

/**
 * ONE MEGA PANEL: the domain's one-line purpose and the way to its landing;
 * its columns of links; and — for Watch, Library and News & Events, where the
 * corpus has one — a recent record with its real picture at the inline end.
 */
function MegaPanel({
  locale,
  menu,
  t,
  featured,
  featuredLabel,
}: {
  readonly locale: Locale;
  readonly menu: DomainMenu;
  readonly t: ShellTranslator;
  readonly featured: NavigationFeature | undefined;
  readonly featuredLabel: (feature: NavigationFeature) => string;
}) {
  const domain = labelOf(t, menu.landing.label);
  return (
    <Container>
      <div
        className={`grid gap-10 py-7 ${featured === undefined ? '' : 'grid-cols-[minmax(0,1fr)_17rem]'}`}
      >
        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-8 gap-y-2 border-b border-border pb-4">
            <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
              {t(INTROS[menu.key])}
            </p>
            <NavLink
              href={pathFor(locale, menu.landing)}
              className="inline-flex min-h-9 shrink-0 items-center gap-1.5 text-sm font-semibold text-action no-underline underline-offset-4 hover:underline"
            >
              {t('menu.overview', { section: domain })}
              <Icon name="arrow-end" size={16} />
            </NavLink>
          </div>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-x-8 gap-y-6">
            {menu.columns.map((column, index) => {
              const id = `menu-${menu.key}-${String(index)}`;
              return (
                <div key={column.key} className="flex min-w-0 flex-col gap-2">
                  <ColumnHeading id={id} column={column} locale={locale} t={t} />
                  <ul aria-labelledby={id} className="flex list-none flex-col p-0">
                    {column.links.map((link) => (
                      <li key={link.key}>
                        <NavLink
                          href={pathFor(locale, link.route)}
                          className="inline-flex min-h-8 items-center rounded-control py-1 text-sm wrap-anywhere text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:text-action hover:underline hover:underline-offset-4 aria-[current]:font-semibold aria-[current]:text-action"
                        >
                          {labelOf(t, link.label)}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
        {featured === undefined ? null : (
          <MediaCard
            as="div"
            headingLevel="p"
            href={featured.href}
            title={featured.title}
            type={featuredLabel(featured)}
            lang={featured.lang}
            dir={featured.dir}
            // A cover is shown whole inside a wide box, so a book does not
            // stand taller than the panel's links.
            aspect={featured.kind === 'book' ? 'wide' : 'poster'}
            {...(featured.kind === 'book' ? { fit: 'contain' as const } : {})}
            sizes="19rem"
            image={{
              path: featured.image.path,
              width: featured.image.width,
              height: featured.image.height,
            }}
          />
        )}
      </div>
    </Container>
  );
}

/**
 * One domain in the sheet: a native disclosure holding its landing and every
 * link of its menu. `<details>` gives the state, the keyboard behaviour and the
 * announced expansion with no script, and a closed one is out of the tab
 * order. Every target is at least 44 pixels tall.
 */
function DrawerSection({
  locale,
  menu,
  t,
}: {
  readonly locale: Locale;
  readonly menu: DomainMenu;
  readonly t: ShellTranslator;
}) {
  const domain = labelOf(t, menu.landing.label);
  return (
    <details className="group/acc">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-serif text-xl text-foreground [&::-webkit-details-marker]:hidden">
        {domain}
        <Icon
          name="chevron-down"
          className="text-foreground-muted transition-transform duration-[var(--duration-fast)] group-open/acc:rotate-180"
        />
      </summary>
      <div className="flex flex-col gap-4 pb-5">
        <NavLink
          href={pathFor(locale, menu.landing)}
          className="inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-action no-underline underline-offset-4 hover:underline"
        >
          {t('menu.overview', { section: domain })}
          <Icon name="arrow-end" size={16} />
        </NavLink>
        {menu.columns.map((column, index) => {
          const id = `drawer-${menu.key}-${String(index)}`;
          return (
            <div key={column.key} className="flex flex-col gap-1">
              <ColumnHeading id={id} column={column} locale={locale} t={t} tall />
              <ul
                aria-labelledby={id}
                className="flex list-none flex-col border-s border-border p-0 ps-3"
              >
                {column.links.map((link) => (
                  <li key={link.key}>
                    <NavLink
                      href={pathFor(locale, link.route)}
                      className="flex min-h-11 items-center rounded-control px-2 text-base wrap-anywhere text-foreground no-underline hover:bg-surface-sunken aria-[current]:font-semibold aria-[current]:text-action"
                    >
                      {labelOf(t, link.label)}
                    </NavLink>
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
