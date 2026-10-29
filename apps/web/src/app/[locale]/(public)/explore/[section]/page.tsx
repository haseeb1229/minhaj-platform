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
import { ExplorePageCard, exploreSectionOf } from '@/components/editorial/page-card';
import { PersonCard } from '@/components/people/person-card';
import { CardGrid, Container, LinkCard } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import {
  EXPLORE_SECTIONS,
  exploreHrefOf,
  exploreSlugsOf,
  type ExploreSection,
} from '@/shell/explore';
import { requireRoute } from '@/shell/registry';

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
 * WHAT IT SHOWS. Its own title and its pages: each PUBLISHED Page as a card with
 * its own title, excerpt and lead image, and every page not yet published as a
 * plainly marked reserved link — so the section is never presented as complete
 * when it is not. Organisational words enter only as `Page` records through
 * the Phase-6 workflow (OPEN_DECISIONS.md §6.1); none is written here.
 *
 * LEADERSHIP (Phase 30-R) has no pages of its own: it shows the founder's
 * published biography Page and every PUBLISHED People profile, People's own
 * public read. The publication-status state stands whenever something the
 * section reserves is still unpublished.
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

  const [published, pages, people, profile] = await Promise.all([
    readPage(`/explore/${section}`),
    editorialReadRuntime().explorePages(),
    section === 'leadership'
      ? peopleReadRuntime().people.publicPeople({ locale })
      : Promise.resolve(null),
    getTranslations({ locale, namespace: 'people' }),
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

  // This section's published Pages, by the page slug of their binding.
  const mine = pages.filter((page) => exploreSectionOf(page.routeBinding) === section);
  const pageAt = (slug: string) =>
    mine.find((page) => page.routeBinding === `/explore/${section}/${slug}`);
  const leaders = people?.items ?? [];
  const founder =
    section === 'leadership'
      ? pages.find((page) => page.routeBinding === '/explore/shaykh-ul-islam/biography')
      : undefined;
  // Complete only when every reserved page is published, or — for a section
  // with no pages — when it shows somebody.
  const complete =
    slugs.length > 0
      ? slugs.every((slug) => pageAt(slug) !== undefined)
      : leaders.length > 0 || founder !== undefined;

  return (
    <>
      <ListingIntro
        trailLabel={t('nav.breadcrumbs')}
        trail={[
          { href: `/${locale}`, text: t('nav.home') },
          { href: `/${locale}/explore`, text: t('explore.title') },
          { text: title },
        ]}
        title={title}
        lede={t(`explore.${section}.summary` as 'explore.about.summary')}
      />

      <Container>
        <div className="flex flex-col gap-10 py-[var(--space-page)]">
          {/*
           * The pages this section reserves, as whole-card links. Each one is a
           * delivered route that says honestly whether it has been published.
           */}
          {slugs.length === 0 ? null : (
            <nav aria-label={title}>
              <CardGrid>
                {slugs.map((slug) => {
                  const page = pageAt(slug);
                  return page === undefined ? (
                    <LinkCard
                      key={slug}
                      href={exploreHrefOf(locale, section, slug)}
                      headingLevel="h2"
                      eyebrow={t('home.status.unavailable')}
                      title={t(
                        `explore.${section}.pages.${slug}` as 'explore.about.pages.vision',
                      )}
                    />
                  ) : (
                    <ExplorePageCard
                      key={slug}
                      locale={locale}
                      page={page}
                      headingLevel="h2"
                    />
                  );
                })}
              </CardGrid>
            </nav>
          )}

          {leaders.length === 0 && founder === undefined ? null : (
            <CardGrid label={title}>
              {founder === undefined ? null : (
                <ExplorePageCard
                  locale={locale}
                  page={founder}
                  eyebrow={t('explore.shaykh-ul-islam.title')}
                  headingLevel="h2"
                />
              )}
              {leaders.map((person) => (
                <PersonCard
                  key={person.id}
                  locale={locale}
                  person={person}
                  creditLabel={profile('portraitCredit')}
                  headingLevel="h2"
                />
              ))}
            </CardGrid>
          )}

          {complete ? null : <PublicationStatus locale={locale} />}
        </div>
      </Container>
    </>
  );
}
