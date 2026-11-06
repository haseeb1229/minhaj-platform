import { localizedPath, type Locale } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { OrganisationMark } from '@/components/shell/brand-lockup';
import { BrandWordmark } from '@/components/shell/brand-wordmark';
import { Container } from '@/components/ui';
import { readPresence } from '@/composition/presence';
import { footerGroups, legalLinks, type FooterLink } from '@/shell/presence';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * THE PUBLIC FOOTER (Rebaseline R1).
 *
 * DELIBERATE, NOT A SITEMAP. Three short groups — discover, the organisation,
 * take part — drawn from the same presentation policy as the header, so a link
 * appears only when its area has published content or an open service, and a
 * legal document only once it is published. The full route list remains in the
 * human-readable sitemap.
 *
 * THE ONE PRE-ADOPTION STATEMENT lives here, once, beside the organisation's
 * unmodified mark: the platform is independently developed and not an official
 * service of Minhaj-ul-Quran International. It is not repeated in the header.
 */
export async function SiteFooter({ locale }: { readonly locale: Locale }) {
  const [t, presence] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    readPresence(),
  ]);

  const groups = footerGroups(presence);
  const legal = legalLinks(presence);
  const hrefOf = (link: FooterLink) =>
    link.kind === 'route'
      ? pathFor(locale, requireRoute(link.route))
      : localizedPath(locale, link.binding);

  return (
    <footer className="surface-ink mt-[var(--space-section)]">
      <Container>
        <div className="grid grid-cols-1 gap-12 py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:gap-16 lg:py-20">
          <div className="flex max-w-sm flex-col gap-4">
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

          <div className="grid grid-cols-1 gap-x-8 gap-y-10 min-[30rem]:grid-cols-2 md:grid-cols-3">
            {groups.map((group, index) => {
              const id = `footer-group-${String(index)}`;
              return (
                <nav key={group.heading} aria-labelledby={id} className="min-w-0">
                  <h2
                    id={id}
                    className="font-sans text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-ink-accent uppercase"
                  >
                    {t(group.heading as 'footer.groups.discover')}
                  </h2>
                  <ul className="mt-4 flex list-none flex-col gap-0.5 p-0">
                    {group.links.map((link) => (
                      <li key={hrefOf(link)}>
                        <a
                          href={hrefOf(link)}
                          className="inline-flex min-h-10 items-center text-[0.9375rem] wrap-anywhere text-ink-foreground/90 no-underline transition-colors duration-[var(--duration-fast)] hover:text-ink-foreground hover:underline hover:underline-offset-4"
                        >
                          {t(link.label as 'nav.about')}
                        </a>
                      </li>
                    ))}
                  </ul>
                </nav>
              );
            })}
          </div>
        </div>

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
                {legal.map((link) => (
                  <li key={hrefOf(link)}>
                    <a
                      href={hrefOf(link)}
                      className="inline-flex min-h-10 items-center text-sm text-ink-foreground underline decoration-ink-border underline-offset-4 hover:decoration-ink-accent"
                    >
                      {t(link.label as 'legal.privacy')}
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
