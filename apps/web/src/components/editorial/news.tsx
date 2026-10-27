import 'server-only';

import type { ReactNode } from 'react';
import { cache } from 'react';
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
  newsStructuredData,
  readNewsArchiveQuery,
  readNewsOffset,
  translationFor,
} from '@/components/editorial/presentation';
import {
  CARD_RAISED,
  CARD_SURFACE,
  CARD_TITLE_LINK,
  LandingFrame,
  ListingIntro,
  RecordSection,
} from '@/components/editorial/frame';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  CardGrid,
  Container,
  DetailRow,
  EmptyState,
  FilterLink,
  LinkCard,
  MetaRow,
  Panel,
  Prose,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { pathFor, requireRoute } from '@/shell/registry';

/**
 * The public News surfaces — `/news`, the three family listings, every detail
 * page and the News archive (ROUTE_MAP.md §3.9). Phase 13.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/editorial-read` and `@/composition/public-references`, which
 * reach Editorial's public reader, People's reader and Taxonomy and nothing
 * else — no session, no identity service, no cookie — so a signed-in visitor
 * and an anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * TEXT, NOT PICTURES. News has no image: its dependencies are Editorial and
 * Search, not Storage or Media. A card is its type, its date, its headline, its
 * own summary, its byline and its topics — each shown only where the record
 * genuinely has it — and never a placeholder picture or a stock image.
 *
 * ONE PAGE OF NAMES PER PAGE. Contributors and topics of every card on a page
 * are resolved by their owners in two calls, never one per card.
 */

type NewsTranslator = Awaited<ReturnType<typeof getTranslations<'news'>>>;
type EditorialTranslator = Awaited<ReturnType<typeof getTranslations<'editorial'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;
type Query = Record<string, string | string[] | undefined>;

/** A page address at an offset; the first page is the bare address. */
function offsetPath(path: string, offset: number): string {
  return offset === 0 ? path : `${path}?offset=${String(offset)}`;
}

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
    home: { href: `/${locale}`, text: shell('nav.home') },
    news: { href: `/${locale}/news`, text: t('title') },
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

/** The News sections, as a small navigation of their own. */
function NewsSections({
  locale,
  current,
  t,
}: {
  readonly locale: Locale;
  readonly current: NewsKind | 'archive';
  readonly t: NewsTranslator;
}) {
  const entries = [
    ...NEWS_KINDS.map((kind) => ({
      key: kind as NewsKind | 'archive',
      href: `/${locale}${newsListPathOf(kind)}`,
      text: t(`families.${kind}`),
    })),
    { key: 'archive' as const, href: `/${locale}/news/archive`, text: t('archive') },
  ];
  return (
    <nav aria-label={t('sectionsLabel')}>
      <ul className="flex list-none flex-wrap gap-2 p-0">
        {entries.map((entry) => (
          <li key={entry.key}>
            <FilterLink href={entry.href} current={entry.key === current}>
              {entry.text}
            </FilterLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** The type of a record, in words — never a colour alone. */
function TypeLabel({ children }: { readonly children: ReactNode }) {
  return (
    <span className="font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
      {children}
    </span>
  );
}

/**
 * How a card sits in its list: an ordinary `card`; the `lead` story that opens
 * the first page of `/news`; or a `compact` one beside it, headline and date
 * only. The record and its links are the same in every variant.
 */
type NewsCardVariant = 'card' | 'lead' | 'compact';

const HEADLINE_SIZE: Record<NewsCardVariant, string> = {
  card: 'text-subheading',
  lead: 'text-heading',
  compact: 'text-base',
};

/**
 * ONE CARD. The headline in its own language and direction, a type label, the
 * genuine publication date, the record's own summary, and — only where the
 * record has them — the issuing authority, the outlet, the byline and the
 * topics. No body text, no picture.
 *
 * The headline is the card's one stretched link; the byline and the topics sit
 * above it as links of their own (see `CARD_SURFACE`).
 */
function NewsCard({
  locale,
  item,
  names,
  t,
  showType,
  headingLevel,
  variant = 'card',
  className = '',
}: {
  readonly locale: Locale;
  readonly item: NewsSummary;
  readonly names: Names;
  readonly t: NewsTranslator;
  readonly showType: boolean;
  readonly headingLevel: 'h2' | 'h3';
  readonly variant?: NewsCardVariant;
  readonly className?: string;
}) {
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const date = publishedDate(item.publishedAt, locale);
  const compact = variant === 'compact';
  const lead = variant === 'lead';
  const authors = item.contributors.flatMap((credit) => {
    const person =
      credit.role === 'author' ? names.people.get(credit.personId) : undefined;
    return person === undefined ? [] : [person];
  });
  const topics = item.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  return (
    <li
      className={`${CARD_SURFACE} ${
        lead ? 'gap-4 border-t-4 border-t-[color:var(--color-accent)] sm:p-7' : ''
      } ${className}`}
    >
      <article className="flex min-w-0 flex-1 flex-col gap-3">
        <MetaRow
          items={[
            showType ? <TypeLabel key="type">{t(`type.${item.kind}`)}</TypeLabel> : null,
            <time key="date" dateTime={date.machine}>
              {date.text}
            </time>,
          ]}
        />
        <Heading
          className={`${HEADLINE_SIZE[variant]} leading-snug font-semibold text-balance wrap-anywhere`}
          lang={translation.languageCode}
          dir={direction}
        >
          <a
            href={`/${locale}${newsPathOf(item.kind, item.slug)}`}
            className={CARD_TITLE_LINK}
          >
            {translation.title}
          </a>
        </Heading>
        {translation.issuer ? (
          <p
            className="text-sm font-medium"
            lang={translation.languageCode}
            dir={direction}
          >
            {t('issuedBy', { issuer: translation.issuer })}
          </p>
        ) : null}
        {item.coverage === null ? null : (
          <p className="text-sm wrap-anywhere" dir="auto">
            {t('coverageOf', { outlet: item.coverage.outlet })}
          </p>
        )}
        {compact || translation.excerpt === '' ? null : (
          <p
            className={`wrap-anywhere text-[color:var(--color-foreground-muted)] ${
              lead ? 'text-lede line-clamp-5' : 'line-clamp-3 text-sm'
            }`}
            lang={translation.languageCode}
            dir={direction}
          >
            {translation.excerpt}
          </p>
        )}
        {compact || authors.length === 0 ? null : (
          <p className={`${CARD_RAISED} mt-auto text-sm`} dir="auto">
            {authors.map((person, index) => (
              <span key={person.slug}>
                {index === 0 ? null : ' · '}
                <TextLink href={`/${locale}/people/${encodeURIComponent(person.slug)}`}>
                  {person.name}
                </TextLink>
              </span>
            ))}
          </p>
        )}
        {compact || topics.length === 0 ? null : (
          <div className={CARD_RAISED}>
            <TopicChips
              label={t('topics')}
              topics={topics.map((topic) => ({
                href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                text: topic.name,
              }))}
            />
          </div>
        )}
      </article>
    </li>
  );
}

const GRID_COLUMNS = {
  2: 'sm:grid-cols-2',
  3: 'sm:grid-cols-2 lg:grid-cols-3',
} as const;

/**
 * A grid of cards, with its names resolved once. Also composed by the home
 * page, a Centre page and the topic hub. `chronicle` opens the grid with a lead
 * story and two compact ones beside it — the first page of `/news`.
 */
export async function NewsGrid({
  locale,
  items,
  label,
  showType,
  headingLevel = 'h2',
  columns = 2,
  chronicle = false,
}: {
  readonly locale: Locale;
  readonly items: readonly NewsSummary[];
  readonly label: string;
  readonly showType: boolean;
  readonly headingLevel?: 'h2' | 'h3';
  readonly columns?: 2 | 3;
  readonly chronicle?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const names = await namesFor(items, locale);
  const lead = chronicle && items.length >= 3;
  return (
    <ul
      className={`grid list-none grid-cols-1 gap-4 p-0 ${GRID_COLUMNS[lead ? 3 : columns]}`}
      aria-label={label}
    >
      {items.map((item, index) => (
        <NewsCard
          key={`${item.kind}:${item.slug}`}
          locale={locale}
          item={item}
          names={names}
          t={t}
          showType={showType}
          headingLevel={headingLevel}
          variant={
            !lead ? 'card' : index === 0 ? 'lead' : index <= 2 ? 'compact' : 'card'
          }
          className={lead && index === 0 ? 'sm:col-span-2 lg:row-span-2' : ''}
        />
      ))}
    </ul>
  );
}

/* ===========================================================================
 * /news — News and Events
 * ========================================================================= */

/** How many of each other family the landing previews. */
const FAMILY_PREVIEW = 3;

/**
 * `/news` — the News and Events entry point, `?sort=latest` (ROUTE_MAP.md §3.9).
 *
 * THE LATEST NEWSARTICLES FIRST, paginated, because `/news` is the NewsArticle
 * collection. `?sort=latest` is the only order that exists — there is no
 * popularity, no view count and no featured flag — so the query names the
 * default and both are canonical to `/news`. The first page reads as an
 * editorial chronology: the newest report leads, the next two sit beside it,
 * and the rest follow in order — a position earned by date alone, never an
 * editorial "featured" claim the data does not make.
 *
 * On the first page, each other family previews its latest records, and the
 * photograph surfaces Phase 12 delivered are linked; a family with nothing
 * published says so in its own listing rather than rendering an empty frame
 * here. Events (Phase 14) are linked as the other half of News and Events, and
 * Collections (Phase 15) beside the archive; the newsletter is not linked from
 * News.
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
  const reads = editorialReadRuntime();
  const [latest, ...families] = await Promise.all([
    reads.newsList('news-article', offset),
    ...(offset === 0
      ? (['press-release', 'statement', 'media-coverage'] as const).map((kind) =>
          reads.newsList(kind, 0),
        )
      : []),
  ]);
  const base = `/${locale}/news`;
  const others = (['press-release', 'statement', 'media-coverage'] as const).flatMap(
    (kind, index) => {
      const page = families[index];
      return page === undefined || page.items.length === 0
        ? []
        : [{ kind, items: page.items.slice(0, FAMILY_PREVIEW) }];
    },
  );

  return (
    <>
      <LandingFrame
        tone="ink"
        trailLabel={trail.label}
        trail={[trail.home, { text: t('title') }]}
        title={t('title')}
        lede={t('description')}
        actions={
          <>
            <ActionLink href={pathFor(locale, requireRoute('events'))} onInk>
              {t('events')}
            </ActionLink>
            <ActionLink href={`/${locale}/news/archive`} tone="secondary" onInk>
              {t('archive')}
            </ActionLink>
          </>
        }
      />

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-page)]">
          <NewsSections locale={locale} current="news-article" t={t} />

          <section className="flex flex-col gap-5" aria-labelledby="news-latest">
            <SectionHeader
              id="news-latest"
              heading={t('latest')}
              intro={t('familyBody.news-article')}
            />
            {latest.items.length === 0 ? (
              <EmptyState>
                {offset === 0 ? (
                  t('empty.news-article')
                ) : (
                  <span className="flex flex-col gap-2">
                    <span>{t('pageEmpty')}</span>
                    <TextLink href={base}>{t('firstPage')}</TextLink>
                  </span>
                )}
              </EmptyState>
            ) : (
              <NewsGrid
                locale={locale}
                items={latest.items}
                label={t('latest')}
                showType={false}
                headingLevel="h3"
                columns={3}
                chronicle={offset === 0}
              />
            )}
            <Pagination
              label={t('latest')}
              previous={
                offset > 0 ? offsetPath(base, Math.max(0, offset - NEWS_PAGE)) : null
              }
              next={latest.more ? offsetPath(base, offset + NEWS_PAGE) : null}
              previousLabel={t('previous')}
              nextLabel={t('next')}
            />
          </section>

          {others.map(({ kind, items }) => (
            <section
              key={kind}
              className="flex flex-col gap-5"
              aria-labelledby={`news-${kind}`}
            >
              <SectionHeader
                id={`news-${kind}`}
                heading={t(`families.${kind}`)}
                intro={t(`familyBody.${kind}`)}
                action={{
                  href: `/${locale}${newsListPathOf(kind)}`,
                  text: t(`all.${kind}`),
                }}
              />
              <NewsGrid
                locale={locale}
                items={items}
                label={t(`families.${kind}`)}
                showType={false}
                headingLevel="h3"
                columns={3}
              />
            </section>
          ))}

          {offset === 0 ? (
            <section className="flex flex-col gap-5" aria-labelledby="news-browse">
              <SectionHeader id="news-browse" heading={t('browse')} />
              <CardGrid>
                {(['press-release', 'statement', 'media-coverage'] as const).map(
                  (kind) => (
                    <LinkCard
                      key={kind}
                      href={`/${locale}${newsListPathOf(kind)}`}
                      title={t(`families.${kind}`)}
                      description={t(`familyBody.${kind}`)}
                    />
                  ),
                )}
                <LinkCard
                  href={pathFor(locale, requireRoute('events'))}
                  title={t('events')}
                  description={t('eventsBody')}
                />
                <LinkCard
                  href={pathFor(locale, requireRoute('collections'))}
                  title={t('collections')}
                  description={t('collectionsBody')}
                />
                <LinkCard
                  href={`/${locale}/news/archive`}
                  title={t('archive')}
                  description={t('archiveBody')}
                />
              </CardGrid>
              <Panel>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h3 className="text-subheading font-semibold">{t('media')}</h3>
                    <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
                      {t('mediaBody')}
                    </p>
                  </div>
                  <ul className="flex shrink-0 list-none flex-wrap gap-2 p-0">
                    {(['photos', 'galleries', 'archive'] as const).map((surface) => (
                      <li key={surface}>
                        <ActionLink
                          href={pathFor(locale, requireRoute(`media.${surface}`))}
                          tone="secondary"
                        >
                          {photos(`sections.${surface}`)}
                        </ActionLink>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
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
  const page = await editorialReadRuntime().newsList(kind, offset);
  const title = t(`families.${kind}`);
  const base = `/${locale}${newsListPathOf(kind)}`;

  return (
    <>
      <ListingIntro
        trailLabel={trail.label}
        trail={[trail.home, trail.news, { text: title }]}
        eyebrow={t('title')}
        title={title}
        lede={t(`familyBody.${kind}`)}
      >
        <NewsSections locale={locale} current={kind} t={t} />
      </ListingIntro>
      <Container>
        <div className="flex flex-col gap-6 py-[var(--space-page)]">
          {page.items.length === 0 ? (
            <EmptyState>
              {offset === 0 ? (
                t(`empty.${kind}`)
              ) : (
                <span className="flex flex-col gap-2">
                  <span>{t('pageEmpty')}</span>
                  <TextLink href={base}>{t('firstPage')}</TextLink>
                </span>
              )}
            </EmptyState>
          ) : (
            <NewsGrid
              locale={locale}
              items={page.items}
              label={title}
              showType={false}
              columns={3}
            />
          )}
          <Pagination
            label={title}
            previous={
              offset > 0 ? offsetPath(base, Math.max(0, offset - NEWS_PAGE)) : null
            }
            next={page.more ? offsetPath(base, offset + NEWS_PAGE) : null}
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

/** The locales the record genuinely exists in — never widened by a fallback. */
function newsLocales(record: PublicNews): Locale[] {
  return record.translations.map((row) => row.languageCode);
}

/**
 * A record page: the story's own column at a reading measure, and beside it on
 * a wide screen (beneath it on a phone) the record's facts and provenance.
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
  const [names, languages, centre] = await Promise.all([
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
  ]);
  const centreLabel = centre === null ? null : labelFor(centre, locale);
  const date = publishedDate(record.publishedAt, locale);
  const familyTitle = t(`families.${record.kind}`);
  const familyPath = newsListPathOf(record.kind);
  const credits = record.contributors.flatMap((credit) => {
    const person = names.people.get(credit.personId);
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const authors = credits.filter((credit) => credit.role === 'author');
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const coverage = record.coverage;
  const contentLocales = newsLocales(record);
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
      : [{ href: `/${locale}${familyPath}`, text: familyTitle }]),
    { text: translation.title },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={trail.label} trail={crumbs} />

        {/* THE HEADER: what it is and when, the headline, its standfirst. */}
        <header className="flex max-w-3xl flex-col gap-4 border-b border-[color:var(--color-border)] pb-8">
          <div className="text-caption">
            <MetaRow
              items={[
                <TypeLabel key="type">{t(`type.${record.kind}`)}</TypeLabel>,
                <time key="date" dateTime={date.machine}>
                  {date.text}
                </time>,
              ]}
            />
          </div>
          {translation.languageCode === locale ? null : (
            <Alert tone="info">
              {t('fallback', {
                language:
                  languages.get(translation.languageCode)?.name ??
                  translation.languageCode,
              })}
            </Alert>
          )}
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
              <p className="text-lede max-w-[var(--measure-prose)] text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            )}
          </div>
          {authors.length === 0 ? null : (
            <p className="text-sm" dir="auto">
              {authors.map(({ person }, index) => (
                <span key={person.slug}>
                  {index === 0 ? null : ' · '}
                  <TextLink href={`/${locale}/people/${encodeURIComponent(person.slug)}`}>
                    {person.name}
                  </TextLink>
                </span>
              ))}
            </p>
          )}
        </header>

        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-14">
          <div className="flex min-w-0 flex-col gap-6">
            {coverage === null ? null : (
              <p
                className="max-w-[var(--measure-prose)] rounded-[var(--radius-control)] border-s-4 border-[color:var(--color-accent-rule)] bg-[color:var(--color-accent-surface)] px-4 py-3 text-sm"
                dir="auto"
              >
                {t('coverageNotice', { outlet: coverage.outlet })}
              </p>
            )}
            <Prose>
              <div
                className="editorial-prose"
                lang={translation.languageCode}
                dir={direction}
                dangerouslySetInnerHTML={{ __html: translation.html }}
              />
            </Prose>
          </div>

          <aside className="flex min-w-0 flex-col gap-8">
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
                      className="inline-flex min-h-11 flex-wrap items-center gap-x-1 font-medium wrap-anywhere text-[color:var(--color-action)] underline underline-offset-2"
                    >
                      <span dir="auto">
                        {t('sourceLink', { outlet: coverage.outlet })}
                      </span>{' '}
                      <span className="text-[color:var(--color-foreground-muted)]">
                        {t('sourceExternal')}
                      </span>
                    </a>
                  </p>
                )}
              </RecordSection>
            )}

            <RecordSection id="news-facts" heading={t('facts')}>
              <dl className="flex flex-col">
                <DetailRow term={t('published')}>
                  <time dateTime={date.machine}>{date.text}</time>
                </DetailRow>
                {translation.issuer ? (
                  <DetailRow term={t('issuer')}>
                    <span lang={translation.languageCode} dir={direction}>
                      {translation.issuer}
                    </span>
                  </DetailRow>
                ) : null}
                {credits.length === 0 ? null : (
                  <DetailRow term={t('contributors')}>
                    <ul className="flex flex-col gap-1">
                      {credits.map(({ person, role }) => (
                        <li key={`${person.slug}:${role}`} dir="auto">
                          <TextLink
                            href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
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
              {topics.length === 0 ? null : (
                <div className="flex flex-col gap-2">
                  <p className="text-xs text-[color:var(--color-foreground-muted)]">
                    {t('topics')}
                  </p>
                  <TopicChips
                    label={t('topics')}
                    topics={topics.map((topic) => ({
                      href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                      text: topic.name,
                    }))}
                  />
                </div>
              )}
            </RecordSection>

            <p>
              <ActionLink href={`/${locale}${familyPath}`} tone="secondary">
                {t(`all.${record.kind}`)}
              </ActionLink>
            </p>
          </aside>
        </div>

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: shell('nav.home'), path: `/${translation.languageCode}` },
            { name: t('title'), path: `/${translation.languageCode}/news` },
            ...(record.kind === 'news-article'
              ? []
              : [
                  {
                    name: familyTitle,
                    path: `/${translation.languageCode}${familyPath}`,
                  },
                ]),
            {
              name: translation.title,
              path: `/${translation.languageCode}${newsPathOf(record.kind, record.slug)}`,
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
 * first, browsed by the UTC year and month of its GENUINE publication instant —
 * never a record's creation time. Each card says which family it is. On a wide
 * screen the years and months sit beside the results as an index; on a phone
 * they come first.
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
  const filter = readNewsArchiveQuery(query);
  const reads = editorialReadRuntime();
  const [periods, page] = await Promise.all([
    reads.newsArchivePeriods(),
    reads.newsArchive(filter),
  ]);
  const years = [...new Set(periods.map((period) => period.year))].map((year) => ({
    year,
    count: periods
      .filter((period) => period.year === year)
      .reduce((total, period) => total + period.count, 0),
  }));
  const months =
    filter.year === null ? [] : periods.filter((period) => period.year === filter.year);
  const heading =
    filter.year === null
      ? t('archiveAll')
      : filter.month === null
        ? t('archiveYear', { year: yearText(filter.year, locale) })
        : t('archiveMonth', {
            month: monthName(filter.month, locale),
            year: yearText(filter.year, locale),
          });

  return (
    <>
      <ListingIntro
        trailLabel={trail.label}
        trail={[trail.home, trail.news, { text: t('archive') }]}
        eyebrow={t('title')}
        title={t('archive')}
        lede={t('archiveBody')}
      >
        <NewsSections locale={locale} current="archive" t={t} />
      </ListingIntro>

      <Container>
        <div className="py-[var(--space-page)]">
          {years.length === 0 ? (
            <EmptyState>{t('archiveEmpty')}</EmptyState>
          ) : (
            <div className="grid gap-10 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-12">
              <div className="flex min-w-0 flex-col gap-8">
                <nav aria-label={t('archiveYears')} className="flex flex-col gap-3">
                  <h2 className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-foreground-muted)] uppercase">
                    {t('archiveYears')}
                  </h2>
                  <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                    <li>
                      <FilterLink
                        href={newsArchivePath(locale, { year: null, month: null })}
                        current={filter.year === null}
                      >
                        {t('archiveEveryYear')}
                      </FilterLink>
                    </li>
                    {years.map((entry) => (
                      <li key={entry.year}>
                        <FilterLink
                          href={newsArchivePath(locale, {
                            year: entry.year,
                            month: null,
                          })}
                          current={filter.year === entry.year && filter.month === null}
                          partial={filter.year === entry.year && filter.month !== null}
                        >
                          {yearText(entry.year, locale)}
                          <span className="ms-1 text-[color:var(--color-foreground-muted)]">
                            ({t('countShort', { count: entry.count })})
                          </span>
                        </FilterLink>
                      </li>
                    ))}
                  </ul>
                </nav>

                {months.length === 0 ? null : (
                  <nav aria-label={t('archiveMonths')} className="flex flex-col gap-3">
                    <h2 className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-foreground-muted)] uppercase">
                      {t('archiveMonths')}
                    </h2>
                    <ul className="flex list-none flex-wrap gap-2 p-0 lg:flex-col">
                      {months.map((entry) => (
                        <li key={entry.month}>
                          <FilterLink
                            href={newsArchivePath(locale, {
                              year: filter.year,
                              month: entry.month,
                            })}
                            current={filter.month === entry.month}
                          >
                            {monthName(entry.month, locale)}
                            <span className="ms-1 text-[color:var(--color-foreground-muted)]">
                              ({t('countShort', { count: entry.count })})
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
                  <EmptyState>
                    <span className="flex flex-col gap-2">
                      <span>{t('archiveFilteredEmpty')}</span>
                      <TextLink
                        href={newsArchivePath(locale, { year: null, month: null })}
                      >
                        {t('archiveEveryYear')}
                      </TextLink>
                    </span>
                  </EmptyState>
                ) : (
                  <NewsGrid
                    locale={locale}
                    items={page.items}
                    label={heading}
                    showType
                    headingLevel="h3"
                  />
                )}
                <Pagination
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
