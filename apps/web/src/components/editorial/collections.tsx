import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { cache } from 'react';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  COLLECTION_HOLDS,
  COLLECTION_LISTING_PAGE,
  collectionMemberPathOf,
  holdsOf,
  collectionPathOf,
  isEditorialMemberKind,
  leadImagePath,
  memberToken,
  type CollectionHolds,
  type CollectionListingFacets,
  type CollectionMemberKind,
  type CollectionMemberTarget,
  type CollectionSummary,
  type PublicCollection,
  type PublicLeadImage,
} from '@minhaj/contracts/editorial';

import { resolveCollectionMembers } from '@/composition/collection-members';
import { editorialReadRuntime } from '@/composition/editorial-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import {
  memberTitle,
  memberYear,
  orderMembers,
} from '@/components/editorial/collection-presentation';
import {
  collectionOrderPath,
  collectionsFiltered,
  collectionsHref,
  collectionsListingHref,
  collectionsReadQuery,
  readCollectionOrder,
  type CollectionOrder,
  type CollectionsView,
} from '@/components/editorial/collections-view';
import { translationFor } from '@/components/editorial/presentation';
import { RecordSection } from '@/components/editorial/frame';
import { leadCardImage } from '@/components/editorial/lead-image';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { BreadcrumbData } from '@/components/media/parts';
import { ShareVideo } from '@/components/media/share';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  CountedSelect,
  ExploreFilters,
  ExploreHero,
} from '@/components/topic-hub/parts';
import {
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  Icon,
  LanguageBadge,
  LinkTabs,
  ListRow,
  MediaCard,
  MetaRow,
  Pager,
  ResponsiveImage,
  SectionHeader,
  Select,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf, isSupportedLocale } from '@/config/locale';
import { absoluteUrl } from '@/config/origin';

/**
 * The public Collection surfaces — `/collections`, a Collection and the topic
 * hub's Collections (ROUTE_MAP.md §3.8). Phase 15; redesigned in R2.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through the
 * public composition roots of Editorial, Library, Media, People and Taxonomy —
 * no session, no identity service, no cookie — so a signed-in visitor and an
 * anonymous one receive the same page (ARCHITECTURE.md §8.1).
 *
 * LAYER-4 COMPOSITION, NEVER A JOIN. A Collection names its members by typed
 * identifier. What a visitor sees of a member is what its OWNER says is public
 * NOW — Editorial for Articles and News, Library for Works, Media for Videos —
 * asked once per owner for the whole page. A withdrawn member is simply not
 * shown: no title, picture or address of it reaches the page, and the rest
 * keep their curated order. A failed owner read degrades that owner's members
 * in words and never takes the Collection down or reveals anything unpublished.
 *
 * IMAGE-LED, NOTHING INVENTED (R2, audit F51). A Collection has no picture of
 * its own, so it is shown through its members' OWN first-party lead images: a
 * card takes the first of its leading members that has one, and a Collection's
 * page opens with a mosaic of them. A Collection whose members have none is
 * set as text — never a placeholder.
 */

type CollectionsTranslator = Awaited<ReturnType<typeof getTranslations<'collections'>>>;
type NewsTranslator = Awaited<ReturnType<typeof getTranslations<'news'>>>;
type Query = Record<string, string | string[] | undefined>;

/** Reads one published Collection once per request, for metadata and body alike. */
export const readCollection = cache((slug: string) =>
  editorialReadRuntime().collection(slug),
);

async function collectionsTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'collections' });
  return {
    label: shell('nav.breadcrumbs'),
    homeText: shell('nav.home'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    collections: { href: localizedPath(locale, '/collections'), text: t('title') },
  };
}

/** A member title's language, said in words when it is not the interface's. */
function languageOf(code: string | null, locale: Locale, news: NewsTranslator) {
  return code === null || code === locale || !isSupportedLocale(code)
    ? undefined
    : { label: news(`languages.${code}`), code };
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * Each card's cover: the first of its leading members, in the curated order,
 * whose owner shows a lead image now. Editorial's members only — Library and
 * Media are not asked for pictures here — in ONE bounded owner read for the
 * whole page.
 */
async function coversFor(
  items: readonly CollectionSummary[],
): Promise<ReadonlyMap<string, PublicLeadImage>> {
  const members = items.flatMap((item) =>
    (item.leadMembers ?? []).filter((member) => isEditorialMemberKind(member.kind)),
  );
  if (members.length === 0) return new Map();
  let targets: ReadonlyMap<string, CollectionMemberTarget>;
  try {
    targets = await editorialReadRuntime().memberTargets(members);
  } catch {
    // A cover is presentation: without it the card is set as text.
    return new Map();
  }
  const covers = new Map<string, PublicLeadImage>();
  for (const item of items)
    for (const member of item.leadMembers ?? []) {
      const image = targets.get(memberToken(member))?.leadImage ?? null;
      if (image !== null) {
        covers.set(item.slug, image);
        break;
      }
    }
  return covers;
}

/**
 * The topic names of one page of Collections, in ONE owner read. Topics are a
 * way onwards, not the record: a failed read leaves the cards without chips
 * rather than taking the listing down.
 */
async function topicNamesFor(
  items: readonly CollectionSummary[],
  locale: Locale,
): Promise<ReadonlyMap<string, { slug: string; name: string }>> {
  try {
    return (
      await referenceNames(
        { personIds: [], topicIds: items.flatMap((item) => item.topicIds) },
        locale,
      )
    ).topics;
  } catch {
    return new Map();
  }
}

/**
 * A grid of image-led cards: each Collection's cover (when a member gives it
 * one), its type, its title in its own language and its own summary — the
 * title is the card's one link — and, beneath the card, its topics as links of
 * their own to each topic's page.
 */
async function CollectionGrid({
  locale,
  items,
  label,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly items: readonly CollectionSummary[];
  readonly label: string;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const [news, t, covers, topicNames] = await Promise.all([
    getTranslations({ locale, namespace: 'news' }),
    getTranslations({ locale, namespace: 'collections' }),
    coversFor(items),
    topicNamesFor(items, locale),
  ]);
  return (
    <ul
      className="grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 sm:grid-cols-2 lg:grid-cols-3"
      aria-label={label}
    >
      {items.map((item) => {
        const translation = translationFor(item, locale);
        const cover = covers.get(item.slug);
        const language = languageOf(translation.languageCode, locale, news);
        const topics = item.topicIds.flatMap((id) => {
          const topic = topicNames.get(id);
          return topic === undefined ? [] : [topic];
        });
        return (
          <li key={item.slug} className="flex min-w-0 flex-col gap-3">
            <MediaCard
              as="div"
              href={localizedPath(locale, collectionPathOf(item.slug))}
              type={t('type')}
              title={translation.title}
              description={translation.excerpt}
              lang={translation.languageCode}
              dir={directionOf(translation.languageCode)}
              headingLevel={headingLevel}
              aspect="wide"
              sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
              image={cover === undefined ? null : leadCardImage(cover, '')}
              {...(language === undefined ? {} : { language })}
            />
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
          </li>
        );
      })}
    </ul>
  );
}

/* ===========================================================================
 * /collections
 * ========================================================================= */

/** The listing's figures: how many Collections, the entries they curate, languages. */
function heroStats(
  locale: Locale,
  all: CollectionListingFacets['all'],
  listId: string,
  t: CollectionsTranslator,
) {
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  return [
    ...(all.collections === 0
      ? []
      : [
          {
            value: number(all.collections),
            label: t('listing.stats.collections', { count: all.collections }),
            href: `#${listId}`,
          },
        ]),
    ...(all.entries === 0
      ? []
      : [
          {
            value: number(all.entries),
            label: t('listing.stats.entries', { count: all.entries }),
          },
        ]),
    ...(all.languages < 2
      ? []
      : [
          {
            value: number(all.languages),
            label: t('listing.stats.languages', { count: all.languages }),
          },
        ]),
  ];
}

/**
 * `/collections` — NEWS & EVENTS PART 2, the shared listing pattern over
 * Editorial's Collections: the figures, what a Collection holds as counted
 * tabs (each keeping the view's Topic, language and order), a GET form of
 * counted filters (Topic and content language, each counted under every other
 * filter), two orders, chips that each remove one filter, a range, numbered
 * pages and one address per view (`./collections-view`). The cards are R2's.
 *
 * HONEST STATES: nothing published says so; a view no Collection matches
 * offers to clear its filters; a page past the end leads to the first.
 */
export async function CollectionsPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: CollectionsView;
}) {
  const [t, hub, news, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'collections' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'news' }),
    collectionsTrail(locale),
  ]);
  const reads = editorialReadRuntime();
  const read = collectionsReadQuery(view);
  const [page, facets] = await Promise.all([
    reads.collectionListing(read),
    reads.collectionListingFacets(read),
  ]);
  let topicNames: ReadonlyMap<string, { slug: string; name: string }> = new Map();
  try {
    topicNames = caseless(
      (
        await referenceNames(
          {
            personIds: [],
            topicIds: [
              ...facets.topics.items.map((facet) => facet.id),
              ...(view.topic === null ? [] : [view.topic]),
            ],
          },
          locale,
        )
      ).topics,
    );
  } catch {
    // A Topic's name is Taxonomy's: without it the filter offers no Topic.
  }

  const title = t('title');
  const listId = 'collections-list';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<CollectionsView>) =>
    collectionsHref(locale, view, change);
  const filtered = collectionsFiltered(view);
  // Clearing the filters keeps the order: it is not a narrowing.
  const base = collectionsListingHref(locale, { sort: view.sort });
  const pages = pageCount(page.total, COLLECTION_LISTING_PAGE);
  const range = pageRange(view.page, page.items.length, COLLECTION_LISTING_PAGE);
  const option = (name: string, count: number) => hub('common.option', { name, count });
  const held = new Map(facets.holds.map((entry) => [entry.holds, entry.collections]));

  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = topicNames.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ value: facet.id.toLowerCase(), name: topic.name, count: facet.collections }];
  });
  const chosenTopic =
    view.topic === null ? null : (topicNames.get(view.topic.toLowerCase()) ?? null);

  const chip = (key: string, text: string, removeHref: string) => ({
    key,
    text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = [
    ...(view.topic === null
      ? []
      : [
          chip(
            'topic',
            chosenTopic?.name ?? t('listing.unknownTopic'),
            href({ topic: null }),
          ),
        ]),
    ...(view.holds === null
      ? []
      : [chip('holds', t(`kindsPlural.${view.holds}`), href({ holds: null }))]),
    ...(view.language === null
      ? []
      : [chip('language', news(`languages.${view.language}`), href({ language: null }))]),
  ];

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: title }]} />
        <ExploreHero
          eyebrow={t('listing.eyebrow')}
          title={title}
          lede={t('description')}
          stats={heroStats(locale, facets.all, listId, t)}
          actions={[]}
        />

        {facets.all.collections === 0 ? (
          <EmptyState icon="grid" title={t('listing.emptyTitle')}>
            {t('empty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('listing.heading')}
              intro={t(view.sort === 'oldest' ? 'listing.introOldest' : 'listing.intro')}
            />

            <LinkTabs
              label={t('listing.holdsLabel')}
              tabs={[
                {
                  href: href({ holds: null }),
                  text: t('listing.anyKind'),
                  current: view.holds === null,
                  count: number(facets.anyKind),
                },
                ...COLLECTION_HOLDS.map((kind) => ({
                  href: href({ holds: kind }),
                  text: t(`kindsPlural.${kind}`),
                  current: view.holds === kind,
                  count: number(held.get(kind) ?? 0),
                })),
              ]}
            />

            <ExploreFilters
              action={localizedPath(locale, '/collections')}
              label={t('listing.filters')}
              hidden={view.holds === null ? [] : [{ name: 'holds', value: view.holds }]}
              submit={t('listing.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              {topicOptions.length > 0 || view.topic !== null ? (
                <CountedSelect
                  id={`${listId}-topic`}
                  label={t('listing.filterTopic')}
                  name="topic"
                  value={view.topic ?? ''}
                  any={t('listing.anyTopic')}
                  options={topicOptions}
                  optionText={option}
                />
              ) : null}
              {facets.languages.length > 1 || view.language !== null ? (
                <CountedSelect
                  id={`${listId}-language`}
                  label={hub('common.filterLanguage')}
                  name="language"
                  value={view.language ?? ''}
                  any={hub('common.anyLanguage')}
                  options={facets.languages.map((entry) => ({
                    value: entry.code,
                    name: news(`languages.${entry.code}`),
                    count: entry.collections,
                  }))}
                  optionText={option}
                />
              ) : null}
              <Field id={`${listId}-sort`} label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="newest">{hub('common.sort.newest')}</option>
                    <option value="oldest">{t('listing.oldest')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {chosenTopic === null ? null : (
              <p className="text-sm">
                <a
                  href={localizedPath(
                    locale,
                    `/topics/${encodeURIComponent(chosenTopic.slug)}`,
                  )}
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {t('listing.topicHub', { topic: chosenTopic.name })}
                  <Icon name="arrow-end" size={16} />
                </a>
              </p>
            )}

            {range === null ? null : (
              <RangeSummary>
                {t('listing.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: page.total,
                })}
              </RangeSummary>
            )}

            {page.items.length === 0 ? (
              view.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
                >
                  {t('listing.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('listing.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('listing.noResults')}
                </EmptyState>
              )
            ) : (
              <CollectionGrid
                locale={locale}
                items={page.items}
                label={title}
                headingLevel="h3"
              />
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('listing.pages')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={page.hasMore ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>
        )}

        <ClosingNote
          text={t('listing.about')}
          links={[{ href: localizedPath(locale, '/topics'), text: t('listing.topics') }]}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /collections/{slug}
 * ========================================================================= */

/** The locales the Collection genuinely exists in — never widened by a fallback. */
export function collectionLocales(record: PublicCollection): Locale[] {
  return record.translations.map((row) => row.languageCode);
}

interface Member {
  readonly kind: CollectionMemberKind;
  readonly target: CollectionMemberTarget;
}

/** One mosaic picture: Editorial's own first-party address and the measured box. */
function mosaicPicture(image: PublicLeadImage) {
  return {
    path: leadImagePath(image),
    alt: '',
    width: image.width,
    height: image.height,
  };
}

/** How many member pictures the opening mosaic shows: one, two, three or five. */
function mosaicCount(available: number): number {
  return available >= 5 ? 5 : available >= 3 ? 3 : available;
}

/**
 * THE OPENING MOSAIC: the members' own lead images, in the curated order — a
 * large picture with two or four beside it from a tablet up, the large one
 * alone on a phone. Decorative: every picture belongs to a member listed, and
 * named, below.
 */
function CoverMosaic({ images }: { readonly images: readonly PublicLeadImage[] }) {
  const count = mosaicCount(images.length);
  if (count === 0) return null;
  const shown = images.slice(0, count);
  const [first] = shown;
  if (first === undefined) return null;
  if (count === 1)
    return (
      <ResponsiveImage
        {...mosaicPicture(first)}
        aspect="16/9"
        radius="panel"
        priority
        sizes="(min-width: 72rem) 72rem, 100vw"
        className="md:aspect-[21/9]"
      />
    );
  if (count === 2)
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {shown.map((image, index) => (
          <ResponsiveImage
            key={image.recordId}
            {...mosaicPicture(image)}
            aspect="3/2"
            radius="panel"
            priority={index === 0}
            sizes="(min-width: 40rem) 50vw, 100vw"
            className={index === 0 ? '' : 'max-sm:hidden'}
          />
        ))}
      </div>
    );
  return (
    <div
      className={`grid grid-cols-1 gap-2 ${count === 5 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}
    >
      {shown.map((image, index) => (
        <div
          key={image.recordId}
          className={index === 0 ? 'sm:col-span-2 sm:row-span-2' : 'max-sm:hidden'}
        >
          <ResponsiveImage
            {...mosaicPicture(image)}
            aspect="3/2"
            radius="panel"
            priority={index === 0}
            sizes={index === 0 ? '(min-width: 40rem) 50vw, 100vw' : '25vw'}
            className={index === 0 ? 'sm:aspect-auto sm:h-full' : ''}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * ONE MEMBER, AS A ROW: its own lead image where its owner shows one, its type
 * in words, its owner's title as the row's one link to the owner's canonical
 * address, and its date where its owner states one. The list's order is the
 * reading order, so no number is drawn beside it.
 */
function MemberRow({
  locale,
  member,
  t,
  news,
}: {
  readonly locale: Locale;
  readonly member: Member;
  readonly t: CollectionsTranslator;
  readonly news: NewsTranslator;
}) {
  const { kind, target } = member;
  const title = memberTitle(target, locale);
  const language = languageOf(title.languageCode, locale, news);
  const image = target.leadImage ?? null;
  const date = target.chronologyAt ?? null;
  const lang =
    title.languageCode !== null && isSupportedLocale(title.languageCode)
      ? title.languageCode
      : null;
  return (
    <ListRow
      href={localizedPath(locale, collectionMemberPathOf(kind, target.slug))}
      title={title.text}
      type={t(`kinds.${kind}`)}
      image={image === null ? null : leadCardImage(image, '')}
      {...(lang === null ? {} : { lang, dir: directionOf(lang) })}
      {...(language === undefined ? {} : { language })}
      {...(date === null
        ? {}
        : {
            meta: [
              <time key="date" dateTime={date.toISOString().slice(0, 10)}>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: 'long',
                  timeZone: 'UTC',
                }).format(date)}
              </time>,
            ],
          })}
    />
  );
}

/**
 * What a Collection's AVAILABLE members are, by the kinds a reader asks for —
 * only when they are of two kinds or more (one kind is already the count).
 */
function holdsBreakdown(members: readonly Member[]) {
  const counts = new Map<CollectionHolds, number>();
  for (const member of members) {
    const kind = holdsOf(member.kind);
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts.size < 2
    ? []
    : COLLECTION_HOLDS.flatMap((holds) => {
        const count = counts.get(holds) ?? 0;
        return count === 0 ? [] : [{ holds, count }];
      });
}

/** How many other Collections a page offers after its members. */
const MORE_COLLECTIONS = 3;

/**
 * More Collections after this one: others on its first Topic, newest first,
 * with the way to all of them (the listing on that Topic, counted); a Collection
 * with no Topic — or none other on it — offers the newest others. Never
 * itself, never a failure: a failed read offers nothing.
 */
async function moreCollections(record: PublicCollection): Promise<{
  readonly items: readonly CollectionSummary[];
  readonly topic: string | null;
  readonly total: number;
}> {
  const reads = editorialReadRuntime();
  const others = (items: readonly CollectionSummary[]) =>
    items.filter((item) => item.slug !== record.slug).slice(0, MORE_COLLECTIONS);
  try {
    const [topic] = record.topicIds;
    if (topic !== undefined) {
      const onTopic = await reads.collectionListing({
        topic,
        limit: MORE_COLLECTIONS + 1,
      });
      const items = others(onTopic.items);
      if (items.length > 0) return { items, topic, total: onTopic.total };
    }
    const newest = await reads.collectionListing({ limit: MORE_COLLECTIONS + 1 });
    return { items: others(newest.items), topic: null, total: 0 };
  } catch {
    return { items: [], topic: null, total: 0 };
  }
}

/** The members grouped by the UTC year of their date, for a date order. */
function byYear(members: readonly Member[]) {
  const groups: { year: number | null; members: Member[] }[] = [];
  for (const member of members) {
    const year = memberYear(member.target);
    const last = groups.at(-1);
    if (last !== undefined && last.year === year) last.members.push(member);
    else groups.push({ year, members: [member] });
  }
  return groups;
}

/**
 * A Collection's page: its title and standfirst, a mosaic of its members'
 * pictures, the editor's introduction at a reading measure, then its members
 * — in the curated order by default, or by date (`?order=newest|oldest`,
 * grouped by year) — then who made it and what it is about.
 */
export async function CollectionDetailPage({
  locale,
  record,
  query = {},
}: {
  readonly locale: Locale;
  readonly record: PublicCollection;
  readonly query?: Query;
}) {
  const t = await getTranslations({ locale, namespace: 'collections' });
  const news = await getTranslations({ locale, namespace: 'news' });
  const editorial = await getTranslations({ locale, namespace: 'editorial' });
  const watch = await getTranslations({ locale, namespace: 'watch' });
  const trail = await collectionsTrail(locale);
  const translation = translationFor(record, locale);
  const direction = directionOf(translation.languageCode);
  const order = readCollectionOrder(query);
  const [names, languages, resolved, more] = await Promise.all([
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
    // Every member, once, batched by owner — public records only.
    resolveCollectionMembers(record.members),
    moreCollections(record),
  ]);
  // The curated order, kept; a member its owner does not publish now — or
  // whose owner could not be asked — is left out, title and address alike.
  const available: Member[] = record.members.flatMap((member) => {
    const target = resolved.targets.get(memberToken(member));
    return target === undefined ? [] : [{ kind: member.kind, target }];
  });
  const dated = available.filter(
    (member) => (member.target.chronologyAt ?? null) !== null,
  ).length;
  const ordered = orderMembers(available, dated >= 2 ? order : 'curated');
  const shownOrder: CollectionOrder = dated >= 2 ? order : 'curated';
  // Each picture once, in the curated order: two members may share one image.
  const pictures = [
    ...new Map(
      available.flatMap((member) => {
        const image = member.target.leadImage ?? null;
        return image === null ? [] : [[image.assetId, image] as const];
      }),
    ).values(),
  ];
  const credits = record.contributors.flatMap((credit) => {
    const person = names.people.get(credit.personId);
    return person === undefined ? [] : [{ person, role: credit.role }];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = names.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const contentLocales = collectionLocales(record);

  return (
    <Container>
      <article className="flex flex-col gap-10 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.collections, { text: translation.title }]}
        />

        <header className="flex max-w-3xl flex-col gap-4">
          {translation.languageCode === locale ? null : (
            <p className="flex flex-wrap items-center gap-2">
              <LanguageBadge
                label={news(`languages.${translation.languageCode}`)}
                code={translation.languageCode}
              />
            </p>
          )}
          <div
            className="flex flex-col gap-4"
            lang={translation.languageCode}
            dir={direction}
          >
            <h1 className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere">
              {translation.title}
            </h1>
            {translation.excerpt === '' ? null : (
              <p className="reading-face text-lede max-w-[var(--measure-prose)] wrap-anywhere text-foreground-muted">
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
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {available.length === 0 ? null : (
              <MetaRow
                items={[
                  t('itemCount', { count: available.length }),
                  ...holdsBreakdown(available).map(({ holds, count }) =>
                    t(`holdsCount.${holds}`, { count }),
                  ),
                ]}
              />
            )}
            <ShareVideo
              url={absoluteUrl(collectionOrderPath(locale, record.slug, 'curated'))}
              title={translation.title}
              labels={{
                share: watch('share.action'),
                copied: watch('share.copied'),
                failed: watch('share.failed'),
              }}
            />
          </div>
        </header>

        <CoverMosaic images={pictures} />

        <div
          className="editorial-prose long-form"
          lang={translation.languageCode}
          dir={direction}
          dangerouslySetInnerHTML={{ __html: translation.html }}
        />

        <section
          className="flex max-w-4xl flex-col gap-5"
          aria-labelledby="collection-items"
        >
          <SectionHeader id="collection-items" heading={t('itemsHeading')} />
          {dated >= 2 ? (
            <nav aria-label={t('orderLabel')}>
              <ul className="flex list-none flex-wrap gap-2 p-0">
                {(['curated', 'newest', 'oldest'] as const).map((choice) => (
                  <li key={choice}>
                    <FilterLink
                      href={collectionOrderPath(locale, record.slug, choice)}
                      current={shownOrder === choice}
                    >
                      {t(`order.${choice}`)}
                    </FilterLink>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
          {resolved.unavailable.size === 0 ? null : (
            <Alert tone="info">{t('itemsUnavailable')}</Alert>
          )}
          {ordered.length === 0 ? (
            resolved.unavailable.size === 0 ? (
              <EmptyState>{t('itemsNone')}</EmptyState>
            ) : null
          ) : shownOrder === 'curated' ? (
            <ol className="flex list-none flex-col border-t border-border p-0">
              {ordered.map((member) => (
                <MemberRow
                  key={memberToken({ kind: member.kind, id: member.target.id })}
                  locale={locale}
                  member={member}
                  t={t}
                  news={news}
                />
              ))}
            </ol>
          ) : (
            <div className="flex flex-col gap-8">
              {byYear(ordered).map((group) => (
                <section
                  key={group.year ?? 'undated'}
                  aria-labelledby={`collection-year-${String(group.year ?? 'undated')}`}
                  className="flex flex-col gap-2"
                >
                  <h3
                    id={`collection-year-${String(group.year ?? 'undated')}`}
                    className="text-subheading font-semibold tabular-nums"
                  >
                    {group.year === null
                      ? t('undated')
                      : new Intl.DateTimeFormat(locale, {
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(Date.UTC(group.year, 0, 1)))}
                  </h3>
                  <ol className="flex list-none flex-col border-t border-border p-0">
                    {group.members.map((member) => (
                      <MemberRow
                        key={memberToken({ kind: member.kind, id: member.target.id })}
                        locale={locale}
                        member={member}
                        t={t}
                        news={news}
                      />
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          )}
        </section>

        {credits.length === 0 && topics.length === 0 ? null : (
          <div className="max-w-3xl">
            <RecordSection id="collection-facts" heading={t('facts')}>
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
              {credits.length === 0 ? null : (
                <dl className="flex flex-col">
                  <DetailRow term={t('contributors')}>
                    <ul className="flex flex-col gap-1">
                      {credits.map(({ person, role }) => (
                        <li key={`${person.slug}:${role}`} dir="auto">
                          <TextLink
                            href={localizedPath(
                              locale,
                              `/people/${encodeURIComponent(person.slug)}`,
                            )}
                          >
                            {person.name}
                          </TextLink>{' '}
                          — {editorial(role as 'speaker')}
                        </li>
                      ))}
                    </ul>
                  </DetailRow>
                </dl>
              )}
            </RecordSection>
          </div>
        )}

        {more.items.length === 0 ? null : (
          <section
            className="flex flex-col gap-6 border-t border-border pt-[var(--space-page)]"
            aria-labelledby="collection-more"
          >
            <SectionHeader
              id="collection-more"
              heading={t('detail.more')}
              {...(more.topic === null
                ? {}
                : {
                    intro: t('detail.moreOnTopic', {
                      topic: names.topics.get(more.topic)?.name ?? '',
                    }),
                    action: {
                      href: collectionsListingHref(locale, { topic: more.topic }),
                      text: t('detail.allOnTopic', { count: more.total }),
                    },
                  })}
            />
            <CollectionGrid
              locale={locale}
              items={more.items}
              label={t('detail.more')}
              headingLevel="h3"
            />
          </section>
        )}

        <p>
          <TextLink href={localizedPath(locale, '/collections')}>{t('all')}</TextLink>
        </p>

        <BreadcrumbData
          contentLocales={contentLocales}
          trail={[
            { name: trail.homeText, path: localizedPath(translation.languageCode, '') },
            {
              name: t('title'),
              path: localizedPath(translation.languageCode, '/collections'),
            },
            {
              name: translation.title,
              path: localizedPath(
                translation.languageCode,
                collectionPathOf(record.slug),
              ),
            },
          ]}
        />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * The topic hub's Collections section
 * ========================================================================= */

/**
 * PHASE 15 — the most recently published Collections on a topic, a bounded
 * preview from Editorial's own public read and never from the search index,
 * with a link to every Collection; nothing at all when the topic has none.
 */
export async function CollectionTopicSection({
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
  const page = await editorialReadRuntime().collectionsOnTopic(topicId);
  if (page.items.length === 0) return null;
  const t = await getTranslations({ locale, namespace: 'collections' });
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        heading={heading}
        action={{ href: localizedPath(locale, '/collections'), text: t('all') }}
      />
      <CollectionGrid
        locale={locale}
        items={page.items}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}
