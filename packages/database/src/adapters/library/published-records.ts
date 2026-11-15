import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type {
  LibraryPublicReaderPort,
  PublishedRecordItem,
  PublishedRecordsQuery,
} from '@minhaj/contracts/library';
import type { ContributionRole } from '@minhaj/contracts/people';

import { getDatabaseClient } from '../../client.ts';
import {
  CONTRIBUTOR_SELECT,
  LABEL_SELECT,
  NO_FILTERS,
  TABLES,
  countsOf,
  facetsOf,
  isoDate,
  membershipOf,
  pageOf,
  type SetQuery,
} from './record-sets.ts';

/**
 * LIBRARY PART 3 — THE PUBLISHED-RECORDS READ: the public Publications or
 * Encyclopedias as a listing (`/library/publications`,
 * `/library/encyclopedias`), over the shared record-set engine
 * (`./record-sets.ts`) — one aggregate at a time, always the whole Library,
 * the Topic a filter.
 *
 * TWO READS, THE SECOND AUTHORITATIVE, as every Library listing: one bounded
 * SQL page of identifiers in the visitor's order with the total the query
 * admits, then those records loaded under the public predicate (and the Topic)
 * again, so an error in the ordering query could only drop a record, never
 * admit one. The document is never loaded: the page answers whether one
 * exists and how many sections it has (`OPENJSON` over the stored JSON,
 * counted in SQL), which is what an Encyclopedia's "entries" are — its
 * structure is its document (DOMAIN_MODEL.md §10.2).
 */

function setQuery(q: PublishedRecordsQuery): SetQuery {
  return { ...q, scope: 'library', kind: q.kind, kinds: [q.kind] };
}

export function createPublishedRecordsReader(): Pick<
  LibraryPublicReaderPort,
  'publishedRecords' | 'publishedRecordFacets'
> {
  const db = getDatabaseClient();

  return {
    async publishedRecords(q) {
      const { rows, total, hasMore } = await pageOf(db, setQuery(q));
      if (rows.length === 0) return { items: [], total, hasMore: false };
      const ids = rows.map((row) => row.id);
      const where = {
        ...membershipOf({ scope: 'library', topic: q.topic }),
        id: { in: ids },
      };
      const select = {
        id: true,
        slug: true,
        primaryLocale: true,
        languageCode: true,
        publicationYear: true,
        publishedOn: true,
        publisher: true,
        labels: LABEL_SELECT,
        contributors: CONTRIBUTOR_SELECT,
      } as const;
      const t = TABLES[q.kind];
      const [loaded, sections] = await Promise.all([
        q.kind === 'publication'
          ? db.publication.findMany({ where, select })
          : db.encyclopedia.findMany({ where, select }),
        // How many sections each readable document has, without reading it here.
        db.$queryRaw<{ id: string; sections: number }[]>`
          SELECT r.[id], (SELECT COUNT(*) FROM OPENJSON(r.[document], N'$.sections')) AS [sections]
          FROM ${t.record} r
          WHERE r.[id] IN (${Prisma.join(ids)}) AND r.[document] IS NOT NULL;`,
      ]);
      const counted = new Map(sections.map((row) => [row.id, Number(row.sections)]));
      const byId = new Map(
        loaded.map((row): [string, PublishedRecordItem] => [
          row.id,
          {
            kind: q.kind,
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
            publisher: row.publisher,
            readable: counted.has(row.id),
            sections: counted.get(row.id) ?? 0,
          },
        ]),
      );
      const items = rows.flatMap((row) => {
        const item = byId.get(row.id);
        return item === undefined ? [] : [item];
      });
      return { items, total, hasMore };
    },

    async publishedRecordFacets(q) {
      const set = setQuery(q);
      const [all, facets] = await Promise.all([
        countsOf(db, set, NO_FILTERS),
        facetsOf(db, set),
      ]);
      return {
        all: {
          records: all.records,
          readable: all.readable,
          languages: facets.languages,
          contributors: facets.contributors,
          earliest: facets.earliest,
          latest: facets.latest,
        },
        languages: facets.languageFacet,
        topics: facets.topicFacet,
        contributors: facets.contributorFacet,
        decades: facets.decades,
        readable: facets.readable,
      };
    },
  };
}
