import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { localizedPath } from '@minhaj/contracts';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { CardGrid, Container, Hero, SectionHeader } from '@/components/ui';
import { ExplorePanel } from '@/components/shell/explore-panel';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';
import { ExploreCard, LeaderCard } from '@/components/explore/cards';

/**
 * The Explore landing (ROUTE_MAP.md §3.2).
 *
 * A genuine navigational hub — the index of the section — which is why it is
 * `delivered` and indexing-eligible while everything beneath it is a reserved
 * shell until published.
 *
 * R2: A NARRATIVE BEFORE THE INDEX. The organisation's own published Pages
 * open the page, picture-led (the founder's biography first when published),
 * then its published leadership by portrait, then the index of every section
 * — the same panel the navigation renders, so the two cannot list different
 * things. PUBLISHED ONLY: no reserved address is listed anywhere here.
 */

/**
 * Rendered per request (Rebaseline R1): the shell promotes only areas with
 * published content, read from public evidence on every request. Nothing here
 * reads a session — the anonymous tree stays one document for every visitor.
 */
export const dynamic = 'force-dynamic';

/** How many Pages and people the landing opens with; the index lists the rest. */
const FEATURED = 3;
const LEADERS = 4;

/** The Page a visitor most needs first, when it is published. */
const FIRST = ['/explore/about/introduction', '/explore/shaykh-ul-islam/biography'];

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'shell' });

  return shellMetadata({
    locale,
    route: requireRoute('explore'),
    title: t('explore.title'),
    description: t('explore.description'),
  });
}

export default async function ExplorePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  setRequestLocale(locale);

  const [t, local, profile, pages, people] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'exploreLanding' }),
    getTranslations({ locale, namespace: 'people' }),
    editorialReadRuntime().explorePages(),
    peopleReadRuntime().people.publicPeople({ locale }),
  ]);

  // The organisation's own Pages, the ones a visitor needs first leading, and
  // pictured Pages before text-only ones; never a reserved address.
  const rank = (binding: string) => {
    const index = FIRST.indexOf(binding);
    return index === -1 ? FIRST.length : index;
  };
  const featured = [...pages]
    .filter((page) => page.routeBinding.split('/').length > 3)
    .sort(
      (a, b) =>
        rank(a.routeBinding) - rank(b.routeBinding) ||
        Number(b.leadImage != null) - Number(a.leadImage != null),
    )
    .slice(0, FEATURED);
  const leaders = people.items.slice(0, LEADERS);

  return (
    <>
      <Hero title={t('explore.title')} lede={local('lede')} />
      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {featured.length === 0 ? null : (
            <section aria-labelledby="explore-featured" className="flex flex-col gap-5">
              <SectionHeader id="explore-featured" heading={local('featured')} />
              <CardGrid label={local('featured')}>
                {featured.map((page, index) => (
                  <ExploreCard
                    key={page.routeBinding}
                    locale={locale}
                    page={page}
                    priority={index === 0}
                  />
                ))}
              </CardGrid>
            </section>
          )}

          {leaders.length === 0 ? null : (
            <section aria-labelledby="explore-leadership" className="flex flex-col gap-5">
              <SectionHeader
                id="explore-leadership"
                heading={t('explore.leadership.title')}
                action={{
                  href: localizedPath(locale, '/explore/leadership'),
                  text: local('allLeadership'),
                }}
              />
              <CardGrid label={t('explore.leadership.title')} columns={4}>
                {leaders.map((person) => (
                  <LeaderCard
                    key={person.id}
                    locale={locale}
                    person={person}
                    creditLabel={profile('portraitCredit')}
                  />
                ))}
              </CardGrid>
            </section>
          )}

          <section aria-labelledby="explore-sections" className="flex flex-col gap-5">
            <SectionHeader id="explore-sections" heading={local('sections')} />
            <ExplorePanel locale={locale} />
          </section>
        </div>
      </Container>
    </>
  );
}
