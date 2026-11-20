import { localizedPath, type Locale } from '@minhaj/contracts';
import type { PublicPageSummary } from '@minhaj/contracts/editorial';
import type { PublicPersonCardPage } from '@minhaj/contracts/people';
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
import {
  ActionLink,
  AwaitingPage,
  CardGrid,
  Container,
  SectionHeader,
  Stat,
  TextLink,
} from '@/components/ui';
import { PublicationStatus } from '@/components/shell/publication-status';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { EXPLORE_SECTIONS, exploreSlugsOf, type ExploreSection } from '@/shell/explore';
import { requireRoute } from '@/shell/registry';
import { ExploreCard, LeaderCard } from '@/components/explore/cards';
import {
  explorePath,
  publicationTally,
  sectionItems,
  type PublishedAddresses,
} from '@/components/explore/explore-view';
import {
  exploreTrail,
  numberIn,
  OfficialChannels,
  OnwardLinks,
  OtherSections,
  SectionPages,
  sectionTitle,
} from '@/components/explore/parts';

/**
 * An Explore SECTION (ROUTE_MAP.md §3.2).
 *
 * THE ALLOWLIST IS THE ROUTE. `dynamicParams = false` means Next answers any
 * segment `generateStaticParams` did not produce with a 404 before this
 * component runs at all — and the component validates the segment anyway,
 * because a routing configuration is a convenience and the render tree is the
 * authority (the same rule the locale segment follows,
 * SECURITY_BASELINE.md §9.1).
 *
 * A SECTION THAT RESERVES PAGES (Explore, R2) opens as a front door: its trail,
 * title and summary, how many of its pages are published (their own count),
 * the way to its first published page; its published Pages picture-led (an
 * item an owner delivers elsewhere — the newsletter — beside them); then every
 * page still to be published, each saying what it will hold; the
 * publication-status notice while anything it reserves is unpublished; the
 * open parts of the platform that already serve its reader; the official
 * channels where it names them; and the other sections. A published Page
 * bound to the section itself opens it instead, followed by the same pages.
 *
 * A LANDING-ONLY SECTION — Leadership, Community — awaits its own Page: it
 * says what the Page will hold and that it is not published, and offers what
 * IS open — for Leadership the founder's published biography and every
 * published profile (People's own public read; People records no "leadership"
 * kind, so the profiles are called what they are, published profiles, never
 * the leadership), and the open parts of the platform. Organisational words
 * enter only as `Page` records through the Phase-6 workflow
 * (OPEN_DECISIONS.md §6.1); none is written here.
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

/** The published Explore Pages, or `null` when they cannot be read (no claim either way). */
async function readExplorePages(): Promise<readonly PublicPageSummary[] | null> {
  try {
    return await editorialReadRuntime().explorePages();
  } catch {
    return null;
  }
}

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  const t = await getTranslations({ locale, namespace: 'shell' });

  const published = await publishedPageMetadata(locale, explorePath(section));
  if (published) return published;

  return shellMetadata({
    locale,
    route: requireRoute(`explore.${section}`),
    title: t(`explore.${section}.title` as 'explore.about.title'),
    description: t(`explore.${section}.summary` as 'explore.about.summary'),
  });
}

export default async function ExploreSectionPage({ params }: SectionParams) {
  const locale = await requireLocale(params);
  const section = requireSection((await params).section);
  setRequestLocale(locale);

  const [shell, t, record, pages, people] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'explore' }),
    readPage(explorePath(section)),
    readExplorePages(),
    section === 'leadership'
      ? peopleReadRuntime().people.publicPeople({ locale })
      : Promise.resolve(null),
  ]);
  const published: PublishedAddresses =
    pages === null ? null : new Set(pages.map((page) => page.routeBinding));
  const title = sectionTitle(shell, section);
  const trail = await exploreTrail(locale);
  const hasPages = exploreSlugsOf(section).length > 0;
  const founder = (pages ?? []).find(
    (page) => page.routeBinding === explorePath('shaykh-ul-islam', 'biography'),
  );

  // What the section holds beyond its own Page: its pages, or — for
  // Leadership — the founder's biography and the published profiles.
  const holdings = hasPages ? (
    <SectionPages
      locale={locale}
      section={section}
      published={published}
      pages={pages ?? []}
    />
  ) : section === 'leadership' ? (
    <LeadershipHoldings locale={locale} founder={founder} people={people} />
  ) : null;

  // The section's own published Page opens it, at the same address.
  if (record)
    return (
      <PublicContent
        record={record}
        locale={locale}
        path={explorePath(section)}
        kind="WebPage"
        trail={[{ path: '/explore', text: trail.explore.text }]}
        share
      >
        {holdings === null ? null : (
          <div className="flex min-w-0 flex-col gap-[var(--space-section)] border-t border-border pt-[var(--space-page)]">
            {holdings}
          </div>
        )}
        <OfficialChannels locale={locale} section={section} />
        <OtherSections locale={locale} current={section} />
      </PublicContent>
    );

  // A landing-only section awaits its own Page.
  if (!hasPages)
    return (
      <AwaitingPage
        crumbs={{
          label: trail.label,
          trail: [trail.home, trail.explore, { text: title }],
        }}
        status={t('status.awaiting')}
        title={title}
        lede={t(`what.${section}` as 'what.community')}
        notice={<PublicationStatus locale={locale} />}
        back={
          <TextLink href={trail.explore.href}>
            {t('back', { section: trail.explore.text })}
          </TextLink>
        }
      >
        {holdings}
        <OnwardLinks locale={locale} section={section} />
        <OtherSections locale={locale} current={section} />
      </AwaitingPage>
    );

  const items = sectionItems(section, published);
  const tally = publicationTally(items);
  const number = numberIn(locale);
  const first = items.find((item) => item.state === 'published');
  // Complete only when every page the section itself reserves is published.
  const complete = tally !== null && tally.published === tally.total;

  return (
    <>
      <ListingIntro
        trailLabel={trail.label}
        trail={[trail.home, trail.explore, { text: title }]}
        eyebrow={shell('explore.title')}
        title={title}
        lede={shell(`explore.${section}.summary` as 'explore.about.summary')}
      >
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {tally === null ? null : (
            <Stat
              value={number(tally.published)}
              label={t('figures.published', { total: number(tally.total) })}
            />
          )}
          {first === undefined ? null : (
            <ActionLink href={localizedPath(locale, explorePath(section, first.slug))}>
              {t('actions.begin')}
            </ActionLink>
          )}
        </div>
      </ListingIntro>

      <Container>
        <div className="flex min-w-0 flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {holdings}

          {/* Anything still unpublished is said in the accepted words
              (ROUTE_MAP.md §5.2). */}
          {complete ? null : <PublicationStatus locale={locale} />}

          <OnwardLinks locale={locale} section={section} />
          <OfficialChannels locale={locale} section={section} />
          <OtherSections locale={locale} current={section} />
        </div>
      </Container>
    </>
  );
}

/**
 * LEADERSHIP'S HOLDINGS — the founder's published biography, then every
 * published profile by portrait, each at its canonical `/people/{slug}`.
 */
async function LeadershipHoldings({
  locale,
  founder,
  people,
}: {
  readonly locale: Locale;
  readonly founder: PublicPageSummary | undefined;
  readonly people: PublicPersonCardPage | null;
}) {
  const [t, profile] = await Promise.all([
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'people' }),
  ]);
  const leaders = people?.items ?? [];
  if (founder === undefined && leaders.length === 0) return null;
  return (
    <>
      {founder === undefined ? null : (
        <section aria-labelledby="explore-founder" className="flex flex-col gap-5">
          <SectionHeader id="explore-founder" heading={t('leadership.founder')} />
          <CardGrid label={t('leadership.founder')} columns={2}>
            <ExploreCard locale={locale} page={founder} priority />
          </CardGrid>
        </section>
      )}
      {leaders.length === 0 ? null : (
        <section aria-labelledby="explore-profiles" className="flex flex-col gap-5">
          <SectionHeader
            id="explore-profiles"
            heading={t('profiles.heading')}
            intro={t('profiles.intro')}
            {...(people?.more === true
              ? {
                  action: {
                    href: localizedPath(locale, '/library/authors'),
                    text: t('profiles.more'),
                  },
                }
              : {})}
          />
          <CardGrid label={t('profiles.heading')} columns={4}>
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
    </>
  );
}
