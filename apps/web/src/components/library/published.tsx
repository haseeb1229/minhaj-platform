import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { PublishedRecordItem, PublishedRecordKind } from '@minhaj/contracts/library';

import { libraryReadRuntime, libraryReferenceNames } from '@/composition/library-read';
import { ExploreHero, languageName } from '@/components/topic-hub/parts';
import {
  ListingFooter,
  RecordListing,
  commonStats,
  creditLine,
  dateOf,
} from '@/components/topic-hub/research';
import {
  LIBRARY_RECORD_SCOPES,
  excerptOf,
  libraryRecordsReadQuery,
  researchHref,
  type ResearchQuery,
} from '@/components/topic-hub/research-view';
import { Badge, Breadcrumbs, Container, EmptyState, Icon } from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  scholarlyLabel,
  scholarlyPath,
  sectionBody,
  sectionTitle,
} from './scholarly-presentation';

/**
 * `/library/publications` and `/library/encyclopedias` — EVERY PUBLIC RECORD
 * OF ONE OF THE TWO PUBLISHED KINDS (ROUTE_MAP.md §3.6; Library Part 3).
 *
 * THE SAME LISTING AS THE RESEARCH (`RecordListing`, shared with
 * `@/components/topic-hub/research`): figures, filters with counts (Topic,
 * content language, author, decade, full text here), chips, three orders, the
 * decade timeline and numbered pages, over Library's published-records read
 * (`publishedRecords`, `publishedRecordFacets`). Only the entry and the words
 * are the kind's own: a publication by its publisher and date, an
 * encyclopedia by its entries — the sections of its text, since its structure
 * is its document (DOMAIN_MODEL.md §10.2; there are no volumes and no entry
 * subsystem to show).
 *
 * Signed out, always; the interface locale never filters content.
 */

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;
type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;
type Names = Awaited<ReturnType<typeof libraryReferenceNames>>;

/** One Publication or Encyclopedia, as a catalogue entry: the title its one link. */
function PublishedEntry({
  locale,
  item,
  names,
  heading,
  hub,
  t,
}: {
  readonly locale: Locale;
  readonly item: PublishedRecordItem;
  readonly names: Names;
  readonly heading: 'h3' | 'h4';
  readonly hub: HubTranslator;
  readonly t: LibraryTranslator;
}) {
  const label = scholarlyLabel(item, locale);
  const title = { lang: label.locale, dir: directionOf(label.locale) };
  const href = scholarlyPath(locale, item.kind, item.slug);
  const credits = creditLine(item, names, hub);
  const date = dateOf(item, locale);
  const summary = excerptOf(label.summary);
  const Heading = heading;
  const action = item.readable
    ? item.kind === 'encyclopedia'
      ? 'records.readEntries'
      : 'records.readFull'
    : 'records.details';

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-6">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
        <Badge>{t(`scholarly.kind.${item.kind}`)}</Badge>
        <span>{languageName(item.languageCode, locale)}</span>
        {date === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={date.machine}>{date.text}</time>
          </>
        )}
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading
          className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
          {...title}
        >
          <a
            href={href}
            className="text-foreground underline decoration-accent-rule decoration-1 underline-offset-4 hover:decoration-accent active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {credits === '' ? null : (
          <p className="text-sm font-medium wrap-anywhere text-foreground" dir="auto">
            {credits}
          </p>
        )}
        {item.publisher === null ? null : (
          <p className="text-sm wrap-anywhere text-foreground-muted">
            {t('records.publishedBy')} <bdi>{item.publisher}</bdi>
          </p>
        )}
      </div>
      {summary === null ? null : (
        <p
          className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-4 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
          {...title}
        >
          {summary}
        </p>
      )}
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-2 text-sm">
        <li>
          <a
            href={href}
            aria-label={t(`${action}Named`, { title: label.title })}
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t(action)}
            <Icon name="arrow-end" size={16} />
          </a>
        </li>
        {item.sections === 0 ? null : (
          <li className="inline-flex min-h-11 items-center text-foreground-muted">
            {t(item.kind === 'encyclopedia' ? 'records.entries' : 'records.sections', {
              count: item.sections,
            })}
          </li>
        )}
      </ul>
    </li>
  );
}

/**
 * Publications or Encyclopedias outside their listing — a record's related
 * works — every contributor resolved in ONE People call. Nothing when empty.
 */
export async function PublishedShelf({
  locale,
  items,
  label,
}: {
  readonly locale: Locale;
  readonly items: readonly PublishedRecordItem[];
  readonly label: string;
}) {
  if (items.length === 0) return null;
  const [t, hub, names] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    libraryReferenceNames(
      {
        personIds: items.flatMap((item) =>
          item.contributors.map((entry) => entry.personId),
        ),
        topicIds: [],
      },
      locale,
    ),
  ]);
  return (
    <ul aria-label={label} className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {items.map((item) => (
        <PublishedEntry
          key={item.id}
          locale={locale}
          item={item}
          names={names}
          heading="h3"
          hub={hub}
          t={t}
        />
      ))}
    </ul>
  );
}

export async function PublishedRecordsPage({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: PublishedRecordKind;
  readonly query: ResearchQuery;
}) {
  const [t, hub, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const scope = LIBRARY_RECORD_SCOPES[kind];
  const library = libraryReadRuntime();
  const read = libraryRecordsReadQuery({ ...scope, kind }, query, locale);
  const [page, facets] = await Promise.all([
    library.publishedRecords(read),
    library.publishedRecordFacets(read),
  ]);
  const names = await libraryReferenceNames(
    {
      personIds: [
        ...page.items.flatMap((item) => item.contributors.map((entry) => entry.personId)),
        ...facets.contributors.items.map((facet) => facet.id),
        ...(query.contributor === null ? [] : [query.contributor]),
      ],
      topicIds: [
        ...facets.topics.items.map((facet) => facet.id),
        ...((query.topic ?? null) === null ? [] : [query.topic ?? '']),
      ],
    },
    locale,
  );

  const title = sectionTitle(t, kind);
  const listId = `library-${kind}-list`;
  const all = facets.all;
  const link = (path: string, text: string) => ({
    href: localizedPath(locale, path),
    text,
  });
  const plain = (change: Partial<ResearchQuery>) =>
    researchHref(scope, locale, query, {
      topic: null,
      language: null,
      contributor: null,
      decade: null,
      fullText: false,
      ...change,
    });

  return RecordListing({
    domain: {
      key: 'library',
      locale,
      topicId: null,
      title,
      frame: (children) => (
        <Container>
          <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
            <Breadcrumbs
              label={shell('nav.breadcrumbs')}
              trail={[
                { href: localizedPath(locale, ''), text: shell('nav.home') },
                { href: localizedPath(locale, '/library'), text: t('title') },
                { text: title },
              ]}
            />
            {children}
          </div>
        </Container>
      ),
      previous: t('previous'),
      next: t('next'),
    },
    scope,
    query,
    t: hub,
    stem: kind,
    hero: (
      <ExploreHero
        eyebrow={t('title')}
        title={title}
        lede={sectionBody(t, kind)}
        notice={t('scholarly.listingNotice')}
        stats={[
          ...(all.records === 0
            ? []
            : [
                {
                  value: all.records,
                  label: t(`records.${kind}.stat`, { count: all.records }),
                  href: `#${listId}`,
                },
              ]),
          ...commonStats(all, plain({ fullText: true }), locale, hub),
        ]}
        actions={[
          link('/library/topics', t('section.topics')),
          link('/library/languages', t('section.languages')),
        ]}
      />
    ),
    empty:
      all.records === 0 ? (
        <EmptyState
          icon="book"
          title={t(`records.${kind}.emptyTitle`)}
          action={link('/library/resources', t('records.toResources'))}
        >
          {t(`records.${kind}.empty`)}
        </EmptyState>
      ) : null,
    tabs: null,
    intro: t(`records.${kind}.listIntro`),
    words: {
      listHeading: t(`records.${kind}.listHeading`),
      filters: t(`records.${kind}.filters`),
      apply: t(`records.${kind}.apply`),
      summary: (range) => t(`records.${kind}.summary`, range),
      noResultsTitle: t(`records.${kind}.noResultsTitle`),
      pastEnd: (number) => t(`records.${kind}.pastEnd`, { page: number }),
      pages: t(`records.${kind}.pages`),
    },
    noResults: t(`records.${kind}.noResults`),
    facets: {
      languages: facets.languages,
      contributors: facets.contributors,
      topics: facets.topics,
      decades: facets.decades,
      readable: facets.readable,
      showFullText: (all.readable > 0 && all.readable < all.records) || query.fullText,
    },
    names,
    page,
    entry: (item: PublishedRecordItem, heading) => (
      <PublishedEntry
        locale={locale}
        item={item}
        names={names}
        heading={heading}
        hub={hub}
        t={t}
      />
    ),
    keyOf: (item: PublishedRecordItem) => item.id,
    footer: (
      <ListingFooter
        about={t(`records.${kind}.about`)}
        links={[
          link(
            kind === 'publication' ? '/library/encyclopedias' : '/library/publications',
            t(`records.${kind === 'publication' ? 'encyclopedia' : 'publication'}.all`),
          ),
          link('/library/books', t('records.toBooks')),
          link('/library', t('booksPage.libraryHome')),
        ]}
      />
    ),
  });
}
