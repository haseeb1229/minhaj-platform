import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { WorkCard } from '@/components/library/cards';
import { CoverStack, LibraryShelf } from '@/components/library/landing';
import {
  ActionLink,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  Hero,
  Icon,
  LinkCard,
  PageHeading,
  PageHero,
  Prose,
  SectionHeader,
  TextInput,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { pathFor, requireRoute } from '@/shell/registry';
import { FixtureNotice, HadithFrame, hadithTrail } from './parts';
import { collectionName, collectionPath, hadithPath } from './presentation';
import { readCollections, readHadithTopic } from './read';
import { RELATED_KINDS } from './related';

/**
 * `/hadith` and `/hadith/introduction` (ROUTE_MAP.md §3.4).
 *
 * A KNOWLEDGE LANDING, NOT A SHOWCASE, AND COLLECTIONS FIRST. It opens with the
 * way in — the collections, or a search — then lists the public collections
 * themselves, and then the section's other parts: browsing and study, what the
 * rest of the platform classifies under Hadith, and courses. A study page, the
 * commentary or a related view is listed ONLY when there is something public
 * behind it. No statistics, no featured narration, no "coming soon".
 */

interface Entry {
  readonly key: string;
  readonly href: string;
}

/** One part of the section: its header and a rail of whole-card links. */
function EntryRail({
  id,
  heading,
  intro,
  entries,
  columns,
  title,
  body,
  action,
}: {
  readonly id: string;
  readonly heading: string;
  readonly intro: string;
  readonly entries: readonly Entry[];
  readonly columns: 2 | 3 | 4;
  readonly title: (key: string) => string;
  readonly body: (key: string) => string;
  readonly action?: { readonly href: string; readonly text: string };
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={id}>
      <SectionHeader
        id={id}
        heading={heading}
        intro={intro}
        {...(action === undefined ? {} : { action })}
      />
      <CardGrid columns={columns}>
        {entries.map((entry) => (
          <LinkCard
            key={entry.key}
            href={entry.href}
            title={title(entry.key)}
            description={body(entry.key)}
          />
        ))}
      </CardGrid>
    </section>
  );
}

export async function HadithLandingPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const reader = hadithReadRuntime().reader;
  const [collections, sciences, commentaries, topic] = await Promise.all([
    readCollections(),
    reader.sciences(),
    reader.commentaries(),
    readHadithTopic(locale),
  ]);

  const section = (key: string): Entry => ({ key, href: hadithPath(locale, key) });
  const study = [
    section('browse'),
    section('introduction'),
    ...(sciences.length > 0 ? [section('sciences')] : []),
    ...(commentaries.length > 0 ? [section('commentary')] : []),
  ];
  const explore =
    topic === null
      ? []
      : [
          ...RELATED_KINDS.filter((kind) => kind !== 'courses').map(section),
          {
            key: 'topics',
            href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
          },
        ];
  const learn = topic === null ? [] : [section('courses')];
  const title = (key: string) => t(`sections.${key}` as 'sections.browse');
  const body = (key: string) => t(`sectionBody.${key}` as 'sectionBody.browse');

  return (
    <>
      <Container>
        <div className="flex flex-col gap-4 pt-6">
          <FixtureNotice locale={locale} availability={availability} />
          <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
        </div>
      </Container>

      <PageHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={t('intro')}
        actions={
          <ActionLink href={hadithPath(locale, 'collections')}>
            {t('sections.collections')}
          </ActionLink>
        }
      >
        <form
          method="get"
          action={hadithPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex w-full max-w-2xl flex-col gap-2 pt-2"
        >
          <label htmlFor="hadith-landing-search" className="text-sm font-medium">
            {t('search.label')}
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <TextInput
                id="hadith-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            <Button tone="secondary">{t('search.submit')}</Button>
          </div>
        </form>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {collections.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="hadith-collections">
              <SectionHeader
                id="hadith-collections"
                heading={t('landing.collections')}
                intro={t('landing.collectionsIntro')}
                action={{
                  href: hadithPath(locale, 'collections'),
                  text: t('landing.collectionsAll'),
                }}
              />
              <CardGrid columns={3}>
                {collections.map((collection) => {
                  const name = collectionName(collection.names, locale);
                  return (
                    <LinkCard
                      key={collection.id}
                      href={collectionPath(locale, collection.slug)}
                      title={name === null ? collection.slug : name.text}
                      {...(name === null
                        ? {}
                        : {
                            lang: name.locale,
                            dir: directionOf(name.locale),
                            ...(name.description === null
                              ? {}
                              : { description: name.description }),
                          })}
                    />
                  );
                })}
              </CardGrid>
            </section>
          )}

          <EntryRail
            id="hadith-study"
            heading={t('landing.study')}
            intro={t('landing.studyIntro')}
            entries={study}
            columns={study.length === 4 ? 4 : 3}
            title={title}
            body={body}
          />
          <EntryRail
            id="hadith-explore"
            heading={t('landing.explore')}
            intro={t('landing.exploreIntro')}
            entries={explore}
            columns={4}
            title={title}
            body={body}
          />
          <EntryRail
            id="hadith-learn"
            heading={t('landing.learn')}
            intro={t('landing.learnIntro')}
            entries={learn}
            columns={2}
            title={title}
            body={body}
            action={{
              href: pathFor(locale, requireRoute('learn')),
              text: t('landing.learnAll'),
            }}
          />
        </div>
      </Container>
    </>
  );
}

/** How many hadith works the landing's shelf shows; the rest are a link away. */
const WORKS_SHELF = 12;

/**
 * THE LANDING WHILE NO COLLECTION IS ACTIVATED — MQI's HADITH WORKS (R2).
 *
 * Owner decision (2026-11-06): no external hadith corpus is taken in, and MQI
 * has no structured one to migrate, so the section presents what Minhaj-ul-
 * Quran itself publishes on hadith — the Library's public works classified
 * under the `hadith` Topic — as a shelf of covers, with a short word on the
 * hadith sciences. ONE calm sentence says the collections reader awaits an
 * authorised source; there is no disclaimer wall, no count and no link into
 * a part of the section that is not open. Every work links to its own Library
 * page, and "all" to the Library's own listing for the Topic.
 *
 * Below it, HOW THE SECTION IS ORGANISED: the collections and their study,
 * each described and marked as opening once a collection is activated — words
 * only, never a link into a part that is not open — and exploring and
 * learning, linked to the delivered areas that already serve them (the topic
 * hub, Learn). Then the way back home.
 *
 * With no such work (or no Topic) the shelf is simply absent.
 */
export async function HadithLandingUnavailable({ locale }: { readonly locale: Locale }) {
  const [t, parts, topic] = await Promise.all([
    getTranslations({ locale, namespace: 'hadith' }),
    hadithTrail(locale),
    readHadithTopic(locale),
  ]);
  const works =
    topic === null
      ? []
      : (await libraryReadRuntime().works({ topic: topic.id, offset: 0 })).items;
  const shelf = [
    ...works.filter((work) => work.cover !== null),
    ...works.filter((work) => work.cover === null),
  ].slice(0, WORKS_SHELF);
  const structure = [
    { key: 'collections', href: null },
    { key: 'study', href: null },
    { key: 'explore', href: pathFor(locale, requireRoute('topics')) },
    { key: 'learn', href: pathFor(locale, requireRoute('learn')) },
  ] as const;

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={parts.label} trail={[parts.home, { text: t('title') }]} />
        </div>
      </Container>

      <Hero
        variant="split"
        title={t('title')}
        lede={t('works.lede')}
        aside={<CoverStack works={shelf} />}
      >
        <p className="flex max-w-[var(--measure-prose)] items-start gap-2 text-sm text-foreground-muted">
          <Icon name="book" size={16} className="mt-1 text-accent" />
          <span>{t('works.awaiting')}</span>
        </p>
      </Hero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          {topic === null || shelf.length === 0 ? null : (
            <LibraryShelf
              id="hadith-works"
              heading={t('works.shelf')}
              action={{
                href: localizedPath(
                  locale,
                  `/library/books?topic=${encodeURIComponent(topic.id)}`,
                ),
                text: t('works.shelfAll'),
              }}
              previousLabel={t('works.showPrevious')}
              nextLabel={t('works.showNext')}
            >
              {shelf.map((work) => (
                <WorkCard key={work.id} locale={locale} work={work} />
              ))}
            </LibraryShelf>
          )}

          <section
            aria-labelledby="hadith-about"
            className="grid grid-cols-1 gap-x-10 gap-y-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]"
          >
            <h2 id="hadith-about" className="text-heading font-semibold text-balance">
              {t('works.aboutHeading')}
            </h2>
            <p className="reading-face max-w-[var(--measure-prose)] text-lede">
              {t('works.about')}
            </p>
          </section>

          <section className="flex flex-col gap-5" aria-labelledby="hadith-structure">
            <SectionHeader
              id="hadith-structure"
              heading={t('unavailable.structureHeading')}
              intro={t('unavailable.structureIntro')}
            />
            <ul className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
              {structure.map((part) => (
                <li key={part.key} className="flex h-full min-w-0 flex-col gap-2.5">
                  <h3 className="border-b border-border pb-2 text-subheading font-semibold">
                    {t(`landing.${part.key}`)}
                  </h3>
                  <p className="text-sm text-foreground-muted">
                    {t(`unavailable.parts.${part.key}`)}
                  </p>
                  <p className="mt-auto pt-1 text-sm">
                    {part.href === null ? (
                      <span className="text-caption font-medium text-foreground-muted">
                        {t('unavailable.awaiting')}
                      </span>
                    ) : (
                      <TextLink href={part.href}>
                        {t(`unavailable.go.${part.key}`)}
                      </TextLink>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <p>
            <TextLink href={localizedPath(locale, '')}>{t('unavailable.home')}</TextLink>
          </p>
        </div>
      </Container>
    </>
  );
}

/** The introduction's paragraphs, in reading order. */
const INTRODUCTION = Object.freeze([
  'structure',
  'citation',
  'source',
  'sourced',
  'layers',
] as const);

/**
 * `/hadith/introduction` — how this section is organised and what each part of
 * a citation page is. Product guidance only: it states how the platform shows
 * sourced material and claims nothing about any narration.
 */
export async function HadithIntroductionPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const title = t('sections.introduction');
  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <Prose>
        <PageHeading>{title}</PageHeading>
        {INTRODUCTION.map((key) => (
          <p key={key}>{t(`introduction.${key}`)}</p>
        ))}
        <p>
          <TextLink href={hadithPath(locale, 'collections')}>
            {t('sections.collections')}
          </TextLink>
        </p>
      </Prose>
    </HadithFrame>
  );
}
