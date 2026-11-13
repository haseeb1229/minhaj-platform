import 'server-only';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  readerDocumentSchema,
  type LibraryPersistencePort,
  type LibraryPublicReaderPort,
  type WorkRecord,
  type EditionRecord,
  type SalePointRecord,
  type WorkDetail,
  type LibraryQuery,
  type LibraryFacetPage,
  type LibraryCover,
  type QuranPassageWork,
  type QuranWork,
  type QuranWorksQuery,
} from '@minhaj/contracts/library';
import {
  canonicalPassageOrder,
  passageKey,
  passageMatchesQuery,
  type PassageQuery,
  type QuranPassage,
} from '@minhaj/contracts/passage';
import { getDatabaseClient } from '../../client.ts';
import { auditRow } from '../../audit-row.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { createScholarlyPersistence, createScholarlyPublicReader } from './scholarly.ts';

class LibraryDataError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}
function refuse(error: unknown): never {
  const code = (error as { code?: string } | null)?.code;
  if (code === 'P2002') throw new LibraryDataError('duplicate-slug');
  if (code === 'P2025') throw new LibraryDataError('conflict');
  if (code === 'P2003' || code === 'P2004') throw new LibraryDataError('invalid');
  // A serialization failure is unavailable, not a domain refusal. No automatic mutation retry.
  throw error;
}
const workInclude = {
  labels: { orderBy: { locale: 'asc' as const } },
  contributors: {
    orderBy: [
      { position: 'asc' as const },
      { personId: 'asc' as const },
      { role: 'asc' as const },
    ],
  },
  topics: { orderBy: { topicId: 'asc' as const } },
  salePoints: { orderBy: { salePointId: 'asc' as const } },
  // Phase 30-R: the card cover is the first published Edition's that has one.
  editions: {
    where: { state: 'published', coverAssetId: { not: null } },
    orderBy: { id: 'asc' as const },
    take: 1,
    select: { id: true, coverAssetId: true, coverWidth: true, coverHeight: true },
  },
};
const editionInclude = {
  translation: { include: { translators: { orderBy: { personId: 'asc' as const } } } },
};
/**
 * The mapper inputs are STRUCTURAL, never Prisma payload aliases.
 *
 * A payload alias names `Prisma` in a PARAMETER position, and a parameter
 * position is part of this module's surface: the architecture gate walks what an
 * exported factory returns, reaches these mappers through it, and refuses an
 * adapter whose public entry can be shown to reach the client, its delegates or
 * its transaction handles (ARCHITECTURE.md §4.1, §6.3 rule 13). Renaming the
 * capability would not narrow it.
 *
 * Stating the shape instead keeps the capability walk stopping here, and nothing
 * is cast to achieve it — the rows the queries above produce are WIDER than
 * these shapes and satisfy them structurally, so a column added to a table
 * cannot silently change what a DTO carries.
 */
interface WorkRow {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly state: string;
  readonly isFeatured: boolean;
  readonly version: number;
  readonly updatedAt: Date;
  readonly labels: readonly {
    readonly locale: string;
    readonly title: string;
    readonly description: string;
  }[];
  readonly contributors: readonly {
    readonly personId: string;
    readonly role: string;
  }[];
  readonly topics: readonly { readonly topicId: string }[];
  readonly salePoints: readonly { readonly salePointId: string }[];
  readonly editions: readonly {
    readonly id: string;
    readonly coverAssetId: string | null;
    readonly coverWidth: number | null;
    readonly coverHeight: number | null;
  }[];
}
interface EditionRow {
  readonly id: string;
  readonly workId: string;
  readonly label: string;
  readonly languageCode: string;
  readonly state: string;
  readonly publisher: string | null;
  readonly publicationYear: number | null;
  readonly isbn: string | null;
  readonly pageCount: number | null;
  readonly reading: string;
  readonly download: string;
  readonly readableAssetId: string | null;
  readonly downloadAssetId: string | null;
  readonly document: string | null;
  readonly contentVersion: string | null;
  readonly coverAssetId: string | null;
  readonly coverWidth: number | null;
  readonly coverHeight: number | null;
  readonly version: number;
  readonly updatedAt: Date;
  readonly translation: {
    readonly sourceEditionId: string | null;
    readonly translators: readonly { readonly personId: string }[];
  } | null;
}
interface SaleRow {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly contact: string;
  readonly url: string | null;
  readonly state: string;
  readonly version: number;
}
/** A cover as a value, or null — the CHECK keeps the three columns together. */
function coverOf(row: {
  readonly coverAssetId: string | null;
  readonly coverWidth: number | null;
  readonly coverHeight: number | null;
}): LibraryCover | null {
  if (row.coverAssetId === null || row.coverWidth === null || row.coverHeight === null)
    return null;
  return { assetId: row.coverAssetId, width: row.coverWidth, height: row.coverHeight };
}

function work(row: WorkRow): WorkRecord {
  const coverEdition = row.editions[0];
  const cover = coverEdition === undefined ? null : coverOf(coverEdition);
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as WorkRecord['primaryLocale'],
    state: row.state as WorkRecord['state'],
    isFeatured: row.isFeatured,
    version: row.version,
    updatedAt: row.updatedAt,
    labels: row.labels.map((l) => ({
      locale: l.locale as WorkRecord['primaryLocale'],
      title: l.title,
      description: l.description,
    })),
    contributors: row.contributors.map((c) => ({
      personId: c.personId,
      role: c.role as WorkRecord['contributors'][number]['role'],
    })),
    topicIds: row.topics.map((t) => t.topicId),
    salePointIds: row.salePoints.map((s) => s.salePointId),
    cover:
      cover === null || coverEdition === undefined
        ? null
        : { ...cover, editionId: coverEdition.id },
  };
}
function edition(row: EditionRow, publicOnly = false): EditionRecord {
  const readable = !publicOnly || row.reading === 'allowed';
  return {
    id: row.id,
    workId: row.workId,
    label: row.label,
    languageCode: row.languageCode,
    state: row.state as EditionRecord['state'],
    publisher: row.publisher,
    publicationYear: row.publicationYear,
    isbn: row.isbn,
    pageCount: row.pageCount,
    reading: row.reading as EditionRecord['reading'],
    download: row.download as EditionRecord['download'],
    readableAssetId: readable ? row.readableAssetId : null,
    downloadAssetId:
      !publicOnly || row.download === 'allowed' ? row.downloadAssetId : null,
    document:
      readable && row.document
        ? readerDocumentSchema.parse(JSON.parse(row.document))
        : null,
    contentVersion: readable ? row.contentVersion : null,
    cover: coverOf(row),
    version: row.version,
    updatedAt: row.updatedAt,
    translation: row.translation
      ? {
          sourceEditionId: row.translation.sourceEditionId,
          translatorIds: row.translation.translators.map((t) => t.personId),
        }
      : null,
  };
}
function sale(row: SaleRow): SalePointRecord {
  return { ...row, state: row.state as SalePointRecord['state'] };
}
async function audit(
  tx: Prisma.TransactionClient,
  actorId: string,
  kind: string,
  id: string,
  action: string,
  before: Record<string, string> | null,
  after: Record<string, string>,
) {
  await tx.auditLog.create({
    data: auditRow({
      actorType: 'user',
      actorId,
      action: `library.${kind}.${action}`,
      targetType: kind,
      targetId: id,
      ...(before ? { before } : {}),
      after,
      authorisingSource: 'library.administer',
    }),
  });
}
async function bumpWork(tx: Prisma.TransactionClient, id: string) {
  await tx.work.update({
    where: { id },
    data: { updatedAt: new Date(), version: { increment: 1 } },
  });
}
async function detail(id: string, publicOnly: boolean): Promise<WorkDetail | null> {
  const db = getDatabaseClient();
  const row = await db.work.findFirst({
    where: { id, ...(publicOnly ? { state: 'published' } : {}) },
    include: workInclude,
  });
  if (!row) return null;
  const [editions, sales, passages] = await Promise.all([
    db.edition.findMany({
      where: { workId: id, ...(publicOnly ? { state: 'published' } : {}) },
      orderBy: { id: 'asc' },
      take: 50,
      include: editionInclude,
    }),
    db.salePoint.findMany({
      where: {
        works: { some: { workId: id } },
        ...(publicOnly ? { state: 'published' } : {}),
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 24,
    }),
    db.workQuranPassage.findMany({
      where: { workId: id },
      orderBy: { position: 'asc' },
      select: PASSAGE_SELECT,
    }),
  ]);
  const visibleIds = new Set(editions.map((e) => e.id));
  return {
    ...work(row),
    editions: editions.map((e) => {
      const dto = edition(e, publicOnly);
      if (
        publicOnly &&
        dto.translation?.sourceEditionId &&
        !visibleIds.has(dto.translation.sourceEditionId)
      )
        dto.translation.sourceEditionId = null;
      return dto;
    }),
    salePoints: sales.map(sale),
    quranPassages: passages.map(passageOf),
  };
}

/* ---- Quran Part 8: the Quran passages a Work explains --------------------- */

const PASSAGE_SELECT = {
  surahNumber: true,
  ayahFrom: true,
  ayahTo: true,
} as const;

/** A stored passage as the citation value it is. */
function passageOf(row: {
  readonly surahNumber: number;
  readonly ayahFrom: number;
  readonly ayahTo: number;
}): QuranPassage {
  return { surah: row.surahNumber, ayahFrom: row.ayahFrom, ayahTo: row.ayahTo };
}

/** The citations an audit entry names — never more than its payload holds. */
function citations(passages: readonly QuranPassage[]): string {
  return passages.map(passageKey).join(' ').slice(0, 1_000);
}
/**
 * A version no row can hold (`CHECK ([version] > 0)`).
 *
 * An edit always carries an expected version — the service refuses one without.
 * If that were ever bypassed, comparing against this makes the guarded update match
 * nothing, so the write is a CONFLICT rather than an unguarded last-write-wins.
 */
const UNMATCHABLE_VERSION = 0;

const boundedOffset = (n: number) =>
  Math.max(0, Math.min(10_000_000, Math.trunc(n) || 0));
async function salePoints(
  offset: number,
  publicOnly: boolean,
): Promise<{ items: SalePointRecord[]; hasMore: boolean }> {
  const rows = await getDatabaseClient().salePoint.findMany({
    where: publicOnly ? { state: 'published' } : {},
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: boundedOffset(offset),
    take: 26,
  });
  return { items: rows.slice(0, 25).map(sale), hasMore: rows.length > 25 };
}
export function createLibraryPersistence(): LibraryPersistencePort {
  const db = getDatabaseClient();
  return {
    // Phase 9's aggregates, written by their own module over their own tables.
    ...createScholarlyPersistence(),
    async works(offset) {
      const rows = await db.work.findMany({
        orderBy: { slug: 'asc' },
        skip: boundedOffset(offset),
        take: 26,
        include: workInclude,
      });
      return { items: rows.slice(0, 25).map(work), hasMore: rows.length > 25 };
    },
    work: (id) => detail(id, false),
    async workBySlug(slug) {
      // The unique current-slug index answers; the detail is the ordinary one.
      const row = await db.work.findUnique({ where: { slug }, select: { id: true } });
      return row === null ? null : detail(row.id, false);
    },
    async editions(offset) {
      const rows = await db.edition.findMany({
        orderBy: [{ workId: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: 26,
        include: editionInclude,
      });
      return {
        items: rows.slice(0, 25).map((e) => edition(e)),
        hasMore: rows.length > 25,
      };
    },
    async edition(id) {
      const row = await db.edition.findUnique({ where: { id }, include: editionInclude });
      return row ? edition(row) : null;
    },
    salePoints: (offset) => salePoints(offset, false),
    async saveWork({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const workId = id ?? randomUUID();
          const previous = id ? await tx.work.findUnique({ where: { id } }) : null;
          if (id && (!previous || previous.version !== expectedVersion))
            throw new LibraryDataError('conflict');
          const data = {
            slug: value.slug,
            primaryLocale: value.primaryLocale,
            state: value.state,
            isFeatured: value.isFeatured,
            updatedAt: new Date(),
          };
          if (id) {
            const changed = await tx.work.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new LibraryDataError('conflict');
          } else await tx.work.create({ data: { ...data, id: workId } });
          // The Work trigger reserves the slug in this same transaction.
          await tx.workLabel.deleteMany({ where: { workId } });
          await tx.workLabel.createMany({
            data: value.labels.map((l) => ({ ...l, workId })),
          });
          await tx.workContributor.deleteMany({ where: { workId } });
          if (value.contributors.length)
            await tx.workContributor.createMany({
              data: value.contributors.map((c, position) => ({ ...c, position, workId })),
            });
          await tx.workTopic.deleteMany({ where: { workId } });
          if (value.topicIds.length)
            await tx.workTopic.createMany({
              data: value.topicIds.map((topicId) => ({ workId, topicId })),
            });
          await tx.workSalePoint.deleteMany({ where: { workId } });
          if (value.salePointIds.length)
            await tx.workSalePoint.createMany({
              data: value.salePointIds.map((salePointId) => ({ workId, salePointId })),
            });
          const row = await tx.work.findUniqueOrThrow({
            where: { id: workId },
            include: workInclude,
          });
          await requestSearchIndexing(tx, 'work', workId);
          await audit(
            tx,
            actorId,
            'work',
            workId,
            previous ? 'updated' : 'created',
            previous
              ? { version: String(previous.version), state: previous.state }
              : null,
            {
              version: String(row.version),
              state: row.state,
              slugChanged: String(previous !== null && previous.slug !== value.slug),
            },
          );
          return work(row);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async saveEdition({ actorId, id, expectedVersion, value, contentVersion }) {
      try {
        return await db.$transaction(async (tx) => {
          // All mutations of a Work's editions serialize at their owner before dependent writes.
          await bumpWork(tx, value.workId);
          if (!id && (await tx.edition.count({ where: { workId: value.workId } })) >= 50)
            throw new LibraryDataError('limit');
          const editionId = id ?? randomUUID();
          const previous = id ? await tx.edition.findUnique({ where: { id } }) : null;
          if (
            id &&
            (!previous ||
              previous.workId !== value.workId ||
              previous.version !== expectedVersion)
          )
            throw new LibraryDataError('conflict');
          // Changing the manifestation's language would invalidate recorded translations.
          if (
            previous &&
            previous.languageCode !== value.languageCode &&
            (await tx.bookTranslation.count({
              where: {
                OR: [{ editionId: previous.id }, { sourceEditionId: previous.id }],
              },
            }))
          )
            throw new LibraryDataError('invalid');
          const { document, cover, ...fields } = value;
          // An omitted cover KEEPS the stored one on an update; null removes it.
          const coverColumns =
            cover === undefined
              ? id
                ? {}
                : { coverAssetId: null, coverWidth: null, coverHeight: null }
              : {
                  coverAssetId: cover?.assetId ?? null,
                  coverWidth: cover?.width ?? null,
                  coverHeight: cover?.height ?? null,
                };
          const data = {
            ...fields,
            ...coverColumns,
            document: document ? JSON.stringify(document) : null,
            contentVersion,
            updatedAt: new Date(),
          };
          if (id) {
            const changed = await tx.edition.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...data, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new LibraryDataError('conflict');
          } else await tx.edition.create({ data: { id: editionId, ...data } });
          const row = await tx.edition.findUniqueOrThrow({
            where: { id: editionId },
            include: editionInclude,
          });
          await requestSearchIndexing(tx, 'work', value.workId);
          await audit(
            tx,
            actorId,
            'edition',
            editionId,
            previous ? 'updated' : 'created',
            previous
              ? {
                  version: String(previous.version),
                  state: previous.state,
                  reading: previous.reading,
                  download: previous.download,
                }
              : null,
            {
              version: String(row.version),
              state: row.state,
              reading: row.reading,
              download: row.download,
              readableAssetId: row.readableAssetId ?? '',
              downloadAssetId: row.downloadAssetId ?? '',
              coverAssetId: row.coverAssetId ?? '',
            },
          );
          return edition(row);
        });
      } catch (error) {
        refuse(error);
      }
    },
    async saveTranslation({
      actorId,
      editionId,
      expectedVersion,
      sourceEditionId,
      translatorIds,
    }) {
      try {
        await db.$transaction(async (tx) => {
          const target = await tx.edition.findUnique({ where: { id: editionId } });
          if (!target) throw new LibraryDataError('not-found');
          await bumpWork(tx, target.workId);
          if (sourceEditionId) {
            const source = await tx.edition.findUnique({
              where: { id: sourceEditionId },
            });
            if (
              !source ||
              source.workId !== target.workId ||
              source.id === target.id ||
              source.languageCode === target.languageCode
            )
              throw new LibraryDataError('invalid');
          }
          const changed = await tx.edition.updateMany({
            where: { id: editionId, version: expectedVersion },
            data: { version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new LibraryDataError('conflict');
          await tx.bookTranslation.upsert({
            where: { editionId },
            create: { editionId, workId: target.workId, sourceEditionId },
            update: { sourceEditionId },
          });
          await tx.bookTranslator.deleteMany({ where: { editionId } });
          await tx.bookTranslator.createMany({
            data: translatorIds.map((personId) => ({ editionId, personId })),
          });
          await requestSearchIndexing(tx, 'work', target.workId);
          await audit(
            tx,
            actorId,
            'translation',
            editionId,
            'updated',
            { version: String(expectedVersion) },
            {
              version: String(expectedVersion + 1),
              sourceEditionId: sourceEditionId ?? '',
              translatorCount: String(translatorIds.length),
            },
          );
        });
      } catch (error) {
        refuse(error);
      }
    },
    async removeTranslation({ actorId, editionId, expectedVersion }) {
      try {
        await db.$transaction(async (tx) => {
          const target = await tx.edition.findUniqueOrThrow({ where: { id: editionId } });
          await bumpWork(tx, target.workId);
          const changed = await tx.edition.updateMany({
            where: { id: editionId, version: expectedVersion },
            data: { version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new LibraryDataError('conflict');
          await tx.bookTranslator.deleteMany({ where: { editionId } });
          await tx.bookTranslation.deleteMany({ where: { editionId } });
          await requestSearchIndexing(tx, 'work', target.workId);
          await audit(
            tx,
            actorId,
            'translation',
            editionId,
            'removed',
            { version: String(expectedVersion) },
            { version: String(expectedVersion + 1) },
          );
        });
      } catch (error) {
        refuse(error);
      }
    },
    async setWorkQuranPassages({ actorId, workId, expectedVersion, passages, change }) {
      try {
        await db.$transaction(async (tx) => {
          const previous = await tx.workQuranPassage.findMany({
            where: { workId },
            orderBy: { position: 'asc' },
            select: PASSAGE_SELECT,
          });
          // The version the operator saw, claimed atomically: a change made in
          // between is a conflict, never something this one silently reorders.
          const claimed = await tx.work.updateMany({
            where: { id: workId, version: expectedVersion },
            data: { updatedAt: new Date(), version: { increment: 1 } },
          });
          if (claimed.count !== 1) throw new LibraryDataError('conflict');
          await tx.workQuranPassage.deleteMany({ where: { workId } });
          if (passages.length > 0)
            await tx.workQuranPassage.createMany({
              data: passages.map((passage, position) => ({
                workId,
                position,
                surahNumber: passage.surah,
                ayahFrom: passage.ayahFrom,
                ayahTo: passage.ayahTo,
              })),
            });
          await requestSearchIndexing(tx, 'work', workId);
          await audit(
            tx,
            actorId,
            'work',
            workId,
            change === 'title' ? 'passages-proposed' : `passages-${change}`,
            {
              version: String(expectedVersion),
              passages: citations(previous.map(passageOf)),
            },
            {
              version: String(expectedVersion + 1),
              passages: citations(passages),
              // Where the set came from: the editor, or the operator command
              // that proposed it from the Work's title (Quran Part 8).
              origin: change === 'title' ? 'operator:tafsir-passages' : 'editor',
            },
          );
        });
      } catch (error) {
        refuse(error);
      }
      const saved = await detail(workId, false);
      if (saved === null) throw new LibraryDataError('not-found');
      return saved;
    },
    async saveSalePoint({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const saleId = id ?? randomUUID();
          if (id) {
            const changed = await tx.salePoint.updateMany({
              where: { id, version: expectedVersion ?? UNMATCHABLE_VERSION },
              data: { ...value, version: { increment: 1 } },
            });
            if (changed.count !== 1) throw new LibraryDataError('conflict');
          } else await tx.salePoint.create({ data: { id: saleId, ...value } });
          const row = await tx.salePoint.findUniqueOrThrow({ where: { id: saleId } });
          await tx.work.updateMany({
            where: { salePoints: { some: { salePointId: saleId } } },
            data: { updatedAt: new Date(), version: { increment: 1 } },
          });
          // A sale point is not searchable, but moving a Work's version moves its
          // search stamp. Requesting the re-projection keeps "every stamp change
          // is owed a projection" true, so reconciliation never reports a Work
          // stale that nothing ever asked to have indexed.
          const linked = await tx.workSalePoint.findMany({
            where: { salePointId: saleId },
            select: { workId: true },
          });
          for (const { workId } of linked)
            await requestSearchIndexing(tx, 'work', workId);
          await audit(
            tx,
            actorId,
            'sale-point',
            saleId,
            id ? 'updated' : 'created',
            id ? { version: String(expectedVersion) } : null,
            { version: String(row.version), state: row.state },
          );
          return sale(row);
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
/**
 * What "a public Work" means, in ONE place.
 *
 * A Work is public when it is published AND has at least one published Edition.
 * A Work with no manifestation is a catalogue entry for nothing: the Work page
 * would have no Edition to select, nothing to read, and not even an honest
 * unavailable state to render — because "unavailable" is a fact about an
 * Edition, and there would be none.
 *
 * Every public read composes this predicate, including the filtered listing
 * below, so the listing, the detail page, the three facets and the sitemap
 * cannot come to different conclusions about which Works exist.
 */
const PUBLIC_WORK = {
  state: 'published',
  editions: { some: { state: 'published' } },
} as const;

function publicWhere(q: LibraryQuery): Prisma.WorkWhereInput {
  const editionFilter: Prisma.EditionWhereInput = {
    state: PUBLIC_WORK.state,
    ...(q.language ? { languageCode: q.language } : {}),
    ...(q.from !== null || q.to !== null
      ? {
          publicationYear: {
            ...(q.from !== null ? { gte: q.from } : {}),
            ...(q.to !== null ? { lte: q.to } : {}),
          },
        }
      : {}),
    ...(q.downloads ? { download: 'allowed', downloadAssetId: { not: null } } : {}),
  };
  return {
    // The filters NARROW which Edition satisfies the public predicate; they
    // never widen it. A Work still needs a published Edition, and the filtered
    // one has to be that Edition rather than merely one of its siblings.
    ...PUBLIC_WORK,
    editions: { some: editionFilter },
    ...(q.topic ? { topics: { some: { topicId: q.topic } } } : {}),
    ...(q.contributor ? { contributors: { some: { personId: q.contributor } } } : {}),
  };
}

/**
 * One page of public Works in a READER'S order (R2): A–Z by the title shown, or
 * the newest publication first.
 *
 * TWO READS, THE SECOND AUTHORITATIVE. The order needs a label chosen per Work
 * and an aggregate over its Editions, which the ORM cannot order by, so the
 * first read is one bounded SQL page of identifiers. The second loads those
 * Works through `publicWhere` — the ONE public predicate — so even an error in
 * the ordering query could only drop a Work from the page, never admit one.
 *
 * The title is the one `labelFor` renders: the reader's locale, else the
 * primary locale, else the first label by locale. The identifier ends every
 * order, so the order is total.
 */
async function orderedWorks(
  q: LibraryQuery,
  sort: 'title' | 'newest',
): Promise<{ items: WorkRecord[]; hasMore: boolean }> {
  const db = getDatabaseClient();
  const edition = [Prisma.sql`e.[workId] = w.[id]`, Prisma.sql`e.[state] = N'published'`];
  if (q.language) edition.push(Prisma.sql`e.[languageCode] = ${q.language}`);
  if (q.from !== null) edition.push(Prisma.sql`e.[publicationYear] >= ${q.from}`);
  if (q.to !== null) edition.push(Prisma.sql`e.[publicationYear] <= ${q.to}`);
  if (q.downloads)
    edition.push(
      Prisma.sql`e.[download] = N'allowed'`,
      Prisma.sql`e.[downloadAssetId] IS NOT NULL`,
    );
  const conditions = [
    Prisma.sql`w.[state] = N'published'`,
    Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[Edition] e WHERE ${Prisma.join(edition, ' AND ')})`,
  ];
  if (q.topic)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkTopic] c WHERE c.[workId] = w.[id] AND c.[topicId] = ${q.topic})`,
    );
  if (q.contributor)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkContributor] c WHERE c.[workId] = w.[id] AND c.[personId] = ${q.contributor})`,
    );
  const order =
    sort === 'newest'
      ? Prisma.sql`CASE WHEN y.[year] IS NULL THEN 1 ELSE 0 END, y.[year] DESC, t.[title] ASC, w.[id] ASC`
      : Prisma.sql`t.[title] ASC, w.[id] ASC`;

  const page = await db.$queryRaw<{ id: string }[]>`
    SELECT w.[id]
    FROM [dbo].[Work] w
    OUTER APPLY (
      SELECT TOP (1) l.[title] FROM [dbo].[WorkLabel] l
      WHERE l.[workId] = w.[id]
      ORDER BY CASE WHEN l.[locale] = ${q.titleLocale} THEN 0
                    WHEN l.[locale] = w.[primaryLocale] THEN 1 ELSE 2 END, l.[locale]
    ) t
    OUTER APPLY (
      SELECT MAX(p.[publicationYear]) AS [year] FROM [dbo].[Edition] p
      WHERE p.[workId] = w.[id] AND p.[state] = N'published'
    ) y
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY ${order}
    OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT 26 ROWS ONLY`;

  const ids = page.slice(0, 25).map((row) => row.id);
  if (ids.length === 0) return { items: [], hasMore: page.length > 25 };
  const rows = await db.work.findMany({
    where: { ...publicWhere(q), id: { in: ids } },
    include: workInclude,
  });
  const byId = new Map(rows.map((row) => [row.id, row]));
  return {
    items: ids.flatMap((id) => {
      const row = byId.get(id);
      return row === undefined ? [] : [work(row)];
    }),
    hasMore: page.length > 25,
  };
}
/**
 * One page of a facet, ordered by weight and broken by identifier.
 *
 * MOST WORKS FIRST is the useful order for a browse, and the identifier is the
 * TIE-BREAKER that makes it deterministic — without it two contributors with the
 * same number of Works could swap places between requests, and a page-two read
 * could then repeat or skip one of them (§31).
 */
function facetPage(
  rows: readonly { id: string; count: number }[],
  size: number,
): LibraryFacetPage {
  return {
    items: rows.slice(0, size).map((row) => ({ id: row.id, works: row.count })),
    hasMore: rows.length > size,
  };
}

/** How many facet rows one browse page shows. */
const FACET_PAGE = 50;

/**
 * Quran Part 8: the most public Works one passage read considers before it
 * orders them by passage. A ceiling, not a page: the Tafsir hub and a Surah's
 * page ask for a bounded `limit` of these.
 */
const PASSAGE_WORKS_CEILING = 500;

/** The stored passages a passage query admits: its Surah, overlapping its range. */
function passageWhere(query: PassageQuery): Prisma.WorkQuranPassageWhereInput {
  if (query.surah === null) return {};
  return {
    surahNumber: query.surah,
    ...(query.ayahTo === null ? {} : { ayahFrom: { lte: query.ayahTo } }),
    ...(query.ayahFrom === null ? {} : { ayahTo: { gte: query.ayahFrom } }),
  };
}

/* ---- Quran Part 10: the Quran Books hub ----------------------------------- */

/** Which of the query's filters a statement applies. */
interface QuranWorksFilters {
  readonly scope: boolean;
  readonly language: boolean;
  readonly contributor: boolean;
  readonly featured: boolean;
}

const ALL_FILTERS: QuranWorksFilters = {
  scope: true,
  language: true,
  contributor: true,
  featured: true,
};
const NO_FILTERS: QuranWorksFilters = {
  scope: false,
  language: false,
  contributor: false,
  featured: false,
};

/**
 * THE QURAN BOOKS SET, as SQL over `[dbo].[Work] w`: the ONE public predicate
 * (published, with a published Edition — the language narrows WHICH Edition
 * must be published, never widens it), membership (on the Topic, or carrying
 * a passage), and whichever of the query's filters `use` names. Every value is
 * a bound parameter.
 */
function quranWorksWhere(q: QuranWorksQuery, use: QuranWorksFilters): Prisma.Sql {
  const edition = [Prisma.sql`e.[workId] = w.[id]`, Prisma.sql`e.[state] = N'published'`];
  if (use.language && q.language !== null)
    edition.push(Prisma.sql`e.[languageCode] = ${q.language}`);
  const carries = Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkQuranPassage] m WHERE m.[workId] = w.[id])`;
  const conditions = [
    Prisma.sql`w.[state] = N'published'`,
    Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[Edition] e WHERE ${Prisma.join(edition, ' AND ')})`,
    q.topic === null
      ? carries
      : Prisma.sql`(EXISTS (SELECT 1 FROM [dbo].[WorkTopic] o WHERE o.[workId] = w.[id] AND o.[topicId] = ${q.topic}) OR ${carries})`,
  ];
  if (use.scope) {
    if (q.surah !== null)
      conditions.push(
        Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkQuranPassage] s WHERE s.[workId] = w.[id] AND s.[surahNumber] = ${q.surah})`,
      );
    else if (q.shelf === 'explains') conditions.push(carries);
    else if (q.shelf === 'general') conditions.push(Prisma.sql`NOT ${carries}`);
  }
  if (use.contributor && q.contributor !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkContributor] c WHERE c.[workId] = w.[id] AND c.[personId] = ${q.contributor})`,
    );
  if (use.featured && q.featured) conditions.push(Prisma.sql`w.[isFeatured] = 1`);
  return Prisma.join(conditions, ' AND ');
}

/** The same membership as an ORM filter: the hydrating read re-applies it. */
function quranWorksMembership(q: QuranWorksQuery): Prisma.WorkWhereInput {
  return q.topic === null
    ? { quranPassages: { some: {} } }
    : {
        OR: [{ topics: { some: { topicId: q.topic } } }, { quranPassages: { some: {} } }],
      };
}

/** How many content languages one card names, at most. */
const QURAN_WORK_EDITIONS = 50;

function quranWorksReader(): Pick<
  LibraryPublicReaderPort,
  'quranWorks' | 'quranWorkFacets'
> {
  const db = getDatabaseClient();

  /** Counts over a filtered set: every Work, and those carrying a passage. */
  async function counts(where: Prisma.Sql) {
    const [row] = await db.$queryRaw<
      { works: number; explaining: number | null; featured: number | null }[]
    >`
      WITH s AS (
        SELECT CASE WHEN EXISTS (SELECT 1 FROM [dbo].[WorkQuranPassage] m WHERE m.[workId] = w.[id])
                    THEN 1 ELSE 0 END AS [explaining],
               CASE WHEN w.[isFeatured] = 1 THEN 1 ELSE 0 END AS [featured]
        FROM [dbo].[Work] w
        WHERE ${where}
      )
      SELECT COUNT(*) AS [works], SUM(s.[explaining]) AS [explaining], SUM(s.[featured]) AS [featured]
      FROM s;`;
    return {
      works: Number(row?.works ?? 0),
      explaining: Number(row?.explaining ?? 0),
      featured: Number(row?.featured ?? 0),
    };
  }

  return {
    /**
     * TWO READS, THE SECOND AUTHORITATIVE — as `orderedWorks`: one bounded SQL
     * page of identifiers in the reader's order (with the total the query
     * admits), then those Works loaded under the public predicate and the
     * membership again, so an error in the ordering query could only drop a
     * Work, never admit one.
     */
    async quranWorks(q) {
      const where = quranWorksWhere(q, ALL_FILTERS);
      const order =
        q.sort === 'newest'
          ? Prisma.sql`CASE WHEN y.[year] IS NULL THEN 1 ELSE 0 END, y.[year] DESC, t.[title] ASC, w.[id] ASC`
          : q.sort === 'quran'
            ? Prisma.sql`CASE WHEN f.[surahNumber] IS NULL THEN 1 ELSE 0 END, f.[surahNumber] ASC, f.[ayahFrom] ASC, f.[ayahTo] ASC, t.[title] ASC, w.[id] ASC`
            : Prisma.sql`t.[title] ASC, w.[id] ASC`;
      // In Quran order a Surah filter orders by the passage in THAT Surah.
      const first =
        q.surah === null ? Prisma.empty : Prisma.sql`AND p.[surahNumber] = ${q.surah}`;
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT w.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[Work] w
        OUTER APPLY (
          SELECT TOP (1) l.[title] FROM [dbo].[WorkLabel] l
          WHERE l.[workId] = w.[id]
          ORDER BY CASE WHEN l.[locale] = ${q.titleLocale} THEN 0
                        WHEN l.[locale] = w.[primaryLocale] THEN 1 ELSE 2 END, l.[locale]
        ) t
        OUTER APPLY (
          SELECT MAX(e.[publicationYear]) AS [year] FROM [dbo].[Edition] e
          WHERE e.[workId] = w.[id] AND e.[state] = N'published'
        ) y
        OUTER APPLY (
          SELECT TOP (1) p.[surahNumber], p.[ayahFrom], p.[ayahTo]
          FROM [dbo].[WorkQuranPassage] p
          WHERE p.[workId] = w.[id] ${first}
          ORDER BY p.[surahNumber], p.[ayahFrom], p.[ayahTo]
        ) f
        WHERE ${where}
        ORDER BY ${order}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : (await counts(where)).works
          : Number(page[0].total);
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };

      const rows = await db.work.findMany({
        where: { ...PUBLIC_WORK, ...quranWorksMembership(q), id: { in: ids } },
        select: {
          id: true,
          slug: true,
          primaryLocale: true,
          isFeatured: true,
          labels: {
            select: { locale: true, title: true, description: true },
            orderBy: { locale: 'asc' as const },
          },
          contributors: {
            select: { personId: true, role: true },
            orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }],
          },
          editions: {
            where: { state: 'published' },
            select: {
              id: true,
              languageCode: true,
              publicationYear: true,
              reading: true,
              coverAssetId: true,
              coverWidth: true,
              coverHeight: true,
            },
            orderBy: { id: 'asc' as const },
            take: QURAN_WORK_EDITIONS,
          },
          quranPassages: {
            select: PASSAGE_SELECT,
            orderBy: { position: 'asc' as const },
          },
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const items: QuranWork[] = ids.flatMap((id) => {
        const row = byId.get(id);
        if (row === undefined) return [];
        const coverEdition = row.editions.find((entry) => coverOf(entry) !== null);
        const cover = coverEdition === undefined ? null : coverOf(coverEdition);
        const years = row.editions.flatMap((entry) =>
          entry.publicationYear === null ? [] : [entry.publicationYear],
        );
        return [
          {
            id: row.id,
            slug: row.slug,
            primaryLocale: row.primaryLocale as WorkRecord['primaryLocale'],
            isFeatured: row.isFeatured,
            labels: row.labels.map((label) => ({
              locale: label.locale as WorkRecord['primaryLocale'],
              title: label.title,
              description: label.description,
            })),
            cover:
              cover === null || coverEdition === undefined
                ? null
                : { ...cover, editionId: coverEdition.id },
            contributors: row.contributors,
            languages: [
              ...new Set(row.editions.map((entry) => entry.languageCode)),
            ].sort(),
            year: years.length === 0 ? null : Math.max(...years),
            readable: row.editions.some((entry) => entry.reading === 'allowed'),
            passages: row.quranPassages.map(passageOf),
          },
        ];
      });
      return { items, total, hasMore: page.length > q.limit };
    },

    /**
     * FIVE GROUPED READS, each bounded: a facet's own filter is left out of its
     * own counts, so every option says how many Works choosing it would show.
     */
    async quranWorkFacets(q) {
      const scoped = (use: Partial<QuranWorksFilters>) =>
        quranWorksWhere(q, { ...NO_FILTERS, ...use });
      const [hub, hubLanguages, shelves, languages, contributors, surahs] =
        await Promise.all([
          counts(scoped({})),
          db.$queryRaw<{ languages: number }[]>`
            SELECT COUNT(DISTINCT e.[languageCode]) AS [languages]
            FROM [dbo].[Edition] e
            WHERE e.[state] = N'published'
              AND e.[workId] IN (SELECT w.[id] FROM [dbo].[Work] w WHERE ${scoped({})});`,
          counts(scoped({ language: true, contributor: true })),
          db.$queryRaw<{ id: string; count: number }[]>`
            SELECT TOP (${FACET_PAGE + 1}) e.[languageCode] AS [id], COUNT(DISTINCT e.[workId]) AS [count]
            FROM [dbo].[Edition] e
            WHERE e.[state] = N'published'
              AND e.[workId] IN (SELECT w.[id] FROM [dbo].[Work] w
                                 WHERE ${scoped({ scope: true, contributor: true })})
            GROUP BY e.[languageCode]
            ORDER BY [count] DESC, [id] ASC;`,
          db.$queryRaw<{ id: string; count: number }[]>`
            SELECT TOP (${FACET_PAGE + 1}) c.[personId] AS [id], COUNT(DISTINCT c.[workId]) AS [count]
            FROM [dbo].[WorkContributor] c
            WHERE c.[workId] IN (SELECT w.[id] FROM [dbo].[Work] w
                                 WHERE ${scoped({ scope: true, language: true })})
            GROUP BY c.[personId]
            ORDER BY [count] DESC, [id] ASC;`,
          db.$queryRaw<{ surah: number; owners: number }[]>`
            SELECT p.[surahNumber] AS [surah], COUNT(DISTINCT p.[workId]) AS [owners]
            FROM [dbo].[WorkQuranPassage] p
            WHERE p.[workId] IN (SELECT w.[id] FROM [dbo].[Work] w
                                 WHERE ${scoped({ language: true, contributor: true })})
            GROUP BY p.[surahNumber]
            ORDER BY p.[surahNumber];`,
        ]);
      const facet = (rows: readonly { id: string; count: number }[]) =>
        facetPage(
          rows.map((row) => ({ id: row.id, count: Number(row.count) })),
          FACET_PAGE,
        );
      return {
        hub: {
          works: hub.works,
          explaining: hub.explaining,
          featured: hub.featured,
          languages: Number(hubLanguages[0]?.languages ?? 0),
        },
        shelves: { all: shelves.works, explaining: shelves.explaining },
        languages: facet(languages),
        contributors: facet(contributors),
        surahs: surahs.map((row) => ({
          surah: Number(row.surah),
          owners: Number(row.owners),
        })),
      };
    },
  };
}

/** At most one Collection's worth of Works is described in one read. */
const REFERENCE_BATCH = 100;
/** How many Works an editor's selector offers at once. */
const REFERENCE_CHOICES = 25;
const REFERENCE_SELECT = {
  id: true,
  slug: true,
  labels: { select: { locale: true, title: true }, orderBy: { locale: 'asc' as const } },
} satisfies Prisma.WorkSelect;

export function createLibraryPublicReader(): LibraryPublicReaderPort {
  const db = getDatabaseClient();
  return {
    ...createScholarlyPublicReader(),
    ...quranWorksReader(),
    async contributorFacets(offset) {
      const rows = await db.workContributor.groupBy({
        by: ['personId'],
        where: { work: PUBLIC_WORK },
        _count: { workId: true },
        orderBy: [{ _count: { workId: 'desc' } }, { personId: 'asc' }],
        skip: boundedOffset(offset),
        take: FACET_PAGE + 1,
      });
      return facetPage(
        rows.map((row) => ({ id: row.personId, count: row._count.workId })),
        FACET_PAGE,
      );
    },

    async topicFacets(offset) {
      const rows = await db.workTopic.groupBy({
        by: ['topicId'],
        where: { work: PUBLIC_WORK },
        _count: { workId: true },
        orderBy: [{ _count: { workId: 'desc' } }, { topicId: 'asc' }],
        skip: boundedOffset(offset),
        take: FACET_PAGE + 1,
      });
      return facetPage(
        rows.map((row) => ({ id: row.topicId, count: row._count.workId })),
        FACET_PAGE,
      );
    },

    /**
     * CONTENT languages, counted over published EDITIONS rather than Works.
     *
     * The distinction is the one DOMAIN_MODEL.md §10.1 turns on: a Work has no
     * language, its manifestations do. Counting Works would have to pick one
     * language per Work and would then have to invent a rule for a Work with an
     * Arabic original and an Urdu translation.
     */
    async languageFacets(offset) {
      const rows = await db.edition.groupBy({
        by: ['languageCode'],
        where: { state: 'published', work: PUBLIC_WORK },
        _count: { id: true },
        orderBy: [{ _count: { id: 'desc' } }, { languageCode: 'asc' }],
        skip: boundedOffset(offset),
        take: FACET_PAGE + 1,
      });
      return facetPage(
        rows.map((row) => ({ id: row.languageCode, count: row._count.id })),
        FACET_PAGE,
      );
    },

    async works(query) {
      if (query.sort !== null) return orderedWorks(query, query.sort);
      const rows = await db.work.findMany({
        where: publicWhere(query),
        orderBy: { slug: 'asc' },
        skip: boundedOffset(query.offset),
        take: 26,
        include: workInclude,
      });
      return { items: rows.slice(0, 25).map(work), hasMore: rows.length > 25 };
    },
    async work(slug) {
      const row = await db.work.findFirst({
        where: { slug, ...PUBLIC_WORK },
        select: { id: true },
      });
      return row ? detail(row.id, true) : null;
    },
    async canonicalSlug(slug) {
      const row = await db.workSlugHistory.findFirst({
        where: {
          slug,
          work: PUBLIC_WORK,
        },
        select: { work: { select: { slug: true } } },
      });
      return row?.work.slug ?? null;
    },
    salePoints: (offset) => salePoints(offset, true),
    async sitemap(offset, limit) {
      const rows = await db.work.findMany({
        where: PUBLIC_WORK,
        orderBy: { slug: 'asc' },
        skip: boundedOffset(offset),
        take: Math.min(5000, Math.max(1, limit)),
        select: {
          slug: true,
          updatedAt: true,
          labels: { select: { locale: true }, orderBy: { locale: 'asc' } },
        },
      });
      return rows.map((r) => ({
        slug: r.slug,
        updatedAt: r.updatedAt,
        locales: r.labels.map((l) => l.locale),
      }));
    },
    async searchWork(id) {
      const row = await db.work.findFirst({
        where: { id, ...PUBLIC_WORK },
        select: {
          id: true,
          slug: true,
          version: true,
          primaryLocale: true,
          labels: { orderBy: { locale: 'asc' } },
          topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
          editions: {
            where: { state: 'published' },
            orderBy: { id: 'asc' },
            take: 50,
            select: {
              id: true,
              label: true,
              languageCode: true,
              publisher: true,
              publicationYear: true,
              isbn: true,
              translation: { select: { editionId: true } },
            },
          },
        },
      });
      if (!row) return null;
      return {
        id: row.id,
        slug: row.slug,
        stamp: String(row.version),
        primaryLocale: row.primaryLocale,
        topicIds: row.topics.map((t) => t.topicId),
        labels: row.labels.map((l) => ({
          locale: l.locale,
          title: l.title,
          description: l.description,
        })),
        editions: row.editions.map((e) => ({
          id: e.id,
          label: e.label,
          languageCode: e.languageCode,
          publisher: e.publisher,
          publicationYear: e.publicationYear,
          isbn: e.isbn,
          isTranslation: e.translation !== null,
        })),
      };
    },
    async searchWorks({ after, limit }) {
      const rows = await db.work.findMany({
        where: { ...PUBLIC_WORK, ...(after === null ? {} : { id: { gt: after } }) },
        select: { id: true, version: true },
        orderBy: { id: 'asc' },
        take: Math.min(500, Math.max(1, Math.trunc(limit) || 1)),
      });
      return rows.map((r) => ({ id: r.id, stamp: String(r.version) }));
    },
    async publicWorkTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > 500) throw new Error('Library search batch exceeds its bound.');
      return db.work.findMany({
        where: { id: { in: [...ids] }, ...PUBLIC_WORK },
        select: { id: true, slug: true },
        orderBy: { id: 'asc' },
      });
    },
    // Phase 15 — the Work reference surface an Editorial Collection is
    // composed from. PUBLIC WORKS ONLY, so no caller learns a draft's title;
    // identity, current slug and titles, and nothing about Editions or files.
    async workReferences(ids) {
      if (ids.length === 0) return [];
      if (ids.length > REFERENCE_BATCH)
        throw new Error('Library reference batch exceeds its bound.');
      return db.work.findMany({
        where: { id: { in: [...new Set(ids)] }, ...PUBLIC_WORK },
        select: REFERENCE_SELECT,
        orderBy: { id: 'asc' },
      });
    },
    async quranPassageWorks(query) {
      const rows = await db.work.findMany({
        where: { ...PUBLIC_WORK, quranPassages: { some: passageWhere(query) } },
        select: {
          id: true,
          slug: true,
          primaryLocale: true,
          labels: {
            select: { locale: true, title: true },
            orderBy: { locale: 'asc' as const },
          },
          contributors: {
            select: { personId: true, role: true },
            orderBy: [{ position: 'asc' as const }, { personId: 'asc' as const }],
          },
          editions: {
            where: { state: 'published' },
            select: {
              id: true,
              publicationYear: true,
              coverAssetId: true,
              coverWidth: true,
              coverHeight: true,
            },
            orderBy: { id: 'asc' as const },
            take: 50,
          },
          quranPassages: {
            select: PASSAGE_SELECT,
            orderBy: { position: 'asc' as const },
          },
        },
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: PASSAGE_WORKS_CEILING,
      });
      const works: (QuranPassageWork & { readonly first: QuranPassage })[] = rows.flatMap(
        (row) => {
          const passages = row.quranPassages.map(passageOf);
          const [first] = canonicalPassageOrder(
            passages.filter((passage) => passageMatchesQuery(passage, query)),
          );
          if (first === undefined) return [];
          const coverEdition = row.editions.find((entry) => coverOf(entry) !== null);
          const cover = coverEdition === undefined ? null : coverOf(coverEdition);
          const years = row.editions.flatMap((entry) =>
            entry.publicationYear === null ? [] : [entry.publicationYear],
          );
          return [
            {
              id: row.id,
              slug: row.slug,
              primaryLocale: row.primaryLocale as WorkRecord['primaryLocale'],
              labels: row.labels.map((label) => ({
                locale: label.locale as WorkRecord['primaryLocale'],
                title: label.title,
              })),
              cover:
                cover === null || coverEdition === undefined
                  ? null
                  : { ...cover, editionId: coverEdition.id },
              contributors: row.contributors,
              year: years.length === 0 ? null : Math.max(...years),
              passages,
              first,
            },
          ];
        },
      );
      return works
        .sort(
          (a, b) =>
            a.first.surah - b.first.surah ||
            a.first.ayahFrom - b.first.ayahFrom ||
            a.first.ayahTo - b.first.ayahTo ||
            a.slug.localeCompare(b.slug),
        )
        .slice(0, query.limit)
        .map(({ first: _first, ...work }) => work);
    },
    async quranPassageCounts() {
      const rows = await db.$queryRaw<{ surah: number; owners: number }[]>`
        SELECT p.[surahNumber] AS [surah], COUNT(DISTINCT p.[workId]) AS [owners]
        FROM [dbo].[WorkQuranPassage] p
        INNER JOIN [dbo].[Work] w ON w.[id] = p.[workId]
        WHERE w.[state] = N'published'
          AND EXISTS (SELECT 1 FROM [dbo].[Edition] e
                      WHERE e.[workId] = w.[id] AND e.[state] = N'published')
        GROUP BY p.[surahNumber]
        ORDER BY p.[surahNumber];`;
      return rows.map((row) => ({
        surah: Number(row.surah),
        owners: Number(row.owners),
      }));
    },
    async workChoices(text, limit) {
      return db.work.findMany({
        where: {
          ...PUBLIC_WORK,
          ...(text === null
            ? {}
            : {
                OR: [
                  { slug: { contains: text } },
                  { labels: { some: { title: { contains: text } } } },
                ],
              }),
        },
        select: REFERENCE_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        take: Math.min(REFERENCE_CHOICES, Math.max(1, Math.trunc(limit) || 1)),
      });
    },
    async publicEditionTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > 500) throw new Error('Library search batch exceeds its bound.');
      const rows = await db.edition.findMany({
        where: { id: { in: [...ids] }, state: 'published', work: PUBLIC_WORK },
        select: { id: true, work: { select: { slug: true } } },
        orderBy: { id: 'asc' },
      });
      return rows.map((r) => ({ id: r.id, workSlug: r.work.slug }));
    },
    async assetRelation(editionId) {
      const row = await db.edition.findUnique({
        where: { id: editionId },
        select: {
          state: true,
          reading: true,
          download: true,
          readableAssetId: true,
          downloadAssetId: true,
          coverAssetId: true,
          work: { select: { state: true } },
        },
      });
      return row
        ? {
            workState: row.work.state,
            editionState: row.state,
            reading: row.reading,
            download: row.download,
            readableAssetId: row.readableAssetId,
            downloadAssetId: row.downloadAssetId,
            coverAssetId: row.coverAssetId,
          }
        : null;
    },
    async issueCoverRelation(issueId) {
      const row = await db.magazineIssue.findUnique({
        where: { id: issueId },
        select: {
          state: true,
          coverAssetId: true,
          magazine: { select: { state: true } },
        },
      });
      return row
        ? {
            issueState: row.state,
            magazineState: row.magazine.state,
            coverAssetId: row.coverAssetId,
          }
        : null;
    },
  };
}
