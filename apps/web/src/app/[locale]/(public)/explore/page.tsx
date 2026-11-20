import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { localizedPath } from '@minhaj/contracts';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { peopleReadRuntime } from '@/composition/people-read';
import {
  ActionLink,
  CardGrid,
  Container,
  PageHero,
  SectionHeader,
  Stat,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';
import { EXPLORE_SECTIONS } from '@/shell/explore';
import { ExploreCard, LeaderCard } from '@/components/explore/cards';
import { exploreTally } from '@/components/explore/explore-view';
import { numberIn, SectionIndex } from '@/components/explore/parts';

/**
 * The Explore landing (ROUTE_MAP.md §3.2) — the organisation's front door.
 *
 * A genuine navigational hub — the index of the section — which is why it is
 * `delivered` and indexing-eligible while everything beneath it is a reserved
 * shell until published.
 *
 * IN THE ORDER A VISITOR NEEDS IT (Explore, R2): who Minhaj-ul-Quran is and
 * how much of its own account is published so far (the figures are the
 * published Pages' own count, over every page the sections reserve); its
 * published Pages, picture-led — the one a visitor needs first (the
 * introduction, else the founder's biography) beside the opening words when it
 * has a picture, and the first way in either way; the
 * published profiles by portrait (People records no "leadership" kind, so they
 * are called what they are); then the index of every section and every
 * page it reserves, each page marked published or awaiting publication (the
 * whole index since the owner's direction of 2026-11-08). Organisational
 * words come only from published Pages; nothing here states one.
 */

/**
 * Rendered per request (Rebaseline R1): the shell promotes only areas with
 * published content, read from public evidence on every request. Nothing here
 * reads a session — the anonymous tree stays one document for every visitor.
 */
export const dynamic = 'force-dynamic';

/** How many Pages the cards show, and how many people. */
const FEATURED = 3;
const LEADERS = 4;

/**
 * One content read, failing closed: a runtime that cannot be composed (it
 * throws before any promise exists) and a read that rejects both answer
 * `fallback`, so only what depends on it is withheld.
 */
async function orElse<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch {
    return fallback;
  }
}

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

  // FAIL CLOSED, SECTION BY SECTION: Explore is the organisation's front door
  // and its index of sections renders from code alone, so a content read that
  // fails hides only what depends on it (as the shell's presence snapshot
  // does) — a failed Pages read claims no status and no count, never a
  // section "awaiting" that may be published.
  const [t, local, profile, pages, people] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'explore' }),
    getTranslations({ locale, namespace: 'people' }),
    orElse(() => editorialReadRuntime().explorePages(), null),
    orElse(() => peopleReadRuntime().people.publicPeople({ locale }), {
      items: [],
      more: false,
    }),
  ]);
  const published =
    pages === null ? null : new Set(pages.map((page) => page.routeBinding));
  const tally = exploreTally(published);
  const number = numberIn(locale);

  // The organisation's own Pages, the ones a visitor needs first leading, and
  // pictured Pages before text-only ones; never a reserved address. A section
  // landing's own Page opens its section rather than standing here.
  const rank = (binding: string) => {
    const index = FIRST.indexOf(binding);
    return index === -1 ? FIRST.length : index;
  };
  const ordered = [...(pages ?? [])]
    .filter((page) => page.routeBinding.split('/').length > 3)
    .sort(
      (a, b) =>
        rank(a.routeBinding) - rank(b.routeBinding) ||
        Number(b.leadImage != null) - Number(a.leadImage != null),
    );
  // The page a visitor needs first leads the way in; it stands beside the
  // opening words only with its own picture, otherwise among the cards.
  const lead = ordered[0];
  const aside = lead?.leadImage == null ? undefined : lead;
  const featured = ordered.filter((page) => page !== aside).slice(0, FEATURED);
  const leaders = people.items.slice(0, LEADERS);

  return (
    <>
      <PageHero
        eyebrow={local('eyebrow')}
        title={t('explore.title')}
        lede={local('lede')}
        actions={
          <>
            <ActionLink
              href={localizedPath(
                locale,
                lead === undefined ? '/explore/about' : lead.routeBinding,
              )}
            >
              {lead === undefined ? local('actions.about') : local('actions.lead')}
            </ActionLink>
            <ActionLink
              href={localizedPath(locale, '/explore/our-work')}
              tone="secondary"
            >
              {local('actions.work')}
            </ActionLink>
          </>
        }
        {...(aside === undefined
          ? {}
          : {
              aside: <ExploreCard locale={locale} page={aside} priority as="div" />,
            })}
      >
        <div className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
          <Stat
            value={number(EXPLORE_SECTIONS.length)}
            label={local('figures.sections', { count: EXPLORE_SECTIONS.length })}
          />
          {tally === null ? null : (
            <Stat
              value={number(tally.published)}
              label={local('figures.published', { total: number(tally.total) })}
            />
          )}
          {people.items.length === 0 ? null : (
            <Stat
              value={
                people.more
                  ? `${number(people.items.length)}+`
                  : number(people.items.length)
              }
              label={local('figures.profiles', { count: people.items.length })}
              href={localizedPath(locale, '/explore/leadership')}
            />
          )}
        </div>
      </PageHero>
      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {featured.length === 0 ? null : (
            <section aria-labelledby="explore-featured" className="flex flex-col gap-5">
              <SectionHeader id="explore-featured" heading={local('featured')} />
              <CardGrid label={local('featured')}>
                {featured.map((page) => (
                  <ExploreCard key={page.routeBinding} locale={locale} page={page} />
                ))}
              </CardGrid>
            </section>
          )}

          {leaders.length === 0 ? null : (
            <section aria-labelledby="explore-profiles" className="flex flex-col gap-5">
              <SectionHeader
                id="explore-profiles"
                heading={local('profiles.heading')}
                action={{
                  href: localizedPath(locale, '/explore/leadership'),
                  text: local('profiles.all'),
                }}
              />
              <CardGrid label={local('profiles.heading')} columns={4}>
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
            <SectionHeader
              id="explore-sections"
              heading={local('sections')}
              intro={local('sectionsIntro')}
            />
            <SectionIndex locale={locale} published={published} />
          </section>
        </div>
      </Container>
    </>
  );
}
