import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { Container } from '@/components/ui';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { BrandLockup } from '@/components/shell/brand-lockup';
import { DisclosureMenu } from '@/components/shell/disclosure-menu';
import { DrawerSection, MegaMenuPanel } from '@/components/shell/menu-panel';
import { MobileNav } from '@/components/shell/mobile-nav';
import { domainMenus } from '@/shell/menus';
import { linksIn, pathFor, requireRoute } from '@/shell/registry';

/**
 * The public header.
 *
 * A SERVER COMPONENT that reads NOTHING about the visitor. No session, no user,
 * no roles, no permissions, no personalisation — the anonymous public render
 * tree must never read session-derived state, and a header is the classic place
 * that rule is broken (ARCHITECTURE.md §8.1, SECURITY_BASELINE.md §17). There
 * is deliberately no avatar and no "signed in as": `My Minhaj` is a plain link
 * that says the same thing to everybody, which is what keeps the whole public
 * tree cacheable as one entry for all visitors.
 *
 * THREE BANDS, from the IA's own order (INFORMATION_ARCHITECTURE.md §2):
 *
 *   1. the UTILITY bar — Find a Centre, Membership, Contact and Help, and the
 *      language switcher, reachable on every page without opening anything;
 *   2. the IDENTITY row — the brand lockup, Search, My Minhaj and Donate, the
 *      three primary items that are destinations rather than domains;
 *   3. the PRIMARY navigation — the nine domains, each with its mega menu.
 *
 * Below the desktop breakpoint, the domains, the utility links and the account
 * and giving links move into the drawer, and Search stays in the row: it is the
 * one thing a visitor on a phone most often came to do.
 *
 * EVERY LINK IS A REGISTRY ROUTE, grouped by `@/shell/menus`. Nothing here is
 * runtime data, and a deferred capability carries no path to link to.
 */
export async function SiteHeader({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  const utility = linksIn('utility');
  const menus = domainMenus();
  const search = requireRoute('search');
  const account = requireRoute('my-minhaj');
  const donate = requireRoute('donate');

  return (
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)]">
      {/*
       * THE UTILITY BAR (INFORMATION_ARCHITECTURE.md §2.1). The language
       * switcher stays here at every width; the three utility links join the
       * drawer below the desktop breakpoint, where a phone has no room for a
       * second row of small links.
       */}
      <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)]">
        <Container>
          <div className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 py-1 text-sm">
            {/*
             * THE PRE-ADOPTION MARKER (Phase 30-R): one quiet, global statement
             * that this is a review build, not the organisation's adopted site —
             * never a banner on every page.
             */}
            <p className="me-auto text-caption text-[color:var(--color-foreground-muted)]">
              {t('preAdoptionMarker')}
            </p>
            <ul className="hidden list-none flex-wrap items-center gap-x-5 p-0 lg:flex">
              {utility.map((route) => (
                <li key={route.key}>
                  <a
                    href={pathFor(locale, route)}
                    className="inline-flex min-h-8 items-center text-[color:var(--color-foreground-muted)] no-underline transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--color-foreground)] hover:underline hover:underline-offset-4"
                  >
                    {t(route.label as 'nav.contactHelp')}
                  </a>
                </li>
              ))}
            </ul>
            <LocaleSwitcher locale={locale} />
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex items-center justify-between gap-4 py-3 lg:py-4">
          <a
            href={pathFor(locale, requireRoute('home'))}
            className="inline-flex min-h-11 min-w-0 shrink items-center no-underline"
          >
            {/*
             * THE BRAND LOCKUP (Phase 30-R): the organisation's current
             * official logo and wordmark, as owner-authorised pre-adoption
             * brand evidence (OPEN_DECISIONS.md §6.4). The picture names the
             * organisation; the link adds its destination. It is the same in
             * every locale — the official lockup is one picture, written in
             * English and Arabic script as the organisation drew it.
             */}
            <BrandLockup placement="header" />
            <span className="sr-only"> — {t('nav.home')}</span>
          </a>

          <div className="flex items-center gap-2 lg:gap-3">
            {/*
             * SEARCH, prominent and immediately discoverable. It is a page, not
             * an overlay (INFORMATION_ARCHITECTURE.md §2.2), so it is a link —
             * shaped like the field it leads to, so it reads as "search" before
             * its label is read.
             */}
            <a
              href={pathFor(locale, search)}
              className="inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 text-sm text-[color:var(--color-foreground-muted)] no-underline transition-colors duration-[var(--duration-fast)] hover:border-[color:var(--color-action)] hover:text-[color:var(--color-foreground)] active:bg-[color:var(--color-surface-sunken)] lg:min-w-56"
            >
              <SearchIcon />
              {/* Icon-only on the narrowest phones, so the row never overflows;
                  the name is still "Search" to every assistive technology. */}
              <span className="sr-only sm:not-sr-only">{t('nav.search')}</span>
            </a>

            <a
              href={pathFor(locale, account)}
              className="hidden min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm font-medium no-underline transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)] lg:inline-flex"
            >
              {t('nav.myMinhaj')}
            </a>

            {/*
             * DONATE — distinct, but calm: an outlined accent rather than a
             * second filled action, so it is easy to find without competing
             * with the content for attention.
             */}
            <a
              href={pathFor(locale, donate)}
              className="hidden min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-accent)] bg-[color:var(--color-accent-surface)] px-4 text-sm font-semibold text-[color:var(--color-accent)] no-underline transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-accent-rule)] hover:text-[color:var(--color-foreground)] active:bg-[color:var(--color-accent-rule)] lg:inline-flex"
            >
              {t('nav.donate')}
            </a>

            {/*
             * THE MOBILE NAVIGATION, shown only below the desktop breakpoint.
             *
             * The two navigations are mutually exclusive by CSS, so exactly one
             * is in the tab order at any width — there is no second, hidden
             * copy of every link for a keyboard visitor to walk through.
             */}
            <div className="lg:hidden">
              <MobileNav
                openLabel={t('nav.openMenu')}
                closeLabel={t('nav.closeMenu')}
                title={t('nav.primary')}
              >
                <nav aria-label={t('nav.primary')} className="flex flex-col gap-6">
                  <a
                    href={pathFor(locale, search)}
                    className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] bg-[color:var(--color-surface)] px-3 text-sm text-[color:var(--color-foreground-muted)] no-underline hover:border-[color:var(--color-action)] hover:text-[color:var(--color-foreground)]"
                  >
                    <SearchIcon />
                    {t('nav.search')}
                  </a>

                  <div>
                    {menus.map((menu) => (
                      <DrawerSection key={menu.key} locale={locale} menu={menu} />
                    ))}
                  </div>

                  <ul className="flex list-none flex-col gap-3 p-0">
                    <li>
                      <a
                        href={pathFor(locale, account)}
                        className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-semibold no-underline hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)]"
                      >
                        {t('nav.myMinhaj')}
                      </a>
                    </li>
                    <li>
                      <a
                        href={pathFor(locale, donate)}
                        className="flex min-h-11 items-center justify-center rounded-[var(--radius-control)] border border-[color:var(--color-accent)] bg-[color:var(--color-accent-surface)] px-4 text-sm font-semibold text-[color:var(--color-accent)] no-underline hover:bg-[color:var(--color-accent-rule)] active:bg-[color:var(--color-accent-rule)]"
                      >
                        {t('nav.donate')}
                      </a>
                    </li>
                  </ul>

                  <ul className="flex list-none flex-col border-t border-[color:var(--color-border)] p-0 pt-3">
                    {utility.map((route) => (
                      <li key={route.key}>
                        <a
                          href={pathFor(locale, route)}
                          className="flex min-h-11 items-center text-sm text-[color:var(--color-foreground-muted)] no-underline hover:text-[color:var(--color-foreground)] hover:underline"
                        >
                          {t(route.label as 'nav.contactHelp')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              </MobileNav>
            </div>
          </div>
        </div>
      </Container>

      {/*
       * THE PRIMARY NAVIGATION — desktop. Each domain is its landing link with
       * a compact disclosure beside it; Explore is a disclosure alone. The row
       * is the panels' containing block, so every open panel spans it.
       */}
      <div className="hidden border-t border-[color:var(--color-border)] lg:block">
        <Container>
          <nav aria-label={t('nav.primary')} className="relative">
            <ul className="flex list-none flex-wrap items-center gap-x-0.5 p-0 py-1">
              {menus.map((menu) => {
                const text = t(menu.landing.label as 'nav.explore');
                const href = pathFor(locale, menu.landing);
                return (
                  <li key={menu.key}>
                    {menu.key === 'explore' ? (
                      <DisclosureMenu label={text} currentPrefix={href}>
                        <MegaMenuPanel locale={locale} menu={menu} />
                      </DisclosureMenu>
                    ) : (
                      <DisclosureMenu
                        label={t('menu.toggle', { section: text })}
                        link={{ href, text }}
                        currentPrefix={href}
                      >
                        <MegaMenuPanel locale={locale} menu={menu} />
                      </DisclosureMenu>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
        </Container>
      </div>
    </header>
  );
}
/** A magnifier, decorative: the link it sits in is named by its text. */
function SearchIcon() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="size-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </svg>
  );
}
