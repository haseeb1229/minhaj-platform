import 'server-only';

import { Prisma } from '@prisma/client';

import {
  conflictFacetsOf,
  HADITH_LIMITS,
  HADITH_PAGE,
  type HadithBookRecord,
  type HadithCandidateRecord,
  type HadithChapterRecord,
  type HadithCitationState,
  type HadithCollectionRecord,
  type HadithConflictRecord,
  type HadithEditionRecord,
  type HadithNameLocale,
  type HadithPersistencePort,
  type HadithRecordFilter,
  type HadithRecordSummary,
  type HadithSourceAuthority,
  type HadithStructureNameRecord,
} from '@minhaj/contracts/hadith';

import { getDatabaseClient } from '../../client.ts';
import { layerPersistence } from './layers.ts';
import {
  audit,
  boundedOffset,
  HadithDataError,
  HISTORY,
  refuse,
  requestRecordScopes,
  VERIFIED,
  type Client,
} from './shared.ts';

/**
 * The Hadith persistence adapter — administration (DOMAIN_MODEL.md §9;
 * DELIVERY_PLAN.md Phase 19).
 *
 * OWNED BY THE HADITH CONTEXT, hosted here (ARCHITECTURE.md §4.1). One factory
 * leaves this module, typed by Hadith's own port, so no client, delegate or
 * transaction handle crosses the boundary. The layered works (`./layers.ts`)
 * are spread into it, so Hadith keeps one persistence port.
 *
 * NO METHOD HERE WRITES A SOURCED FACT. It READS sources, editions, structure,
 * records, their history, verification, citations and conflict evidence; the
 * only canonical-table facts it writes are display-name versions, and the only
 * record-adjacent rows are topic assignments. Canonical writes are
 * `./canonical.ts`'s procedures alone — and this principal holds no INSERT,
 * UPDATE or DELETE that could bypass them.
 *
 * Topics and people are named by their identifiers only: nothing here reads a
 * Taxonomy or People table.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

/** Registered sources an operator sees at once; the owner registers few. */
const SOURCE_LIST = 100;

/** Editions of one collection shown at once; each is an operator registration. */
const EDITION_LIST = 100;

/** Candidates for one citation number shown at once. */
const CANDIDATES = 100;

const NAMES = {
  select: { locale: true, name: true },
  orderBy: { locale: 'asc' },
} as const;

const SOURCE_SELECT = {
  id: true,
  code: true,
  authority: true,
  title: true,
  version: true,
  reference: true,
  createdAt: true,
} satisfies Prisma.HadithSourceSystemSelect;

const EDITION_SELECT = {
  id: true,
  collectionId: true,
  sourceSystemId: true,
  code: true,
  title: true,
  reference: true,
  sourceSystem: { select: { code: true, title: true, authority: true } },
} satisfies Prisma.HadithEditionSelect;

const EDITION_ORDER = [{ code: 'asc' }, { id: 'asc' }] as const;

const COLLECTION_SELECT = {
  id: true,
  slug: true,
  position: true,
  namesVersion: true,
  names: {
    select: { locale: true, name: true, description: true },
    orderBy: { locale: 'asc' },
  },
  activation: { select: { authority: true } },
  editions: { select: EDITION_SELECT, orderBy: [...EDITION_ORDER], take: EDITION_LIST },
} satisfies Prisma.HadithCollectionSelect;

const BOOK_SELECT = {
  id: true,
  collectionId: true,
  editionId: true,
  slug: true,
  reference: true,
  position: true,
  title: true,
  titleLanguage: true,
  namesVersion: true,
  names: NAMES,
  collection: { select: { slug: true } },
  edition: { select: { code: true } },
} satisfies Prisma.HadithBookSelect;

const CHAPTER_SELECT = {
  id: true,
  bookId: true,
  slug: true,
  reference: true,
  position: true,
  title: true,
  titleLanguage: true,
  namesVersion: true,
  names: NAMES,
} satisfies Prisma.HadithChapterSelect;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface NameRow {
  readonly locale: string;
  readonly name: string;
}

interface EditionRow {
  readonly id: string;
  readonly collectionId: string;
  readonly sourceSystemId: string;
  readonly code: string;
  readonly title: string;
  readonly reference: string | null;
  readonly sourceSystem: {
    readonly code: string;
    readonly title: string;
    readonly authority: string;
  };
}

interface CollectionRow {
  readonly id: string;
  readonly slug: string;
  readonly position: number;
  readonly namesVersion: number;
  readonly names: readonly (NameRow & { readonly description: string | null })[];
  readonly activation: { readonly authority: string } | null;
  readonly editions: readonly EditionRow[];
}

interface StructureRow {
  readonly id: string;
  readonly slug: string;
  readonly reference: string;
  readonly position: number;
  readonly title: string | null;
  readonly titleLanguage: string | null;
  readonly namesVersion: number;
  readonly names: readonly NameRow[];
}

interface BookRow extends StructureRow {
  readonly collectionId: string;
  readonly editionId: string;
  readonly collection: { readonly slug: string };
  readonly edition: { readonly code: string };
}

interface ChapterRow extends StructureRow {
  readonly bookId: string;
}

function localeOf(value: string): HadithNameLocale {
  return value as HadithNameLocale;
}

function structureNames(rows: readonly NameRow[]): HadithStructureNameRecord[] {
  return rows.map((row) => ({ locale: localeOf(row.locale), name: row.name }));
}

function toEdition(row: EditionRow): HadithEditionRecord {
  return {
    id: row.id,
    collectionId: row.collectionId,
    sourceSystemId: row.sourceSystemId,
    sourceSystemCode: row.sourceSystem.code,
    sourceSystemTitle: row.sourceSystem.title,
    authority: row.sourceSystem.authority as HadithSourceAuthority,
    code: row.code,
    title: row.title,
    reference: row.reference,
  };
}

function toCollection(row: CollectionRow): HadithCollectionRecord {
  return {
    id: row.id,
    slug: row.slug,
    position: row.position,
    namesVersion: row.namesVersion,
    names: row.names.map((name) => ({
      locale: localeOf(name.locale),
      name: name.name,
      description: name.description,
    })),
    activation:
      row.activation === null
        ? null
        : (row.activation.authority as HadithSourceAuthority),
    editions: row.editions.map(toEdition),
  };
}

function toBook(row: BookRow): HadithBookRecord {
  return {
    id: row.id,
    collectionId: row.collectionId,
    collectionSlug: row.collection.slug,
    editionId: row.editionId,
    editionCode: row.edition.code,
    slug: row.slug,
    reference: row.reference,
    position: row.position,
    title: row.title,
    titleLanguage: row.titleLanguage,
    namesVersion: row.namesVersion,
    names: structureNames(row.names),
  };
}

function toChapter(row: ChapterRow): HadithChapterRecord {
  return {
    id: row.id,
    bookId: row.bookId,
    slug: row.slug,
    reference: row.reference,
    position: row.position,
    title: row.title,
    titleLanguage: row.titleLanguage,
    namesVersion: row.namesVersion,
    names: structureNames(row.names),
  };
}

/* ===========================================================================
 * Record summaries — one bounded query for a page
 * ========================================================================= */

interface SummaryRow {
  readonly id: string;
  readonly collectionId: string;
  readonly collectionSlug: string;
  readonly editionId: string;
  readonly editionCode: string;
  readonly sourceSystemCode: string;
  readonly authority: string;
  readonly sourceReference: string;
  readonly citationNumber: number | null;
  readonly version: number;
  readonly verified: number;
  readonly conflicts: number;
  readonly citation: string | null;
  readonly updatedAt: Date;
}

/** Conflict evidence naming the record `h` on either side. */
const CONFLICTED = Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[HadithConflict] x
  WHERE x.[hadithId] = h.[id] OR x.[otherHadithId] = h.[id])`;

/** What each administrative view narrows the record list to — never broader. */
function viewOf(view: HadithRecordFilter): Prisma.Sql {
  switch (view) {
    case 'all':
      return Prisma.empty;
    case 'unverified':
      return Prisma.sql`AND NOT ${VERIFIED}`;
    case 'conflicted':
      return Prisma.sql`AND ${CONFLICTED}`;
    case 'mapped':
      return Prisma.sql`AND EXISTS (SELECT 1 FROM [dbo].[HadithCitation] mc
        WHERE mc.[hadithId] = h.[id] AND mc.[state] = N'mapped')`;
  }
}

/**
 * Record summaries matching `where` (a fragment over `h`), in collection, then
 * citation-number, then source order — every flag the list shows computed in
 * the same statement, never one query per record.
 */
async function summaries(
  db: Client,
  where: Prisma.Sql,
  page: { readonly skip: number; readonly take: number },
): Promise<HadithRecordSummary[]> {
  const rows = await db.$queryRaw<SummaryRow[]>`
    SELECT h.[id], h.[collectionId], col.[slug] AS [collectionSlug], h.[editionId],
           e.[code] AS [editionCode], s.[code] AS [sourceSystemCode], s.[authority],
           h.[sourceReference], h.[citationNumber], h.[version],
           CASE WHEN ${VERIFIED} THEN 1 ELSE 0 END AS [verified],
           (SELECT COUNT(*) FROM [dbo].[HadithConflict] x
             WHERE x.[hadithId] = h.[id] OR x.[otherHadithId] = h.[id]) AS [conflicts],
           (SELECT TOP (1) nc.[state] FROM [dbo].[HadithCitation] nc
             WHERE nc.[hadithId] = h.[id]) AS [citation],
           h.[updatedAt]
    FROM [dbo].[Hadith] h
    JOIN [dbo].[HadithCollection] col ON col.[id] = h.[collectionId]
    JOIN [dbo].[HadithEdition] e ON e.[id] = h.[editionId]
    JOIN [dbo].[HadithSourceSystem] s ON s.[id] = h.[sourceSystemId]
    WHERE 1 = 1 ${where}
    ORDER BY col.[position], col.[slug],
             CASE WHEN h.[citationNumber] IS NULL THEN 1 ELSE 0 END, h.[citationNumber],
             e.[code], h.[sourceReference], h.[id]
    OFFSET ${page.skip} ROWS FETCH NEXT ${page.take} ROWS ONLY`;
  return rows.map((row) => ({
    id: row.id,
    collectionId: row.collectionId,
    collectionSlug: row.collectionSlug,
    editionId: row.editionId,
    editionCode: row.editionCode,
    sourceSystemCode: row.sourceSystemCode,
    authority: row.authority as HadithSourceAuthority,
    sourceReference: row.sourceReference,
    citationNumber: row.citationNumber === null ? null : Number(row.citationNumber),
    version: Number(row.version),
    verified: Number(row.verified) === 1,
    conflicts: Number(row.conflicts),
    citation: row.citation as HadithCitationState | null,
    updatedAt: new Date(row.updatedAt),
  }));
}

/* ===========================================================================
 * Display names — the one canonical-table fact this principal advances
 * ========================================================================= */

type NamedKind = 'collection' | 'book' | 'chapter';

/**
 * Claims a structure's display-names version — the ONE column of it this
 * principal may advance (column-level grant), by exactly one (its trigger),
 * under the version the operator read.
 */
async function claimNames(
  tx: Client,
  kind: NamedKind,
  id: string,
  expectedVersion: number,
): Promise<void> {
  const select = { namesVersion: true } as const;
  const previous =
    kind === 'collection'
      ? await tx.hadithCollection.findUnique({ where: { id }, select })
      : kind === 'book'
        ? await tx.hadithBook.findUnique({ where: { id }, select })
        : await tx.hadithChapter.findUnique({ where: { id }, select });
  if (previous === null) throw new HadithDataError('not-found');
  if (previous.namesVersion !== expectedVersion) throw new HadithDataError('conflict');
  const where = { id, namesVersion: expectedVersion };
  const data = { namesVersion: { increment: 1 }, updatedAt: new Date() };
  const changed =
    kind === 'collection'
      ? await tx.hadithCollection.updateMany({ where, data })
      : kind === 'book'
        ? await tx.hadithBook.updateMany({ where, data })
        : await tx.hadithChapter.updateMany({ where, data });
  if (changed.count !== 1) throw new HadithDataError('conflict');
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createHadithPersistence(): HadithPersistencePort {
  const db = getDatabaseClient();

  /** Which of these records a human verification covers at its CURRENT version. */
  async function verifiedAt(
    records: readonly { readonly id: string; readonly version: number }[],
  ): Promise<ReadonlySet<string>> {
    if (records.length === 0) return new Set();
    const rows = await db.hadithVerification.findMany({
      where: {
        OR: records.map((record) => ({ hadithId: record.id, version: record.version })),
      },
      select: { hadithId: true },
    });
    return new Set(rows.map((row) => row.hadithId));
  }

  async function names(
    tx: Client,
    kind: NamedKind,
    input: {
      readonly actorId: string;
      readonly value: {
        readonly id: string;
        readonly expectedVersion: number;
        readonly names: readonly {
          readonly locale: string;
          readonly name: string;
          readonly description?: string | null;
        }[];
      };
    },
  ): Promise<void> {
    const { id, expectedVersion } = input.value;
    await claimNames(tx, kind, id, expectedVersion);
    if (kind === 'collection') {
      await tx.hadithCollectionName.deleteMany({ where: { collectionId: id } });
      if (input.value.names.length > 0)
        await tx.hadithCollectionName.createMany({
          data: input.value.names.map((entry) => ({
            collectionId: id,
            locale: entry.locale,
            name: entry.name,
            description: entry.description ?? null,
          })),
        });
    } else if (kind === 'book') {
      await tx.hadithBookName.deleteMany({ where: { bookId: id } });
      if (input.value.names.length > 0)
        await tx.hadithBookName.createMany({
          data: input.value.names.map((entry) => ({
            bookId: id,
            locale: entry.locale,
            name: entry.name,
          })),
        });
    } else {
      await tx.hadithChapterName.deleteMany({ where: { chapterId: id } });
      if (input.value.names.length > 0)
        await tx.hadithChapterName.createMany({
          data: input.value.names.map((entry) => ({
            chapterId: id,
            locale: entry.locale,
            name: entry.name,
          })),
        });
    }
    // Which locales carry a name — never the names.
    await audit(tx, {
      actorId: input.actorId,
      action: `hadith.${kind}.names-saved`,
      targetType: `hadith-${kind}`,
      targetId: id,
      before: { version: String(expectedVersion) },
      after: {
        version: String(expectedVersion + 1),
        locales: input.value.names.map((entry) => entry.locale).join(','),
      },
    });
  }

  return {
    ...layerPersistence(),

    /* ---- Sources and editions — the operator's, read only ---------------- */

    async sourceSystems() {
      const rows = await db.hadithSourceSystem.findMany({
        select: SOURCE_SELECT,
        orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
        take: SOURCE_LIST,
      });
      return rows.map((row) => ({
        ...row,
        authority: row.authority as HadithSourceAuthority,
      }));
    },

    /* ---- Structure ------------------------------------------------------- */

    async collections(offset) {
      const skip = boundedOffset(offset);
      const [total, rows] = await Promise.all([
        db.hadithCollection.count(),
        db.hadithCollection.findMany({
          select: COLLECTION_SELECT,
          orderBy: [{ position: 'asc' }, { slug: 'asc' }],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toCollection), total, offset: skip };
    },

    async collection(id) {
      const row = await db.hadithCollection.findUnique({
        where: { id },
        select: COLLECTION_SELECT,
      });
      return row === null ? null : toCollection(row);
    },

    async saveCollectionNames(input) {
      try {
        await db.$transaction((tx) => names(tx, 'collection', input));
      } catch (error) {
        refuse(error);
      }
    },

    async books(collectionId, offset) {
      const skip = boundedOffset(offset);
      const where = collectionId === null ? {} : { collectionId };
      const [total, rows] = await Promise.all([
        db.hadithBook.count({ where }),
        db.hadithBook.findMany({
          where,
          select: BOOK_SELECT,
          orderBy: [
            { collection: { position: 'asc' } },
            { collection: { slug: 'asc' } },
            { edition: { code: 'asc' } },
            { position: 'asc' },
            { id: 'asc' },
          ],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toBook), total, offset: skip };
    },

    async book(id) {
      const row = await db.hadithBook.findUnique({ where: { id }, select: BOOK_SELECT });
      return row === null ? null : toBook(row);
    },

    async saveBookNames(input) {
      try {
        await db.$transaction((tx) => names(tx, 'book', input));
      } catch (error) {
        refuse(error);
      }
    },

    async chapters(bookId, offset) {
      const skip = boundedOffset(offset);
      const where = bookId === null ? {} : { bookId };
      const [total, rows] = await Promise.all([
        db.hadithChapter.count({ where }),
        db.hadithChapter.findMany({
          where,
          select: CHAPTER_SELECT,
          orderBy: [
            { book: { position: 'asc' } },
            { bookId: 'asc' },
            { position: 'asc' },
            { id: 'asc' },
          ],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toChapter), total, offset: skip };
    },

    async chapter(id) {
      const row = await db.hadithChapter.findUnique({
        where: { id },
        select: CHAPTER_SELECT,
      });
      return row === null ? null : toChapter(row);
    },

    async saveChapterNames(input) {
      try {
        await db.$transaction((tx) => names(tx, 'chapter', input));
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Records — read only --------------------------------------------- */

    async records(filter, offset) {
      const skip = boundedOffset(offset);
      const where = Prisma.sql`${
        filter.collectionId === null
          ? Prisma.empty
          : Prisma.sql`AND h.[collectionId] = ${filter.collectionId}`
      } ${viewOf(filter.view)}`;
      const [counted, items] = await Promise.all([
        db.$queryRaw<{ total: number }[]>`
          SELECT COUNT(*) AS [total] FROM [dbo].[Hadith] h WHERE 1 = 1 ${where}`,
        summaries(db, where, { skip, take: HADITH_PAGE }),
      ]);
      return { items, total: Number(counted[0]?.total ?? 0), offset: skip };
    },

    /**
     * Everything an administrator reviews about one record: its current
     * facts and gradings, its whole bounded history, every verification,
     * the conflict evidence on either side, the other candidates for its
     * number and the citation for that number, whichever candidate it names.
     */
    async record(id) {
      const [summary] = await summaries(db, Prisma.sql`AND h.[id] = ${id}`, {
        skip: 0,
        take: 1,
      });
      if (summary === undefined) return null;
      const row = await db.hadith.findUnique({
        where: { id },
        select: {
          bookId: true,
          chapterId: true,
          text: true,
          textLanguage: true,
          chain: true,
          chainLanguage: true,
          book: { select: { slug: true, reference: true } },
          chapter: { select: { slug: true, reference: true } },
          revisions: {
            select: {
              version: true,
              operation: true,
              sourceReference: true,
              citationNumber: true,
              evidence: true,
              reason: true,
              actorId: true,
              createdAt: true,
            },
            orderBy: { version: 'desc' },
            take: HISTORY,
          },
          topics: {
            select: { topicId: true },
            orderBy: { topicId: 'asc' },
            take: HADITH_LIMITS.topicsPerRecord,
          },
        },
      });
      if (row === null) return null;

      const number = summary.citationNumber;
      const [gradings, verifications, conflictRows, candidateRows, citation, conflicted] =
        await Promise.all([
          db.hadithGrading.findMany({
            where: { hadithId: id, version: summary.version },
            select: {
              position: true,
              grader: true,
              label: true,
              labelLanguage: true,
              reference: true,
            },
            orderBy: { position: 'asc' },
          }),
          db.hadithVerification.findMany({
            where: { hadithId: id },
            select: {
              id: true,
              version: true,
              evidence: true,
              actorId: true,
              createdAt: true,
            },
            orderBy: [{ version: 'desc' }, { id: 'asc' }],
            take: HISTORY,
          }),
          db.hadithConflict.findMany({
            where: { OR: [{ hadithId: id }, { otherHadithId: id }] },
            select: {
              id: true,
              hadithId: true,
              hadithVersion: true,
              otherHadithId: true,
              otherVersion: true,
              facets: true,
              detectedAt: true,
            },
            orderBy: [{ detectedAt: 'desc' }, { id: 'asc' }],
            take: HISTORY,
          }),
          number === null
            ? Promise.resolve([])
            : db.hadith.findMany({
                where: {
                  collectionId: summary.collectionId,
                  citationNumber: number,
                  id: { not: id },
                },
                select: {
                  id: true,
                  sourceReference: true,
                  version: true,
                  edition: { select: { code: true } },
                  sourceSystem: { select: { code: true } },
                },
                orderBy: [
                  { edition: { code: 'asc' } },
                  { sourceReference: 'asc' },
                  { id: 'asc' },
                ],
                take: CANDIDATES,
              }),
          number === null
            ? Promise.resolve(null)
            : db.hadithCitation.findUnique({
                where: {
                  collectionId_number: { collectionId: summary.collectionId, number },
                },
                select: {
                  id: true,
                  collectionId: true,
                  number: true,
                  hadithId: true,
                  state: true,
                  version: true,
                  updatedAt: true,
                  revisions: {
                    select: {
                      version: true,
                      hadithId: true,
                      state: true,
                      evidence: true,
                      reason: true,
                      actorId: true,
                      createdAt: true,
                    },
                    orderBy: { version: 'desc' },
                    take: HISTORY,
                  },
                },
              }),
          number === null
            ? Promise.resolve(0)
            : db.hadithConflict.count({
                where: { collectionId: summary.collectionId, citationNumber: number },
              }),
        ]);

      // Each row read from THIS record's side: the other record is the one
      // that is not this one, whichever side the database recorded it on.
      const oriented = conflictRows.map((conflict) =>
        conflict.hadithId === id
          ? conflict
          : {
              ...conflict,
              hadithId: conflict.otherHadithId,
              hadithVersion: conflict.otherVersion,
              otherHadithId: conflict.hadithId,
              otherVersion: conflict.hadithVersion,
            },
      );
      const otherIds = [...new Set(oriented.map((conflict) => conflict.otherHadithId))];
      const [others, candidatesVerified] = await Promise.all([
        otherIds.length === 0
          ? Promise.resolve([])
          : db.hadith.findMany({
              where: { id: { in: otherIds } },
              select: {
                id: true,
                sourceReference: true,
                edition: { select: { code: true } },
              },
            }),
        verifiedAt(candidateRows),
      ]);
      const other = new Map(others.map((record) => [record.id, record]));
      const conflictEvidence: HadithConflictRecord[] = oriented.map((conflict) => ({
        id: conflict.id,
        hadithId: conflict.hadithId,
        hadithVersion: conflict.hadithVersion,
        otherHadithId: conflict.otherHadithId,
        otherVersion: conflict.otherVersion,
        otherEditionCode: other.get(conflict.otherHadithId)?.edition.code ?? '',
        otherSourceReference: other.get(conflict.otherHadithId)?.sourceReference ?? '',
        facets: conflictFacetsOf(conflict.facets),
        detectedAt: conflict.detectedAt,
      }));
      const candidates: HadithCandidateRecord[] = candidateRows.map((candidate) => ({
        id: candidate.id,
        editionCode: candidate.edition.code,
        sourceSystemCode: candidate.sourceSystem.code,
        sourceReference: candidate.sourceReference,
        version: candidate.version,
        verified: candidatesVerified.has(candidate.id),
      }));

      return {
        ...summary,
        bookId: row.bookId,
        bookSlug: row.book.slug,
        bookReference: row.book.reference,
        chapterId: row.chapterId,
        chapterSlug: row.chapter?.slug ?? null,
        chapterReference: row.chapter?.reference ?? null,
        text: row.text,
        textLanguage: row.textLanguage,
        chain: row.chain,
        chainLanguage: row.chainLanguage,
        gradings,
        revisions: row.revisions.map((revision) => ({
          ...revision,
          operation: revision.operation as 'created' | 'corrected',
        })),
        verifications,
        conflictEvidence,
        candidates,
        citationRecord:
          citation === null
            ? null
            : {
                ...citation,
                state: citation.state as HadithCitationState,
                revisions: citation.revisions.map((revision) => ({
                  ...revision,
                  state: revision.state as HadithCitationState,
                })),
              },
        citationConflicted: conflicted > 0,
        topicIds: row.topics.map((topic) => topic.topicId),
      };
    },

    /* ---- Topics: a typed foreign key to the record and to the Topic ------ */

    async addRecordTopic({ actorId, hadithId, topicId }) {
      try {
        await db.$transaction(async (tx) => {
          // Two concurrent additions at the ceiling must not both pass the
          // count: the record row is locked for the rest of the transaction.
          const locked = await tx.$queryRaw<{ id: string }[]>`
            SELECT [id] FROM [dbo].[Hadith] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = ${hadithId}`;
          if (locked.length !== 1) throw new HadithDataError('not-found');
          const held = await tx.hadithTopic.count({ where: { hadithId } });
          if (held >= HADITH_LIMITS.topicsPerRecord) throw new HadithDataError('invalid');
          await tx.hadithTopic.create({ data: { hadithId, topicId } });
          await requestRecordScopes(tx, [hadithId]);
          await audit(tx, {
            actorId,
            action: 'hadith.record.topic-added',
            targetType: 'hadith-record',
            targetId: hadithId,
            after: { topicId },
          });
        });
      } catch (error) {
        refuse(error);
      }
    },

    async removeRecordTopic({ actorId, hadithId, topicId }) {
      try {
        await db.$transaction(async (tx) => {
          const removed = await tx.hadithTopic.deleteMany({
            where: { hadithId, topicId },
          });
          if (removed.count !== 1) throw new HadithDataError('not-found');
          await requestRecordScopes(tx, [hadithId]);
          await audit(tx, {
            actorId,
            action: 'hadith.record.topic-removed',
            targetType: 'hadith-record',
            targetId: hadithId,
            before: { topicId },
            after: { topicId: 'none' },
          });
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
