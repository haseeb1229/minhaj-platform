import 'server-only';

import { Prisma } from '@prisma/client';

import {
  HADITH_LIMITS,
  HADITH_PAGE,
  HADITH_SEARCH_RECORDS_MAX,
  type HadithCollectionNameRecord,
  type HadithNameLocale,
  type HadithPublicReaderPort,
  type HadithSearchRecord,
  type HadithSourceAuthority,
  type PublicHadithAttribution,
  type PublicHadithCitationSummary,
  type PublicHadithCollection,
  type PublicHadithBook,
  type PublicHadithStructure,
} from '@minhaj/contracts/hadith';

import { getDatabaseClient } from '../../client.ts';
import {
  activeMode,
  bounded,
  boundedOffset,
  isPublicCitation,
  publicCitations,
  publicLayer,
  publicLayerSql,
  roleOf,
  stampOf,
  STRUCTURE_LIST,
  TARGET_BATCH,
  WORK_LIST,
} from './shared.ts';

/**
 * The Hadith adapter's PUBLIC half (DOMAIN_MODEL.md §9; DELIVERY_PLAN.md
 * Phase 19). It takes no actor and answers only what is public NOW.
 *
 * NOTHING WHILE THE SECTION IS INACTIVE. Every read asks for the activation
 * first; without one it returns empty or null and asks nothing else, so no
 * page, sitemap or search projection can show a record the operator has not
 * made public.
 *
 * ONE PUBLIC RULE FOR EVERY CITATION (`publicCitations`, and the same rule
 * over facts already read, `isPublicCitation`): an activated collection, a
 * mapped citation, no conflict evidence against it, a verification of the
 * named record's CURRENT version, and — beside an APPROVED section — an
 * approved source. A layered work is shown only beside a public citation, and
 * only when it is itself public (`publicLayer`). The sitemap lists citations
 * only for an approved section.
 *
 * NO N+1. A listing page is one bounded query and its count; a batch of search
 * stamps is three bounded reads, whatever its size.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const COLLECTION_NAMES = {
  select: { locale: true, name: true, description: true },
  orderBy: { locale: 'asc' },
} as const;

const PUBLIC_STRUCTURE = {
  id: true,
  slug: true,
  reference: true,
  title: true,
  titleLanguage: true,
  names: { select: { locale: true, name: true }, orderBy: { locale: 'asc' } },
} as const;

const PUBLIC_BOOK = {
  ...PUBLIC_STRUCTURE,
  edition: {
    select: { code: true, title: true, sourceSystem: { select: { title: true } } },
  },
} as const;

const PUBLIC_CONTRIBUTORS = {
  select: { personId: true, role: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }, { role: 'asc' }],
} satisfies Prisma.HadithTranslation$contributorsArgs;

/** How many sciences a public list holds — the ceiling a science position allows. */
const SCIENCE_LIST = HADITH_LIMITS.sciences + 1;

/** How many collections the section lists at once. */
const COLLECTION_LIST = 1_000;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

function localeOf(value: string): HadithNameLocale {
  return value as HadithNameLocale;
}

function collectionNames(
  rows: readonly {
    readonly locale: string;
    readonly name: string;
    readonly description: string | null;
  }[],
): HadithCollectionNameRecord[] {
  return rows.map((row) => ({
    locale: localeOf(row.locale),
    name: row.name,
    description: row.description,
  }));
}

function toStructure(row: {
  readonly id: string;
  readonly slug: string;
  readonly reference: string;
  readonly title: string | null;
  readonly titleLanguage: string | null;
  readonly names: readonly { readonly locale: string; readonly name: string }[];
}): PublicHadithStructure {
  return {
    id: row.id,
    slug: row.slug,
    reference: row.reference,
    title: row.title,
    titleLanguage: row.titleLanguage,
    names: row.names.map((name) => ({ locale: localeOf(name.locale), name: name.name })),
  };
}

function toBook(
  row: Parameters<typeof toStructure>[0] & {
    readonly edition: {
      readonly code: string;
      readonly title: string;
      readonly sourceSystem: { readonly title: string };
    };
  },
): PublicHadithBook {
  return {
    ...toStructure(row),
    edition: {
      sourceSystemTitle: row.edition.sourceSystem.title,
      editionTitle: row.edition.title,
      editionCode: row.edition.code,
    },
  };
}

function latest(...dates: readonly (Date | null | undefined)[]): Date {
  let found = 0;
  for (const date of dates) if (date != null) found = Math.max(found, date.getTime());
  return new Date(found);
}

/** A raw query's aggregate or timestamp, whatever shape the driver hands back. */
function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createHadithPublicReader(): HadithPublicReaderPort {
  const db = getDatabaseClient();

  /**
   * One page of public citations matching `filter` (a fragment over the
   * public rule's aliases), in collection, then number, order — and its count.
   */
  async function citationPage(
    mode: HadithSourceAuthority,
    filter: Prisma.Sql,
    offset: number,
  ): Promise<{
    readonly items: readonly PublicHadithCitationSummary[];
    readonly total: number;
    readonly offset: number;
  }> {
    const skip = boundedOffset(offset);
    const [counted, rows] = await Promise.all([
      db.$queryRaw<{ total: number }[]>`
        SELECT COUNT(*) AS [total] ${publicCitations(mode)} ${filter}`,
      db.$queryRaw<
        {
          collectionSlug: string;
          number: number;
          sourceReference: string;
          text: string;
          textLanguage: string;
        }[]
      >`SELECT col.[slug] AS [collectionSlug], c.[number], h.[sourceReference],
               h.[text], h.[textLanguage]
        ${publicCitations(mode)} ${filter}
        ORDER BY col.[position], col.[slug], c.[number]
        OFFSET ${skip} ROWS FETCH NEXT ${HADITH_PAGE} ROWS ONLY`,
    ]);
    return {
      items: rows.map((row) => ({ ...row, number: Number(row.number) })),
      total: Number(counted[0]?.total ?? 0),
      offset: skip,
    };
  }

  /** Whether at least one public citation matches `filter`. */
  async function holdsPublic(
    mode: HadithSourceAuthority,
    filter: Prisma.Sql,
  ): Promise<boolean> {
    const rows = await db.$queryRaw<{ found: number }[]>`
      SELECT TOP (1) 1 AS [found] ${publicCitations(mode)} ${filter}`;
    return rows.length > 0;
  }

  /**
   * The activated collections holding at least one public citation — with
   * the editions standing behind those citations and when any of them last
   * changed — in section order. `slug` narrows to one.
   */
  async function publicCollections(
    mode: HadithSourceAuthority,
    slug: string | null,
  ): Promise<PublicHadithCollection[]> {
    const only = slug === null ? Prisma.empty : Prisma.sql`AND col.[slug] = ${slug}`;
    const [held, sources] = await Promise.all([
      db.$queryRaw<{ collectionId: string; citationAt: Date; recordAt: Date }[]>`
        SELECT TOP (${COLLECTION_LIST}) c.[collectionId],
               MAX(c.[updatedAt]) AS [citationAt], MAX(h.[updatedAt]) AS [recordAt]
        ${publicCitations(mode)} ${only}
        GROUP BY c.[collectionId], col.[position], col.[slug]
        ORDER BY col.[position], col.[slug]`,
      db.$queryRaw<
        {
          collectionId: string;
          sourceSystemTitle: string;
          editionTitle: string;
          editionCode: string;
        }[]
      >`SELECT DISTINCT p.[collectionId], es.[title] AS [sourceSystemTitle],
               e.[title] AS [editionTitle], e.[code] AS [editionCode]
        FROM (SELECT c.[collectionId], h.[editionId] ${publicCitations(mode)} ${only}) p
        JOIN [dbo].[HadithEdition] e ON e.[id] = p.[editionId]
        JOIN [dbo].[HadithSourceSystem] es ON es.[id] = e.[sourceSystemId]`,
    ]);
    if (held.length === 0) return [];
    const rows = await db.hadithCollection.findMany({
      where: { id: { in: held.map((row) => row.collectionId) } },
      select: { id: true, slug: true, updatedAt: true, names: COLLECTION_NAMES },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const attributions = new Map<string, PublicHadithAttribution[]>();
    for (const row of sources) {
      const list = attributions.get(row.collectionId) ?? [];
      list.push({
        sourceSystemTitle: row.sourceSystemTitle,
        editionTitle: row.editionTitle,
        editionCode: row.editionCode,
      });
      attributions.set(row.collectionId, list);
    }
    return held.flatMap((row) => {
      const collection = byId.get(row.collectionId);
      if (collection === undefined) return [];
      return [
        {
          id: collection.id,
          slug: collection.slug,
          names: collectionNames(collection.names),
          attributions: (attributions.get(collection.id) ?? []).sort(
            (a, b) =>
              a.editionCode.localeCompare(b.editionCode) ||
              a.sourceSystemTitle.localeCompare(b.sourceSystemTitle),
          ),
          lastModified: latest(
            collection.updatedAt,
            dateOf(row.citationAt),
            dateOf(row.recordAt),
          ),
        },
      ];
    });
  }

  /**
   * The current public projection of a set of citations — the ONE
   * definition `searchCitation`, `searchCitationRecords` and (without text)
   * `searchCitationScopes` share, so a single record, a results page and the
   * reconciliation sweep cannot disagree. Three bounded reads for the whole
   * set; a citation that is not public now is simply absent.
   */
  async function projection(
    mode: HadithSourceAuthority,
    filter: Prisma.Sql,
    limit: number,
    withText: boolean,
  ): Promise<HadithSearchRecord[]> {
    const rows = await db.$queryRaw<
      {
        citationId: string;
        citationVersion: number;
        collectionSlug: string;
        number: number;
        hadithId: string;
        hadithVersion: number;
        verificationId: string | null;
        text: string | null;
        textLanguage: string;
      }[]
    >`SELECT TOP (${limit}) c.[id] AS [citationId], c.[version] AS [citationVersion],
             col.[slug] AS [collectionSlug], c.[number], h.[id] AS [hadithId],
             h.[version] AS [hadithVersion],
             (SELECT TOP (1) pv.[id] FROM [dbo].[HadithVerification] pv
               WHERE pv.[hadithId] = h.[id] AND pv.[version] = h.[version]) AS [verificationId],
             ${withText ? Prisma.sql`h.[text]` : Prisma.sql`NULL`} AS [text], h.[textLanguage]
      ${publicCitations(mode)} ${filter}
      ORDER BY c.[id]`;
    const hadithIds = rows.map((row) => row.hadithId);
    const [translations, topics] =
      hadithIds.length === 0
        ? [[], []]
        : await Promise.all([
            db.hadithTranslation.findMany({
              where: { hadithId: { in: hadithIds }, ...publicLayer(mode) },
              select: {
                id: true,
                hadithId: true,
                version: true,
                state: true,
                languageCode: true,
                text: withText,
              },
              orderBy: [{ languageCode: 'asc' }, { id: 'asc' }],
              take: WORK_LIST * hadithIds.length,
            }),
            db.hadithTopic.findMany({
              where: { hadithId: { in: hadithIds } },
              select: { hadithId: true, topicId: true },
              orderBy: [{ hadithId: 'asc' }, { topicId: 'asc' }],
              take: HADITH_LIMITS.topicsPerRecord * hadithIds.length,
            }),
          ]);
    return rows.map((row) => {
      const own = translations.filter(
        (translation) => translation.hadithId === row.hadithId,
      );
      const topicIds = topics
        .filter((topic) => topic.hadithId === row.hadithId)
        .map((topic) => topic.topicId);
      return {
        citationId: row.citationId,
        collectionSlug: row.collectionSlug,
        number: Number(row.number),
        text: row.text ?? '',
        textLanguage: row.textLanguage,
        translations: own.map((translation) => ({
          languageCode: translation.languageCode,
          text: translation.text ?? '',
        })),
        topicIds,
        stamp: stampOf({
          citationVersion: Number(row.citationVersion),
          hadithId: row.hadithId,
          hadithVersion: Number(row.hadithVersion),
          verificationId: row.verificationId,
          translations: own,
          topicIds,
        }),
      };
    });
  }

  function idsFilter(ids: readonly string[]): Prisma.Sql {
    return Prisma.sql`AND c.[id] IN (${Prisma.join([...ids])})`;
  }

  return {
    /** Answered with literal domain values, one per mode — nothing else is handed back. */
    async availability() {
      switch (await activeMode(db)) {
        case 'approved':
          return { active: true, mode: 'approved' };
        case 'fixture':
          return { active: true, mode: 'fixture' };
        case null:
          return { active: false };
      }
    },

    /* ---- Collections and structure --------------------------------------- */

    async collections() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      return publicCollections(mode, null);
    },

    async collection(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const [collection] = await publicCollections(mode, slug);
      return collection ?? null;
    },

    async books(collectionId) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const held = await db.$queryRaw<{ id: string }[]>`
        SELECT TOP (${STRUCTURE_LIST}) b.[id] FROM [dbo].[HadithBook] b
        WHERE b.[collectionId] = ${collectionId}
          AND EXISTS (SELECT 1 ${publicCitations(mode)} AND h.[bookId] = b.[id])
        ORDER BY b.[position], b.[slug]`;
      if (held.length === 0) return [];
      const rows = await db.hadithBook.findMany({
        where: { id: { in: held.map((row) => row.id) } },
        select: PUBLIC_BOOK,
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      });
      return rows.map(toBook);
    },

    async book(collectionId, slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.hadithBook.findUnique({
        where: { collectionId_slug: { collectionId, slug } },
        select: PUBLIC_BOOK,
      });
      if (row === null) return null;
      return (await holdsPublic(mode, Prisma.sql`AND h.[bookId] = ${row.id}`))
        ? toBook(row)
        : null;
    },

    async chapters(bookId) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const held = await db.$queryRaw<{ id: string }[]>`
        SELECT TOP (${STRUCTURE_LIST}) ch.[id] FROM [dbo].[HadithChapter] ch
        WHERE ch.[bookId] = ${bookId}
          AND EXISTS (SELECT 1 ${publicCitations(mode)} AND h.[chapterId] = ch.[id])
        ORDER BY ch.[position], ch.[slug]`;
      if (held.length === 0) return [];
      const rows = await db.hadithChapter.findMany({
        where: { id: { in: held.map((row) => row.id) } },
        select: PUBLIC_STRUCTURE,
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
      });
      return rows.map(toStructure);
    },

    async chapter(bookId, slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.hadithChapter.findUnique({
        where: { bookId_slug: { bookId, slug } },
        select: PUBLIC_STRUCTURE,
      });
      if (row === null) return null;
      return (await holdsPublic(mode, Prisma.sql`AND h.[chapterId] = ${row.id}`))
        ? toStructure(row)
        : null;
    },

    async bookCitations(bookId, offset) {
      const mode = await activeMode(db);
      if (mode === null) return { items: [], total: 0, offset: boundedOffset(offset) };
      return citationPage(
        mode,
        Prisma.sql`AND h.[bookId] = ${bookId} AND h.[chapterId] IS NULL`,
        offset,
      );
    },

    async chapterCitations(chapterId, offset) {
      const mode = await activeMode(db);
      if (mode === null) return { items: [], total: 0, offset: boundedOffset(offset) };
      return citationPage(mode, Prisma.sql`AND h.[chapterId] = ${chapterId}`, offset);
    },

    /* ---- The canonical citation page ------------------------------------- */

    /**
     * Read whole, then decided by the public rule over the facts read — so a
     * withdrawn, conflicted or unverified citation is absent exactly as an
     * unmapped one is.
     */
    async citation(collectionSlug, number) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const citation = await db.hadithCitation.findFirst({
        where: { number, collection: { slug: collectionSlug } },
        select: {
          id: true,
          collectionId: true,
          state: true,
          updatedAt: true,
          collection: {
            select: {
              slug: true,
              names: COLLECTION_NAMES,
              activation: { select: { authority: true } },
            },
          },
          hadith: {
            select: {
              id: true,
              version: true,
              sourceReference: true,
              text: true,
              textLanguage: true,
              chain: true,
              chainLanguage: true,
              updatedAt: true,
              sourceSystem: { select: { authority: true, title: true } },
              edition: { select: { title: true, code: true } },
              book: { select: PUBLIC_BOOK },
              chapter: { select: PUBLIC_STRUCTURE },
            },
          },
        },
      });
      if (citation === null) return null;
      const record = citation.hadith;
      const [verification, conflicts] = await Promise.all([
        db.hadithVerification.findUnique({
          where: { hadithId_version: { hadithId: record.id, version: record.version } },
          select: { id: true },
        }),
        db.hadithConflict.count({
          where: { collectionId: citation.collectionId, citationNumber: number },
        }),
      ]);
      if (
        !isPublicCitation(mode, {
          activated: citation.collection.activation !== null,
          state: citation.state,
          conflicted: conflicts > 0,
          verified: verification !== null,
          sourceAuthority: record.sourceSystem.authority,
        })
      )
        return null;

      const [gradings, translations, commentary, topics] = await Promise.all([
        db.hadithGrading.findMany({
          where: { hadithId: record.id, version: record.version },
          select: {
            position: true,
            grader: true,
            label: true,
            labelLanguage: true,
            reference: true,
          },
          orderBy: { position: 'asc' },
        }),
        db.hadithTranslation.findMany({
          where: { hadithId: record.id, ...publicLayer(mode) },
          select: {
            id: true,
            languageCode: true,
            text: true,
            attribution: true,
            updatedAt: true,
            sourceSystem: { select: { title: true } },
            contributors: PUBLIC_CONTRIBUTORS,
          },
          orderBy: [{ languageCode: 'asc' }, { id: 'asc' }],
          take: WORK_LIST,
        }),
        db.hadithCommentaryEntry.findMany({
          where: { hadithId: record.id, commentary: publicLayer(mode) },
          select: {
            text: true,
            commentary: {
              select: {
                id: true,
                slug: true,
                name: true,
                languageCode: true,
                attribution: true,
                updatedAt: true,
              },
            },
          },
          orderBy: [{ commentary: { slug: 'asc' } }, { commentaryId: 'asc' }],
          take: WORK_LIST,
        }),
        db.hadithTopic.findMany({
          where: { hadithId: record.id },
          select: { topicId: true },
          orderBy: { topicId: 'asc' },
          take: HADITH_LIMITS.topicsPerRecord,
        }),
      ]);

      return {
        citationId: citation.id,
        collection: {
          slug: citation.collection.slug,
          names: collectionNames(citation.collection.names),
        },
        number,
        sourceReference: record.sourceReference,
        attribution: {
          sourceSystemTitle: record.sourceSystem.title,
          editionTitle: record.edition.title,
          editionCode: record.edition.code,
        },
        book: toBook(record.book),
        chapter: record.chapter === null ? null : toStructure(record.chapter),
        text: record.text,
        textLanguage: record.textLanguage,
        chain: record.chain,
        chainLanguage: record.chainLanguage,
        gradings,
        translations: translations.flatMap((translation) =>
          // `publicLayer` names a source; the relation is never empty here.
          translation.sourceSystem === null
            ? []
            : [
                {
                  id: translation.id,
                  languageCode: translation.languageCode,
                  text: translation.text,
                  attribution: translation.attribution,
                  sourceSystemTitle: translation.sourceSystem.title,
                  contributors: translation.contributors.map((contributor) => ({
                    personId: contributor.personId,
                    role: roleOf(contributor.role),
                  })),
                },
              ],
        ),
        commentary: commentary.map((entry) => ({
          commentaryId: entry.commentary.id,
          slug: entry.commentary.slug,
          name: entry.commentary.name,
          languageCode: entry.commentary.languageCode,
          attribution: entry.commentary.attribution,
          text: entry.text,
        })),
        topicIds: topics.map((topic) => topic.topicId),
        lastModified: latest(
          record.updatedAt,
          citation.updatedAt,
          ...translations.map((translation) => translation.updatedAt),
          ...commentary.map((entry) => entry.commentary.updatedAt),
        ),
      };
    },

    async browse(offset) {
      const mode = await activeMode(db);
      if (mode === null) return { items: [], total: 0, offset: boundedOffset(offset) };
      return citationPage(mode, Prisma.empty, offset);
    },

    async topicCitations(topicId, offset) {
      const mode = await activeMode(db);
      if (mode === null) return { items: [], total: 0, offset: boundedOffset(offset) };
      return citationPage(
        mode,
        Prisma.sql`AND EXISTS (SELECT 1 FROM [dbo].[HadithTopic] tt
          WHERE tt.[hadithId] = h.[id] AND tt.[topicId] = ${topicId})`,
        offset,
      );
    },

    /* ---- Commentary and sciences ----------------------------------------- */

    /**
     * Public commentary works that carry at least one entry shown beside a
     * public citation, with the count of those entries.
     */
    async commentaries() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.hadithCommentary.findMany({
        where: publicLayer(mode),
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          languageCode: true,
          attribution: true,
          sourceSystem: { select: { title: true } },
          contributors: PUBLIC_CONTRIBUTORS,
        },
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: WORK_LIST,
      });
      if (rows.length === 0) return [];
      const counted = await db.$queryRaw<{ commentaryId: string; entries: number }[]>`
        SELECT ce.[commentaryId], COUNT(*) AS [entries]
        FROM [dbo].[HadithCommentaryEntry] ce
        WHERE ce.[commentaryId] IN (${Prisma.join(rows.map((row) => row.id))})
          AND EXISTS (SELECT 1 ${publicCitations(mode)} AND h.[id] = ce.[hadithId])
        GROUP BY ce.[commentaryId]`;
      const entries = new Map(
        counted.map((row) => [row.commentaryId, Number(row.entries)]),
      );
      return rows.flatMap((row) => {
        const entryCount = entries.get(row.id) ?? 0;
        return entryCount === 0 || row.sourceSystem === null
          ? []
          : [
              {
                id: row.id,
                slug: row.slug,
                name: row.name,
                description: row.description,
                languageCode: row.languageCode,
                attribution: row.attribution,
                sourceSystemTitle: row.sourceSystem.title,
                contributors: row.contributors.map((contributor) => ({
                  personId: contributor.personId,
                  role: roleOf(contributor.role),
                })),
                entryCount,
              },
            ];
      });
    },

    async sciences() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.hadithScience.findMany({
        where: publicLayer(mode),
        select: {
          slug: true,
          position: true,
          texts: {
            select: { languageCode: true, title: true },
            orderBy: { languageCode: 'asc' },
          },
        },
        orderBy: [{ position: 'asc' }, { slug: 'asc' }],
        take: SCIENCE_LIST,
      });
      return rows.map((row) => ({
        slug: row.slug,
        position: row.position,
        titles: row.texts.map((text) => ({ ...text })),
      }));
    },

    async science(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.hadithScience.findFirst({
        where: { slug, ...publicLayer(mode) },
        select: {
          slug: true,
          attribution: true,
          updatedAt: true,
          sourceSystem: { select: { title: true } },
          texts: {
            select: { languageCode: true, title: true, body: true },
            orderBy: { languageCode: 'asc' },
          },
        },
      });
      if (row === null || row.sourceSystem === null) return null;
      return {
        slug: row.slug,
        attribution: row.attribution,
        sourceSystemTitle: row.sourceSystem.title,
        texts: row.texts.map((text) => ({ ...text })),
        lastModified: row.updatedAt,
      };
    },

    /* ---- Sitemap: an APPROVED section only ------------------------------- */

    async citationSitemap(offset, limit) {
      const mode = await activeMode(db);
      if (mode !== 'approved') return [];
      const rows = await db.$queryRaw<
        { collectionSlug: string; number: number; lastModified: Date }[]
      >`SELECT col.[slug] AS [collectionSlug], c.[number],
               GREATEST(c.[updatedAt], h.[updatedAt],
                 (SELECT MAX(t.[updatedAt]) FROM [dbo].[HadithTranslation] t
                   WHERE t.[hadithId] = h.[id] AND ${publicLayerSql(mode)}),
                 (SELECT MAX(t.[updatedAt]) FROM [dbo].[HadithCommentaryEntry] se
                   JOIN [dbo].[HadithCommentary] t ON t.[id] = se.[commentaryId]
                   WHERE se.[hadithId] = h.[id] AND ${publicLayerSql(mode)})) AS [lastModified]
        ${publicCitations(mode)}
        ORDER BY col.[position], col.[slug], c.[number]
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${bounded(limit, 5000)} ROWS ONLY`;
      return rows.map((row) => ({
        collectionSlug: row.collectionSlug,
        number: Number(row.number),
        lastModified: dateOf(row.lastModified),
      }));
    },

    /* ---- Search ----------------------------------------------------------- */

    async searchCitation(citationId) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const [record] = await projection(mode, idsFilter([citationId]), 1, true);
      return record ?? null;
    },

    async searchCitationScopes(after, limit) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const records = await projection(
        mode,
        after === null ? Prisma.empty : Prisma.sql`AND c.[id] > ${after}`,
        bounded(limit, TARGET_BATCH),
        false,
      );
      return records.map((record) => ({ id: record.citationId, stamp: record.stamp }));
    },

    async publicCitationTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Hadith search batch exceeds its bound.');
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.$queryRaw<
        { citationId: string; collectionSlug: string; number: number }[]
      >`SELECT c.[id] AS [citationId], col.[slug] AS [collectionSlug], c.[number]
        ${publicCitations(mode)} ${idsFilter([...new Set(ids)])}
        ORDER BY col.[position], col.[slug], c.[number]`;
      return rows.map((row) => ({ ...row, number: Number(row.number) }));
    },

    async searchCitationRecords(ids) {
      if (ids.length === 0) return [];
      if (ids.length > HADITH_SEARCH_RECORDS_MAX)
        throw new Error('Hadith search record batch exceeds its bound.');
      const mode = await activeMode(db);
      if (mode === null) return [];
      const distinct = [...new Set(ids)];
      return projection(mode, idsFilter(distinct), distinct.length, true);
    },
  };
}
