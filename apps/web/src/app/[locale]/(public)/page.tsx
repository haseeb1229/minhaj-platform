import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Container, Panel, Prose } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { EXPLORE_SECTIONS } from '@/shell/explore';
import { PRODUCT_NAME } from '@/shell/product';
import { requireRoute } from '@/shell/registry';

/**
 * THE HOME SHELL — and a shell is exactly what it is.
 *
 * It presents the product, the navigation and the areas that exist. It presents
 * NO organisational content: no mission, no vision, no history, no leadership,
 * no impact figures, no testimonials, no awards, no Quran or Hadith excerpt, no
 * news, no campaign. Every one of those is either an organisational fact Minhaj
 * owns and publishes through the Phase-6 `Page` workflow (OPEN_DECISIONS.md
 * §6.1) or content belonging to a domain that has not shipped. Inventing any of
 * it to make a homepage look finished is the single most tempting failure this
 * phase has, and the page is written so there is nowhere for it to go.
 *
 * EVERY LINK RESOLVES. The section cards are built from the Explore allowlist
 * the routes validate against, so a card and its route cannot disagree.
 *
 * Statically renderable: route parameters and the message catalogue, nothing
 * request-scoped and nothing session-derived (ARCHITECTURE.md §8.1).
 */

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'shell' });

  // No `title`: the home page's title IS the product name, which the root
  // layout already supplies as the default.
  return shellMetadata({
    locale,
    route: requireRoute('home'),
    description: t('home.description'),
  });
}

export default async function HomePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });

  return (
    <Container>
      <div className="flex flex-col gap-12 py-12">
        <section className="flex flex-col gap-5">
          <Prose>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              <span lang="en">{PRODUCT_NAME}</span>
            </h1>
            <p className="text-lg">{t('home.lede')}</p>
            <p className="text-[color:var(--color-foreground-muted)]">
              {t('home.buildStatus')}
            </p>
          </Prose>

          <div>
            <a
              href={`/${locale}/explore`}
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] bg-[color:var(--color-action)] px-5 py-2 text-sm font-medium text-[color:var(--color-action-foreground)] no-underline hover:bg-[color:var(--color-action-hover)]"
            >
              {t('home.exploreAction')}
            </a>
          </div>
        </section>

        <section aria-labelledby="home-explore" className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <h2 id="home-explore" className="text-2xl font-semibold tracking-tight">
              {t('home.exploreHeading')}
            </h2>
            <p className="max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]">
              {t('home.exploreIntro')}
            </p>
          </div>

          <ul className="grid list-none grid-cols-1 gap-4 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {EXPLORE_SECTIONS.map((section) => (
              <Panel as="li" key={section}>
                <h3 className="text-base font-semibold">
                  <a
                    href={`/${locale}/explore/${section}`}
                    className="underline underline-offset-2"
                  >
                    {t(`explore.${section}.title` as 'explore.about.title')}
                  </a>
                </h3>
                <p className="mt-1.5 text-sm text-[color:var(--color-foreground-muted)]">
                  {t(`explore.${section}.summary` as 'explore.about.summary')}
                </p>
              </Panel>
            ))}
          </ul>
        </section>

        {/*
         * THE ACCOUNT ENTRY POINT, described rather than personalised.
         *
         * It says what an account is for and links to it. It does NOT say
         * whether anybody is signed in, because this page is one cached
         * document served to every visitor and a greeting here would be
         * somebody else's (ARCHITECTURE.md §8.1).
         */}
        <section aria-labelledby="home-account">
          <Panel>
            <h2 id="home-account" className="text-xl font-semibold tracking-tight">
              {t('home.accountHeading')}
            </h2>
            <p className="mt-2 max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
              {t('home.accountBody')}
            </p>
            <p className="mt-3">
              <a href={`/${locale}/my`} className="underline underline-offset-2">
                {t('nav.myMinhaj')}
              </a>
            </p>
          </Panel>
        </section>
      </div>
    </Container>
  );
}
