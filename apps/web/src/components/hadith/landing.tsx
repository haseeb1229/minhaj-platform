import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { hadithReadRuntime } from '@/composition/hadith-read';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
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
          { key: 'topics', href: `/${locale}/topics/${encodeURIComponent(topic.slug)}` },
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

/**
 * THE LANDING WHILE NO COLLECTION IS ACTIVATED.
 *
 * It says so first and plainly, then describes how the section is organised —
 * in words, with no link into it, no number, no sample and no search, because
 * there is nothing behind any of them yet. The two parts that do not depend on
 * an activated collection point at the delivered areas that already serve them
 * (the topic hub and Learn).
 */
export async function HadithLandingUnavailable({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
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

      <PageHero
        eyebrow={t('landing.eyebrow')}
        title={t('title')}
        lede={t('unavailable.lede')}
      >
        <div className="max-w-[var(--measure-prose)]">
          <Alert tone="info">{t('unavailable.body')}</Alert>
        </div>
      </PageHero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-5" aria-labelledby="hadith-structure">
            <SectionHeader
              id="hadith-structure"
              heading={t('unavailable.structureHeading')}
              intro={t('unavailable.structureIntro')}
            />
            <ul className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-4">
              {structure.map((part) => (
                <li
                  key={part.key}
                  className="flex h-full min-w-0 flex-col gap-2.5 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
                >
                  <h3 className="text-subheading font-semibold">
                    {t(`landing.${part.key}`)}
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t(`unavailable.parts.${part.key}`)}
                  </p>
                  <p className="mt-auto pt-1 text-sm">
                    {part.href === null ? (
                      <span className="text-caption font-medium text-[color:var(--color-foreground-muted)]">
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
            <TextLink href={`/${locale}`}>{t('unavailable.home')}</TextLink>
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
