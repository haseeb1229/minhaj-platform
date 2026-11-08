import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { OrganisationMark } from '@/components/shell/brand-lockup';
import { BrandWordmark } from '@/components/shell/brand-wordmark';
import { Container, Icon } from '@/components/ui';
import { readPresence } from '@/composition/presence';
import { OFFICIAL_CHANNELS } from '@/shell/official-channels';
import { footerGroups, hasSignal, legalLinks, type NavItem } from '@/shell/presence';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC FOOTER (R2).
 *
 * CURATED, NOT A SITEMAP. Six columns — Quran & Knowledge, Library, Watch &
 * Listen, News & Events, About MQI, Learn & take part — drawn from the same
 * presentation policy as the header, so a link appears only when its area has
 * published content or an open service, a column with nothing to show is
 * dropped, and a legal document is linked only once it is published. The full
 * route list remains in the human-readable sitemap.
 *
 * BENEATH THE COLUMNS: the organisation's official channels (addresses taken
 * from minhaj.org itself, `@/shell/official-channels`); the attribution the
 * Quran text's licence requires, only while a reference text is what the
 * Quran pages show; and THE ONE PRE-ADOPTION STATEMENT, once, beside the
 * organisation's unmodified mark. It is not repeated in the header.
 */
export async function SiteFooter({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);

  const groups = footerGroups(presence);
  const legal = legalLinks(presence);
  const hrefOf = (item: NavItem) =>
    item.kind === 'route'
      ? pathFor(locale, requireRoute(item.route))
      : localizedPath(locale, item.binding);

  return (
    <footer className="surface-ink mt-[var(--space-section)]">
      <Container>
        <div className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,3fr)] lg:gap-16 lg:py-20">
          <div className="flex max-w-sm flex-col gap-6">
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

            <nav aria-labelledby="footer-channels" className="flex flex-col gap-2">
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

          <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[30rem]:grid-cols-2 md:grid-cols-3">
            {groups.map((group) => {
              const id = `footer-group-${group.id}`;
              return (
                <nav key={group.id} aria-labelledby={id} className="min-w-0">
                  <h2
                    id={id}
                    className="font-sans text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-ink-accent uppercase"
                  >
                    {t(`footer.groups.${group.id}` as 'footer.groups.about')}
                  </h2>
                  <ul className="mt-4 flex list-none flex-col gap-0.5 p-0">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <a
                          href={hrefOf(item)}
                          className="inline-flex min-h-10 items-center text-[0.9375rem] wrap-anywhere text-ink-foreground/90 no-underline transition-colors duration-[var(--duration-fast)] hover:text-ink-foreground hover:underline hover:underline-offset-4"
                        >
                          {t(`nav.items.${item.id}.title` as 'nav.items.about.title')}
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
          {legal.length === 0 ? null : (
            <nav aria-label={t('footer.legalHeading')}>
              <ul className="flex list-none flex-wrap gap-x-5 gap-y-1 p-0">
                {legal.map((item) => (
                  <li key={item.id}>
                    <a
                      href={hrefOf(item)}
                      className="inline-flex min-h-10 items-center text-sm text-ink-foreground underline decoration-ink-border underline-offset-4 hover:decoration-ink-accent"
                    >
                      {t(`legal.${item.id}` as 'legal.privacy')}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </Container>
    </footer>
  );
}
