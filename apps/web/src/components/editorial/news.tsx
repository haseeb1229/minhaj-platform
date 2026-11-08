import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { cache, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  NEWS_KINDS,
  NEWS_PAGE,
  newsListPathOf,
  newsPathOf,
  type NewsKind,
  type NewsSummary,
  type PublicNews,
} from '@minhaj/contracts/editorial';
import { globalPaths, labelFor, type CentreReference } from '@minhaj/contracts/global';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { globalReadRuntime } from '@/composition/global-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import {
  newsArchivePath,
  newsListingPath,
  newsStructuredData,
  readNewsArchiveQuery,
  readNewsFilters,
  readNewsOffset,
  translationFor,
} from '@/components/editorial/presentation';
import { withContents, revisedAfterPublication } from '@/components/editorial/long-form';
import { RecordSection } from '@/components/editorial/frame';
import { AuthorChips, Contents, ReadingDates } from '@/components/editorial/reading';
import { BreadcrumbData } from '@/components/media/parts';
import { LeadFigure, leadCardImage } from '@/components/editorial/lead-image';
import {
  ActionLink,
  Badge,
  Breadcrumbs,
  Container,
  DetailRow,
  EditorialCard,
  EmptyState,
  FilterLink,
  Icon,
  LanguageBadge,
  LinkTabs,
  ListRow,
  MediaCard,
  PageHeading,
  Pager,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * The public News surfaces — `/news`, the three family listings, every detail
 * page and the News archive (ROUTE_MAP.md §3.9). Phase 13; redesigned in R2.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/editorial-read` and `@/composition/public-references`, which
 * reach Editorial's public reader, People's reader and Taxonomy and nothing
 * else — no session, no identity service, no cookie — so a signed-in visitor
 * and an anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * AN EDITORIAL PUBLICATION, NOT A GRID OF BOXES (R2). A listing opens with the
 * newest story as its lead and the next three beside it, then reads as a
 * chronological list with a thumbnail per story. A position is earned by date
 * alone — never a "featured" claim the data does not make.
 *
 * THE READER'S LANGUAGE FIRST, EVERY LANGUAGE VISIBLE (audit F10). A listing
 * puts the records published in the interface language first and the rest
 * after them; a visitor may narrow it to one content language with `?lang=`.
 * Any card whose words are not in the interface language says which language
 * they are in.
 *
 * A LEAD IMAGE WHERE THE RECORD HAS ONE, TEXT WHERE IT DOES NOT (Phase 30-R):
 * Editorial's own first-party route, never a placeholder or a stock picture.
 *
 * THE DATE IS THE RECORD'S CHRONOLOGY: the source's own publication date where
 * a migrated record states one, else its first publication here — never the
 * day it was migrated or approved.
 *
 * ONE PAGE OF NAMES PER PAGE. Contributors and topics of every card on a page
 * are resolved by their owners in two calls, never one per card.
 */

type NewsTranslator = Awaited<ReturnType<typeof getTranslations<'news'>>>;
type EditorialTranslator = Awaited<ReturnType<typeof getTranslations<'editorial'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;
type Query = Record<string, string | string[] | undefined>;

const LANGUAGES: readonly Locale[] = ['en', 'ur', 'ar'];

/* ===========================================================================
 * Shared parts
 * ========================================================================= */

/** Reads one published record once per request, for metadata and body alike. */
export const readNews = cache((kind: NewsKind, slug: string) =>
  editorialReadRuntime().news(kind, slug),
);

/** An instant, as the UTC calendar date it was published on. */
function publishedDate(value: Date, locale: Locale): { text: string; machine: string } {
  return {
    text: new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
      value,
    ),
    machine: value.toISOString().slice(0, 10),
  };
}

/** A date-only fact, formatted in the interface locale and never shifted by a zone. */
function calendarDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

function yearText(year: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, 0, 1)),
  );
}

/** Home / News and Events / … — the trail every News page starts with. */
async function newsTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'news' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    news: { href: localizedPath(locale, '/news'), text: t('title') },
  };
}

/** Names for every contributor and topic on one page of cards, in two calls. */
function namesFor(items: readonly NewsSummary[], locale: Locale): Promise<Names> {
  return referenceNames(
    {
      personIds: items.flatMap((item) => item.contributors.map((c) => c.personId)),
      topicIds: items.flatMap((item) => item.topicIds),
    },
    locale,
  );
}

/** The content language of words shown on a page, said in words when it differs. */
function languageOf(code: Locale, locale: Locale, t: NewsTranslator) {
  return code === locale ? undefined : { label: t(`languages.${code}`), code };
}

/**
 * What every card says about one record, whatever its shape: its address, its
 * headline and summary in their own language, its date and its byline, its
 * family when the list mixes them, and its language when it is not the page's.
 */
function cardWords(
  locale: Locale,
  item: NewsSummary,
  names: Names,
  t: NewsTranslator,
  showType: boolean,
) {
  const translation = translationFor(item, locale);
  const date = publishedDate(item.chronologyAt, locale);
  const authors = item.contributors.flatMap((credit) => {
    const person =
      credit.role === 'author' ? names.people.get(credit.personId) : undefined;
    return person === undefined ? [] : [person.name];
  });
  const meta: ReactNode[] = [
    <time key="date" dateTime={date.machine}>
      {date.text}
    </time>,
    translation.issuer ? (
      <span key="issuer" lang={translation.languageCode}>
        {t('issuedBy', { issuer: translation.issuer })}
      </span>
    ) : null,
    item.coverage === null ? null : (
      <span key="outlet">{t('coverageOf', { outlet: item.coverage.outlet })}</span>
    ),
    authors.length === 0 ? null : <span key="by">{authors.join(' · ')}</span>,
  ];
  const language = languageOf(translation.languageCode, locale, t);
  return {
    href: localizedPath(locale, newsPathOf(item.kind, item.slug)),
    title: translation.title,
    description: translation.excerpt,
    meta,
    lang: translation.languageCode,
    dir: directionOf(translation.languageCode),
    ...(showType ? { type: t(`type.${item.kind}`) } : {}),
    ...(language === undefined ? {} : { language }),
    picture:
      item.leadImage === null
        ? null
        : leadCardImage(item.leadImage, translation.leadAlt ?? ''),
  };
}

/**
 * A grid of image-led cards, with its names resolved once. Composed by the
 * family previews on `/news`, a Centre page and the topic hub.
 */
export async function NewsGrid({
  locale,
  items,
  label,
  showType,
  headingLevel = 'h2',
  columns = 3,
}: {
  readonly locale: Locale;
  readonly items: readonly NewsSummary[];
  readonly label: string;
  readonly showType: boolean;
  readonly headingLevel?: 'h2' | 'h3';
  readonly columns?: 2 | 3;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const names = await namesFor(items, locale);
  return (
    <ul
      className={`grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 sm:grid-cols-2 ${
        columns === 3 ? 'lg:grid-cols-3' : ''
      }`}
      aria-label={label}
    >
      {items.map((item) => {
        const { picture, ...words } = cardWords(locale, item, names, t, showType);
        return (
          <MediaCard
            key={`${item.kind}:${item.slug}`}
            {...words}
            image={picture}
            aspect="wide"
            headingLevel={headingLevel}
            sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
          />
        );
      })}
    </ul>
  );
}

/**
 * A CHRONICLE: on a listing's first page the newest story leads, wide, with
 * the next three beside it; every other story follows as a row with its
 * thumbnail. Later pages are rows only.
 */
async function NewsChronicle({
  locale,
  items,
  label,
  showType,
  opening,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly items: readonly NewsSummary[];
  readonly label: string;
  readonly showType: boolean;
  /** The first page: open with the lead story. */
  readonly opening: boolean;
  /** Every story's heading level: `h2` under the page title, `h3` under a section. */
  readonly headingLevel: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const names = await namesFor(items, locale);
  const led = opening && items.length >= 4;
  const top = led ? items.slice(0, 4) : [];
  const rest = led ? items.slice(4) : items;
  return (
    <div className="flex flex-col gap-10">
      {top.length === 0 ? null : (
        <ul
          aria-label={label}
          className="grid list-none grid-cols-1 gap-x-10 gap-y-8 p-0 lg:grid-cols-12"
        >
          {top.map((item, index) => {
            const { picture, ...words } = cardWords(locale, item, names, t, showType);
            return (
              <li
                key={`${item.kind}:${item.slug}`}
                className={
                  index === 0
                    ? 'min-w-0 lg:col-span-7 lg:row-span-3'
                    : 'min-w-0 border-border lg:col-span-5 max-lg:border-t max-lg:pt-6'
                }
              >
                <EditorialCard
                  {...words}
                  as="article"
                  variant={index === 0 ? 'lead' : 'secondary'}
                  image={picture}
                  priority={index === 0}
                  headingLevel={headingLevel}
                  sizes={
                    index === 0
                      ? '(min-width: 64rem) 40rem, 100vw'
                      : '(min-width: 64rem) 11rem, (min-width: 30rem) 40vw, 100vw'
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
      {rest.length === 0 ? null : (
        <ul
          aria-label={led ? t('moreNews') : label}
          className="flex list-none flex-col border-t border-border p-0"
        >
          {rest.map((item) => {
            const { picture, ...words } = cardWords(locale, item, names, t, showType);
            return (
              <ListRow
                key={`${item.kind}:${item.slug}`}
                {...words}
                image={picture}
                headingLevel={headingLevel}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The News sections as route tabs: each family's listing and the archive. */
function NewsSections({
  locale,
  current,
  t,
}: {
  readonly locale: Locale;
  readonly current: NewsKind | 'archive';
  readonly t: NewsTranslator;
}) {
  return (
    <LinkTabs
      label={t('sectionsLabel')}
      tabs={[
        ...NEWS_KINDS.map((kind) => ({
          href: localizedPath(locale, newsListPathOf(kind)),
          text: t(`families.${kind}`),
          current: kind === current,
        })),
        {
          href: localizedPath(locale, '/news/archive'),
          text: t('archive'),
          current: current === 'archive',
        },
      ]}
    />
  );
}

/**
 * The content-language choice: every language a record may be written in, in
 * its own name, and "all languages" — the default, with the reader's own
 * language first. A choice is a link, so it is shareable and works without
 * script.
 */
function LanguageFilter({
  current,
  hrefFor,
  t,
}: {
  readonly current: Locale | null;
  readonly hrefFor: (language: Locale | null) => string;
  readonly t: NewsTranslator;
}) {
  return (
    <nav aria-label={t('languageFilter')}>
      <ul className="flex list-none flex-wrap items-center gap-2 p-0">
        <li>
          <FilterLink href={hrefFor(null)} current={current === null}>
            {t('allLanguages')}
          </FilterLink>
        </li>
        {LANGUAGES.map((code) => (
          <li key={code}>
            <FilterLink href={hrefFor(code)} current={current === code}>
              <span lang={code}>{endonymOf(code)}</span>
            </FilterLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * A listing's opening: the trail, its one `h1`, its lede, the landing's own
 * actions when it has any, and its controls.
 */
function ListingHead({
  trailLabel,
  trail,
  title,
  lede,
  actions,
  children,
}: {
  readonly trailLabel: string;
  readonly trail: readonly { readonly href?: string; readonly text: string }[];
  readonly title: string;
  readonly lede: string;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <Container>
      <div className="flex flex-col gap-6 pt-6 pb-8">
        <Breadcrumbs label={trailLabel} trail={trail} />
        <div className="flex max-w-3xl flex-col gap-3">
          <PageHeading>{title}</PageHeading>
          <p className="text-lede max-w-[var(--measure-prose)] text-foreground-muted">
            {lede}
          </p>
          {actions === undefined ? null : (
            <div className="flex flex-wrap items-center gap-3 pt-2">{actions}</div>
          )}
        </div>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </Container>
  );
}

/** "Nothing here": the first page of an empty listing, or a page past its end. */
function ListingEmpty({
  firstPage,
  message,
  back,
  t,
}: {
  readonly firstPage: boolean;
  readonly message: string;
  readonly back: string;
  readonly t: NewsTranslator;
}) {
  return firstPage ? (
    <EmptyState icon="news">{message}</EmptyState>
  ) : (
    <EmptyState action={{ href: back, text: t('firstPage') }}>
      {t('pageEmpty')}
    </EmptyState>
  );
}

/* ===========================================================================
 * /news — News and Events
 * ========================================================================= */

/** How many of each other family the landing previews. */
const FAMILY_PREVIEW = 3;
/** How many recent years the landing offers as archive shortcuts. */
const LANDING_YEARS = 8;

/**
 * `/news` — the News and Events entry point, `?sort=latest` (ROUTE_MAP.md §3.9).
 *
 * THE LATEST NEWSARTICLES, paginated, because `/news` is the NewsArticle
 * collection; `?sort=latest` names the only order that exists, so both are
 * canonical to `/news`. `?lang=` narrows to one content language; without it
 * the interface language leads. On the first page each other family previews
 * its latest records, recent years link into the archive, and Events,
 * Collections and the photograph surfaces are linked as the rest of News and
 * Events.
 */
export async function NewsLandingPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const photos = await getTranslations({ locale, namespace: 'photos' });
  const trail = await newsTrail(locale);
  const offset = readNewsOffset(query);
  const { language } = readNewsFilters(query);
  const reads = editorialReadRuntime();
  const order = { only: language, prefer: language === null ? locale : null };
  const others = ['press-release', 'statement', 'media-coverage'] as const;
  const [latest, periods, ...families] = await Promise.all([
    reads.newsList('news-article', offset, order),
    offset === 0 ? reads.newsArchivePeriods() : Promise.resolve([]),
    ...(offset === 0 ? others.map((kind) => reads.newsList(kind, 0, order)) : []),
  ]);
  const listing = (lang: Locale | null, at = 0) =>
    newsListingPath(locale, '/news', { language: lang }, at);
  const previews = others.flatMap((kind, index) => {
    const page = families[index];
    return page === undefined || page.items.length === 0
      ? []
      : [{ kind, items: page.items.slice(0, FAMILY_PREVIEW) }];
  });
  const years = [...new Set(periods.map((period) => period.year))].slice(
    0,
    LANDING_YEARS,
  );

  return (
    <>
      <ListingHead
        trailLabel={trail.label}
        trail={[trail.home, { text: t('title') }]}
        title={t('title')}
        lede={t('description')}
        actions={
          <>
            <ActionLink href={pathFor(locale, requireRoute('events'))}>
              {t('events')}
            </ActionLink>
            <ActionLink href={localizedPath(locale, '/news/archive')} tone="secondary">
              {t('archive')}
            </ActionLink>
          </>
        }
      >
        <NewsSections locale={locale} current="news-article" t={t} />
        <LanguageFilter current={language} hrefFor={(lang) => listing(lang)} t={t} />
      </ListingHead>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] pb-[var(--space-section)]">
          <section className="flex flex-col gap-6" aria-labelledby="news-latest">
            <h2 id="news-latest" className="sr-only">
              {t('latest')}
            </h2>
            {latest.items.length === 0 ? (
              <ListingEmpty
                firstPage={offset === 0}
                message={language === null ? t('empty.news-article') : t('languageEmpty')}
                back={listing(language)}
                t={t}
              />
            ) : (
              <NewsChronicle
                locale={locale}
                items={latest.items}
                label={t('latest')}
                showType={false}
                opening={offset === 0}
                headingLevel="h3"
              />
            )}
            <Pager
              label={t('latest')}
              previous={
                offset > 0 ? listing(language, Math.max(0, offset - NEWS_PAGE)) : null
              }
              next={latest.more ? listing(language, offset + NEWS_PAGE) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
            />
          </section>

          {previews.map(({ kind, items }) => (
            <section
              key={kind}
              className="flex flex-col gap-6"
              aria-labelledby={`news-${kind}`}
            >
              <SectionHeader
                id={`news-${kind}`}
                heading={t(`families.${kind}`)}
                action={{
                  href: localizedPath(locale, newsListPathOf(kind)),
                  text: t(`all.${kind}`),
                }}
              />
              <NewsGrid
                locale={locale}
                items={items}
                label={t(`families.${kind}`)}
                showType={false}
                headingLevel="h3"
              />
            </section>
          ))}

          {offset === 0 ? (
            <section
              className="grid gap-10 border-t border-border pt-[var(--space-page)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16"
              aria-labelledby="news-browse"
            >
              <div className="flex flex-col gap-4">
                <h2 id="news-browse" className="text-heading font-semibold">
                  {t('browse')}
                </h2>
                <ul className="flex list-none flex-col p-0">
                  {[
                    ...others.map((kind) => ({
                      href: localizedPath(locale, newsListPathOf(kind)),
                      title: t(`families.${kind}`),
                      body: t(`familyBody.${kind}`),
                    })),
                    {
                      href: localizedPath(locale, '/news/archive'),
                      title: t('archive'),
                      body: t('archiveBody'),
                    },
                    {
                      href: pathFor(locale, requireRoute('events')),
                      title: t('events'),
                      body: t('eventsBody'),
                    },
                    {
                      href: pathFor(locale, requireRoute('collections')),
                      title: t('collections'),
                      body: t('collectionsBody'),
                    },
                    ...(['photos', 'galleries', 'archive'] as const).map((surface) => ({
                      href: pathFor(locale, requireRoute(`media.${surface}`)),
                      title: photos(`sections.${surface}`),
                      body: t(`mediaSurface.${surface}`),
                    })),
                  ].map((entry) => (
                    <ListRow
                      key={entry.href}
                      href={entry.href}
                      title={entry.title}
                      description={entry.body}
                    />
                  ))}
                </ul>
              </div>
              {years.length === 0 ? null : (
                <nav aria-labelledby="news-years" className="flex flex-col gap-4">
                  <h2 id="news-years" className="text-heading font-semibold">
                    {t('byYear')}
                  </h2>
                  <ul className="flex list-none flex-wrap gap-2 p-0">
                    {years.map((year) => (
                      <li key={year}>
                        <FilterLink
                          href={newsArchivePath(locale, { year, month: null })}
                          current={false}
                        >
                          <span className="tabular-nums">{yearText(year, locale)}</span>
                        </FilterLink>
                      </li>
                    ))}
                    <li>
                      <FilterLink
                        href={newsArchivePath(locale, { year: null, month: null })}
                        current={false}
                      >
                        {t('archiveEveryYear')}
                      </FilterLink>
                    </li>
                  </ul>
                </nav>
              )}
            </section>
          ) : null}
        </div>
      </Container>
    </>
  );
}

/* ===========================================================================
 * /news/{press-releases|statements|media-coverage}
 * ========================================================================= */

export async function NewsFamilyPage({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: Exclude<NewsKind, 'news-article'>;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const trail = await newsTrail(locale);
  const offset = readNewsOffset(query);
  const { language } = readNewsFilters(query);
  const page = await editorialReadRuntime().newsList(kind, offset, {
    only: language,
    prefer: language === null ? locale : null,
  });
  const title = t(`families.${kind}`);
  const listing = (lang: Locale | null, at = 0) =>
    newsListingPath(locale, newsListPathOf(kind), { language: lang }, at);

  return (
    <>
      <ListingHead
        trailLabel={trail.label}
        trail={[trail.home, trail.news, { text: title }]}
        title={title}
        lede={t(`familyBody.${kind}`)}
      >
        <NewsSections locale={locale} current={kind} t={t} />
        <LanguageFilter current={language} hrefFor={(lang) => listing(lang)} t={t} />
      </ListingHead>
      <Container>
        <div className="flex flex-col gap-6 pb-[var(--space-section)]">
          {page.items.length === 0 ? (
            <ListingEmpty
              firstPage={offset === 0}
              message={language === null ? t(`empty.${kind}`) : t('languageEmpty')}
              back={listing(language)}
              t={t}
            />
          ) : (
            <NewsChronicle
              locale={locale}
              items={page.items}
              label={title}
              showType={false}
              opening={offset === 0}
              headingLevel="h2"
            />
          )}
          <Pager
            label={title}
            previous={
              offset > 0 ? listing(language, Math.max(0, offset - NEWS_PAGE)) : null
            }
            next={page.more ? listing(language, offset + NEWS_PAGE) : null}
            previousLabel={t('previous')}
            nextLabel={t('next')}
          />
        </div>
      </Container>
    </>
  );
}

/* ===========================================================================
 * Detail pages
 * ========================================================================= */

/**
 * The Centre a NewsArticle is scoped to, ONLY while Global says it is public —
 * asked of Global's public read at Layer 4, never joined. A Centre since
 * archived or withheld, or a Global read that fails, simply leaves the
 * attribution out: the News itself stays Editorial's and stays published.
 */
async function publicCentre(centreId: string | null): Promise<CentreReference | null> {
  if (centreId === null) return null;
  try {
    return (await globalReadRuntime().centreReferences([centreId]))[0] ?? null;
  } catch {
    return null;
  }
}

/** How many related records a detail page closes with. */
const RELATED = 3;

/**
 * Related reading: the latest published News on the record's first topic,
 * else the latest of its own family — the record itself excluded. A position
 * earned by topic and date, never a recommendation.
 */
async function relatedNews(record: PublicNews): Promise<readonly NewsSummary[]> {
  const reads = editorialReadRuntime();
  const [topicId] = record.topicIds;
  const page =
    topicId === undefined
      ? await reads.newsList(record.kind, 0)
      : await reads.newsOnTopic(topicId);
  return page.items
    .filter((item) => !(item.kind === record.kind && item.slug === record.slug))
    .slice(0, RELATED);
}

/**
 * A record page, set for reading: the header (type, headline, standfirst,
 * byline, dates), the lead picture, then the story at a reading measure with
 * its contents beside it when it has sections, then what it is about, where
 * it came from, and related reading.
 */
export async function NewsDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: PublicNews;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const editorial: EditorialTranslator = await getTranslations({
    locale,
    namespace: 'editorial',
  });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const trail = await newsTrail(locale);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const [names, languages, centre, related] = await Promise.all([
    referenceNames(
      {
        personIds: record.contributors.map((c) => c.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
    translation.languageCode === locale
      ? Promise.resolve(new Map<string, ContentLanguage>())
      : contentLanguages(),
    publicCentre(record.centreId),
    relatedNews(record),
  ]);
  const centreLabel = centre === null ? null : labelFor(centre, locale);
  // The record's chronology: its source's own date where it states one.
  const date = publishedDate(record.chronologyAt ?? record.publishedAt, locale);
  const updated = revisedAfterPublication(record.publishedAt, record.updatedAt)
    ? publishedDate(record.updatedAt, locale)
    : null;
  const image = record.leadImage ?? null;
  const familyTitle = t(`families.${record.kind}`);
  const familyPath = newsListPathOf(record.kind);
  const credits = record.contributors.flatMap((credit) => {
    const person = names.people.get(credit.personId);
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const authors = credits.filter((credit) => credit.role === 'author');
  const others = credits.filter((credit) => credit.role !== 'author');
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const coverage = record.coverage;
  const contentLocales = record.translations.map((row) => row.languageCode);
  const body = withContents(translation.html);
  const structured = newsStructuredData(
    record,
    locale,
    authors.map((credit) => credit.person),
  );

  // The family's own breadcrumb; a NewsArticle's family IS `/news`.
  const crumbs = [
    trail.home,
    trail.news,
    ...(record.kind === 'news-article'
      ? []
      : [{ href: localizedPath(locale, familyPath), text: familyTitle }]),
    { text: translation.title },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={trail.label} trail={crumbs} />

        <header className="flex max-w-3xl flex-col gap-5">
          <p className="flex flex-wrap items-center gap-2">
            <Badge>{t(`type.${record.kind}`)}</Badge>
            {translation.languageCode === locale ? null : (
              <LanguageBadge
                label={t(`languages.${translation.languageCode}`)}
                code={translation.languageCode}
              />
            )}
          </p>
          <div
            className="flex flex-col gap-4"
            lang={translation.languageCode}
            dir={direction}
          >
            <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              {translation.title}
            </h1>
            {translation.issuer ? (
              <p className="text-base font-medium">
                {t('issuedBy', { issuer: translation.issuer })}
              </p>
            ) : null}
            {translation.excerpt === '' ? null : (
              <p className="reading-face text-lede max-w-[var(--measure-prose)] text-foreground-muted">
                {translation.excerpt}
              </p>
            )}
          </div>
          {translation.languageCode === locale ? null : (
            <p
              role="status"
              className="flex items-start gap-2 text-sm text-foreground-muted"
            >
              <Icon name="globe" size={16} className="mt-1 shrink-0" />
              <span>
                {t('fallback', {
                  language:
                    languages.get(translation.languageCode)?.name ??
                    translation.languageCode,
                })}
              </span>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-border pt-4">
            <AuthorChips
              locale={locale}
              label={t('authors')}
              people={authors.map((credit) => credit.person)}
            />
            <ReadingDates
              dates={[
                { term: t('published'), ...date },
                ...(updated === null ? [] : [{ term: t('updated'), ...updated }]),
              ]}
            />
          </div>
        </header>

        {image === null ? null : (
          <LeadFigure
            image={image}
            alt={translation.leadAlt ?? ''}
            lang={translation.languageCode}
            caption={
              image.credit === null
                ? null
                : editorial('leadCredit', { credit: image.credit })
            }
          />
        )}

        <div
          className={
            body.entries.length === 0
              ? 'flex min-w-0 flex-col gap-10'
              : 'grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14'
          }
        >
          {body.entries.length === 0 ? null : (
            <Contents entries={body.entries} label={t('contents')} />
          )}
          <div className="flex min-w-0 flex-col gap-10">
            {coverage === null ? null : (
              <p
                className="max-w-[var(--measure-prose)] text-sm text-foreground-muted"
                dir="auto"
              >
                {t('coverageNotice', { outlet: coverage.outlet })}
              </p>
            )}
            <div
              className="editorial-prose long-form"
              lang={translation.languageCode}
              dir={direction}
              dangerouslySetInnerHTML={{ __html: body.html }}
            />

            <div className="flex max-w-[70ch] flex-col gap-8">
              {coverage === null ? null : (
                <RecordSection id="news-source" heading={t('source')}>
                  <dl className="flex flex-col">
                    <DetailRow term={t('outlet')}>
                      <span dir="auto">{coverage.outlet}</span>
                    </DetailRow>
                    {coverage.sourceDate === null ? null : (
                      <DetailRow term={t('coverageDate')}>
                        <time dateTime={coverage.sourceDate}>
                          {calendarDate(coverage.sourceDate, locale)}
                        </time>
                      </DetailRow>
                    )}
                  </dl>
                  {coverage.sourceUrl === null ? (
                    <p className="text-sm">{t('sourceUnknown')}</p>
                  ) : (
                    <p className="text-sm">
                      <a
                        href={coverage.sourceUrl}
                        rel="external noopener noreferrer"
                        className="inline-flex min-h-11 flex-wrap items-center gap-x-1 font-medium wrap-anywhere text-action underline underline-offset-2"
                      >
                        <span dir="auto">
                          {t('sourceLink', { outlet: coverage.outlet })}
                        </span>{' '}
                        <span className="text-foreground-muted">
                          {t('sourceExternal')}
                        </span>
                      </a>
                    </p>
                  )}
                </RecordSection>
              )}

              {topics.length === 0 &&
              others.length === 0 &&
              (centre === null || centreLabel === null) ? null : (
                <RecordSection id="news-facts" heading={t('facts')}>
                  {topics.length === 0 ? null : (
                    <TopicChips
                      label={t('topics')}
                      topics={topics.map((topic) => ({
                        href: localizedPath(
                          locale,
                          `/topics/${encodeURIComponent(topic.slug)}`,
                        ),
                        text: topic.name,
                      }))}
                    />
                  )}
                  <dl className="flex flex-col">
                    {others.length === 0 ? null : (
                      <DetailRow term={t('contributors')}>
                        <ul className="flex flex-col gap-1">
                          {others.map(({ person, role }) => (
                            <li key={`${person.slug}:${role}`} dir="auto">
                              <TextLink
                                href={localizedPath(
                                  locale,
                                  `/people/${encodeURIComponent(person.slug)}`,
                                )}
                              >
                                {person.name}
                              </TextLink>{' '}
                              — {editorial(role as 'author')}
                            </li>
                          ))}
                        </ul>
                      </DetailRow>
                    )}
                    {centre === null || centreLabel === null ? null : (
                      <DetailRow term={t('centre')}>
                        <TextLink href={globalPaths.centre(locale, centre.slug)}>
                          <span
                            lang={centreLabel.locale}
                            dir={directionOf(centreLabel.locale)}
                          >
                            {centreLabel.name}
                          </span>
                        </TextLink>
                      </DetailRow>
                    )}
                  </dl>
                </RecordSection>
              )}
            </div>
          </div>
        </div>

        {related.length === 0 ? (
          <p>
            <TextLink href={localizedPath(locale, familyPath)}>
              {t(`all.${record.kind}`)}
            </TextLink>
          </p>
        ) : (
          <section
            className="flex flex-col gap-6 border-t border-border pt-[var(--space-page)]"
            aria-labelledby="news-related"
          >
            <SectionHeader
              id="news-related"
              heading={t('related')}
              action={{
                href: localizedPath(locale, familyPath),
                text: t(`all.${record.kind}`),
              }}
            />
            <NewsGrid
              locale={locale}
              items={related}
              label={t('related')}
              showType
              headingLevel="h3"
            />
          </section>
        )}

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            {
              name: shell('nav.home'),
              path: localizedPath(translation.languageCode, ''),
            },
            { name: t('title'), path: localizedPath(translation.languageCode, '/news') },
            ...(record.kind === 'news-article'
              ? []
              : [
                  {
                    name: familyTitle,
                    path: localizedPath(translation.languageCode, familyPath),
                  },
                ]),
            {
              name: translation.title,
              path: localizedPath(
                translation.languageCode,
                newsPathOf(record.kind, record.slug),
              ),
            },
          ]}
        />
        {structured !== null && isContentIndexable({ contentLocales }) ? (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: serializeStructuredData(structured),
            }}
          />
        ) : null}
      </article>
    </Container>
  );
}

/* ===========================================================================
 * /news/archive
 * ========================================================================= */

/**
 * The News archive: every published record of the four families, newest
 * first, browsed by the UTC year and month of its CHRONOLOGY — its source's own
 * publication date where a migrated record states one, else its genuine
 * publication instant — never a record's creation, migration or approval time.
 * R2: narrowed by family (`?type=`) and content language (`?lang=`) as well,
 * and the periods are counted over the same narrowing. On a wide screen the
 * years and months sit beside the results as an index; on a phone they come
 * first.
 */
export async function NewsArchivePage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const trail = await newsTrail(locale);
  const period = readNewsArchiveQuery(query);
  const { kind, language } = readNewsFilters(query);
  const filter = { ...period, kind, language };
  const reads = editorialReadRuntime();
  const [periods, page] = await Promise.all([
    reads.newsArchivePeriods({ kind, language }),
    reads.newsArchive(filter),
  ]);
  const years = [...new Set(periods.map((entry) => entry.year))].map((year) => ({
    year,
    count: periods
      .filter((entry) => entry.year === year)
      .reduce((total, entry) => total + entry.count, 0),
  }));
  const months =
    filter.year === null ? [] : periods.filter((entry) => entry.year === filter.year);
  const heading =
    filter.year === null
      ? t('archiveAll')
      : filter.month === null
        ? t('archiveYear', { year: yearText(filter.year, locale) })
        : t('archiveMonth', {
            month: monthName(filter.month, locale),
            year: yearText(filter.year, locale),
          });
  const narrowed = kind !== null || language !== null;

  return (
    <>
      <ListingHead
        trailLabel={trail.label}
        trail={[trail.home, trail.news, { text: t('archive') }]}
        title={t('archive')}
        lede={t('archiveBody')}
      >
        <NewsSections locale={locale} current="archive" t={t} />
        <nav aria-label={t('typeFilter')}>
          <ul className="flex list-none flex-wrap items-center gap-2 p-0">
            <li>
              <FilterLink
                href={newsArchivePath(locale, { ...filter, kind: null })}
                current={kind === null}
              >
                {t('allTypes')}
              </FilterLink>
            </li>
            {NEWS_KINDS.map((family) => (
              <li key={family}>
                <FilterLink
                  href={newsArchivePath(locale, { ...filter, kind: family })}
                  current={kind === family}
                >
                  {t(`families.${family}`)}
                </FilterLink>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageFilter
          current={language}
          hrefFor={(lang) => newsArchivePath(locale, { ...filter, language: lang })}
          t={t}
        />
      </ListingHead>

      <Container>
        <div className="pb-[var(--space-section)]">
          {years.length === 0 ? (
            narrowed ? (
              <EmptyState
                action={{
                  href: newsArchivePath(locale, { year: null, month: null }),
                  text: t('archiveEverything'),
                }}
              >
                {t('archiveFilteredEmpty')}
              </EmptyState>
            ) : (
              <EmptyState icon="news">{t('archiveEmpty')}</EmptyState>
            )
          ) : (
            <div className="grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-12">
              <div className="flex min-w-0 flex-col gap-8">
                <nav aria-labelledby="news-archive-years" className="flex flex-col gap-3">
                  <h2
                    id="news-archive-years"
                    className="text-sm font-semibold text-foreground-muted"
                  >
                    {t('archiveYears')}
                  </h2>
                  <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                    <li>
                      <FilterLink
                        href={newsArchivePath(locale, {
                          ...filter,
                          year: null,
                          month: null,
                        })}
                        current={filter.year === null}
                      >
                        {t('archiveEveryYear')}
                      </FilterLink>
                    </li>
                    {years.map((entry) => (
                      <li key={entry.year}>
                        <FilterLink
                          href={newsArchivePath(locale, {
                            ...filter,
                            year: entry.year,
                            month: null,
                          })}
                          current={filter.year === entry.year && filter.month === null}
                          partial={filter.year === entry.year && filter.month !== null}
                        >
                          <span className="tabular-nums">
                            {yearText(entry.year, locale)}
                          </span>
                          <span className="ms-1.5 text-foreground-muted tabular-nums">
                            {t('countShort', { count: entry.count })}
                          </span>
                        </FilterLink>
                      </li>
                    ))}
                  </ul>
                </nav>

                {months.length === 0 ? null : (
                  <nav
                    aria-labelledby="news-archive-months"
                    className="flex flex-col gap-3"
                  >
                    <h2
                      id="news-archive-months"
                      className="text-sm font-semibold text-foreground-muted"
                    >
                      {t('archiveMonths')}
                    </h2>
                    <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                      {months.map((entry) => (
                        <li key={entry.month}>
                          <FilterLink
                            href={newsArchivePath(locale, {
                              ...filter,
                              month: entry.month,
                            })}
                            current={filter.month === entry.month}
                          >
                            {monthName(entry.month, locale)}
                            <span className="ms-1.5 text-foreground-muted tabular-nums">
                              {t('countShort', { count: entry.count })}
                            </span>
                          </FilterLink>
                        </li>
                      ))}
                    </ul>
                  </nav>
                )}
              </div>

              <section
                className="flex min-w-0 flex-col gap-5"
                aria-labelledby="news-archive-items"
              >
                <SectionHeader id="news-archive-items" heading={heading} />
                {page.items.length === 0 ? (
                  <EmptyState
                    action={{
                      href: newsArchivePath(locale, {
                        ...filter,
                        year: null,
                        month: null,
                      }),
                      text: t('archiveEveryYear'),
                    }}
                  >
                    {t('archiveFilteredEmpty')}
                  </EmptyState>
                ) : (
                  <NewsChronicle
                    locale={locale}
                    items={page.items}
                    label={heading}
                    showType={kind === null}
                    opening={false}
                    headingLevel="h3"
                  />
                )}
                <Pager
                  label={heading}
                  previous={
                    filter.offset > 0
                      ? newsArchivePath(
                          locale,
                          filter,
                          Math.max(0, filter.offset - NEWS_PAGE),
                        )
                      : null
                  }
                  next={
                    page.more
                      ? newsArchivePath(locale, filter, filter.offset + NEWS_PAGE)
                      : null
                  }
                  previousLabel={t('previous')}
                  nextLabel={t('next')}
                />
              </section>
            </div>
          )}
        </div>
      </Container>
    </>
  );
}

/* ===========================================================================
 * The topic hub's News section
 * ========================================================================= */

/**
 * PHASE 13 — the most recent published News of every family on one topic,
 * composed from Editorial's own public read, never from the search index; and
 * nothing at all when none is published on it.
 */
export async function NewsTopicSection({
  locale,
  topicId,
  heading,
  headingId,
}: {
  readonly locale: Locale;
  readonly topicId: string;
  readonly heading: string;
  readonly headingId: string;
}) {
  const page = await editorialReadRuntime().newsOnTopic(topicId);
  if (page.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader id={headingId} heading={heading} />
      <NewsGrid
        locale={locale}
        items={page.items}
        label={heading}
        showType
        headingLevel="h3"
      />
    </section>
  );
}
