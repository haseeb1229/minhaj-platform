import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { Container } from '@/components/ui';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { DisclosureMenu } from '@/components/shell/disclosure-menu';
import { ExplorePanel } from '@/components/shell/explore-panel';
import { MobileNav } from '@/components/shell/mobile-nav';
import { PRODUCT_NAME } from '@/shell/product';
import { linksIn, pathFor, routeByKey, isAvailable } from '@/shell/registry';

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
 * WHAT IS ABSENT IS THE POINT. Nine of the twelve primary items and all three
 * deferred utility items belong to phases that have not shipped, so they are
 * not here at all — not greyed out, not "coming soon", not linked to a stub.
 * A deferred capability is absent (ROUTE_MAP.md §5.2), and the registry makes
 * that structural: a deferred route carries no path to link to.
 */
export async function SiteHeader({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  const primary = linksIn('primary');
  const explore = routeByKey('explore');
  const hasExplore = explore !== null && isAvailable(explore);

  return (
    <header className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)]">
      {/*
       * THE UTILITY BAR (INFORMATION_ARCHITECTURE.md §2.1).
       *
       * The language switcher and nothing else. Find a Centre, Membership and
       * Contact / Help belong to Global Network, Membership and Editorial, and
       * none of those has shipped — so none of them appears. The switcher is
       * here rather than inside a menu because it is a site-wide concern that
       * must be reachable from every page without opening anything.
       */}
      <div className="border-b border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)]">
        <Container>
          <div className="flex items-center justify-end py-1.5 text-sm">
            <LocaleSwitcher locale={locale} />
          </div>
        </Container>
      </div>

      <Container>
        <div className="flex items-center justify-between gap-4 py-3">
          <a
            href={`/${locale}`}
            className="text-lg font-semibold tracking-tight no-underline"
          >
            {/*
             * THE PRODUCT NAME, not an organisational logo or wordmark.
             *
             * Official logo assets and brand guidelines are organisational
             * input that has not arrived (OPEN_DECISIONS.md §6.4), so there is
             * no image here and nothing that could be mistaken for one. The
             * name is carried in English in every locale and marked `lang="en"`
             * accordingly: an Urdu or Arabic rendering of it would be a brand
             * decision nobody has taken, and inventing one is exactly the kind
             * of unevidenced claim this phase must not make.
             */}
            <span lang="en">{PRODUCT_NAME}</span>
            <span className="sr-only"> — {t('nav.home')}</span>
          </a>

          <nav aria-label={t('nav.primary')} className="hidden lg:block">
            <ul className="flex items-center gap-1">
              {hasExplore ? (
                <li>
                  <DisclosureMenu label={t('nav.explore')}>
                    <ExplorePanel locale={locale} />
                  </DisclosureMenu>
                </li>
              ) : null}

              {primary
                .filter((route) => route.key !== 'explore')
                .map((route) => (
                  <li key={route.key}>
                    <a
                      href={pathFor(locale, route)}
                      className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] px-3 py-2 text-sm font-medium no-underline hover:bg-[color:var(--color-surface-sunken)]"
                    >
                      {t(route.label as 'nav.explore')}
                    </a>
                  </li>
                ))}
            </ul>
          </nav>

          {/*
           * THE MOBILE NAVIGATION, shown only below the desktop breakpoint.
           *
           * The two navigations are mutually exclusive by CSS, so exactly one
           * is in the tab order at any width — there is no second, hidden copy
           * of every link for a keyboard visitor to walk through.
           */}
          <div className="lg:hidden">
            <MobileNav
              openLabel={t('nav.openMenu')}
              closeLabel={t('nav.closeMenu')}
              title={t('nav.primary')}
            >
              <nav aria-label={t('nav.primary')} className="flex flex-col gap-5">
                <ul className="flex flex-col gap-2">
                  {primary.map((route) => (
                    <li key={route.key}>
                      <a
                        href={pathFor(locale, route)}
                        className="inline-flex min-h-11 items-center text-base font-medium underline underline-offset-4"
                      >
                        {t(route.label as 'nav.explore')}
                      </a>
                    </li>
                  ))}
                </ul>

                {hasExplore ? <ExplorePanel locale={locale} /> : null}
              </nav>
            </MobileNav>
          </div>
        </div>
      </Container>
    </header>
  );
}
