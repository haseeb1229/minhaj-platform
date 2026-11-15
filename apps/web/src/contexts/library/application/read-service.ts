import { z } from 'zod';
import {
  libraryDownloadsQuerySchema,
  libraryIdSchema,
  libraryQuerySchema,
  librarySalePointQuerySchema,
  libraryTopicTotalsInputSchema,
  librarySlugSchema,
  magazineDirectoryQuerySchema,
  magazineIssuesQuerySchema,
  publishedRecordsQuerySchema,
  topicResearchQuerySchema,
  topicWorksQuerySchema,
  scholarlyKindSchema,
  scholarlyQuerySchema,
  type LibraryPublicReaderPort,
  type ScholarlyKind,
  type ScholarlyRecord,
  type ScholarlyRecordOf,
  type StandaloneScholarlyKind,
} from '@minhaj/contracts/library';
import { passageQuerySchema } from '@minhaj/contracts/passage';

/**
 * The PUBLIC Library reads.
 *
 * NO ACTOR, NO SESSION, NO PERMISSION — and the SHAPE is what makes that
 * structural rather than a promise. There is no parameter a viewer's identity
 * could arrive through, so no answer this service produces can vary with one
 * (PRODUCT_SCOPE.md §2.1: ordinary public knowledge works without signing in;
 * ARCHITECTURE.md §8.1: the anonymous public render tree reads no
 * session-derived state).
 *
 * EVERY INPUT IS VALIDATED HERE, at the trust boundary, before it reaches a
 * query. A slug arrives from a URL segment and an offset from a query string;
 * both are caller-controlled, and both are parsed rather than trusted
 * (SECURITY_BASELINE.md §9.1). A malformed slug resolves to `null` — the same
 * answer as a slug that names nothing — rather than throwing, because a visitor
 * who mistyped an address should get the 404 the page already knows how to
 * render.
 */

/** A well-formed slug, or `null` — which every caller treats as "no such record". */
const validSlug = (slug: string): boolean => librarySlugSchema.safeParse(slug).success;

const standalone = scholarlyKindSchema.exclude(['magazine-issue']);

export function createLibraryReadService(reader: LibraryPublicReaderPort) {
  return {
    works(raw: unknown = {}) {
      return reader.works(libraryQuerySchema.parse(raw));
    },

    work(slug: string) {
      return librarySlugSchema.safeParse(slug).success
        ? reader.work(slug)
        : Promise.resolve(null);
    },

    canonicalSlug(slug: string) {
      return librarySlugSchema.safeParse(slug).success
        ? reader.canonicalSlug(slug)
        : Promise.resolve(null);
    },

    /**
     * LIBRARY PART 2 — the browse and access reads (`/library/resources`,
     * `/authors`, `/topics`, `/languages`, `/downloads`, `/sale-points`).
     * Each hands back identifiers and counts; the page resolves names from
     * their owners in a bounded number of calls, which is also why Library
     * never holds a copy of a contributor's, a Topic's or a language's name.
     * Every input is parsed here, before any read.
     */
    holdings() {
      return reader.holdings();
    },

    /** Per asked Topic, its public records by kind. None asked reads nothing. */
    async topicHoldings(raw: unknown) {
      const topics = libraryTopicTotalsInputSchema.parse(raw);
      if (topics.length === 0) return [];
      return reader.topicHoldings(topics);
    },

    languageHoldings() {
      return reader.languageHoldings();
    },

    contributorDirectory() {
      return reader.contributorDirectory();
    },

    downloads(raw: unknown = {}) {
      return reader.downloads(libraryDownloadsQuerySchema.parse(raw));
    },

    downloadFacets(raw: unknown = {}) {
      return reader.downloadFacets(libraryDownloadsQuerySchema.parse(raw));
    },

    salePointDirectory(raw: unknown = {}) {
      return reader.salePointDirectory(librarySalePointQuerySchema.parse(raw));
    },

    /**
     * One page of canonical Work URLs for the machine sitemap.
     *
     * A WIDER OFFSET BOUND than a browse, on purpose: the sitemap reads the whole
     * published corpus to exhaustion in bounded pages, and a browse ceiling
     * appropriate for a visitor clicking "next" would silently truncate it.
     */
    sitemap(offset: number, limit: number) {
      return reader.sitemap(
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },

    /* -----------------------------------------------------------------------
     * Phase 9 — the scholarly and periodical records, under the same rules:
     * every input parsed here, a malformed slug is `null` (the page's 404), and
     * the public predicate lives in the query rather than in a filter.
     * -------------------------------------------------------------------- */

    scholarlyList(kind: ScholarlyKind, raw: unknown = {}) {
      return reader.scholarlyList(
        scholarlyKindSchema.parse(kind),
        scholarlyQuerySchema.parse(raw),
      );
    },

    async scholarlyRecord<K extends StandaloneScholarlyKind>(
      kind: K,
      slug: string,
    ): Promise<ScholarlyRecordOf<K> | null> {
      if (!validSlug(slug)) return null;
      const record: ScholarlyRecord | null = await reader.scholarlyRecord(
        standalone.parse(kind),
        slug,
      );
      // A record read by kind is that kind's record — checked, never assumed.
      return record !== null && record.kind === kind
        ? (record as ScholarlyRecordOf<K>)
        : null;
    },

    scholarlyCanonicalSlug(kind: StandaloneScholarlyKind, slug: string) {
      return validSlug(slug)
        ? reader.scholarlyCanonicalSlug(standalone.parse(kind), slug)
        : Promise.resolve(null);
    },

    /**
     * Library Part 3 — a Magazine's issues: one view (all, one year's or the
     * undated ones) with its total, and the issue count, readable count and
     * year index its page is navigated by. Every field parsed before any read.
     */
    magazineIssuePage(raw: unknown) {
      return reader.magazineIssuePage(magazineIssuesQuerySchema.parse(raw));
    },

    magazineIssueFacets(magazineId: string) {
      return reader.magazineIssueFacets(libraryIdSchema.parse(magazineId));
    },

    /** Library Part 3 — the periodicals directory, under an optional Topic. */
    magazineDirectory(raw: unknown = {}) {
      return reader.magazineDirectory(magazineDirectoryQuerySchema.parse(raw));
    },

    /**
     * Library Part 3 — the published-records read (`/library/publications`,
     * `/library/encyclopedias`): one bounded page of one aggregate's public
     * records and the listing's aggregates. Every field parsed before any read.
     */
    publishedRecords(raw: unknown) {
      return reader.publishedRecords(publishedRecordsQuerySchema.parse(raw));
    },

    publishedRecordFacets(raw: unknown) {
      return reader.publishedRecordFacets(publishedRecordsQuerySchema.parse(raw));
    },

    magazineIssue(magazineSlug: string, issueSlug: string) {
      return validSlug(magazineSlug) && validSlug(issueSlug)
        ? reader.magazineIssue(magazineSlug, issueSlug)
        : Promise.resolve(null);
    },

    magazineIssueCanonical(magazineSlug: string, issueSlug: string) {
      return validSlug(magazineSlug) && validSlug(issueSlug)
        ? reader.magazineIssueCanonical(magazineSlug, issueSlug)
        : Promise.resolve(null);
    },

    magazineIssueNeighbours(issueId: string) {
      return reader.magazineIssueNeighbours(libraryIdSchema.parse(issueId));
    },

    /** The machine sitemap's reads, with the same wide bound as the Work sitemap. */
    scholarlySitemap(kind: ScholarlyKind, offset: number, limit: number) {
      return reader.scholarlySitemap(
        scholarlyKindSchema.parse(kind),
        z.number().int().min(0).max(10_000_000).parse(offset),
        z.number().int().min(1).max(5000).parse(limit),
      );
    },

    /**
     * Phase 15 — THE WORK REFERENCE SURFACE an Editorial Collection is
     * composed from (Editorial → Library, DOMAIN_MODEL.md §3.2). Public Works
     * only, at most one Collection's worth per call; a Work that is not public
     * now is simply absent. Identity, current slug and titles — nothing else.
     */
    workReferences(ids: readonly string[]) {
      return reader.workReferences(z.array(libraryIdSchema).max(100).parse(ids));
    },

    /** Public Works an editor may choose, narrowed by title text. Bounded. */
    workChoices(text: string | null) {
      const query = z.string().trim().min(1).max(120).safeParse(text);
      return reader.workChoices(query.success ? query.data : null, 25);
    },

    /**
     * Quran Part 8 — the public Works that explain a Quran passage, for the
     * Tafsir hub and the reader composed at Layer 4. A malformed query is
     * refused here, before any read; Library answers by citation value only.
     */
    async quranPassageWorks(raw: unknown) {
      return reader.quranPassageWorks(passageQuerySchema.parse(raw));
    },

    /** How many public Works carry a passage in each Surah. */
    quranPassageCounts() {
      return reader.quranPassageCounts();
    },

    /**
     * The Topic Works read (Quran Part 10; Hadith Part 1) — a subject's Books
     * hub, composed at Layer 4: one bounded page of the public Works on the
     * named Topic (and, with the Quran passage parts, those explaining a
     * Quran passage), and the aggregates the hub is navigated by. Every field
     * is parsed here (a Surah beside the `general` shelf, or any passage part
     * without `quranPassages`, is refused), before any read.
     */
    topicWorks(raw: unknown = {}) {
      return reader.topicWorks(topicWorksQuerySchema.parse(raw));
    },

    topicWorkFacets(raw: unknown = {}) {
      return reader.topicWorkFacets(topicWorksQuerySchema.parse(raw));
    },

    /**
     * The Topic Research read (Quran Part 12; Hadith Part 1) — a subject's
     * Research hub, composed at Layer 4: one bounded page of the public Research and ResearchPaper records on the
     * named Topic, and the aggregates the hub is navigated by. Every field is
     * parsed here (an unknown kind or order, a year that is no decade, an
     * offset past the bound), before any read.
     */
    topicResearch(raw: unknown = {}) {
      return reader.topicResearch(topicResearchQuerySchema.parse(raw));
    },

    topicResearchFacets(raw: unknown = {}) {
      return reader.topicResearchFacets(topicResearchQuerySchema.parse(raw));
    },

    /**
     * Learn Part 2 — the Topic index: per asked Topic, how many public Works
     * and Research records its hubs open with. The Topics are parsed here
     * (identifiers, distinct, at most `LIBRARY_TOPIC_TOTALS_MAX`) before any
     * read; none asked reads nothing.
     */
    async topicTotals(raw: unknown) {
      const topics = libraryTopicTotalsInputSchema.parse(raw);
      if (topics.length === 0) return { works: [], research: [] };
      return reader.topicTotals(topics);
    },
  };
}
