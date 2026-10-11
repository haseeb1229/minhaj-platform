import 'server-only';

import { Prisma } from '@prisma/client';

import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_JUZ_PAGE,
  QURAN_LIMITS,
  QURAN_PAGE,
  QURAN_SEARCH_RECORDS_MAX,
  type AyahSearchRecord,
  type PublicAyah,
  type PublicContributor,
  type PublicJuz,
  type PublicLayerWork,
  type PublicRecitation,
  type PublicSurah,
  type PublicTajweedRule,
  type QuranContributorRole,
  type QuranPublicReaderPort,
  type QuranRef,
  type QuranRevelation,
  type QuranSajdah,
  type QuranSourceAuthority,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import { toEntry } from './layers.ts';
import {
  activeMode,
  ayahRange,
  bounded,
  boundedOffset,
  BY_SLUG,
  bySlug,
  CANONICAL_ORDER,
  citationsAfter,
  citationsBetween,
  isPublicWork,
  namesOf,
  publicWork,
  stampOf,
  stateOf,
  TARGET_BATCH,
  WORK_LIST,
  type StampLayer,
} from './shared.ts';

/**
 * The Quran adapter's PUBLIC half (DOMAIN_MODEL.md §8; DELIVERY_PLAN.md
 * Phase 18). It takes no actor and answers only what is public NOW.
 *
 * NOTHING WHILE THE CORPUS IS INACTIVE. Every read asks for the activation
 * first; without one it returns empty or null, so no page, sitemap or search
 * projection can show canonical text the operator has not activated.
 *
 * ONE PUBLIC PREDICATE FOR EVERY LAYERED WORK, IN THE QUERY (`publicWork`):
 * published, a registered source, and — beside an APPROVED corpus — an approved
 * source. A fixture-sourced work is never shown with approved text, and the
 * sitemap lists ayat only for an approved corpus.
 *
 * NO N+1. A Surah page, a Juz page or a range of one work's texts is ONE
 * bounded query; a batch of search stamps is four, whatever its size.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const PUBLIC_AYAH = {
  surahNumber: true,
  ayahNumber: true,
  juzNumber: true,
  sajdah: true,
  text: true,
} satisfies Prisma.AyahSelect;

const PUBLIC_SURAH = {
  number: true,
  ayahCount: true,
  revelation: true,
  nameArabic: true,
  names: { select: { locale: true, name: true }, orderBy: { locale: 'asc' } },
} satisfies Prisma.SurahSelect;

const CONTRIBUTORS = {
  select: { personId: true, role: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }, { role: 'asc' }],
} satisfies Prisma.QuranTranslation$contributorsArgs;

const PUBLIC_WORK = {
  id: true,
  slug: true,
  name: true,
  description: true,
  attribution: true,
  languageCode: true,
  publishedAt: true,
} as const;

const PUBLIC_RECITATION = {
  id: true,
  slug: true,
  name: true,
  personId: true,
  style: true,
  attribution: true,
  publishedAt: true,
} satisfies Prisma.QuranRecitationSelect;

const PUBLIC_TAJWEED = {
  slug: true,
  position: true,
  attribution: true,
  texts: {
    select: { languageCode: true, title: true, body: true },
    orderBy: { languageCode: 'asc' },
  },
} satisfies Prisma.QuranTajweedRuleSelect;

/** A canonical citation as one sortable number: an Ayah number never reaches it. */
const CITATION_KEY = 1000;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface PublicWorkRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly publishedAt: Date | null;
}

function toAyah(row: {
  readonly surahNumber: number;
  readonly ayahNumber: number;
  readonly juzNumber: number;
  readonly sajdah: string | null;
  readonly text: string;
}): PublicAyah {
  return {
    surah: row.surahNumber,
    ayah: row.ayahNumber,
    juz: row.juzNumber,
    sajdah: row.sajdah as QuranSajdah | null,
    text: row.text,
  };
}

function toSurah(row: {
  readonly number: number;
  readonly ayahCount: number;
  readonly revelation: string | null;
  readonly nameArabic: string | null;
  readonly names: readonly { readonly locale: string; readonly name: string }[];
}): PublicSurah {
  return {
    number: row.number,
    ayahCount: row.ayahCount,
    revelation: row.revelation as QuranRevelation | null,
    nameArabic: row.nameArabic,
    names: namesOf(row.names),
  };
}

function contributorsOf(
  rows: readonly { readonly personId: string; readonly role: string }[],
): PublicContributor[] {
  return rows.map((row) => ({
    personId: row.personId,
    role: row.role as QuranContributorRole,
  }));
}

/**
 * A published work always carries `publishedAt` — the state CHECK of every
 * layered table requires it — so a missing one is a broken invariant, refused
 * rather than papered over with an invented date.
 */
function publishedOn(row: { readonly publishedAt: Date | null }): Date {
  if (row.publishedAt === null)
    throw new Error('A published Quran work carries no publication date.');
  return row.publishedAt;
}

function toWork(
  row: PublicWorkRow,
  contributors: readonly { readonly personId: string; readonly role: string }[],
): PublicLayerWork {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    attribution: row.attribution,
    languageCode: row.languageCode,
    contributors: contributorsOf(contributors),
    publishedAt: publishedOn(row),
  };
}

function toRecitation(row: {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly personId: string;
  readonly style: string | null;
  readonly attribution: string | null;
  readonly publishedAt: Date | null;
}): PublicRecitation {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    reciterId: row.personId,
    style: row.style,
    attribution: row.attribution,
    publishedAt: publishedOn(row),
  };
}

function toTajweed(row: {
  readonly slug: string;
  readonly position: number;
  readonly attribution: string | null;
  readonly texts: readonly { languageCode: string; title: string; body: string }[];
}): PublicTajweedRule {
  return {
    slug: row.slug,
    position: row.position,
    attribution: row.attribution,
    texts: row.texts.map((text) => ({ ...text })),
  };
}

function refOf(key: number): QuranRef {
  return { surah: Math.floor(key / CITATION_KEY), ayah: key % CITATION_KEY };
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createQuranPublicReader(): QuranPublicReaderPort {
  const db = getDatabaseClient();

  /** Each Juz's derived range: ONE grouped read over the canonical ayat. */
  async function juzRanges(only: number | null): Promise<PublicJuz[]> {
    const filter = only === null ? Prisma.empty : Prisma.sql`WHERE [juzNumber] = ${only}`;
    const rows = await db.$queryRaw<
      { number: number; ayahCount: number; first: number; last: number }[]
    >`SELECT [juzNumber] AS [number], COUNT(*) AS [ayahCount],
             MIN([surahNumber] * ${CITATION_KEY} + [ayahNumber]) AS [first],
             MAX([surahNumber] * ${CITATION_KEY} + [ayahNumber]) AS [last]
      FROM [dbo].[Ayah] ${filter}
      GROUP BY [juzNumber]
      ORDER BY [juzNumber]`;
    return rows.map((row) => ({
      number: Number(row.number),
      start: refOf(Number(row.first)),
      end: refOf(Number(row.last)),
      ayahCount: Number(row.ayahCount),
    }));
  }

  /**
   * The public layers that carry text for a contiguous run of ayat, and the
   * topics on them — three bounded reads for the whole run, never one per Ayah.
   * The run is at most `TARGET_BATCH` ayat; each Ayah carries at most one text
   * per work and at most `topicsPerAyah` topics.
   */
  async function projectionInputs(mode: QuranSourceAuthority, run: object) {
    const work = { select: { id: true, slug: true, version: true } } as const;
    const [translations, transliterations, topics] = await Promise.all([
      db.quranTranslationText.findMany({
        where: { ...run, translation: publicWork(mode) },
        select: { surahNumber: true, ayahNumber: true, translation: work },
      }),
      db.quranTransliterationText.findMany({
        where: { ...run, transliteration: publicWork(mode) },
        select: { surahNumber: true, ayahNumber: true, transliteration: work },
      }),
      db.quranTopic.findMany({
        where: run,
        select: { surahNumber: true, ayahNumber: true, topicId: true },
      }),
    ]);
    const layers = new Map<string, StampLayer[]>();
    const topicIds = new Map<string, string[]>();
    const add = <T>(map: Map<string, T[]>, key: string, value: T) => {
      const list = map.get(key);
      if (list === undefined) map.set(key, [value]);
      else list.push(value);
    };
    for (const row of translations)
      add(layers, `${row.surahNumber}:${row.ayahNumber}`, {
        kind: 'translation',
        ...row.translation,
      });
    for (const row of transliterations)
      add(layers, `${row.surahNumber}:${row.ayahNumber}`, {
        kind: 'transliteration',
        ...row.transliteration,
      });
    for (const row of topics)
      add(topicIds, `${row.surahNumber}:${row.ayahNumber}`, row.topicId);
    return { layers, topicIds };
  }

  /**
   * The current public projection of a set of citations — the ONE definition
   * `searchAyah` and `searchAyahRecords` share, so a single record and a
   * results page's batch cannot disagree. Three bounded reads for the whole
   * set (the Ayah with its topics, and each layer family's public texts),
   * never one per citation. Citations that are not Ayat are simply absent.
   */
  async function currentRecords(
    mode: QuranSourceAuthority,
    refs: readonly QuranRef[],
  ): Promise<AyahSearchRecord[]> {
    const at = {
      OR: refs.map((ref) => ({ surahNumber: ref.surah, ayahNumber: ref.ayah })),
    };
    const work = {
      select: { id: true, slug: true, name: true, languageCode: true, version: true },
    } as const;
    const [ayat, translations, transliterations] = await Promise.all([
      db.ayah.findMany({
        where: at,
        select: {
          surahNumber: true,
          ayahNumber: true,
          version: true,
          text: true,
          topics: { select: { topicId: true }, orderBy: { topicId: 'asc' } },
        },
        orderBy: [...CANONICAL_ORDER],
      }),
      db.quranTranslationText.findMany({
        where: { ...at, translation: publicWork(mode) },
        select: { surahNumber: true, ayahNumber: true, text: true, translation: work },
        take: WORK_LIST * refs.length,
      }),
      db.quranTransliterationText.findMany({
        where: { ...at, transliteration: publicWork(mode) },
        select: {
          surahNumber: true,
          ayahNumber: true,
          text: true,
          transliteration: work,
        },
        take: WORK_LIST * refs.length,
      }),
    ]);

    type Layer = AyahSearchRecord['layers'][number] & StampLayer;
    const layers = new Map<string, Layer[]>();
    const add = (key: string, layer: Layer) => {
      const list = layers.get(key);
      if (list === undefined) layers.set(key, [layer]);
      else list.push(layer);
    };
    for (const entry of translations)
      add(`${entry.surahNumber}:${entry.ayahNumber}`, {
        kind: 'translation',
        ...entry.translation,
        text: entry.text,
      });
    for (const entry of transliterations)
      add(`${entry.surahNumber}:${entry.ayahNumber}`, {
        kind: 'transliteration',
        ...entry.transliteration,
        text: entry.text,
      });

    return ayat.map((row) => {
      const own = [...(layers.get(`${row.surahNumber}:${row.ayahNumber}`) ?? [])].sort(
        bySlug,
      );
      const topicIds = row.topics.map((topic) => topic.topicId);
      return {
        surah: row.surahNumber,
        ayah: row.ayahNumber,
        text: row.text,
        stamp: stampOf(row.version, topicIds, own),
        topicIds,
        layers: own.map((layer) => ({
          kind: layer.kind,
          slug: layer.slug,
          name: layer.name,
          languageCode: layer.languageCode,
          text: layer.text,
        })),
      };
    });
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

    /* ---- Canonical structure and text ------------------------------------ */

    async surahs() {
      if ((await activeMode(db)) === null) return [];
      const rows = await db.surah.findMany({
        select: PUBLIC_SURAH,
        orderBy: { number: 'asc' },
      });
      return rows.map(toSurah);
    },

    async surah(number) {
      if ((await activeMode(db)) === null) return null;
      const row = await db.surah.findUnique({ where: { number }, select: PUBLIC_SURAH });
      return row === null ? null : toSurah(row);
    },

    async ayat(surah, from, to) {
      if ((await activeMode(db)) === null) return [];
      const rows = await db.ayah.findMany({
        where: { surahNumber: surah, ayahNumber: ayahRange(from, to) },
        select: PUBLIC_AYAH,
        orderBy: { ayahNumber: 'asc' },
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map(toAyah);
    },

    async ayah(ref) {
      if ((await activeMode(db)) === null) return null;
      const row = await db.ayah.findUnique({
        where: {
          surahNumber_ayahNumber: { surahNumber: ref.surah, ayahNumber: ref.ayah },
        },
        select: PUBLIC_AYAH,
      });
      return row === null ? null : toAyah(row);
    },

    async juzList() {
      if ((await activeMode(db)) === null) return [];
      return juzRanges(null);
    },

    async juz(number) {
      if ((await activeMode(db)) === null) return null;
      return (await juzRanges(Math.trunc(number)))[0] ?? null;
    },

    async juzAyat(number, offset) {
      const skip = boundedOffset(offset);
      if ((await activeMode(db)) === null) return { items: [], total: 0, offset: skip };
      const where = { juzNumber: number };
      const [total, rows] = await Promise.all([
        db.ayah.count({ where }),
        db.ayah.findMany({
          where,
          select: PUBLIC_AYAH,
          orderBy: [...CANONICAL_ORDER],
          skip,
          take: QURAN_JUZ_PAGE,
        }),
      ]);
      return { items: rows.map(toAyah), total, offset: skip };
    },

    /* ---- Layered works ----------------------------------------------------- */

    async translations() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTranslation.findMany({
        where: publicWork(mode),
        select: { ...PUBLIC_WORK, contributors: CONTRIBUTORS },
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.map((row) => toWork(row, row.contributors));
    },

    async translation(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.quranTranslation.findFirst({
        where: { slug, ...publicWork(mode) },
        select: { ...PUBLIC_WORK, contributors: CONTRIBUTORS },
      });
      return row === null ? null : toWork(row, row.contributors);
    },

    async transliterations() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTransliteration.findMany({
        where: publicWork(mode),
        select: { ...PUBLIC_WORK, scheme: true },
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.map((row) => ({ ...toWork(row, []), scheme: row.scheme }));
    },

    async transliteration(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.quranTransliteration.findFirst({
        where: { slug, ...publicWork(mode) },
        select: { ...PUBLIC_WORK, scheme: true },
      });
      return row === null ? null : { ...toWork(row, []), scheme: row.scheme };
    },

    async tafsirs() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTafsir.findMany({
        where: publicWork(mode),
        select: { ...PUBLIC_WORK, contributors: CONTRIBUTORS },
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.map((row) => toWork(row, row.contributors));
    },

    async tafsir(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.quranTafsir.findFirst({
        where: { slug, ...publicWork(mode) },
        select: { ...PUBLIC_WORK, contributors: CONTRIBUTORS },
      });
      return row === null ? null : toWork(row, row.contributors);
    },

    async translationTexts(workId, surah, from, to) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTranslationText.findMany({
        where: {
          translationId: workId,
          surahNumber: surah,
          ayahNumber: ayahRange(from, to),
          translation: publicWork(mode),
        },
        select: { ayahNumber: true, text: true },
        orderBy: { ayahNumber: 'asc' },
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map((row) => ({ ayah: row.ayahNumber, text: row.text }));
    },

    async transliterationTexts(workId, surah, from, to) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTransliterationText.findMany({
        where: {
          transliterationId: workId,
          surahNumber: surah,
          ayahNumber: ayahRange(from, to),
          transliteration: publicWork(mode),
        },
        select: { ayahNumber: true, text: true },
        orderBy: { ayahNumber: 'asc' },
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map((row) => ({ ayah: row.ayahNumber, text: row.text }));
    },

    async tafsirEntries(workId, surah, from, to) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const range = ayahRange(from, to);
      const rows = await db.quranTafsirText.findMany({
        where: {
          tafsirId: workId,
          surahNumber: surah,
          // Every entry that OVERLAPS the range, not only those inside it.
          startAyah: { lte: range.lte },
          endAyah: { gte: range.gte },
          tafsir: publicWork(mode),
        },
        select: {
          id: true,
          surahNumber: true,
          startAyah: true,
          endAyah: true,
          text: true,
        },
        orderBy: [{ startAyah: 'asc' }, { id: 'asc' }],
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map(toEntry);
    },

    async tafsirEntryPage(workId, offset) {
      const skip = boundedOffset(offset);
      const mode = await activeMode(db);
      if (mode === null) return { items: [], total: 0, offset: skip };
      const where = { tafsirId: workId, tafsir: publicWork(mode) };
      const [total, rows] = await Promise.all([
        db.quranTafsirText.count({ where }),
        db.quranTafsirText.findMany({
          where,
          select: {
            id: true,
            surahNumber: true,
            startAyah: true,
            endAyah: true,
            text: true,
          },
          orderBy: [{ surahNumber: 'asc' }, { startAyah: 'asc' }, { id: 'asc' }],
          skip,
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toEntry), total, offset: skip };
    },

    /* ---- Recitations ------------------------------------------------------- */

    async recitations() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranRecitation.findMany({
        where: publicWork(mode),
        select: PUBLIC_RECITATION,
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.map(toRecitation);
    },

    async recitation(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.quranRecitation.findFirst({
        where: { slug, ...publicWork(mode) },
        select: PUBLIC_RECITATION,
      });
      return row === null ? null : toRecitation(row);
    },

    async recitationsByReciter(personId) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranRecitation.findMany({
        where: { personId, ...publicWork(mode) },
        select: PUBLIC_RECITATION,
        orderBy: [...BY_SLUG],
        take: WORK_LIST,
      });
      return rows.map(toRecitation);
    },

    async recitationSegments(recitationId, surah) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranRecitationSegment.findMany({
        where: {
          recitationId,
          assetId: { not: null },
          ...(surah === null ? {} : { surahNumber: surah }),
          recitation: publicWork(mode),
        },
        select: {
          id: true,
          surahNumber: true,
          startAyah: true,
          endAyah: true,
          assetId: true,
        },
        orderBy: [{ surahNumber: 'asc' }, { startAyah: 'asc' }, { id: 'asc' }],
        take: QURAN_LIMITS.segmentsPerRecitation,
      });
      return rows.flatMap((row) =>
        row.assetId === null
          ? []
          : [
              {
                id: row.id,
                surah: row.surahNumber,
                startAyah: row.startAyah,
                endAyah: row.endAyah,
                assetId: row.assetId,
              },
            ],
      );
    },

    /* ---- Tajweed ----------------------------------------------------------- */

    async tajweedRules() {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const rows = await db.quranTajweedRule.findMany({
        where: publicWork(mode),
        select: PUBLIC_TAJWEED,
        orderBy: [{ position: 'asc' }, ...BY_SLUG],
        take: QURAN_LIMITS.tajweedRules,
      });
      return rows.map(toTajweed);
    },

    async tajweedRule(slug) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const row = await db.quranTajweedRule.findFirst({
        where: { slug, ...publicWork(mode) },
        select: PUBLIC_TAJWEED,
      });
      return row === null ? null : toTajweed(row);
    },

    /* ---- Topics ------------------------------------------------------------ */

    async topicAyat(topicId, offset) {
      const skip = boundedOffset(offset);
      if ((await activeMode(db)) === null) return { items: [], total: 0, offset: skip };
      const where = { topicId };
      const [total, rows] = await Promise.all([
        db.quranTopic.count({ where }),
        db.quranTopic.findMany({
          where,
          select: {
            surahNumber: true,
            ayahNumber: true,
            ayah: { select: { text: true } },
          },
          orderBy: [...CANONICAL_ORDER],
          skip,
          take: QURAN_PAGE,
        }),
      ]);
      return {
        items: rows.map((row) => ({
          surah: row.surahNumber,
          ayah: row.ayahNumber,
          text: row.ayah.text,
        })),
        total,
        offset: skip,
      };
    },

    /* ---- Sitemap: an APPROVED corpus only --------------------------------- */

    async ayahSitemap(offset, limit) {
      if ((await activeMode(db)) !== 'approved') return [];
      const rows = await db.ayah.findMany({
        select: { surahNumber: true, ayahNumber: true, updatedAt: true },
        orderBy: [...CANONICAL_ORDER],
        skip: boundedOffset(offset),
        take: bounded(limit, 5000),
      });
      return rows.map((row) => ({
        surah: row.surahNumber,
        ayah: row.ayahNumber,
        lastModified: row.updatedAt,
      }));
    },

    async ayahSitemapCount() {
      if ((await activeMode(db)) !== 'approved') return 0;
      return db.ayah.count();
    },

    /* ---- Search ------------------------------------------------------------ */

    async searchAyah(ref) {
      const mode = await activeMode(db);
      if (mode === null) return null;
      const [record] = await currentRecords(mode, [ref]);
      return record ?? null;
    },

    async searchAyahScopes(after, limit) {
      const mode = await activeMode(db);
      if (mode === null) return [];
      const ayat = await db.ayah.findMany({
        where: citationsAfter(after),
        select: { surahNumber: true, ayahNumber: true, version: true },
        orderBy: [...CANONICAL_ORDER],
        take: bounded(limit, TARGET_BATCH),
      });
      const first = ayat[0];
      const last = ayat.at(-1);
      if (first === undefined || last === undefined) return [];
      const { layers, topicIds } = await projectionInputs(
        mode,
        citationsBetween(
          { surah: first.surahNumber, ayah: first.ayahNumber },
          { surah: last.surahNumber, ayah: last.ayahNumber },
        ),
      );
      return ayat.map((row) => {
        const key = `${row.surahNumber}:${row.ayahNumber}`;
        return {
          ref: { surah: row.surahNumber, ayah: row.ayahNumber },
          stamp: stampOf(row.version, topicIds.get(key) ?? [], layers.get(key) ?? []),
        };
      });
    },

    async publicAyahTargets(refs) {
      if (refs.length === 0) return [];
      if (refs.length > TARGET_BATCH)
        throw new Error('Quran search batch exceeds its bound.');
      if ((await activeMode(db)) === null) return [];
      const rows = await db.ayah.findMany({
        where: {
          OR: refs.map((ref) => ({ surahNumber: ref.surah, ayahNumber: ref.ayah })),
        },
        select: { surahNumber: true, ayahNumber: true },
        orderBy: [...CANONICAL_ORDER],
      });
      return rows.map((row) => ({ surah: row.surahNumber, ayah: row.ayahNumber }));
    },

    async searchAyahRecords(refs) {
      if (refs.length === 0) return [];
      if (refs.length > QURAN_SEARCH_RECORDS_MAX)
        throw new Error('Quran search record batch exceeds its bound.');
      const mode = await activeMode(db);
      if (mode === null) return [];
      const distinct = new Map(refs.map((ref) => [`${ref.surah}:${ref.ayah}`, ref]));
      return currentRecords(mode, [...distinct.values()]);
    },

    /* ---- Serving ------------------------------------------------------------ */

    async segmentAsset(recitationId, segmentId) {
      const [mode, row] = await Promise.all([
        activeMode(db),
        db.quranRecitationSegment.findFirst({
          where: { id: segmentId, recitationId },
          select: {
            assetId: true,
            recitation: {
              select: { state: true, source: { select: { authority: true } } },
            },
          },
        }),
      ]);
      if (row === null) return null;
      return {
        recitationState: stateOf(row.recitation.state),
        publiclyVisible: row.assetId !== null && isPublicWork(mode, row.recitation),
        assetId: row.assetId,
      };
    },
  };
}
