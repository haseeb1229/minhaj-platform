import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LocaleSwitcher } from '@/components/locale-switcher';
import { AccountEntry } from '@/components/shell/account-entry';
import { BrandWordmark } from '@/components/shell/brand-wordmark';
import { DisclosureMenu } from '@/components/shell/disclosure-menu';
import { MobileNav } from '@/components/shell/mobile-nav';
import { NavLink } from '@/components/shell/nav-link';
import { Container } from '@/components/ui';
import { readPresence } from '@/composition/presence';
import {
  footerGroups,
  givingPromoted,
  primaryNavigation,
  type Destination,
} from '@/shell/presence';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC HEADER (Rebaseline R1).
 *
 * TWO TIERS, deliberately quiet: a slim language strip, then ONE row — the One
 * Minhaj wordmark, the primary destinations, a real search form, the account
 * entry and, only while giving is open, Donate. No utility link wall, no
 * twelve-item bar, no mega menus of reserved pages.
 *
 * CONTENT-AWARE. The destinations come from the presentation policy
 * (`@/shell/presence`) applied to public evidence (`readPresence`): an area
 * appears once it has published content or an open service, so the header never
 * advertises an empty room. Every route stays reachable by its address.
 *
 * SESSION-FREE. Nothing here reads who is looking (ARCHITECTURE.md §8.1). The
 * account entry is a private island that asks one boolean after the page loads.
 */
export async function SiteHeader({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);

  const { bar, more } = primaryNavigation(presence);
  const giving = givingPromoted(presence);
  const home = pathFor(locale, requireRoute('home'));
  const searchAction = pathFor(locale, requireRoute('search'));
  const myHref = pathFor(locale, requireRoute('my-minhaj'));
  const signInHref = localizedPath(locale, '/signin');
  const donateHref = pathFor(locale, requireRoute('donate'));
  const hrefOf = (destination: Destination) =>
    pathFor(locale, requireRoute(destination.route));
  const labelOf = (destination: Destination) => t(destination.label as 'nav.library');
  const organisation = footerGroups(presence).find(
    (group) => group.heading === 'footer.groups.organisation',
  );

  const account = {
    myHref,
    signInHref,
    myLabel: t('nav.myMinhaj'),
    signInLabel: t('nav.signIn'),
    signedInLabel: t('nav.signedIn'),
  };

  return (
    <header className="border-b border-border bg-surface-raised">
      {/* THE LANGUAGE STRIP — the one control every page needs at every width. */}
      <div className="border-b border-border/70 bg-surface">
        <Container>
          <div className="flex min-h-9 items-center justify-end text-sm">
            <LocaleSwitcher locale={locale} />
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex min-h-[4.5rem] items-center gap-4 lg:gap-7">
          <a
            href={home}
            className="inline-flex min-h-11 shrink-0 items-center rounded-control no-underline"
          >
            <BrandWordmark />
            <span className="sr-only"> — {t('nav.home')}</span>
          </a>

          {/* PRIMARY NAVIGATION — desktop. */}
          <nav aria-label={t('nav.primary')} className="hidden min-w-0 flex-1 lg:block">
            <ul className="flex list-none items-center gap-1 p-0">
              {bar.map((destination) => (
                <li key={destination.route}>
                  <NavLink
                    href={hrefOf(destination)}
                    className="relative inline-flex min-h-11 items-center rounded-control px-3 text-[0.9375rem] font-medium text-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken aria-[current]:after:absolute aria-[current]:after:inset-x-3 aria-[current]:after:bottom-1 aria-[current]:after:h-0.5 aria-[current]:after:rounded-full aria-[current]:after:bg-accent"
                  >
                    {labelOf(destination)}
                  </NavLink>
                </li>
              ))}
              {more[0] === undefined ? null : (
                <li>
                  <DisclosureMenu label={t('nav.more')} currentPrefix={hrefOf(more[0])}>
                    <ul className="flex min-w-48 list-none flex-col gap-1 p-2">
                      {more.map((destination) => (
                        <li key={destination.route}>
                          <a
                            href={hrefOf(destination)}
                            className="flex min-h-11 items-center rounded-control px-3 text-sm no-underline hover:bg-surface-sunken"
                          >
                            {labelOf(destination)}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </DisclosureMenu>
                </li>
              )}
            </ul>
          </nav>

          <div className="ms-auto flex items-center gap-1.5 lg:ms-0 lg:gap-2">
            {/* SEARCH — a real field from a tablet up; a labelled action on a phone. */}
            <SearchForm
              action={searchAction}
              label={t('nav.searchLabel')}
              placeholder={t('nav.searchPlaceholder')}
              submit={t('nav.search')}
              id="site-search-bar"
              className="hidden md:flex"
            />
            <a
              href={searchAction}
              className="inline-flex size-11 items-center justify-center rounded-control text-foreground no-underline hover:bg-surface-sunken md:hidden"
            >
              <SearchIcon />
              <span className="sr-only">{t('nav.search')}</span>
            </a>

            <div className="hidden lg:block">
              <AccountEntry {...account} variant="bar" />
            </div>

            {giving ? (
              <a
                href={donateHref}
                className="hidden min-h-11 items-center rounded-control bg-action px-4 text-sm font-semibold text-action-foreground no-underline transition-colors duration-[var(--duration-fast)] hover:bg-action-hover lg:inline-flex"
              >
                {t('nav.donate')}
              </a>
            ) : null}

            {/* THE MOBILE NAVIGATION — exactly one navigation is in the tab order at any width. */}
            <div className="lg:hidden">
              <MobileNav
                openLabel={t('nav.openMenu')}
                closeLabel={t('nav.closeMenu')}
                title={t('nav.primary')}
              >
                <div className="flex flex-col gap-7">
                  <SearchForm
                    action={searchAction}
                    label={t('nav.searchLabel')}
                    placeholder={t('nav.searchPlaceholder')}
                    submit={t('nav.search')}
                    id="site-search-drawer"
                    className="flex"
                  />
                  <nav aria-label={t('nav.primary')}>
                    <ul className="flex list-none flex-col p-0">
                      {[...bar, ...more].map((destination) => (
                        <li key={destination.route} className="border-b border-border">
                          <NavLink
                            href={hrefOf(destination)}
                            className="flex min-h-14 items-center font-serif text-xl text-foreground no-underline aria-[current]:text-action"
                          >
                            {labelOf(destination)}
                          </NavLink>
                        </li>
                      ))}
                    </ul>
                  </nav>
                  <div className="flex flex-col gap-3">
                    <AccountEntry {...account} variant="drawer" />
                    {giving ? (
                      <a
                        href={donateHref}
                        className="flex min-h-12 items-center justify-center rounded-control bg-action px-4 text-base font-semibold text-action-foreground no-underline hover:bg-action-hover"
                      >
                        {t('nav.donate')}
                      </a>
                    ) : null}
                  </div>
                  {organisation === undefined ? null : (
                    <div>
                      <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-foreground-muted uppercase">
                        {t('footer.groups.organisation')}
                      </p>
                      <ul className="mt-2 flex list-none flex-col p-0">
                        {organisation.links.map((link) => {
                          const href =
                            link.kind === 'route'
                              ? pathFor(locale, requireRoute(link.route))
                              : localizedPath(locale, link.binding);
                          return (
                            <li key={href}>
                              <a
                                href={href}
                                className="flex min-h-11 items-center text-foreground-muted no-underline hover:text-foreground hover:underline"
                              >
                                {t(link.label as 'nav.about')}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </MobileNav>
            </div>
          </div>
        </div>
      </Container>
    </header>
  );
}

/** A real search form: a labelled field submitting `q` to the search page by GET. */
function SearchForm({
  action,
  label,
  placeholder,
  submit,
  id,
  className,
}: {
  readonly action: string;
  readonly label: string;
  readonly placeholder: string;
  readonly submit: string;
  readonly id: string;
  readonly className: string;
}) {
  return (
    <form
      role="search"
      action={action}
      method="get"
      className={`${className} items-stretch`}
    >
      <label className="sr-only" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="search"
        name="q"
        required
        maxLength={200}
        enterKeyHint="search"
        placeholder={placeholder}
        className="min-h-11 w-full min-w-0 rounded-s-control border border-e-0 border-border-strong bg-surface px-3 text-sm text-foreground placeholder:text-foreground-muted focus-visible:border-action lg:w-56 xl:w-64"
      />
      <button
        type="submit"
        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-e-control border border-border-strong bg-surface-sunken text-foreground transition-colors duration-[var(--duration-fast)] hover:bg-border"
      >
        <SearchIcon />
        <span className="sr-only">{submit}</span>
      </button>
    </form>
  );
}

/** A magnifier, decorative: the control it sits in is named by its text. */
function SearchIcon() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24" className="size-5">
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="m15.5 15.5 5 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
