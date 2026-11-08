import type { Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { OrganisationMark } from '@/components/shell/brand-lockup';
import { BrandWordmark } from '@/components/shell/brand-wordmark';
import { Container, Icon } from '@/components/ui';
import { readPresence } from '@/composition/presence';
import { footerColumns, footerUtility } from '@/shell/menus';
import { OFFICIAL_CHANNELS } from '@/shell/official-channels';
import { hasSignal } from '@/shell/presence';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC FOOTER — "the comprehensive index that the mega menus
 * deliberately are not" (INFORMATION_ARCHITECTURE.md §4).
 *
 * SIX COLUMNS, ALWAYS (owner direction 2026-11-08), from `@/shell/menus`:
 * About Minhaj-ul-Quran, Knowledge, Library and Media, Learn and Participate,
 * Our Work, and Global and Contact. Every link is a registry route that
 * answers today; a reserved Explore or Volunteer page is linked too, and says
 * honestly that nothing is published there yet. Each column is a named
 * navigation list under a real `h2`, so a screen-reader user can move between
 * them by heading.
 *
 * BENEATH THE COLUMNS: the attribution the Quran text's licence requires,
 * only while a reference text is what the Quran pages show; THE ONE
 * PRE-ADOPTION STATEMENT, beside the organisation's unmodified mark; and the
 * legal documents and the human sitemap, always.
 *
 * BESIDE THE BRAND: the organisation's official channels (addresses taken
 * from minhaj.org itself, `@/shell/official-channels`). The language switcher
 * is not repeated here; it is in the header on every page.
 */
export async function SiteFooter({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);

  const columns = footerColumns();
  const utility = footerUtility();

  return (
    <footer className="surface-ink mt-[var(--space-section)]">
      <Container>
        <div className="flex flex-col gap-12 py-14 lg:py-20">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between lg:gap-16">
            <div className="flex max-w-sm flex-col gap-5">
              <a
                href={pathFor(locale, requireRoute('home'))}
                className="inline-flex min-h-11 w-fit items-center rounded-control no-underline"
              >
                <BrandWordmark tone="ink" />
                <span className="sr-only"> — {t('nav.home')}</span>
              </a>
              <p className="text-sm leading-relaxed text-ink-muted">
                {t('footer.description')}
              </p>
            </div>

            <nav
              aria-labelledby="footer-channels"
              className="flex max-w-xl flex-col gap-2"
            >
              <h2
                id="footer-channels"
                className="font-sans text-caption font-semibold text-ink-accent"
              >
                {t('footer.channels')}
              </h2>
              <p className="text-caption text-ink-muted">{t('footer.channelsIntro')}</p>
              <ul className="flex list-none flex-wrap gap-x-4 gap-y-0.5 p-0">
                {OFFICIAL_CHANNELS.map((channel) => (
                  <li key={channel.id}>
                    <a
                      href={channel.href}
                      rel="external noopener noreferrer"
                      lang="en"
                      className="inline-flex min-h-10 items-center gap-1.5 text-sm text-ink-foreground/90 no-underline transition-colors duration-[var(--duration-fast)] hover:text-ink-foreground hover:underline hover:underline-offset-4"
                    >
                      {channel.name}
                      <Icon name="external" size={16} className="text-ink-muted" />
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          <div className="grid grid-cols-1 gap-x-8 gap-y-10 border-t border-ink-border pt-10 min-[30rem]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {columns.map((column, index) => {
              const id = `footer-column-${String(index)}`;
              return (
                <nav key={column.heading} aria-labelledby={id} className="min-w-0">
                  <h2
                    id={id}
                    // Two lines at six columns, so every list starts on one line.
                    className="font-sans text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-ink-accent uppercase xl:min-h-[2lh]"
                  >
                    {t(column.heading as 'footer.columns.about')}
                  </h2>
                  <ul className="mt-4 flex list-none flex-col p-0">
                    {column.links.map((link) => (
                      <li key={link.key}>
                        <a
                          href={pathFor(locale, link.route)}
                          className="inline-flex min-h-9 items-center text-sm wrap-anywhere text-ink-foreground/90 no-underline transition-colors duration-[var(--duration-fast)] hover:text-ink-foreground hover:underline hover:underline-offset-4"
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
        </div>

        {hasSignal(presence, 'quranReference') ? (
          <p className="border-t border-ink-border py-5 text-caption text-ink-muted">
            {t('footer.quranAttribution')}
          </p>
        ) : null}

        <div className="flex flex-col gap-6 border-t border-ink-border py-8 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-5">
            <span className="inline-flex w-fit rounded-control bg-surface-raised px-3 py-2">
              <OrganisationMark />
            </span>
            <p className="max-w-xl text-sm text-ink-muted">{t('footer.preAdoption')}</p>
          </div>
          <nav aria-label={t('footer.legalHeading')}>
            <ul className="flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
              {utility.map((link) => (
                <li key={link.key}>
                  <a
                    href={pathFor(locale, link.route)}
                    className="inline-flex min-h-10 items-center text-sm text-ink-foreground underline decoration-ink-border underline-offset-4 hover:decoration-ink-accent"
                  >
                    {t(link.label as 'nav.sitemap')}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
