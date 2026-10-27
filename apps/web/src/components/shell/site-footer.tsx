import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import { Container } from '@/components/ui';
import { footerColumns, footerUtility } from '@/shell/menus';
import { PRODUCT_NAME } from '@/shell/product';
import { pathFor } from '@/shell/registry';

/**
 * The public footer — "the comprehensive index that the mega menus
 * deliberately are not" (INFORMATION_ARCHITECTURE.md §4).
 *
 * SIX COLUMNS, from `@/shell/menus`: About Minhaj-ul-Quran, Knowledge, Library
 * and Media, Learn and Participate, Our Work, and Global and Contact. Every
 * link is a registry route that answers today; reserved Explore and Volunteer
 * pages are included because they exist and say honestly that nothing is
 * published yet. Entries with no static route are absent rather than greyed.
 *
 * EACH COLUMN IS A NAMED NAVIGATION LIST under a real `h2`, so a screen-reader
 * user can jump between the groups by heading and hear each list's size.
 *
 * THE UTILITY BAR holds the legal documents and the human sitemap. The
 * language switcher is NOT repeated here: it is already in the utility bar at
 * the top of every page (§2.1), and a second copy would put two identically
 * named navigation landmarks, and two of every language link, on each page.
 *
 * SERVER-RENDERED AND SESSION-FREE, like the header. LABELS AND ROUTES ONLY:
 * no address, no contact details, no social profiles and no copyright owner —
 * each of those is an organisational fact this build has no evidence for.
 */
export async function SiteFooter({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'shell' });

  const columns = footerColumns();
  const utility = footerUtility();

  return (
    <footer className="surface-ink mt-[var(--space-section)] border-t-4 border-[color:var(--color-ink-accent)]">
      <Container>
        <div className="flex flex-col gap-10 py-[var(--space-section)]">
          <p className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="h-6 w-1 shrink-0 rounded-full bg-[color:var(--color-ink-accent)]"
            />
            <span lang="en" className="text-lg font-semibold">
              {PRODUCT_NAME}
            </span>
          </p>

          <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[30rem]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {columns.map((column, index) => {
              const id = `footer-column-${String(index)}`;
              const heading = t(column.heading as 'footer.columns.about');
              return (
                <nav key={column.heading} aria-labelledby={id} className="min-w-0">
                  <h2
                    id={id}
                    className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-ink-accent)] uppercase"
                  >
                    {heading}
                  </h2>
                  <ul className="mt-3 flex list-none flex-col p-0">
                    {column.links.map((link) => (
                      <li key={link.key}>
                        <a
                          href={pathFor(locale, link.route)}
                          className="inline-flex min-h-9 items-center text-sm wrap-anywhere text-[color:var(--color-ink-muted)] no-underline transition-colors duration-[var(--duration-fast)] hover:text-[color:var(--color-ink-foreground)] hover:underline hover:underline-offset-4 active:text-[color:var(--color-ink-accent)]"
                        >
                          {t(link.label as 'nav.home')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              );
            })}
          </div>

          <div className="flex flex-col gap-5 border-t border-[color:var(--color-ink-border)] pt-6">
            <nav aria-label={t('footer.legalHeading')}>
              <ul className="flex list-none flex-wrap gap-x-6 gap-y-1 p-0">
                {utility.map((link) => (
                  <li key={link.key}>
                    <a
                      href={pathFor(locale, link.route)}
                      className="inline-flex min-h-9 items-center text-sm text-[color:var(--color-ink-foreground)] underline decoration-[color:var(--color-ink-border)] underline-offset-4 transition-colors duration-[var(--duration-fast)] hover:decoration-[color:var(--color-ink-accent)] active:text-[color:var(--color-ink-accent)]"
                    >
                      {t(link.label as 'nav.sitemap')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>

            {/*
             * THE PRE-ADOPTION STATEMENT.
             *
             * Stated plainly, in the visitor's language, on every public page:
             * this platform is independently developed and is not currently
             * commissioned, sponsored, adopted or deployed by Minhaj-ul-Quran
             * International (PRODUCT_SCOPE.md, *Product status and acceptance*).
             * It is a statement about the DEPLOYMENT, not a disclaimer that
             * makes the software a demo — there is no reduced build and no demo
             * mode.
             */}
            <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-ink-muted)]">
              {t('footer.preAdoption')}
            </p>
          </div>
        </div>
      </Container>
    </footer>
  );
}
