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
import { readPresence } from '@/composition/presence';
import {
  givingPromoted,
  navigationGroups,
  utilityLinks,
  type NavItem,
  type NavigationGroup,
} from '@/shell/presence';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC HEADER (R2 — grouped mega-navigation).
 *
 * TWO ROWS ON A LAPTOP, ONE ON A PHONE.
 *
 *   - A thin utility strip: the organisation, help and contact at the inline
 *     start; the language switcher, My Minhaj or Sign in, and Donate (only
 *     while giving is open) at the inline end.
 *   - The main row: the One Minhaj wordmark; six grouped disclosures — Quran,
 *     Knowledge, Watch & Listen, Learn, News & Events, About MQI — each opening
 *     a panel of its present destinations with one-line descriptions and, where
 *     the corpus has one, a featured record with its real picture; and Search
 *     (a palette, Ctrl/⌘K).
 *   - Below 1024 px: wordmark, search, account and Menu, which opens a sheet
 *     with one accordion per group and the language switcher.
 *
 * WHY THE ACCOUNT AND DONATE SIT IN THE STRIP. Measured in the shipped faces,
 * the six English group labels alone take ~700 px with their controls; with
 * the wordmark, Search, the account and Donate in the same row it would not
 * fit 1024 px (nor 1280 px with Search's label). The strip has the room, and
 * the main row stays one line in all three languages.
 *
 * CONTENT-AWARE. Which groups and destinations exist is the presentation
 * policy's decision (`@/shell/presence`) over public evidence (`readPresence`):
 * a group with nothing present is not shown, and nothing absent is linked.
 *
 * SESSION-FREE. Nothing here reads who is looking (ARCHITECTURE.md §8.1). The
 * account entry is a private island that asks one boolean after the page loads.
 */
export async function SiteHeader({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);
  const features = await readNavigationFeatures(locale);

  const groups = navigationGroups(presence);
  const utility = utilityLinks(presence);
  const giving = givingPromoted(presence);
  const searchAction = pathFor(locale, requireRoute('search'));
  const donateHref = pathFor(locale, requireRoute('donate'));

  const hrefOf = (item: NavItem) =>
    item.kind === 'route'
      ? pathFor(locale, requireRoute(item.route))
      : localizedPath(locale, item.binding);
  const titleOf = (item: NavItem) =>
    t(`nav.items.${item.id}.title` as 'nav.items.about.title');
  const groupLabel = (group: NavigationGroup) =>
    t(`nav.groups.${group.id}` as 'nav.groups.about');

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
      {/* THE UTILITY STRIP — the organisation and the language, from a laptop up. */}
      <div className="hidden border-b border-border/70 bg-surface lg:block">
        <Container>
          <div className="flex min-h-9 items-center justify-between gap-6 text-sm">
            <nav aria-label={t('nav.utility')}>
              <ul className="flex list-none flex-wrap items-center gap-x-5 p-0">
                {utility.map((item) => (
                  <li key={item.id}>
                    <NavLink
                      href={hrefOf(item)}
                      className="inline-flex min-h-9 items-center text-foreground-muted no-underline underline-offset-4 hover:text-foreground hover:underline aria-[current]:text-foreground"
                    >
                      {titleOf(item)}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="flex items-center gap-4">
              <LocaleSwitcher locale={locale} />
              <span aria-hidden="true" className="h-4 border-s border-border-strong/50" />
              <AccountEntry {...account} variant="strip" />
              {giving ? (
                <a
                  href={donateHref}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-action px-3 text-sm font-semibold text-action-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-action-hover"
                >
                  <Icon name="heart" size={16} />
                  {t('nav.donate')}
                </a>
              ) : null}
            </div>
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex min-h-[4.25rem] items-center gap-2 sm:gap-3 lg:gap-4 xl:gap-6">
          <a
            href={pathFor(locale, requireRoute('home'))}
            className="inline-flex min-h-11 shrink-0 items-center rounded-control no-underline"
          >
            <BrandWordmark />
            <span className="sr-only"> — {t('nav.home')}</span>
          </a>

          {/* THE MEGA-NAVIGATION — from a laptop up. */}
          <div className="hidden min-w-0 flex-1 lg:block">
            <MegaNav
              label={t('nav.primary')}
              currentLabel={t('nav.currentSection')}
              groups={groups.map((group) => ({
                id: group.id,
                label: groupLabel(group),
                prefixes: group.items.map(hrefOf),
                panel: (
                  <MegaPanel
                    intro={t(`nav.intros.${group.id}` as 'nav.intros.about')}
                    items={group.items.map((item) => ({
                      key: item.id,
                      href: hrefOf(item),
                      title: titleOf(item),
                      description: t(
                        `nav.items.${item.id}.description` as 'nav.items.about.description',
                      ),
                    }))}
                    featured={features[group.id]}
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
              quickLinks={groups.flatMap((group) =>
                group.items.map((item) => ({ href: hrefOf(item), label: titleOf(item) })),
              )}
            />

            {/* THE PHONE AND TABLET ROW — account, then Menu; exactly one navigation is usable at any width. */}
            <div className="flex items-center gap-1 lg:hidden">
              <AccountEntry {...account} variant="icon" />
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
                      {groups.map((group) => (
                        <li key={group.id} className="border-b border-border">
                          <details className="group/acc">
                            <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 font-serif text-xl text-foreground [&::-webkit-details-marker]:hidden">
                              {groupLabel(group)}
                              <Icon
                                name="chevron-down"
                                className="text-foreground-muted transition-transform duration-[var(--duration-fast)] group-open/acc:rotate-180"
                              />
                            </summary>
                            <ul className="flex list-none flex-col gap-0.5 p-0 pb-4">
                              {group.items.map((item) => (
                                <li key={item.id}>
                                  <NavLink
                                    href={hrefOf(item)}
                                    className="flex min-h-11 items-center rounded-control px-3 text-base text-foreground no-underline hover:bg-surface-sunken aria-[current]:font-semibold aria-[current]:text-action"
                                  >
                                    {titleOf(item)}
                                  </NavLink>
                                </li>
                              ))}
                            </ul>
                          </details>
                        </li>
                      ))}
                    </ul>
                  </nav>

                  {giving ? (
                    <a
                      href={donateHref}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-control bg-action px-4 text-base font-semibold text-action-foreground no-underline hover:bg-action-hover"
                    >
                      <Icon name="heart" size={16} />
                      {t('nav.donate')}
                    </a>
                  ) : null}

                  <nav aria-label={t('nav.utility')}>
                    <ul className="flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
                      {utility.map((item) => (
                        <li key={item.id}>
                          <a
                            href={hrefOf(item)}
                            className="inline-flex min-h-11 items-center text-foreground-muted no-underline hover:text-foreground hover:underline"
                          >
                            {titleOf(item)}
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
 * ONE MEGA PANEL: the group's one-line purpose, its destinations in two or
 * three columns each with a one-line description, and — where the corpus has
 * one — a recent record with its real picture at the inline end.
 */
function MegaPanel({
  intro,
  items,
  featured,
  featuredLabel,
}: {
  readonly intro: string;
  readonly items: readonly {
    readonly key: string;
    readonly href: string;
    readonly title: string;
    readonly description: string;
  }[];
  readonly featured: NavigationFeature | undefined;
  readonly featuredLabel: (feature: NavigationFeature) => string;
}) {
  return (
    <Container>
      <div
        className={`grid gap-10 py-8 ${featured === undefined ? '' : 'grid-cols-[minmax(0,1fr)_17rem] xl:grid-cols-[minmax(0,1fr)_19rem]'}`}
      >
        <div className="flex min-w-0 flex-col gap-5">
          <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
            {intro}
          </p>
          <ul
            className={`grid list-none gap-x-6 gap-y-1 p-0 ${items.length > 4 ? 'grid-cols-2 xl:grid-cols-3' : 'grid-cols-2'}`}
          >
            {items.map((item) => (
              <li key={item.key} className="min-w-0">
                <NavLink
                  href={item.href}
                  className="group/item flex min-h-11 flex-col gap-0.5 rounded-control px-3 py-2.5 no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken aria-[current]:bg-accent-surface"
                >
                  <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                    {item.title}
                    <Icon
                      name="arrow-end"
                      size={16}
                      className="text-accent opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover/item:opacity-100 group-focus-visible/item:opacity-100"
                    />
                  </span>
                  <span className="text-sm text-foreground-muted">
                    {item.description}
                  </span>
                </NavLink>
              </li>
            ))}
          </ul>
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
