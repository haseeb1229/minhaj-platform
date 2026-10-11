import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  citationOf,
  QURAN_LIMITS,
  QURAN_PAGE,
  type AyahRecord,
  type QuranPersistencePort,
  type QuranRevelation,
  type QuranSajdah,
  type QuranSourceAuthority,
  type QuranSourceRecord,
  type SurahRecord,
  type VerificationMismatchReason,
  type VerificationRunRecord,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import { requestSearchIndexing } from '../../search-intent.ts';
import { layerPersistence } from './layers.ts';
import { recitationPersistence } from './recitation.ts';
import {
  audit,
  boundedOffset,
  firstDifference,
  HISTORY,
  refuse,
  namesOf,
  QuranDataError,
  type Client,
} from './shared.ts';

/**
 * The Quran persistence adapter — administration (DOMAIN_MODEL.md §8;
 * DELIVERY_PLAN.md Phase 18).
 *
 * OWNED BY THE QURAN CONTEXT, hosted here (ARCHITECTURE.md §4.1). One factory
 * leaves this module, typed by Quran's own port, so no client, delegate or
 * transaction handle crosses the boundary. The layered works (`./layers.ts`)
 * and recitations (`./recitation.ts`) are spread into it, so Quran keeps one
 * persistence port.
 *
 * NO METHOD HERE WRITES CANONICAL TEXT OR STRUCTURE. It READS the corpus, its
 * history, its sources and its verification evidence; the only Surah fact it
 * writes is the display-names version, and the only Ayah-adjacent rows are
 * topic assignments. Canonical writes are `./canonical.ts`'s procedures alone —
 * and this principal holds no INSERT, UPDATE or DELETE that could bypass them.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const NAMES = {
  select: { locale: true, name: true },
  orderBy: { locale: 'asc' },
} satisfies Prisma.Surah$namesArgs;

const SURAH_SELECT = {
  number: true,
  ayahCount: true,
  revelation: true,
  nameArabic: true,
  sourceId: true,
  namesVersion: true,
  names: NAMES,
} satisfies Prisma.SurahSelect;

const AYAH_SELECT = {
  surahNumber: true,
  ayahNumber: true,
  juzNumber: true,
  hizb: true,
  page: true,
  sajdah: true,
  text: true,
  sourceId: true,
  version: true,
  updatedAt: true,
} satisfies Prisma.AyahSelect;

const SOURCE_SELECT = {
  id: true,
  code: true,
  authority: true,
  title: true,
  version: true,
  encoding: true,
  script: true,
  reference: true,
  createdAt: true,
} satisfies Prisma.QuranSourceSelect;

const RUN_SELECT = {
  id: true,
  kind: true,
  outcome: true,
  sourceId: true,
  checked: true,
  mismatches: true,
  firstSurah: true,
  firstAyah: true,
  firstOffset: true,
  firstReason: true,
  actorId: true,
  createdAt: true,
} satisfies Prisma.QuranVerificationRunSelect;

/** Registered sources an operator sees at once; the owner registers few. */
const SOURCE_LIST = 100;

/** The verification evidence the status shows, newest first. */
const RECENT_RUNS = 20;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface SurahRow {
  readonly number: number;
  readonly ayahCount: number;
  readonly revelation: string | null;
  readonly nameArabic: string | null;
  readonly sourceId: string;
  readonly namesVersion: number;
  readonly names: readonly { readonly locale: string; readonly name: string }[];
}

interface AyahRow {
  readonly surahNumber: number;
  readonly ayahNumber: number;
  readonly juzNumber: number;
  readonly hizb: number | null;
  readonly page: number | null;
  readonly sajdah: string | null;
  readonly text: string;
  readonly sourceId: string;
  readonly version: number;
  readonly updatedAt: Date;
}

interface SourceRow {
  readonly id: string;
  readonly code: string;
  readonly authority: string;
  readonly title: string;
  readonly version: string;
  readonly encoding: string;
  readonly script: string | null;
  readonly reference: string | null;
  readonly createdAt: Date;
}

interface RunRow {
  readonly id: string;
  readonly kind: string;
  readonly outcome: string;
  readonly sourceId: string;
  readonly checked: number;
  readonly mismatches: number;
  readonly firstSurah: number | null;
  readonly firstAyah: number | null;
  readonly firstOffset: number | null;
  readonly firstReason: string | null;
  readonly actorId: string | null;
  readonly createdAt: Date;
}

function toSurah(row: SurahRow): SurahRecord {
  return {
    number: row.number,
    ayahCount: row.ayahCount,
    revelation: row.revelation as QuranRevelation | null,
    nameArabic: row.nameArabic,
    names: namesOf(row.names),
    sourceId: row.sourceId,
    namesVersion: row.namesVersion,
  };
}

function toAyah(row: AyahRow): AyahRecord {
  return {
    surah: row.surahNumber,
    ayah: row.ayahNumber,
    juz: row.juzNumber,
    hizb: row.hizb,
    page: row.page,
    sajdah: row.sajdah as QuranSajdah | null,
    text: row.text,
    sourceId: row.sourceId,
    version: row.version,
    updatedAt: row.updatedAt,
  };
}

function toSource(row: SourceRow, ayahCount: number): QuranSourceRecord {
  return {
    id: row.id,
    code: row.code,
    authority: row.authority as QuranSourceAuthority,
    title: row.title,
    version: row.version,
    encoding: row.encoding,
    script: row.script,
    reference: row.reference,
    ayahCount,
    createdAt: row.createdAt,
  };
}

function toRun(row: RunRow): VerificationRunRecord {
  return {
    id: row.id,
    kind: row.kind as VerificationRunRecord['kind'],
    outcome: row.outcome as VerificationRunRecord['outcome'],
    sourceId: row.sourceId,
    checked: row.checked,
    mismatches: row.mismatches,
    first:
      row.firstReason === null
        ? null
        : {
            reason: row.firstReason as VerificationMismatchReason,
            ref:
              row.firstSurah === null || row.firstAyah === null
                ? null
                : { surah: row.firstSurah, ayah: row.firstAyah },
            offset: row.firstOffset,
          },
    actorId: row.actorId,
    createdAt: row.createdAt,
  };
}

/** How many ayat each source registered — one grouped read, never one per source. */
async function sourceAyahCounts(
  db: Client,
  ids: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (ids.length === 0) return new Map();
  const groups = await db.quranSourceAyah.groupBy({
    by: ['sourceId'],
    where: { sourceId: { in: [...ids] } },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.sourceId, group._count._all]));
}

async function surahOf(tx: Client, number: number): Promise<SurahRecord> {
  const row = await tx.surah.findUnique({ where: { number }, select: SURAH_SELECT });
  if (row === null) throw new QuranDataError('conflict');
  return toSurah(row);
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createQuranPersistence(): QuranPersistencePort {
  const db = getDatabaseClient();

  async function source(id: string): Promise<QuranSourceRecord | null> {
    const row = await db.quranSource.findUnique({ where: { id }, select: SOURCE_SELECT });
    if (row === null) return null;
    const ayahCount = await db.quranSourceAyah.count({ where: { sourceId: id } });
    return toSource(row, ayahCount);
  }

  return {
    ...layerPersistence(),
    ...recitationPersistence(),

    /* ---- Canonical position — read only ---------------------------------- */

    async corpusStatus() {
      const [surahs, ayat, juz, activation, sources, runs] = await Promise.all([
        db.surah.count(),
        db.ayah.count(),
        db.juz.count(),
        db.quranActivation.findUnique({
          where: { id: 1 },
          select: {
            sourceId: true,
            activatedAt: true,
            authorisedBy: true,
            source: { select: { authority: true } },
          },
        }),
        db.quranSource.findMany({
          select: SOURCE_SELECT,
          orderBy: [{ createdAt: 'desc' }, { code: 'asc' }],
          take: SOURCE_LIST,
        }),
        db.quranVerificationRun.findMany({
          select: RUN_SELECT,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          take: RECENT_RUNS,
        }),
      ]);
      const counts = await sourceAyahCounts(
        db,
        sources.map((row) => row.id),
      );
      return {
        surahs,
        ayat,
        juz,
        activation:
          activation === null
            ? null
            : {
                sourceId: activation.sourceId,
                authority: activation.source.authority as QuranSourceAuthority,
                activatedAt: activation.activatedAt,
                authorisedBy: activation.authorisedBy,
              },
        sources: sources.map((row) => toSource(row, counts.get(row.id) ?? 0)),
        recentRuns: runs.map(toRun),
      };
    },

    source,

    async sourceText(sourceId, ref) {
      const row = await db.quranSourceAyah.findUnique({
        where: {
          sourceId_surahNumber_ayahNumber: {
            sourceId,
            surahNumber: ref.surah,
            ayahNumber: ref.ayah,
          },
        },
        select: { text: true },
      });
      return row?.text ?? null;
    },

    async surahs() {
      const rows = await db.surah.findMany({
        select: SURAH_SELECT,
        orderBy: { number: 'asc' },
      });
      return rows.map(toSurah);
    },

    async surahAyat(surah, offset) {
      const where = { surahNumber: surah };
      const [total, rows] = await Promise.all([
        db.ayah.count({ where }),
        db.ayah.findMany({
          where,
          select: AYAH_SELECT,
          orderBy: { ayahNumber: 'asc' },
          skip: boundedOffset(offset),
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toAyah), total, offset: boundedOffset(offset) };
    },

    async ayah(ref) {
      const row = await db.ayah.findUnique({
        where: {
          surahNumber_ayahNumber: { surahNumber: ref.surah, ayahNumber: ref.ayah },
        },
        select: {
          ...AYAH_SELECT,
          revisions: {
            select: {
              version: true,
              text: true,
              sourceId: true,
              actorId: true,
              reason: true,
              createdAt: true,
            },
            orderBy: { version: 'desc' },
            take: HISTORY,
          },
          topics: {
            select: { topicId: true },
            orderBy: { topicId: 'asc' },
            take: QURAN_LIMITS.topicsPerAyah,
          },
        },
      });
      if (row === null) return null;
      return {
        ...toAyah(row),
        history: row.revisions.map((revision) => ({ ...revision })),
        topicIds: row.topics.map((topic) => topic.topicId),
      };
    },

    /**
     * Evidence for the operator, never applied by itself: the current text,
     * the source's text for the same Ayah, and where they first differ.
     */
    async correctionPreview(ref, sourceId) {
      const [ayah, registered, sourceRow] = await Promise.all([
        db.ayah.findUnique({
          where: {
            surahNumber_ayahNumber: { surahNumber: ref.surah, ayahNumber: ref.ayah },
          },
          select: AYAH_SELECT,
        }),
        source(sourceId),
        db.quranSourceAyah.findUnique({
          where: {
            sourceId_surahNumber_ayahNumber: {
              sourceId,
              surahNumber: ref.surah,
              ayahNumber: ref.ayah,
            },
          },
          select: { text: true },
        }),
      ]);
      if (ayah === null || registered === null) return null;
      const sourceText = sourceRow?.text ?? null;
      return {
        ayah: toAyah(ayah),
        source: registered,
        sourceText,
        firstDifference:
          sourceText === null ? null : firstDifference(ayah.text, sourceText),
      };
    },

    /**
     * Presentation only. The display-names version is the ONE Surah column
     * this principal may advance (column-level grant), by exactly one (the
     * Surah trigger), under the version the operator read.
     */
    async saveSurahNames({ actorId, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.surah.findUnique({
            where: { number: value.surah },
            select: { namesVersion: true },
          });
          if (previous === null) throw new QuranDataError('not-found');
          if (previous.namesVersion !== expectedVersion)
            throw new QuranDataError('conflict');
          const changed = await tx.surah.updateMany({
            where: { number: value.surah, namesVersion: expectedVersion },
            data: { namesVersion: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await tx.surahName.deleteMany({ where: { surahNumber: value.surah } });
          if (value.names.length > 0)
            await tx.surahName.createMany({
              data: value.names.map((entry) => ({
                surahNumber: value.surah,
                locale: entry.locale,
                name: entry.name,
              })),
            });
          // Which locales carry a name — never the names.
          await audit(tx, {
            actorId,
            action: 'quran.surah.names-saved',
            targetType: 'quran-surah',
            targetId: String(value.surah),
            before: { version: String(expectedVersion) },
            after: {
              version: String(expectedVersion + 1),
              locales: value.names.map((entry) => entry.locale).join(','),
            },
          });
          return surahOf(tx, value.surah);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Topics: a typed foreign key to the Ayah and to the Topic -------- */

    async addAyahTopic({ actorId, ref, topicId }) {
      try {
        return await db.$transaction(async (tx) => {
          const held = await tx.quranTopic.count({
            where: { surahNumber: ref.surah, ayahNumber: ref.ayah },
          });
          if (held >= QURAN_LIMITS.topicsPerAyah) throw new QuranDataError('invalid');
          await tx.quranTopic.create({
            data: { surahNumber: ref.surah, ayahNumber: ref.ayah, topicId },
          });
          await requestSearchIndexing(tx, 'quran-ayah', citationOf(ref));
          await audit(tx, {
            actorId,
            action: 'quran.ayah.topic-added',
            targetType: 'quran-ayah',
            targetId: citationOf(ref),
            after: { topicId },
          });
        });
      } catch (error) {
        refuse(error);
      }
    },

    async removeAyahTopic({ actorId, ref, topicId }) {
      try {
        return await db.$transaction(async (tx) => {
          const removed = await tx.quranTopic.deleteMany({
            where: { surahNumber: ref.surah, ayahNumber: ref.ayah, topicId },
          });
          if (removed.count !== 1) throw new QuranDataError('not-found');
          await requestSearchIndexing(tx, 'quran-ayah', citationOf(ref));
          await audit(tx, {
            actorId,
            action: 'quran.ayah.topic-removed',
            targetType: 'quran-ayah',
            targetId: citationOf(ref),
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
