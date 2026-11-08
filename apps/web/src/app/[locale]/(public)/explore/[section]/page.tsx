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
import { CardGrid, Container, LinkCard, TextLink } from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import {
  EXPLORE_SECTIONS,
  exploreHrefOf,
  exploreSlugsOf,
  ownerPathOf,
  type ExploreSection,
} from '@/shell/explore';
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
 * WHAT IT SHOWS. Its own title and EVERY page it reserves (restored after R2,
 * owner direction 2026-11-08 — R2 had listed published pages only). Each
 * PUBLISHED Page is a picture-led card with its own title, excerpt and lead
 * image; every page not yet published follows as a plainly marked card that
 * leads to its reserved route's honest state; a page an owner delivers
 * elsewhere (the newsletter) links to that owner's page. The
 * publication-status state stands whenever something the section reserves is
 * still unpublished, so the section is never presented as complete when it is
 * not. Organisational words enter only as `Page` records through the Phase-6
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

  // Every page the section reserves, in its own order: its published Page, or
  // nothing yet. A page an owner delivers elsewhere is never a Page here.
  const entries = slugs.map((slug) => ({
    slug,
    owned: ownerPathOf(section, slug) !== null,
    page: pages.find((entry) => entry.routeBinding === `/explore/${section}/${slug}`),
  }));
  const mine = entries.flatMap(({ page }) => (page === undefined ? [] : [page]));
  const rest = entries.filter(({ page }) => page === undefined);
  const leaders = people?.items ?? [];
  const founder =
    section === 'leadership'
      ? pages.find((page) => page.routeBinding === '/explore/shaykh-ul-islam/biography')
      : undefined;
  const nothing = mine.length === 0 && leaders.length === 0 && founder === undefined;
  // Complete only when every reserved page is published (or delivered by its
  // owner), or — for a section with no pages — when it shows somebody.
  const complete =
    slugs.length > 0
      ? rest.every(({ owned }) => owned)
      : leaders.length > 0 || founder !== undefined;

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

          {/*
           * The rest of what this section reserves, as whole-card links: each
           * is a delivered route that says honestly whether it has been
           * published, or the owner's own page (the newsletter).
           */}
          {rest.length === 0 ? null : (
            <nav aria-label={title}>
              <CardGrid>
                {rest.map(({ slug, owned }) => (
                  <LinkCard
                    key={slug}
                    href={exploreHrefOf(locale, section, slug)}
                    headingLevel="h2"
                    {...(owned ? {} : { eyebrow: t('home.status.unavailable') })}
                    title={t(
                      `explore.${section}.pages.${slug}` as 'explore.about.pages.vision',
                    )}
                  />
                ))}
              </CardGrid>
            </nav>
          )}

          {/* Anything still unpublished is said in the accepted words
              (ROUTE_MAP.md §5.2); a section with nothing published at all
              also points onwards. */}
          {complete ? null : (
            <div className="flex flex-col items-start gap-4">
              <PublicationStatus locale={locale} />
              {nothing ? (
                <TextLink href={localizedPath(locale, '/explore')}>
                  {local('otherSections')}
                </TextLink>
              ) : null}
            </div>
          )}
        </div>
      </Container>
    </>
  );
}
