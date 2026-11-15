import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type {
  LibraryPublicReaderPort,
  TopicResearchItem,
  TopicResearchKind,
  TopicResearchQuery,
} from '@minhaj/contracts/library';
import type { ContributionRole } from '@minhaj/contracts/people';

import { getDatabaseClient } from '../../client.ts';
import {
  CONTRIBUTOR_SELECT,
  EMPTY_FACETS,
  LABEL_SELECT,
  NO_FILTERS,
  TABLES,
  countsOf,
  facetsOf,
  hasSet,
  isoDate,
  membershipOf,
  pageOf,
  without,
  type SetQuery,
} from './record-sets.ts';

/**
 * THE TOPIC RESEARCH READ (Quran Part 12; named for the Topic in Hadith Part
 * 1): Library's public Research and ResearchPaper records on the Topic a
 * caller names, for a subject's Research hub — the Quran's and Hadith's —
 * composed at Layer 4 (DOMAIN_MODEL.md §10.2).
 *
 * TWO AGGREGATES, ONE SET. Each keeps its own table, its own relation sets and
 * its own public predicate (published); the set is the two read side by side
 * as `UNION ALL`, every row tagged with the aggregate it came from. The table
 * names are this module's own constants — never anything a caller supplies —
 * and every value is a bound parameter.
 *
 * TWO READS, THE SECOND AUTHORITATIVE — as the Topic Works read: one bounded
 * SQL page of (kind, identifier) in the visitor's order with the total the
 * query admits, then those records loaded per aggregate under the public
 * predicate and the Topic again, so an error in the ordering query could only
 * drop a record, never admit one. The readable document is never loaded: the
 * page answers only whether one exists.
 *
 * LIBRARY PART 3: the SQL is the shared record-set engine (`./record-sets.ts`),
 * and `scope: 'library'` reads every public record of the two aggregates — the
 * Topic a filter with a facet of its own — for `/library/research` and
 * `/library/research-papers`; the hubs' `scope: 'topic'` is unchanged.
 */

/** The two aggregates of the research set. */
const KINDS: readonly TopicResearchKind[] = ['research', 'research-paper'];

/** The research read's query as a record set (`./record-sets.ts`). */
function setQuery(q: TopicResearchQuery): SetQuery {
  return { ...q, kinds: KINDS };
}

/**
 * LEARN PART 2 — THE TOPIC INDEX: how many public Research and ResearchPaper
 * records are filed under each asked Topic — each aggregate under its own
 * public predicate, read side by side and summed per Topic, so each count is
 * the `total` of `topicResearch` on that Topic with no filter. Only the asked
 * Topics are read, each a bound parameter.
 */
export async function researchTopicTotals(
  db: ReturnType<typeof getDatabaseClient>,
  topics: readonly string[],
): Promise<readonly { readonly topic: string; readonly count: number }[]> {
  if (topics.length === 0) return [];
  const asked = Prisma.join([...topics]);
  const parts = KINDS.map((kind) => {
    const t = TABLES[kind];
    return Prisma.sql`SELECT o.[topicId] AS [topic]
      FROM ${t.topic} o
      JOIN ${t.record} r ON r.[id] = o.${t.fk}
      WHERE r.[state] = N'published' AND o.[topicId] IN (${asked})`;
  });
  const rows = await db.$queryRaw<{ topic: string; count: number }[]>`
    WITH s AS (${Prisma.join(parts, ' UNION ALL ')})
    SELECT s.[topic], COUNT(*) AS [count]
    FROM s
    GROUP BY s.[topic]
    ORDER BY s.[topic];`;
  return rows.map((row) => ({ topic: row.topic, count: Number(row.count) }));
}

export function createTopicResearchReader(): Pick<
  LibraryPublicReaderPort,
  'topicResearch' | 'topicResearchFacets'
> {
  const db = getDatabaseClient();

  return {
    async topicResearch(q) {
      // On a hub with no Topic nothing is research on the subject: no record
      // carries a passage, so the set is empty rather than every record.
      if (!hasSet(q)) return { items: [], total: 0, hasMore: false };
      const { rows, total, hasMore } = await pageOf(db, setQuery(q));
      if (rows.length === 0) return { items: [], total, hasMore: false };

      const idsOf = (kind: TopicResearchKind) =>
        rows.filter((row) => row.kind === kind).map((row) => row.id);
      const researchIds = idsOf('research');
      const paperIds = idsOf('research-paper');
      const membership = membershipOf(q);

      const [research, papers, readable] = await Promise.all([
        researchIds.length === 0
          ? Promise.resolve([])
          : db.research.findMany({
              where: { ...membership, id: { in: researchIds } },
              select: {
                id: true,
                slug: true,
                primaryLocale: true,
                languageCode: true,
                publicationYear: true,
                publishedOn: true,
                institutionalContext: true,
                abstract: true,
                labels: LABEL_SELECT,
                contributors: CONTRIBUTOR_SELECT,
                _count: { select: { citations: true } },
              },
            }),
        paperIds.length === 0
          ? Promise.resolve([])
          : db.researchPaper.findMany({
              where: { ...membership, id: { in: paperIds } },
              select: {
                id: true,
                slug: true,
                primaryLocale: true,
                languageCode: true,
                publicationYear: true,
                publishedOn: true,
                institutionalContext: true,
                abstract: true,
                venue: true,
                doi: true,
                labels: LABEL_SELECT,
                contributors: CONTRIBUTOR_SELECT,
                _count: { select: { citations: true } },
              },
            }),
        // Whether each record's text is on the platform, without reading it.
        Promise.all([
          researchIds.length === 0
            ? Promise.resolve([])
            : db.research.findMany({
                where: { id: { in: researchIds }, document: { not: null } },
                select: { id: true },
              }),
          paperIds.length === 0
            ? Promise.resolve([])
            : db.researchPaper.findMany({
                where: { id: { in: paperIds }, document: { not: null } },
                select: { id: true },
              }),
        ]),
      ]);
      const withText = new Set(readable.flat().map((row) => row.id));

      type Loaded = (typeof research)[number] & {
        readonly venue?: string | null;
        readonly doi?: string | null;
      };
      const toItem = (kind: TopicResearchKind, row: Loaded): TopicResearchItem => ({
        kind,
        id: row.id,
        slug: row.slug,
        primaryLocale: row.primaryLocale as Locale,
        labels: row.labels.map((label) => ({
          locale: label.locale as Locale,
          title: label.title,
          summary: label.summary,
        })),
        contributors: row.contributors.map((entry) => ({
          personId: entry.personId,
          role: entry.role as ContributionRole,
        })),
        languageCode: row.languageCode,
        publicationYear: row.publicationYear,
        publishedOn: isoDate(row.publishedOn),
        institutionalContext: row.institutionalContext,
        abstract: row.abstract,
        venue: row.venue ?? null,
        doi: row.doi ?? null,
        citations: row._count.citations,
        readable: withText.has(row.id),
      });
      const byKey = new Map<string, TopicResearchItem>([
        ...research.map(
          (row) => [`research:${row.id}`, toItem('research', row)] as const,
        ),
        ...papers.map(
          (row) => [`research-paper:${row.id}`, toItem('research-paper', row)] as const,
        ),
      ]);
      const items = rows.flatMap((row) => {
        const item = byKey.get(`${row.kind}:${row.id}`);
        return item === undefined ? [] : [item];
      });
      return { items, total, hasMore };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its
     * own counts, so every option says how many records choosing it would
     * show.
     */
    async topicResearchFacets(q) {
      if (!hasSet(q))
        return {
          hub: {
            records: 0,
            research: 0,
            papers: 0,
            readable: 0,
            languages: 0,
            contributors: 0,
            earliest: null,
            latest: null,
          },
          kinds: { all: 0, research: 0, papers: 0 },
          languages: EMPTY_FACETS,
          contributors: EMPTY_FACETS,
          decades: [],
          readable: 0,
          topics: EMPTY_FACETS,
        };
      const set = setQuery(q);
      // A hub's figures are its whole set; a whole-Library listing is of ONE
      // kind (each kind has its own address), so its figures are that kind's.
      const base = q.scope === 'library' ? { ...NO_FILTERS, kind: true } : NO_FILTERS;
      const [hub, kinds, facets] = await Promise.all([
        countsOf(db, set, base),
        countsOf(db, set, without('kind')),
        facetsOf(db, set, base),
      ]);
      return {
        hub: {
          records: hub.records,
          research: hub.byKind.get('research') ?? 0,
          papers: hub.byKind.get('research-paper') ?? 0,
          readable: hub.readable,
          languages: facets.languages,
          contributors: facets.contributors,
          earliest: facets.earliest,
          latest: facets.latest,
        },
        kinds: {
          all: kinds.records,
          research: kinds.byKind.get('research') ?? 0,
          papers: kinds.byKind.get('research-paper') ?? 0,
        },
        languages: facets.languageFacet,
        contributors: facets.contributorFacet,
        decades: facets.decades,
        readable: facets.readable,
        topics: facets.topicFacet,
      };
    },
  };
}
