import { localizedPath } from '@minhaj/contracts';
import {
  readPage,
  publishedPageMetadata,
  PublicContent,
} from '@/components/editorial/public-content';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { peopleReadRuntime } from '@/composition/people-read';
import { ListingIntro } from '@/components/editorial/frame';
import { CardGrid, Container, TextLink } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { EXPLORE_SECTIONS, exploreSlugsOf, type ExploreSection } from '@/shell/explore';
import { requireRoute } from '@/shell/registry';
import { ExploreCard, LeaderCard } from '@/components/explore/cards';

/**
 * An Explore SECTION shell (ROUTE_MAP.md §3.2).
 *
 * THE ALLOWLIST IS THE ROUTE. `dynamicParams = false` means Next answers any
 * segment `generateStaticParams` did not produce with a 404 before this
 * component runs at all — and the component validates the segment anyway,
 * because a routing configuration is a convenience and the render tree is the
 * authority (the same rule the locale segment follows,
 * SECURITY_BASELINE.md §9.1).
 *
 * WHAT IT SHOWS (R2). Its own title and its PUBLISHED pages, each a picture-led
 * card with its own title, excerpt and lead image. A page not yet published is
 * not listed — its reserved address still answers honestly if reached — and a
 * section with nothing published renders the publication-status state and
 * points to the other sections.
 * Organisational words enter only as `Page` records through the Phase-6
 * workflow (OPEN_DECISIONS.md §6.1); none is written here.
 *
 * LEADERSHIP (Phase 30-R) has no pages of its own: it shows the founder's
 * published biography Page and every PUBLISHED People profile by portrait,
 * People's own public read.
 */

export const dynamic = 'force-dynamic';
export const dynamicParams = false;

export function generateStaticParams(): { section: ExploreSection }[] {
  return EXPLORE_SECTIONS.map((section) => ({ section }));
}

interface SectionParams {
  readonly params: Promise<{ readonly locale: string; readonly section: string }>;
}

/** Narrows the section segment, or renders 404. */
function requireSection(value: string): ExploreSection {
  if (!(EXPLORE_SECTIONS as readonly string[]).includes(value)) notFound();
  return value as ExploreSection;
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  const t = await getTranslations({ locale, namespace: 'shell' });

  const published = await publishedPageMetadata(locale, `/explore/${section}`);
  if (published) return published;

  return shellMetadata({
    locale,
    route: requireRoute(`explore.${section}`),
    title: t(`explore.${section}.title` as 'explore.about.title'),
  });
}

export default async function ExploreSectionPage({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'shell' });
  const slugs = exploreSlugsOf(section);
  const title = t(`explore.${section}.title` as 'explore.about.title');

  const [published, pages, people, profile, local] = await Promise.all([
    readPage(`/explore/${section}`),
    editorialReadRuntime().explorePages(),
    section === 'leadership'
      ? peopleReadRuntime().people.publicPeople({ locale })
      : Promise.resolve(null),
    getTranslations({ locale, namespace: 'people' }),
    getTranslations({ locale, namespace: 'exploreLanding' }),
  ]);
  if (published)
    return (
      <PublicContent
        record={published}
        locale={locale}
        path={`/explore/${section}`}
        kind="WebPage"
      />
    );

  // This section's PUBLISHED Pages, in the order the section lists them. A
  // reserved address with nothing on it is not listed (R2): it still answers,
  // honestly, if somebody reaches it, but it is not offered as a destination.
  const mine = slugs.flatMap((slug) => {
    const page = pages.find(
      (entry) => entry.routeBinding === `/explore/${section}/${slug}`,
    );
    return page === undefined ? [] : [page];
  });
  const leaders = people?.items ?? [];
  const founder =
    section === 'leadership'
      ? pages.find((page) => page.routeBinding === '/explore/shaykh-ul-islam/biography')
      : undefined;
  const nothing = mine.length === 0 && leaders.length === 0 && founder === undefined;

  return (
    <>
      <ListingIntro
        trailLabel={t('nav.breadcrumbs')}
        trail={[
          { href: localizedPath(locale, ''), text: t('nav.home') },
          { href: localizedPath(locale, '/explore'), text: t('explore.title') },
          { text: title },
        ]}
        title={title}
        lede={t(`explore.${section}.summary` as 'explore.about.summary')}
      />

      <Container>
        <div className="flex flex-col gap-10 py-[var(--space-page)]">
          {mine.length === 0 ? null : (
            <CardGrid label={title}>
              {mine.map((page, index) => (
                <ExploreCard
                  key={page.routeBinding}
                  locale={locale}
                  page={page}
                  headingLevel="h2"
                  priority={index === 0}
                />
              ))}
            </CardGrid>
          )}

          {founder === undefined ? null : (
            <CardGrid label={t('explore.shaykh-ul-islam.title')} columns={2}>
              <ExploreCard locale={locale} page={founder} headingLevel="h2" priority />
            </CardGrid>
          )}

          {leaders.length === 0 ? null : (
            <CardGrid label={title} columns={4}>
              {leaders.map((person) => (
                <LeaderCard
                  key={person.id}
                  locale={locale}
                  person={person}
                  creditLabel={profile('portraitCredit')}
                  headingLevel="h2"
                />
              ))}
            </CardGrid>
          )}

          {/* A section with nothing published is a reserved route: it says so
              in the accepted words (ROUTE_MAP.md §5.2) and points onwards. */}
          {nothing ? (
            <div className="flex flex-col items-start gap-4">
              <PublicationStatus locale={locale} />
              <TextLink href={localizedPath(locale, '/explore')}>
                {local('otherSections')}
              </TextLink>
            </div>
          ) : null}
        </div>
      </Container>
    </>
  );
}
