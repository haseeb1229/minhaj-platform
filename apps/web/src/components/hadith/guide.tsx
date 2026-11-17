import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import {
  AwaitingPage,
  Button,
  CardGrid,
  Icon,
  LinkCard,
  PageHeading,
  SectionHeader,
  TextInput,
  TextLink,
} from '@/components/ui';
import { pathFor, requireRoute } from '@/shell/registry';
import { readHadithHubFigures, type HadithHubFigures } from './hub-figures';
import { HADITH_HUBS, type HadithHub } from './hubs';
import { HadithFrame, hadithTrail, type HadithTranslator } from './parts';
import { hadithPath } from './presentation';
import { HADITH_TOPIC_SLUG, readHadithTopic } from './read';

/**
 * THE SECTION'S GUIDE (Hadith Part 2) — what this section is and how it is
 * organised, stated the same way on the landing, the introduction and every
 * page that awaits an authorised source.
 *
 * PRODUCT DESCRIPTION, NEVER A NARRATION. Nothing here reads the Hadith
 * context's records: there is no Hadith corpus (OPEN_DECISIONS.md §1.3), so no
 * hadith text, number, chain or grading is shown or invented. What is OPEN is
 * linked — the introduction, and the hubs of other owners' material on the
 * `hadith` Topic with the figure each hub opens with (`hub-figures.ts`); what
 * awaits an activated collection is NAMED and marked so, never linked, so no
 * link leads into a page that cannot open.
 */

/** The four parts of the section, in the Hadith menu's order. */
const PARTS = Object.freeze(['read', 'study', 'explore', 'learn'] as const);
type Part = (typeof PARTS)[number];

/** The pages of the section that depend on an activated collection. */
const CORPUS_PAGES = Object.freeze({
  read: ['collections', 'browse', 'search'],
  study: ['sciences', 'commentary'],
} as const);

interface PartPage {
  readonly key: string;
  readonly text: string;
  /** Where it opens, or `null` while it awaits an activated collection. */
  readonly href: string | null;
}

/** The sections a page awaiting an authorised source can stand for. */
export type AwaitingSection =
  'collections' | 'browse' | 'search' | 'sciences' | 'commentary';

/**
 * Every page of each part, linked when it is open. The corpus pages open only
 * under an activation; the hubs and the topic hub only while there is a
 * `hadith` Topic for anything to be classified under (as the hubs' own empty
 * states say); the introduction and Learn always.
 */
function partPages(
  locale: Locale,
  t: HadithTranslator,
  active: boolean,
  topic: boolean,
): Readonly<Record<Part, readonly PartPage[]>> {
  const page = (key: string, open: boolean): PartPage => ({
    key,
    text: t(`sections.${key}` as 'sections.browse'),
    href: open ? hadithPath(locale, key) : null,
  });
  const hub = (key: HadithHub) => page(key, true);
  return {
    read: [
      page('introduction', true),
      ...CORPUS_PAGES.read.map((key) => page(key, active)),
    ],
    study: CORPUS_PAGES.study.map((key) => page(key, active)),
    explore: topic
      ? [
          hub('books'),
          hub('videos'),
          hub('research'),
          {
            key: 'topics',
            text: t('sections.topics'),
            href: localizedPath(
              locale,
              `/topics/${encodeURIComponent(HADITH_TOPIC_SLUG)}`,
            ),
          },
        ]
      : [],
    learn: [
      ...(topic ? [hub('courses')] : []),
      {
        key: 'learn',
        text: t('landing.learnAll'),
        href: pathFor(locale, requireRoute('learn')),
      },
    ],
  };
}

/**
 * HOW THIS SECTION IS ORGANISED — the four parts, each described, its open
 * pages linked and the rest named with "Opens when a collection is activated".
 */
export async function SectionMap({
  locale,
  active,
  id,
  heading,
  intro,
}: {
  readonly locale: Locale;
  readonly active: boolean;
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
}) {
  const [t, topic] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    readHadithTopic(locale),
  ]);
  const pages = partPages(locale, t, active, topic !== null);
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <SectionHeader id={id} heading={heading} intro={intro} />
      <ul className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
        {PARTS.map((part) => {
          const listed = pages[part];
          const waiting = listed.some((entry) => entry.href === null);
          return (
            <li key={part} className="flex h-full min-w-0 flex-col gap-2.5">
              <h3 className="border-b border-border pb-2 text-subheading font-semibold">
                {t(`landing.${part}`)}
              </h3>
              <p className="text-sm text-foreground-muted">{t(`parts.${part}`)}</p>
              {listed.length === 0 ? null : (
                <ul className="mt-auto flex list-none flex-col gap-1 p-0 pt-1 text-sm">
                  {listed.map((entry) => (
                    <li key={entry.key}>
                      {entry.href === null ? (
                        <span className="text-foreground-muted">{entry.text}</span>
                      ) : (
                        <TextLink href={entry.href}>{entry.text}</TextLink>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {waiting ? (
                <p className="flex items-start gap-1.5 text-caption font-medium text-foreground-muted">
                  <Icon name="info" size={16} className="mt-0.5 shrink-0" />
                  <span>{t('unavailable.awaiting')}</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * THE HUBS, OPEN NOW — one card per hub, each with the figure that hub opens
 * with (stated only when it is more than none). Absent without the Topic.
 */
export async function HubCards({
  locale,
  figures,
  introduction = false,
}: {
  readonly locale: Locale;
  readonly figures: HadithHubFigures | null;
  /** Lead with the introduction, for a page that awaits a source. */
  readonly introduction?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const stat = (hub: HadithHub, count: number) =>
    hub === 'books'
      ? t('booksHub.statBooks', { count })
      : hub === 'videos'
        ? t('videosHub.statVideos', { count })
        : hub === 'research'
          ? t('researchHub.statRecords', { count })
          : t('coursesHub.statCourses', { count });
  const icon = {
    books: 'book',
    videos: 'video',
    research: 'news',
    courses: 'calendar',
  } as const;
  return (
    <CardGrid columns={introduction ? 3 : 4}>
      {introduction ? (
        <LinkCard
          href={hadithPath(locale, 'introduction')}
          title={t('sections.introduction')}
          description={t('sectionBody.introduction')}
          eyebrow={t('landing.read')}
        />
      ) : null}
      {figures === null
        ? null
        : HADITH_HUBS.map((hub) => {
            const count = figures[hub];
            return (
              <LinkCard
                key={hub}
                href={hadithPath(locale, hub)}
                title={t(`sections.${hub}`)}
                description={t(`sectionBody.${hub}`)}
                eyebrow={t(hub === 'courses' ? 'landing.learn' : 'landing.explore')}
                {...(count > 0
                  ? {
                      meta: (
                        <p className="flex items-center gap-2 text-sm font-medium">
                          <Icon name={icon[hub]} size={16} className="text-accent" />
                          <span>
                            <span className="tabular-nums">{count}</span>{' '}
                            {stat(hub, count)}
                          </span>
                        </p>
                      ),
                    }
                  : {})}
              />
            );
          })}
    </CardGrid>
  );
}

/* ===========================================================================
 * /hadith/introduction
 * ========================================================================= */

/** What a citation page shows, in the order a reader meets it. */
const ANATOMY = Object.freeze([
  'citation',
  'structure',
  'source',
  'sourced',
  'layers',
] as const);

/**
 * `/hadith/introduction` — what the section is, how it is organised, what is
 * open now, and how to read a citation page. Product guidance only: it states
 * how the platform shows sourced material and claims nothing about any
 * narration, so it stands whether or not a collection is activated (Hadith
 * Part 2). While none is, it says so plainly, names the pages that await a
 * source without linking them, and describes the citation page as what it
 * WILL show.
 */
export async function HadithIntroductionPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const [t, parts, figures] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    hadithTrail(locale),
    readHadithHubFigures(locale),
  ]);
  const active = availability.active;
  type Heading = 'what' | 'state' | 'parts' | 'works' | 'citation';
  const sections: readonly Heading[] = [
    'what',
    ...(active ? [] : (['state'] as const)),
    'parts',
    ...(figures === null ? [] : (['works'] as const)),
    'citation',
  ];
  const id = (key: string) => `hadith-intro-${key}`;
  const heading = (key: Heading) => t(`introduction.headings.${key}`);

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: t('sections.introduction') }]}
    >
      <header className="flex flex-col gap-3 border-b border-border pb-8">
        <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
          {t('title')}
        </p>
        <PageHeading>{t('introduction.title')}</PageHeading>
        <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
          {t('introduction.lede')}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_15rem]">
        <nav
          aria-label={t('introduction.onThisPage')}
          className="min-w-0 lg:sticky lg:top-24 lg:order-last lg:self-start"
        >
          <p className="pb-2 text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-foreground-muted uppercase">
            {t('introduction.onThisPage')}
          </p>
          <ol className="flex list-none flex-col gap-1 border-s border-border p-0 ps-4 text-sm">
            {sections.map((key) => (
              <li key={key}>
                <a
                  href={`#${id(key)}`}
                  className="inline-flex min-h-11 items-center text-action underline-offset-4 hover:underline lg:min-h-9"
                >
                  {heading(key)}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-[var(--space-section)]">
          <section aria-labelledby={id('what')} className="flex flex-col gap-4">
            <h2 id={id('what')} className="scroll-mt-24 text-heading font-semibold">
              {heading('what')}
            </h2>
            <p className="reading-face max-w-[var(--measure-prose)] text-lede">
              {t('introduction.what')}
            </p>
            <p className="max-w-[var(--measure-prose)] text-foreground-muted">
              {t('introduction.whatMore')}
            </p>
          </section>

          {active ? null : (
            <section
              aria-labelledby={id('state')}
              className="flex flex-col gap-3 rounded-panel border border-accent-rule bg-accent-surface p-5 sm:p-6"
            >
              <h2
                id={id('state')}
                className="flex scroll-mt-24 items-center gap-2 text-subheading font-semibold"
              >
                <Icon name="info" size={20} className="shrink-0 text-accent" />
                <span>{heading('state')}</span>
              </h2>
              <p className="max-w-[var(--measure-prose)]">{t('introduction.state')}</p>
            </section>
          )}

          <div id={id('parts')} className="scroll-mt-24">
            <SectionMap
              locale={locale}
              active={active}
              id={`${id('parts')}-heading`}
              heading={heading('parts')}
              intro={t('introduction.partsIntro')}
            />
          </div>

          {figures === null ? null : (
            <section
              id={id('works')}
              aria-labelledby={`${id('works')}-heading`}
              className="flex scroll-mt-24 flex-col gap-5"
            >
              <SectionHeader
                id={`${id('works')}-heading`}
                heading={heading('works')}
                intro={t('introduction.worksIntro')}
              />
              <HubCards locale={locale} figures={figures} />
            </section>
          )}

          <section aria-labelledby={id('citation')} className="flex flex-col gap-5">
            <SectionHeader
              id={id('citation')}
              heading={heading('citation')}
              intro={t(
                active
                  ? 'introduction.citationIntro'
                  : 'introduction.citationIntroAwaiting',
              )}
            />
            <ol className="flex list-none flex-col p-0">
              {ANATOMY.map((key, index) => (
                <li
                  key={key}
                  className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4 border-t border-border py-5 first:border-t-0 first:pt-0"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-serif font-semibold text-accent tabular-nums"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="text-subheading font-semibold">
                      {t(`introduction.titles.${key}`)}
                    </h3>
                    <p className="max-w-[var(--measure-prose)] text-foreground-muted">
                      {t(`introduction.${key}`)}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </HadithFrame>
  );
}

/* ===========================================================================
 * The pages that await an authorised source
 * ========================================================================= */

type Query = Record<string, string | string[] | undefined>;

/** The visitor's words from `?q`, bounded, to carry into site search. */
function searchWords(query: Query | undefined): string {
  const value = query?.['q'];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.slice(0, SEARCH_QUERY_MAX_LENGTH) : '';
}

/**
 * A PAGE THAT AWAITS AN AUTHORISED SOURCE — Collections, All citations, Search
 * Hadith, Hadith sciences and Commentary while no collection is activated
 * (Hadith Part 2; replacing the Phase-19 bare unavailable state, historical).
 *
 * HONEST, AND STILL USEFUL. It names the page, says in a sentence what will
 * appear here, and says plainly that nothing is shown in its place — no
 * listing, sample, number, chain or grading. Then the ways onward that ARE
 * open: the introduction and the hubs of MQI's material on Hadith, with their
 * figures. Search does not pretend to search hadith: it offers SITE search,
 * restricted to the `hadith` Topic, which finds books, videos, research and
 * courses on Hadith and says that it does not search hadith text.
 *
 * Its shape is the shared `AwaitingPage` (`components/ui`), which Fatwa's
 * pages that await the service use too (Fatwa Part 1); the markup is
 * unchanged.
 */
export async function HadithAwaiting({
  locale,
  section,
  query,
}: {
  readonly locale: Locale;
  readonly section: AwaitingSection;
  /** The page's query, for Search to carry the visitor's words on. */
  readonly query?: Query;
}) {
  const [t, parts, topic, figures] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    hadithTrail(locale),
    readHadithTopic(locale),
    readHadithHubFigures(locale),
  ]);
  const title = t(`sections.${section}`);
  const words = searchWords(query);

  return (
    <AwaitingPage
      crumbs={{ label: parts.label, trail: [parts.home, parts.hadith, { text: title }] }}
      status={t('awaiting.status')}
      title={title}
      lede={t(`awaiting.what.${section}`)}
      notice={{
        id: 'hadith-awaiting-notice',
        title: t('awaiting.noticeTitle'),
        children: (
          <>
            <p className="max-w-[var(--measure-prose)]">{t('awaiting.notice')}</p>
            <p>
              <TextLink href={hadithPath(locale, 'introduction')}>
                {t('awaiting.howItWorks')}
              </TextLink>
            </p>
          </>
        ),
      }}
      back={<TextLink href={hadithPath(locale)}>{t('awaiting.back')}</TextLink>}
    >
      {section === 'search' ? (
        <section aria-labelledby="hadith-awaiting-search" className="flex flex-col gap-4">
          <SectionHeader
            id="hadith-awaiting-search"
            heading={t('awaiting.searchHeading')}
            intro={t('awaiting.searchIntro')}
          />
          <form
            method="get"
            action={pathFor(locale, requireRoute('search'))}
            role="search"
            aria-label={t('awaiting.searchHeading')}
            className="flex w-full max-w-2xl flex-col gap-2"
          >
            <label htmlFor="hadith-site-search" className="text-sm font-medium">
              {t('awaiting.searchLabel')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <TextInput
                  id="hadith-site-search"
                  type="search"
                  name="q"
                  defaultValue={words}
                  maxLength={SEARCH_QUERY_MAX_LENGTH}
                  autoComplete="off"
                />
              </div>
              {topic === null ? null : (
                <input type="hidden" name="topic" value={topic.slug} />
              )}
              <Button tone="secondary">{t('search.submit')}</Button>
            </div>
          </form>
        </section>
      ) : null}

      <section aria-labelledby="hadith-awaiting-open" className="flex flex-col gap-5">
        <SectionHeader
          id="hadith-awaiting-open"
          heading={t('landing.openHeading')}
          intro={t('landing.openIntro')}
        />
        <HubCards locale={locale} figures={figures} introduction />
      </section>
    </AwaitingPage>
  );
}
