import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { Container } from '@/components/ui';
import { PRODUCT_NAME } from '@/shell/product';
import { linksIn, pathFor } from '@/shell/registry';

/**
 * The public footer.
 *
 * THE FRAMEWORK, AT ITS CURRENT HONEST SIZE. INFORMATION_ARCHITECTURE.md §4
 * describes a six-column footer that is "the comprehensive index that the mega
 * menus deliberately are not" — and almost every entry in it belongs to Quran,
 * Hadith, Learn, Library, Watch, Fatwa, News, Global, Membership or Donations.
 * A column arrives only with the domains it indexes, and nothing is linked
 * before its owner has shipped it; what is here is the structure they arrive
 * into, and every link in it resolves today.
 *
 * SERVER-RENDERED AND SESSION-FREE, like the header, for the same reason.
 *
 * LABELS AND ROUTES ONLY. No organisational body, no legal text, no address, no
 * contact details, no social profiles — the footer of a legacy site is where
 * unevidenced organisational facts usually accumulate, and every one of those
 * is Phase-6 Page content (DELIVERY_PLAN.md, Phase 4).
 */
export async function SiteFooter({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  const explore = linksIn('footer-explore');
  const legal = linksIn('footer-legal');
  const utility = linksIn('footer-utility');

  return (
    <footer className="mt-16 border-t border-[color:var(--color-border)] bg-[color:var(--color-surface-sunken)]">
      <Container>
        <div className="flex flex-col gap-8 py-10">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <nav aria-label={t('footer.exploreHeading')} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">{t('footer.exploreHeading')}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {explore.map((route) => (
                  <li key={route.key}>
                    <a
                      href={pathFor(locale, route)}
                      className="underline underline-offset-2"
                    >
                      {t(route.label as 'explore.about.title')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            <nav aria-label={t('footer.legalHeading')} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">{t('footer.legalHeading')}</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {legal.map((route) => (
                  <li key={route.key}>
                    <a
                      href={pathFor(locale, route)}
                      className="underline underline-offset-2"
                    >
                      {t(route.label as 'legal.privacy')}
                    </a>
                  </li>
                ))}
                {utility.map((route) => (
                  <li key={route.key}>
                    <a
                      href={pathFor(locale, route)}
                      className="underline underline-offset-2"
                    >
                      {t(route.label as 'nav.sitemap')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {/*
           * THE PRE-ADOPTION STATEMENT.
           *
           * Stated plainly, in the visitor's language, on every public page:
           * this platform is independently developed and is not currently
           * commissioned, sponsored, adopted or deployed by Minhaj-ul-Quran
           * International (PRODUCT_SCOPE.md, *Product status and acceptance*).
           * It is a statement about the DEPLOYMENT, not a disclaimer that makes
           * the software a demo — there is no reduced build and no demo mode.
           */}
          <p className="max-w-[var(--measure-prose)] border-t border-[color:var(--color-border)] pt-6 text-sm text-[color:var(--color-foreground-muted)]">
            {t('footer.preAdoption')}
          </p>

          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            <span lang="en">{PRODUCT_NAME}</span>
          </p>
        </div>
      </Container>
    </footer>
  );
}
