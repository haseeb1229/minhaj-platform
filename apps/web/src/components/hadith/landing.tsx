import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';
import { SEARCH_QUERY_MAX_LENGTH } from '@minhaj/contracts/search';

import { hadithReadRuntime } from '@/composition/hadith-read';
import {
  Button,
  Panel,
  PageHeading,
  Prose,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { HadithFrame, hadithTrail } from './parts';
import { collectionName, collectionPath, hadithPath } from './presentation';
import { readCollections, readHadithTopic } from './read';
import { RELATED_KINDS } from './related';

/**
 * `/hadith` and `/hadith/introduction` (ROUTE_MAP.md §3.4).
 *
 * A KNOWLEDGE LANDING, NOT A SHOWCASE. It says what the section holds and how
 * to enter it — by collection, by citation, by search — and lists the public
 * collections, a study page, the commentary or a related view ONLY when there
 * is something public behind it. No statistics, no featured narration, no
 * "coming soon".
 */

interface Entry {
  readonly key: string;
  readonly href: string;
}

function EntryList({
  id,
  heading,
  entries,
  title,
  body,
}: {
  readonly id: string;
  readonly heading: string;
  readonly entries: readonly Entry[];
  readonly title: (key: string) => string;
  readonly body: (key: string) => string;
}) {
  if (entries.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby={id}>
      <SectionHeading>
        <span id={id}>{heading}</span>
      </SectionHeading>
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {entries.map((entry) => (
          <Panel key={entry.key} as="li">
            <div className="flex flex-col gap-2">
              <h3 className="text-lg font-semibold">
                <TextLink href={entry.href}>{title(entry.key)}</TextLink>
              </h3>
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {body(entry.key)}
              </p>
            </div>
          </Panel>
        ))}
      </ul>
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
  const browse = [section('collections'), section('browse')];
  const study = [
    section('introduction'),
    ...(sciences.length > 0 ? [section('sciences')] : []),
    ...(commentaries.length > 0 ? [section('commentary')] : []),
  ];
  const related =
    topic === null
      ? []
      : [
          ...RELATED_KINDS.map(section),
          { key: 'topics', href: `/${locale}/topics/${encodeURIComponent(topic.slug)}` },
        ];
  const title = (key: string) => t(`sections.${key}` as 'sections.browse');
  const body = (key: string) => t(`sectionBody.${key}` as 'sectionBody.browse');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, { text: t('title') }]}
    >
      <Prose>
        <PageHeading>{t('title')}</PageHeading>
        <p>{t('intro')}</p>
      </Prose>

      <Panel>
        <form
          method="get"
          action={hadithPath(locale, 'search')}
          role="search"
          aria-label={t('sections.search')}
          className="flex flex-col gap-3"
        >
          <SectionHeading>{t('sections.search')}</SectionHeading>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <label htmlFor="hadith-landing-search" className="text-sm font-medium">
                {t('search.label')}
              </label>
              <TextInput
                id="hadith-landing-search"
                type="search"
                name="q"
                maxLength={SEARCH_QUERY_MAX_LENGTH}
                autoComplete="off"
              />
            </div>
            <Button>{t('search.submit')}</Button>
          </div>
        </form>
      </Panel>

      {collections.length === 0 ? null : (
        <section className="flex flex-col gap-4" aria-labelledby="hadith-collections">
          <SectionHeading>
            <span id="hadith-collections">{t('landing.collections')}</span>
          </SectionHeading>
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collections.map((collection) => {
              const name = collectionName(collection.names, locale);
              return (
                <Panel key={collection.id} as="li">
                  <h3 className="text-lg font-semibold wrap-anywhere">
                    <TextLink href={collectionPath(locale, collection.slug)}>
                      {name === null ? (
                        collection.slug
                      ) : (
                        <span lang={name.locale}>{name.text}</span>
                      )}
                    </TextLink>
                  </h3>
                </Panel>
              );
            })}
          </ul>
        </section>
      )}

      <EntryList
        id="hadith-browse"
        heading={t('landing.browse')}
        entries={browse}
        title={title}
        body={body}
      />
      <EntryList
        id="hadith-study"
        heading={t('landing.study')}
        entries={study}
        title={title}
        body={body}
      />
      <EntryList
        id="hadith-related"
        heading={t('landing.related')}
        entries={related}
        title={title}
        body={body}
      />
    </HadithFrame>
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
