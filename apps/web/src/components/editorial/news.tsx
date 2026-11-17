import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { cache, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
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
import { newsStructuredData, translationFor } from '@/components/editorial/presentation';
import {
  readingMinutes,
  revisedAfterPublication,
  withContents,
} from '@/components/editorial/long-form';
import { RecordSection } from '@/components/editorial/frame';
import { AuthorChips, Contents, ReadingDates } from '@/components/editorial/reading';
import { newsListingHref } from '@/components/editorial/news-view';
import { BreadcrumbData } from '@/components/media/parts';
import { ShareVideo } from '@/components/media/share';
import { LeadFigure, leadCardImage } from '@/components/editorial/lead-image';
import { caseless } from '@/components/topic-hub/address';
import {
  Badge,
  Breadcrumbs,
  Container,
  DetailRow,
  EditorialCard,
  Icon,
  LanguageBadge,
  ListRow,
  MediaCard,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import { absoluteUrl } from '@/config/origin';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';

/**
 * The public News surfaces' SHARED PARTS, a record's page and the topic hub's
 * News section (ROUTE_MAP.md §3.9). Phase 13; redesigned in R2; the listings
 * (`./news-listing`) and the archive (`./news-archive`) rebuilt in News &
 * Events Part 1, and the record page with them.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/editorial-read` and `@/composition/public-references`, which
 * reach Editorial's public reader, People's reader and Taxonomy and nothing
 * else — no session, no identity service, no cookie — so a signed-in visitor
 * and an anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * THE READER'S LANGUAGE FIRST, EVERY LANGUAGE VISIBLE (audit F10). Any card
 * whose words are not in the interface language says which language they are
 * in.
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

export type NewsTranslator = Awaited<ReturnType<typeof getTranslations<'news'>>>;
type EditorialTranslator = Awaited<ReturnType<typeof getTranslations<'editorial'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

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

/** A month's name in the interface language. */
export function monthName(month: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(2000, month - 1, 1)),
  );
}

/** A year as the interface language writes it. */
export function yearText(year: number, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, 0, 1)),
  );
}

/** Home / News and Events / … — the trail every News page starts with. */
export async function newsTrail(locale: Locale) {
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
  const people = caseless(names.people);
  const authors = item.contributors.flatMap((credit) => {
    const person =
      credit.role === 'author' ? people.get(credit.personId.toLowerCase()) : undefined;
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
      <span key="outlet" dir="auto">
        {t('coverageOf', { outlet: item.coverage.outlet })}
      </span>
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
 * family shelves on `/news`, a record's related shelves, a Centre page and the
 * topic hub.
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
 * A CHRONICLE: when `opening`, the first story leads, wide, with the next
 * three beside it; every other story follows as a row with its thumbnail.
 * Otherwise rows only.
 */
export async function NewsChronicle({
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
  /** Open with the lead story (the newest-first order's first page). */
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

/* ===========================================================================
 * A record's page
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

/** How many records each related shelf of a record's page shows. */
const RELATED = 3;
/** How many a family read asks for, so that what is excluded still leaves a shelf. */
const RELATED_ASK = 10;

/** One "more like this" shelf: what relates it, and the way to all of them. */
interface RelatedShelf {
  readonly key: 'topic' | 'kind';
  readonly heading: string;
  readonly more: { readonly href: string; readonly text: string };
  readonly items: readonly NewsSummary[];
  readonly showType: boolean;
}

/**
 * WHAT ELSE TO READ — composed from Editorial's own public reads, so
 * "related" is a fact the records state, never a recommendation: more on the
 * record's first Topic (any family), then more of its own family. Never the
 * record itself, never one its newer/older links already offer, never one
 * record twice.
 */
async function relatedNews(
  locale: Locale,
  record: PublicNews,
  exclude: readonly NewsSummary[],
  topic: { readonly id: string; readonly name: string; readonly slug: string } | null,
  t: NewsTranslator,
): Promise<readonly RelatedShelf[]> {
  const reads = editorialReadRuntime();
  const [onTopic, family] = await Promise.all([
    topic === null ? null : reads.newsOnTopic(topic.id),
    reads.newsListing({ kind: record.kind, prefer: locale, limit: RELATED_ASK }),
  ]);
  const key = (item: { readonly kind: NewsKind; readonly slug: string }) =>
    `${item.kind}:${item.slug}`;
  const seen = new Set([key(record), ...exclude.map(key)]);
  const take = (items: readonly NewsSummary[]) => {
    const chosen = items.filter((item) => !seen.has(key(item))).slice(0, RELATED);
    for (const item of chosen) seen.add(key(item));
    return chosen;
  };
  const shelves: RelatedShelf[] = [];
  if (topic !== null && onTopic !== null) {
    const items = take(onTopic.items);
    if (items.length > 0)
      shelves.push({
        key: 'topic',
        heading: t('detail.relatedTopic', { topic: topic.name }),
        more: {
          href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
          text: t('detail.topicHub', { topic: topic.name }),
        },
        items,
        showType: true,
      });
  }
  const items = take(family.items);
  if (items.length > 0)
    shelves.push({
      key: 'kind',
      heading: t(`detail.more.${record.kind}`),
      more: {
        href: localizedPath(locale, newsListPathOf(record.kind)),
        text: t(`all.${record.kind}`, { count: family.total }),
      },
      items,
      showType: false,
    });
  return shelves;
}

/** A newer or older record of the same family, its direction named first. */
async function KindStep({
  locale,
  item,
  direction,
  t,
}: {
  readonly locale: Locale;
  readonly item: NewsSummary;
  readonly direction: 'newer' | 'older';
  readonly t: NewsTranslator;
}) {
  const translation = translationFor(item, locale);
  const date = publishedDate(item.chronologyAt, locale);
  return (
    <a
      href={localizedPath(locale, newsPathOf(item.kind, item.slug))}
      className={`group flex min-h-11 min-w-0 flex-col gap-1 rounded-control border border-border bg-surface p-4 no-underline hover:border-action ${direction === 'older' ? 'sm:col-start-2 sm:items-end sm:text-end' : ''}`}
    >
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-action">
        {direction === 'newer' ? <Icon name="arrow-start" size={16} /> : null}
        {t(`detail.${direction}.${item.kind}`)}
        {direction === 'older' ? <Icon name="arrow-end" size={16} /> : null}
      </span>
      <span
        className="font-medium wrap-anywhere text-foreground group-hover:underline"
        lang={translation.languageCode}
        dir={directionOf(translation.languageCode)}
      >
        {translation.title}
      </span>
      <time dateTime={date.machine} className="text-caption text-foreground-muted">
        {date.text}
      </time>
    </a>
  );
}

/**
 * A record page, set for reading: the header (type, headline, standfirst,
 * issuer or outlet, byline, dates, reading time and Share), the lead picture
 * with its credit, then the story at a reading measure with its contents
 * beside it when it has sections; then where it came from (media coverage),
 * what it is about and in which languages it can be read; its newer and older
 * neighbours in its own family; and related reading.
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
  const [shell, watch, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'watch' }),
    newsTrail(locale),
  ]);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const [names, languages, centre, neighbours] = await Promise.all([
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
    editorialReadRuntime().newsNeighbours(record.kind, record.slug),
  ]);
  const people = caseless(names.people);
  const topicNames = caseless(names.topics);
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
    const person = people.get(credit.personId.toLowerCase());
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const authors = credits.filter((credit) => credit.role === 'author');
  const others = credits.filter((credit) => credit.role !== 'author');
  const topics = record.topicIds.flatMap((id) => {
    const topic = topicNames.get(id.toLowerCase());
    return topic === undefined ? [] : [{ id, ...topic }];
  });
  const coverage = record.coverage;
  const contentLocales = record.translations.map((row) => row.languageCode);
  const otherLanguages = contentLocales.filter(
    (code) => code !== translation.languageCode,
  );
  const body = withContents(translation.html);
  const minutes = readingMinutes(translation.html);
  const structured = newsStructuredData(
    record,
    locale,
    authors.map((credit) => credit.person),
  );
  const newer = neighbours.newer;
  const older = neighbours.older;
  const related = await relatedNews(
    locale,
    record,
    [newer, older].flatMap((item) => (item === null ? [] : [item])),
    topics[0] ?? null,
    t,
  );
  const address = localizedPath(locale, newsPathOf(record.kind, record.slug));

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
      <article className="flex min-w-0 flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={trail.label} trail={crumbs} />

        <header className="flex max-w-3xl min-w-0 flex-col gap-5">
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
              <p className="flex items-start gap-2 text-base font-medium">
                <Icon name="info" size={16} className="mt-1 shrink-0 text-accent" />
                <span>{t('issuedBy', { issuer: translation.issuer })}</span>
              </p>
            ) : null}
            {translation.excerpt === '' ? null : (
              <p className="reading-face text-lede max-w-[var(--measure-prose)] text-foreground-muted">
                {translation.excerpt}
              </p>
            )}
          </div>
          {coverage === null ? null : (
            <p className="text-base font-medium" dir="auto">
              {t('coverageOf', { outlet: coverage.outlet })}
              {coverage.sourceDate === null ? null : (
                <>
                  {' · '}
                  <time
                    dateTime={coverage.sourceDate}
                    className="font-normal text-foreground-muted"
                  >
                    {calendarDate(coverage.sourceDate, locale)}
                  </time>
                </>
              )}
            </p>
          )}
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
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <AuthorChips
              locale={locale}
              label={t('authors')}
              people={authors.map((credit) => credit.person)}
            />
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <ReadingDates
                dates={[
                  { term: t('published'), ...date },
                  ...(updated === null ? [] : [{ term: t('updated'), ...updated }]),
                ]}
              />
              {minutes === null ? null : (
                <p className="text-sm text-foreground-muted">
                  {t('detail.readingTime', { minutes })}
                </p>
              )}
              <ShareVideo
                url={absoluteUrl(address)}
                title={translation.title}
                labels={{
                  share: watch('share.action'),
                  copied: watch('share.copied'),
                  failed: watch('share.failed'),
                }}
              />
            </div>
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
                className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-3 text-sm text-foreground-muted"
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

            <div className="flex max-w-[70ch] min-w-0 flex-col gap-8">
              {coverage === null ? null : (
                <RecordSection id="news-source" heading={t('source')}>
                  <dl className="flex flex-col">
                    <DetailRow term={t('outlet')}>
                      <TextLink
                        href={newsListingHref(locale, 'media-coverage', {
                          outlet: coverage.outlet,
                        })}
                      >
                        <span dir="auto">
                          {t('detail.outletAll', { outlet: coverage.outlet })}
                        </span>
                      </TextLink>
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
                        className="inline-flex min-h-11 flex-wrap items-center gap-x-1.5 font-medium wrap-anywhere text-action underline underline-offset-2"
                      >
                        <span dir="auto">
                          {t('sourceLink', { outlet: coverage.outlet })}
                        </span>{' '}
                        <span className="text-foreground-muted">
                          {t('sourceExternal')}
                        </span>
                        <Icon name="external" size={16} className="shrink-0" />
                      </a>
                    </p>
                  )}
                </RecordSection>
              )}

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
                  <DetailRow term={t('detail.kind')}>
                    <TextLink href={localizedPath(locale, familyPath)}>
                      {familyTitle}
                    </TextLink>
                  </DetailRow>
                  {otherLanguages.length === 0 ? null : (
                    <DetailRow term={t('detail.alsoIn')}>
                      <ul className="flex flex-wrap gap-x-4 gap-y-1">
                        {otherLanguages.map((code) => (
                          <li key={code}>
                            <TextLink
                              href={localizedPath(
                                code,
                                newsPathOf(record.kind, record.slug),
                              )}
                            >
                              <span lang={code} dir={directionOf(code)}>
                                {endonymOf(code)}
                              </span>
                            </TextLink>
                          </li>
                        ))}
                      </ul>
                    </DetailRow>
                  )}
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
            </div>
          </div>
        </div>

        {newer === null && older === null ? null : (
          <nav
            aria-label={t(`detail.kindNav.${record.kind}`)}
            className="grid gap-3 border-t border-border pt-[var(--space-page)] sm:grid-cols-2"
          >
            {newer === null ? null : (
              <KindStep locale={locale} item={newer} direction="newer" t={t} />
            )}
            {older === null ? null : (
              <KindStep locale={locale} item={older} direction="older" t={t} />
            )}
          </nav>
        )}

        {related.map((shelf) => (
          <section
            key={shelf.key}
            className="flex flex-col gap-6 border-t border-border pt-[var(--space-page)]"
            aria-labelledby={`news-related-${shelf.key}`}
          >
            <SectionHeader
              id={`news-related-${shelf.key}`}
              heading={shelf.heading}
              action={shelf.more}
            />
            <NewsGrid
              locale={locale}
              items={shelf.items}
              label={shelf.heading}
              showType={shelf.showType}
              headingLevel="h3"
            />
          </section>
        ))}

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
