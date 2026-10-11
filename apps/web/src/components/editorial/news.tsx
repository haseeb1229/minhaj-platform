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
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  FilterLink,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
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
      <ul className="flex flex-wrap gap-2">
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
    <span className="text-xs font-semibold tracking-wide text-[color:var(--color-action)] uppercase">
      {children}
    </span>
  );
}

/**
 * ONE CARD. The headline in its own language and direction, a type label, the
 * genuine publication date, the record's own summary, and — only where the
 * record has them — the issuing authority, the outlet, the byline and the
 * topics. No body text, no picture.
 */
function NewsCard({
  locale,
  item,
  names,
  t,
  showType,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly item: NewsSummary;
  readonly names: Names;
  readonly t: NewsTranslator;
  readonly showType: boolean;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const translation = translationFor(item, locale);
  const direction = directionOf(translation.languageCode);
  const Heading = headingLevel;
  const date = publishedDate(item.publishedAt, locale);
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
    <Panel as="li">
      <article className="flex min-w-0 flex-col gap-3">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {showType ? <TypeLabel>{t(`type.${item.kind}`)}</TypeLabel> : null}
          <time
            dateTime={date.machine}
            className="text-sm text-[color:var(--color-foreground-muted)]"
          >
            {date.text}
          </time>
        </p>
        <Heading
          className="text-lg leading-snug font-semibold break-words"
          lang={translation.languageCode}
          dir={direction}
        >
          <TextLink href={`/${locale}${newsPathOf(item.kind, item.slug)}`}>
            {translation.title}
          </TextLink>
        </Heading>
        {translation.issuer ? (
          <p className="text-sm" lang={translation.languageCode} dir={direction}>
            {t('issuedBy', { issuer: translation.issuer })}
          </p>
        ) : null}
        {item.coverage === null ? null : (
          <p className="text-sm break-words" dir="auto">
            {t('coverageOf', { outlet: item.coverage.outlet })}
          </p>
        )}
        {translation.excerpt === '' ? null : (
          <p
            className="line-clamp-3 text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={translation.languageCode}
            dir={direction}
          >
            {translation.excerpt}
          </p>
        )}
        {authors.length === 0 ? null : (
          <p className="text-sm" dir="auto">
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
        {topics.length === 0 ? null : (
          <ul className="flex flex-wrap gap-2" aria-label={t('topics')}>
            {topics.map((topic) => (
              <li key={topic.slug}>
                <a
                  href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                  className="inline-flex min-h-8 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border)] px-2 text-xs"
                >
                  {topic.name}
                </a>
              </li>
            ))}
          </ul>
        )}
      </article>
    </Panel>
  );
}

/** A grid of cards, with its names resolved once. Also composed by a Centre page. */
export async function NewsGrid({
  locale,
  items,
  label,
  showType,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly items: readonly NewsSummary[];
  readonly label: string;
  readonly showType: boolean;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const t = await getTranslations({ locale, namespace: 'news' });
  const names = await namesFor(items, locale);
  return (
    <ul className="grid gap-4 sm:grid-cols-2" aria-label={label}>
      {items.map((item) => (
        <NewsCard
          key={`${item.kind}:${item.slug}`}
          locale={locale}
          item={item}
          names={names}
          t={t}
          showType={showType}
          headingLevel={headingLevel}
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
 * default and both are canonical to `/news`. On the first page, each other
 * family previews its latest records, and the photograph surfaces Phase 12
 * delivered are linked; a family with nothing published says so in its own
 * listing rather than rendering an empty frame here. Events (Phase 14) are linked
 * as the other half of News and Events, and Collections (Phase 15) beside the
 * archive; the newsletter is not linked: it does not exist yet.
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
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('description')}</p>
        </Prose>
        <NewsSections locale={locale} current="news-article" t={t} />

        <section className="flex flex-col gap-4" aria-labelledby="news-latest">
          <SectionHeading>
            <span id="news-latest">{t('latest')}</span>
          </SectionHeading>
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
            className="flex flex-col gap-4"
            aria-labelledby={`news-${kind}`}
          >
            <SectionHeading>
              <span id={`news-${kind}`}>{t(`families.${kind}`)}</span>
            </SectionHeading>
            <NewsGrid
              locale={locale}
              items={items}
              label={t(`families.${kind}`)}
              showType={false}
              headingLevel="h3"
            />
            <p>
              <TextLink href={`/${locale}${newsListPathOf(kind)}`}>
                {t(`all.${kind}`)}
              </TextLink>
            </p>
          </section>
        ))}

        {offset === 0 ? (
          <section className="flex flex-col gap-4" aria-labelledby="news-browse">
            <SectionHeading>
              <span id="news-browse">{t('browse')}</span>
            </SectionHeading>
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {(['press-release', 'statement', 'media-coverage'] as const).map((kind) => (
                <Panel key={kind} as="li">
                  <div className="flex flex-col gap-2">
                    <h3 className="text-lg font-semibold">
                      <TextLink href={`/${locale}${newsListPathOf(kind)}`}>
                        {t(`families.${kind}`)}
                      </TextLink>
                    </h3>
                    <p className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t(`familyBody.${kind}`)}
                    </p>
                  </div>
                </Panel>
              ))}
              <Panel as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">
                    <TextLink href={pathFor(locale, requireRoute('events'))}>
                      {t('events')}
                    </TextLink>
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('eventsBody')}
                  </p>
                </div>
              </Panel>
              <Panel as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">
                    <TextLink href={pathFor(locale, requireRoute('collections'))}>
                      {t('collections')}
                    </TextLink>
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('collectionsBody')}
                  </p>
                </div>
              </Panel>
              <Panel as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">
                    <TextLink href={`/${locale}/news/archive`}>{t('archive')}</TextLink>
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('archiveBody')}
                  </p>
                </div>
              </Panel>
              <Panel as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">{t('media')}</h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('mediaBody')}
                  </p>
                  <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                    {(['photos', 'galleries', 'archive'] as const).map((surface) => (
                      <li key={surface}>
                        <TextLink
                          href={pathFor(locale, requireRoute(`media.${surface}`))}
                        >
                          {photos(`sections.${surface}`)}
                        </TextLink>
                      </li>
                    ))}
                  </ul>
                </div>
              </Panel>
            </ul>
          </section>
        ) : null}
      </div>
    </Container>
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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, { text: title }]}
        />
        <Prose>
          <PageHeading>{title}</PageHeading>
          <p>{t(`familyBody.${kind}`)}</p>
        </Prose>
        <NewsSections locale={locale} current={kind} t={t} />
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
          <NewsGrid locale={locale} items={page.items} label={title} showType={false} />
        )}
        <Pagination
          label={title}
          previous={offset > 0 ? offsetPath(base, Math.max(0, offset - NEWS_PAGE)) : null}
          next={page.more ? offsetPath(base, offset + NEWS_PAGE) : null}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
      </div>
    </Container>
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

function Facts({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="news-facts">
      <h2 id="news-facts" className="text-lg font-semibold">
        {title}
      </h2>
      <dl className="grid gap-x-8 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

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
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const coverage = record.coverage;
  const contentLocales = newsLocales(record);
  const structured = newsStructuredData(
    record,
    locale,
    credits.filter((credit) => credit.role === 'author').map((credit) => credit.person),
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
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={crumbs} />

        <Prose>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <TypeLabel>{t(`type.${record.kind}`)}</TypeLabel>
            <time
              dateTime={date.machine}
              className="text-sm text-[color:var(--color-foreground-muted)]"
            >
              {date.text}
            </time>
          </p>
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
            <h1 className="text-3xl leading-tight font-semibold tracking-tight break-words">
              {translation.title}
            </h1>
            {translation.issuer ? (
              <p className="text-base font-medium">
                {t('issuedBy', { issuer: translation.issuer })}
              </p>
            ) : null}
            {translation.excerpt === '' ? null : (
              <p className="text-lg text-[color:var(--color-foreground-muted)]">
                {translation.excerpt}
              </p>
            )}
          </div>
          {coverage === null ? null : (
            <p className="text-sm text-[color:var(--color-foreground-muted)]" dir="auto">
              {t('coverageNotice', { outlet: coverage.outlet })}
            </p>
          )}
          <div
            className="editorial-prose"
            lang={translation.languageCode}
            dir={direction}
            dangerouslySetInnerHTML={{ __html: translation.html }}
          />
        </Prose>

        {coverage === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="news-source">
            <h2 id="news-source" className="text-lg font-semibold">
              {t('source')}
            </h2>
            <dl className="grid gap-x-8 sm:grid-cols-2">
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
                  className="font-medium break-words text-[color:var(--color-action)] underline underline-offset-2"
                >
                  <span dir="auto">{t('sourceLink', { outlet: coverage.outlet })}</span>{' '}
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('sourceExternal')}
                  </span>
                </a>
              </p>
            )}
          </section>
        )}

        <Facts title={t('facts')}>
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
          {topics.length === 0 ? null : (
            <DetailRow term={t('topics')}>
              <ul className="flex flex-wrap gap-x-4 gap-y-1">
                {topics.map((topic) => (
                  <li key={topic.slug}>
                    <TextLink
                      href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}
                    >
                      {topic.name}
                    </TextLink>
                  </li>
                ))}
              </ul>
            </DetailRow>
          )}
          {centre === null || centreLabel === null ? null : (
            <DetailRow term={t('centre')}>
              <TextLink href={globalPaths.centre(locale, centre.slug)}>
                <span lang={centreLabel.locale} dir={directionOf(centreLabel.locale)}>
                  {centreLabel.name}
                </span>
              </TextLink>
            </DetailRow>
          )}
        </Facts>

        <p>
          <TextLink href={`/${locale}${familyPath}`}>{t(`all.${record.kind}`)}</TextLink>
        </p>

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
 * never a record's creation time. Each card says which family it is.
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
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.news, { text: t('archive') }]}
        />
        <Prose>
          <PageHeading>{t('archive')}</PageHeading>
          <p>{t('archiveBody')}</p>
        </Prose>
        <NewsSections locale={locale} current="archive" t={t} />

        {years.length === 0 ? (
          <EmptyState>{t('archiveEmpty')}</EmptyState>
        ) : (
          <>
            <nav aria-label={t('archiveYears')} className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold">{t('archiveYears')}</h2>
              <ul className="flex flex-wrap gap-2">
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
                      href={newsArchivePath(locale, { year: entry.year, month: null })}
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
                <h2 className="text-sm font-semibold">{t('archiveMonths')}</h2>
                <ul className="flex flex-wrap gap-2">
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

            <section className="flex flex-col gap-4" aria-labelledby="news-archive-items">
              <SectionHeading>
                <span id="news-archive-items">{heading}</span>
              </SectionHeading>
              {page.items.length === 0 ? (
                <EmptyState>
                  <span className="flex flex-col gap-2">
                    <span>{t('archiveFilteredEmpty')}</span>
                    <TextLink href={newsArchivePath(locale, { year: null, month: null })}>
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
          </>
        )}
      </div>
    </Container>
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
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
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
