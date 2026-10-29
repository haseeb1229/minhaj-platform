import { z } from 'zod';
import {
  COLLECTION_MAX_OFFSET,
  COLLECTION_MEMBER_CHOICES,
  COLLECTION_PAGE,
  COLLECTION_PREVIEW,
  collectionMemberKindSchema,
  collectionMemberSchema,
  isEditorialMemberKind,
  memberToken,
  type CollectionMember,
  type CollectionMemberTarget,
  type CollectionPage,
  type EditorialMemberKind,
  EVENT_GEOGRAPHY_CENTRES,
  EVENT_MAX_OFFSET,
  EVENT_PAGE,
  EVENT_PREVIEW,
  eventWhenSchema,
  NEWS_EARLIEST_YEAR,
  NEWS_MAX_OFFSET,
  NEWS_PAGE,
  NEWS_TOPIC_PREVIEW,
  editorialIdSchema,
  editorialSlugSchema,
  isReservedNewsSlug,
  newsKindSchema,
  validPageBinding,
  type EditorialPublicReaderPort,
  type EventPage,
  type EventWhen,
  type NewsKind,
  type NewsPage,
} from '@minhaj/contracts/editorial';

const newsOffsetSchema = z.number().int().min(0).max(NEWS_MAX_OFFSET);

/**
 * The archive's query, validated again here whatever the page tolerated: a
 * year within the accepted range and a month only together with a year.
 */
const archiveFilterSchema = z
  .strictObject({
    year: z.number().int().min(NEWS_EARLIEST_YEAR).max(9998).nullable(),
    month: z.number().int().min(1).max(12).nullable(),
    offset: newsOffsetSchema,
  })
  .refine((value) => value.month === null || value.year !== null);

const eventOffsetSchema = z.number().int().min(0).max(EVENT_MAX_OFFSET);

const collectionOffsetSchema = z.number().int().min(0).max(COLLECTION_MAX_OFFSET);
/** One Collection's members at most; anything longer is not one Collection's. */
const membersSchema = z.array(collectionMemberSchema).max(100);
/** The most Explore Pages one read returns: every Explore route, with room to spare. */
const EXPLORE_PAGE_CAP = 60;

/**
 * An Event listing's query, validated again here whatever the page tolerated.
 * A Centre filter is a list of identifiers Global resolved — never more than a
 * geography filter may resolve to — and `null` means no Centre filter at all.
 */
const eventFilterSchema = z.strictObject({
  when: eventWhenSchema,
  offset: eventOffsetSchema,
  centreIds: z.array(editorialIdSchema).max(EVENT_GEOGRAPHY_CENTRES).nullable(),
});

export function createEditorialReadService(
  reader: EditorialPublicReaderPort,
  /** The SERVER's clock — never a visitor's — decides upcoming and past. */
  now: () => Date = () => new Date(),
) {
  /** A slug that cannot name a published record of this family answers null. */
  const newsSlug = (kind: NewsKind, slug: string) =>
    editorialSlugSchema.safeParse(slug).success &&
    !(kind === 'news-article' && isReservedNewsSlug(slug));
  return {
    async articleCanonicalSlug(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.articleCanonicalSlug(slug);
    },
    async pageCanonicalSlug(binding: string, slug: string) {
      if (
        !validPageBinding(binding, slug) ||
        !editorialSlugSchema.safeParse(slug).success
      )
        return null;
      return reader.pageCanonicalSlug(binding, slug);
    },
    helpPages(offset = 0) {
      z.number().int().min(0).max(10_000_000).parse(offset);
      return reader.publishedHelpPages(offset, 25);
    },
    /**
     * Phase 30-R: every published Explore Page as a card, in binding order —
     * bounded by the closed Explore route list, which is far below the cap.
     */
    explorePages() {
      return reader.publishedExplorePages(EXPLORE_PAGE_CAP);
    },
    async article(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.publicArticle(slug);
    },
    async page(binding: string, slug = 'page') {
      if (
        !validPageBinding(binding, slug) ||
        !editorialSlugSchema.safeParse(slug).success
      )
        return null;
      return reader.publicPage(binding, slug);
    },
    articles(offset = 0) {
      z.number().int().min(0).max(10_000_000).parse(offset);
      return reader.publishedArticles(offset, 25);
    },
    articleSitemap(offset: number, limit: number) {
      return reader.articleSitemap(offset, limit);
    },
    pageSitemap(offset: number, limit: number) {
      return reader.pageSitemap(offset, limit);
    },

    /* ---- Phase 13: News ------------------------------------------------- */

    async newsCanonicalSlug(kind: NewsKind, slug: string) {
      if (!newsSlug(newsKindSchema.parse(kind), slug)) return null;
      return reader.newsCanonicalSlug(kind, slug);
    },
    async news(kind: NewsKind, slug: string) {
      if (!newsSlug(newsKindSchema.parse(kind), slug)) return null;
      return reader.publicNews(kind, slug);
    },
    async newsList(kind: NewsKind, offset = 0): Promise<NewsPage> {
      return reader.publishedNews(
        newsKindSchema.parse(kind),
        newsOffsetSchema.parse(offset),
        NEWS_PAGE,
      );
    },
    async newsArchive(filter: {
      readonly year: number | null;
      readonly month: number | null;
      readonly offset: number;
    }): Promise<NewsPage> {
      const parsed = archiveFilterSchema.parse(filter);
      return reader.newsTimeline({ ...parsed, limit: NEWS_PAGE, topicId: null });
    },
    newsArchivePeriods() {
      return reader.newsArchivePeriods();
    },
    /** The most recent published News on a topic, for the topic hub. */
    async newsOnTopic(topicId: string): Promise<NewsPage> {
      return reader.newsTimeline({
        offset: 0,
        limit: NEWS_TOPIC_PREVIEW,
        year: null,
        month: null,
        topicId: editorialIdSchema.parse(topicId),
      });
    },
    newsSitemap(kind: NewsKind, offset: number, limit: number) {
      return reader.newsSitemap(kind, offset, limit);
    },

    /* ---- Phase 16: centre-scoped News ----------------------------------- */

    /**
     * One page of the published NewsArticles scoped to a Centre, by its
     * IDENTIFIER. Whether that Centre may be shown at all is Global's question,
     * asked by the page that composes the two — never by Editorial.
     */
    async centreNews(centreId: string, offset = 0, limit = NEWS_PAGE): Promise<NewsPage> {
      return reader.centreNews(
        editorialIdSchema.parse(centreId),
        newsOffsetSchema.parse(offset),
        z.number().int().min(1).max(NEWS_PAGE).parse(limit),
      );
    },

    /* ---- Phase 14: Events ------------------------------------------------ */

    async eventCanonicalSlug(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.eventCanonicalSlug(slug);
    },
    async event(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.publicEvent(slug);
    },
    /**
     * One page of `/events`, upcoming or past. A Centre filter only ever
     * NARROWS: an empty list matches nothing, it never means everything.
     */
    async events(filter: {
      readonly when: EventWhen;
      readonly offset: number;
      readonly centreIds: readonly string[] | null;
    }): Promise<EventPage> {
      const parsed = eventFilterSchema.parse(filter);
      if (parsed.centreIds !== null && parsed.centreIds.length === 0)
        return { items: [], more: false };
      return reader.events({ ...parsed, now: now(), limit: EVENT_PAGE, topicId: null });
    },
    hasPublishedEvents() {
      return reader.hasPublishedEvents();
    },
    /**
     * One page of the published Events held at a Centre, by its IDENTIFIER.
     * Whether that Centre may be shown at all is Global's question, asked by the
     * page that composes the two — never by Editorial.
     */
    async centreEvents(
      centreId: string,
      when: EventWhen,
      offset = 0,
      limit = EVENT_PAGE,
    ): Promise<EventPage> {
      return reader.events({
        when: eventWhenSchema.parse(when),
        now: now(),
        offset: eventOffsetSchema.parse(offset),
        limit: z.number().int().min(1).max(EVENT_PAGE).parse(limit),
        centreIds: [editorialIdSchema.parse(centreId)],
        topicId: null,
      });
    },
    /**
     * A topic hub's Events: the upcoming ones on the topic, soonest first, or —
     * when none is ahead — the most recent past ones, saying which they are.
     */
    async eventsOnTopic(
      topicId: string,
    ): Promise<{ readonly when: EventWhen; readonly page: EventPage }> {
      const query = {
        now: now(),
        offset: 0,
        limit: EVENT_PREVIEW,
        centreIds: null,
        topicId: editorialIdSchema.parse(topicId),
      };
      const upcoming = await reader.events({ ...query, when: 'upcoming' });
      if (upcoming.items.length > 0) return { when: 'upcoming', page: upcoming };
      return { when: 'past', page: await reader.events({ ...query, when: 'past' }) };
    },
    eventSitemap(offset: number, limit: number) {
      return reader.eventSitemap(offset, limit);
    },

    /* ---- Phase 15: Collections ------------------------------------------ */

    async collectionCanonicalSlug(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.collectionCanonicalSlug(slug);
    },
    async collection(slug: string) {
      if (!editorialSlugSchema.safeParse(slug).success) return null;
      return reader.publicCollection(slug);
    },
    /** One page of `/collections`, newest publication first. */
    collections(offset = 0): Promise<CollectionPage> {
      return reader.collections({
        offset: collectionOffsetSchema.parse(offset),
        limit: COLLECTION_PAGE,
        topicId: null,
      });
    },
    /** A topic hub's Collections: the most recently published on the topic. */
    collectionsOnTopic(topicId: string): Promise<CollectionPage> {
      return reader.collections({
        offset: 0,
        limit: COLLECTION_PREVIEW,
        topicId: editorialIdSchema.parse(topicId),
      });
    },
    collectionSitemap(offset: number, limit: number) {
      return reader.collectionSitemap(offset, limit);
    },
    /**
     * Editorial's OWN members among these — Articles and the four News families
     * — resolved under the published predicate, ONE bounded read per type and
     * never one per member, keyed `kind:id`. A member that is not published now
     * is simply absent; Works and Videos are not Editorial's and are ignored.
     */
    async memberTargets(
      members: readonly CollectionMember[],
    ): Promise<ReadonlyMap<string, CollectionMemberTarget>> {
      const grouped = new Map<EditorialMemberKind, string[]>();
      for (const member of membersSchema.parse(members))
        if (isEditorialMemberKind(member.kind))
          grouped.set(member.kind, [...(grouped.get(member.kind) ?? []), member.id]);
      const found = await Promise.all(
        [...grouped].map(async ([kind, ids]) =>
          (await reader.memberTargets(kind, ids)).map(
            (target) => [memberToken({ kind, id: target.id }), target] as const,
          ),
        ),
      );
      return new Map(found.flat());
    },
    /**
     * Published records of one Editorial member type an editor may choose,
     * narrowed by title text. Bounded; never a draft.
     */
    async memberChoices(kind: EditorialMemberKind, text: string | null) {
      const parsed = collectionMemberKindSchema.parse(kind);
      if (!isEditorialMemberKind(parsed)) return [];
      const query = z.string().trim().min(1).max(120).safeParse(text);
      return reader.memberChoices(
        parsed,
        query.success ? query.data : null,
        COLLECTION_MEMBER_CHOICES,
      );
    },
  };
}
