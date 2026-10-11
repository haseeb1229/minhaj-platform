import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_LIMITS,
  QURAN_PAGE,
  type LayerTextChange,
  type QuranContributorRef,
  type QuranContributorRole,
  type QuranPersistencePort,
  type TafsirEntryRecord,
  type TafsirRecord,
  type TajweedRuleRecord,
  type TranslationRecord,
  type TransliterationRecord,
} from '@minhaj/contracts/quran';

import { getDatabaseClient } from '../../client.ts';
import {
  audit,
  authorityOf,
  BY_SLUG,
  boundedOffset,
  changedFields,
  claim,
  guardEdit,
  refuse,
  publication,
  QuranDataError,
  requestAyahScopes,
  stateOf,
  workReach,
  type Client,
} from './shared.ts';

/**
 * The Quran adapter's LAYERED WORKS — Translation, Transliteration, Tafsir and
 * Tajweed guidance (DOMAIN_MODEL.md §8.2; DELIVERY_PLAN.md Phase 18).
 *
 * OWNED BY THE QURAN CONTEXT, hosted here, and spread into
 * `createQuranPersistence` so Quran keeps one persistence port. Each work is
 * its own aggregate with its own source, lifecycle and version, layered over
 * the Ayah by a typed foreign key and never a field on it.
 *
 * TEXT IS STORED EXACTLY AS GIVEN. Nothing here trims, folds or re-composes a
 * character: the contract refuses what would need repairing, and the adapter
 * writes what it was handed.
 *
 * EVERY WRITE IS ONE TRANSACTION under the work's expected version (`claim`),
 * with its audit entry and — wherever an Ayah's public projection can move —
 * its durable search intent for exactly the ayat it reaches.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const WORK = {
  id: true,
  slug: true,
  name: true,
  description: true,
  attribution: true,
  languageCode: true,
  sourceId: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  source: { select: { authority: true } },
} as const;

const CONTRIBUTORS = {
  select: { personId: true, role: true, position: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }, { role: 'asc' }],
} satisfies Prisma.QuranTranslation$contributorsArgs;

const TRANSLATION_SELECT = {
  ...WORK,
  contributors: CONTRIBUTORS,
  _count: { select: { texts: true } },
} satisfies Prisma.QuranTranslationSelect;

const TRANSLITERATION_SELECT = {
  ...WORK,
  scheme: true,
  _count: { select: { texts: true } },
} satisfies Prisma.QuranTransliterationSelect;

const TAFSIR_SELECT = {
  ...WORK,
  contributors: CONTRIBUTORS,
  _count: { select: { entries: true } },
} satisfies Prisma.QuranTafsirSelect;

const TAJWEED_SELECT = {
  id: true,
  slug: true,
  position: true,
  attribution: true,
  sourceId: true,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  source: { select: { authority: true } },
  texts: {
    select: { languageCode: true, title: true, body: true },
    orderBy: { languageCode: 'asc' },
  },
} satisfies Prisma.QuranTajweedRuleSelect;

const ENTRY_SELECT = {
  id: true,
  surahNumber: true,
  startAyah: true,
  endAyah: true,
  text: true,
} satisfies Prisma.QuranTafsirTextSelect;

/** The raw tables a layer's per-Ayah texts live in — fixed fragments, never input. */
const TEXT_TABLES = {
  translation: {
    table: Prisma.sql`[dbo].[QuranTranslationText]`,
    owner: Prisma.sql`[translationId]`,
  },
  transliteration: {
    table: Prisma.sql`[dbo].[QuranTransliterationText]`,
    owner: Prisma.sql`[transliterationId]`,
  },
} as const;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface WorkRow {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly sourceId: string | null;
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly source: { readonly authority: string } | null;
}

interface ContributorRow {
  readonly personId: string;
  readonly role: string;
  readonly position: number;
}

function workRecord(
  row: WorkRow,
  textCount: number,
): Omit<TranslationRecord, 'contributors'> {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    attribution: row.attribution,
    languageCode: row.languageCode,
    sourceId: row.sourceId,
    sourceAuthority: authorityOf(row.source),
    state: stateOf(row.state),
    version: row.version,
    textCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

function contributorsOf(rows: readonly ContributorRow[]): QuranContributorRef[] {
  return rows.map((row) => ({
    personId: row.personId,
    role: row.role as QuranContributorRole,
    position: row.position,
  }));
}

function toTranslation(
  row: WorkRow & {
    readonly contributors: readonly ContributorRow[];
    readonly _count: { readonly texts: number };
  },
): TranslationRecord {
  return {
    ...workRecord(row, row._count.texts),
    contributors: contributorsOf(row.contributors),
  };
}

function toTransliteration(
  row: WorkRow & {
    readonly scheme: string | null;
    readonly _count: { readonly texts: number };
  },
): TransliterationRecord {
  return { ...workRecord(row, row._count.texts), scheme: row.scheme };
}

function toTafsir(
  row: WorkRow & {
    readonly contributors: readonly ContributorRow[];
    readonly _count: { readonly entries: number };
  },
): TafsirRecord {
  return {
    ...workRecord(row, row._count.entries),
    contributors: contributorsOf(row.contributors),
  };
}

function toTajweed(row: {
  readonly id: string;
  readonly slug: string;
  readonly position: number;
  readonly attribution: string | null;
  readonly sourceId: string | null;
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly source: { readonly authority: string } | null;
  readonly texts: readonly { languageCode: string; title: string; body: string }[];
}): TajweedRuleRecord {
  return {
    id: row.id,
    slug: row.slug,
    position: row.position,
    attribution: row.attribution,
    sourceId: row.sourceId,
    sourceAuthority: authorityOf(row.source),
    state: stateOf(row.state),
    version: row.version,
    texts: row.texts.map((text) => ({ ...text })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
  };
}

export function toEntry(row: {
  readonly id: string;
  readonly surahNumber: number;
  readonly startAyah: number;
  readonly endAyah: number;
  readonly text: string;
}): TafsirEntryRecord {
  return {
    id: row.id,
    surah: row.surahNumber,
    startAyah: row.startAyah,
    endAyah: row.endAyah,
    text: row.text,
  };
}

/* ===========================================================================
 * Writing
 * ========================================================================= */

/** A work's own descriptive columns — never its slug, which is set once. */
function workColumns(value: {
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly sourceId: string | null;
}) {
  return {
    name: value.name,
    description: value.description,
    attribution: value.attribution,
    languageCode: value.languageCode,
    sourceId: value.sourceId,
  };
}

async function replaceContributors(
  tx: Client,
  kind: 'translation' | 'tafsir',
  id: string,
  contributors: readonly { readonly personId: string; readonly role: string }[],
): Promise<void> {
  const rows = contributors.map((entry, position) => ({
    personId: entry.personId,
    role: entry.role,
    position,
  }));
  if (kind === 'translation') {
    await tx.quranTranslationContributor.deleteMany({ where: { translationId: id } });
    if (rows.length > 0)
      await tx.quranTranslationContributor.createMany({
        data: rows.map((row) => ({ ...row, translationId: id })),
      });
  } else {
    await tx.quranTafsirContributor.deleteMany({ where: { tafsirId: id } });
    if (rows.length > 0)
      await tx.quranTafsirContributor.createMany({
        data: rows.map((row) => ({ ...row, tafsirId: id })),
      });
  }
}

/**
 * One Surah's worth of a layer's texts in three set-based statements: replace
 * the texts that exist, insert the ones that do not, then remove the ones set
 * to `null`. Removal comes LAST, so a published work is never seen without
 * text in between (its trigger refuses only the state the save ends in).
 *
 * The texts travel as one bound JSON document read with `OPENJSON`; every
 * character arrives exactly as supplied.
 */
async function writeLayerTexts(
  tx: Client,
  kind: 'translation' | 'transliteration',
  workId: string,
  surah: number,
  changes: readonly LayerTextChange[],
): Promise<{ readonly saved: number; readonly removed: number }> {
  const { table, owner } = TEXT_TABLES[kind];
  const saved = changes.filter((change) => change.text !== null);
  const removed = changes.filter((change) => change.text === null).map((c) => c.ayah);

  if (saved.length > 0) {
    const document = JSON.stringify(
      saved.map((change) => ({ ayah: change.ayah, text: change.text })),
    );
    await tx.$executeRaw`UPDATE t SET t.[text] = j.[text]
      FROM ${table} t
      JOIN OPENJSON(${document}) WITH ([ayah] INT '$.ayah', [text] NVARCHAR(MAX) '$.text') j
        ON j.[ayah] = t.[ayahNumber]
      WHERE t.${owner} = ${workId} AND t.[surahNumber] = ${surah}`;
    await tx.$executeRaw`INSERT INTO ${table} (${owner}, [surahNumber], [ayahNumber], [text])
      SELECT ${workId}, ${surah}, j.[ayah], j.[text]
      FROM OPENJSON(${document}) WITH ([ayah] INT '$.ayah', [text] NVARCHAR(MAX) '$.text') j
      WHERE NOT EXISTS (
        SELECT 1 FROM ${table} t
        WHERE t.${owner} = ${workId} AND t.[surahNumber] = ${surah} AND t.[ayahNumber] = j.[ayah]
      )`;
  }
  if (removed.length > 0)
    await tx.$executeRaw`DELETE FROM ${table}
      WHERE ${owner} = ${workId} AND [surahNumber] = ${surah}
        AND [ayahNumber] IN (SELECT CAST([value] AS INT) FROM OPENJSON(${JSON.stringify(removed)}))`;

  return { saved: saved.length, removed: removed.length };
}

/* ===========================================================================
 * Reading a just-written record back
 * ========================================================================= */

async function translationOf(tx: Client, id: string): Promise<TranslationRecord> {
  const row = await tx.quranTranslation.findUnique({
    where: { id },
    select: TRANSLATION_SELECT,
  });
  if (row === null) throw new QuranDataError('conflict');
  return toTranslation(row);
}

async function transliterationOf(tx: Client, id: string): Promise<TransliterationRecord> {
  const row = await tx.quranTransliteration.findUnique({
    where: { id },
    select: TRANSLITERATION_SELECT,
  });
  if (row === null) throw new QuranDataError('conflict');
  return toTransliteration(row);
}

async function tafsirOf(tx: Client, id: string): Promise<TafsirRecord> {
  const row = await tx.quranTafsir.findUnique({ where: { id }, select: TAFSIR_SELECT });
  if (row === null) throw new QuranDataError('conflict');
  return toTafsir(row);
}

async function tajweedOf(tx: Client, id: string): Promise<TajweedRuleRecord> {
  const row = await tx.quranTajweedRule.findUnique({
    where: { id },
    select: TAJWEED_SELECT,
  });
  if (row === null) throw new QuranDataError('conflict');
  return toTajweed(row);
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

type LayerPersistence = Pick<
  QuranPersistencePort,
  | 'translations'
  | 'translation'
  | 'createTranslation'
  | 'updateTranslation'
  | 'setTranslationState'
  | 'translationTexts'
  | 'saveTranslationTexts'
  | 'transliterations'
  | 'transliteration'
  | 'createTransliteration'
  | 'updateTransliteration'
  | 'setTransliterationState'
  | 'transliterationTexts'
  | 'saveTransliterationTexts'
  | 'tafsirs'
  | 'tafsir'
  | 'createTafsir'
  | 'updateTafsir'
  | 'setTafsirState'
  | 'tafsirEntries'
  | 'saveTafsirEntry'
  | 'removeTafsirEntry'
  | 'tajweedRules'
  | 'tajweedRule'
  | 'createTajweedRule'
  | 'updateTajweedRule'
  | 'setTajweedRuleState'
>;

export function layerPersistence(): LayerPersistence {
  const db = getDatabaseClient();

  /** A text save under the work's version; a PUBLISHED work's changed ayat are re-projected. */
  async function saveTexts(
    tx: Client,
    kind: 'translation' | 'transliteration',
    input: {
      readonly actorId: string;
      readonly id: string;
      readonly expectedVersion: number;
      readonly surah: number;
      readonly changes: readonly LayerTextChange[];
    },
  ): Promise<void> {
    const previous = await claim(tx, kind, input.id, input.expectedVersion);
    const written = await writeLayerTexts(tx, kind, input.id, input.surah, input.changes);
    if (previous.state === 'published')
      await requestAyahScopes(
        tx,
        input.changes.map((change) => ({ surah: input.surah, ayah: change.ayah })),
      );
    // Which Surah and how many — never a word of the texts.
    await audit(tx, {
      actorId: input.actorId,
      action: `quran.${kind}.texts-saved`,
      targetType: `quran-${kind}`,
      targetId: input.id,
      before: { version: String(previous.version) },
      after: {
        version: String(previous.version + 1),
        surah: String(input.surah),
        saved: String(written.saved),
        removed: String(written.removed),
      },
    });
  }

  /**
   * A state change. Whenever a Translation or Transliteration enters or leaves
   * publication, every Ayah it carries text for is re-projected, in the same
   * transaction.
   */
  async function changeState(
    tx: Client,
    kind: 'translation' | 'transliteration' | 'tafsir' | 'tajweed',
    input: {
      readonly actorId: string;
      readonly id: string;
      readonly expectedVersion: number;
      readonly state: 'draft' | 'published' | 'archived';
    },
    carried: () => Promise<number>,
  ): Promise<void> {
    const previous = await claim(tx, kind, input.id, input.expectedVersion, (head) =>
      publication(head, input.state, carried, 'text-required'),
    );
    if (
      (kind === 'translation' || kind === 'transliteration') &&
      (previous.state === 'published' || input.state === 'published')
    )
      await requestAyahScopes(tx, await workReach(tx, kind, input.id));
    await audit(tx, {
      actorId: input.actorId,
      action: `quran.${kind === 'tajweed' ? 'tajweed-rule' : kind}.state-changed`,
      targetType: kind === 'tajweed' ? 'quran-tajweed-rule' : `quran-${kind}`,
      targetId: input.id,
      before: { version: String(previous.version), state: previous.state },
      after: { version: String(previous.version + 1), state: input.state },
    });
  }

  /** A metadata edit's audit: which fields changed, by name. */
  async function edited(
    tx: Client,
    kind: 'translation' | 'transliteration' | 'tafsir',
    input: { readonly actorId: string; readonly id: string },
    previous: { readonly version: number; readonly state: string },
    changed: string,
  ): Promise<void> {
    // A published work's name, language or source reaches every Ayah it is
    // projected beside — or decides whether it is projected at all.
    if (kind !== 'tafsir' && previous.state === 'published')
      await requestAyahScopes(tx, await workReach(tx, kind, input.id));
    await audit(tx, {
      actorId: input.actorId,
      action: `quran.${kind}.updated`,
      targetType: `quran-${kind}`,
      targetId: input.id,
      before: { version: String(previous.version), state: previous.state },
      after: { version: String(previous.version + 1), changed },
    });
  }

  return {
    /* ---- Translation ---------------------------------------------------- */

    async translations(offset) {
      const [total, rows] = await Promise.all([
        db.quranTranslation.count(),
        db.quranTranslation.findMany({
          select: TRANSLATION_SELECT,
          orderBy: [...BY_SLUG],
          skip: boundedOffset(offset),
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toTranslation), total, offset: boundedOffset(offset) };
    },

    async translation(id) {
      const row = await db.quranTranslation.findUnique({
        where: { id },
        select: TRANSLATION_SELECT,
      });
      return row === null ? null : toTranslation(row);
    },

    async createTranslation({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranTranslation.create({
            data: {
              id,
              slug: value.slug,
              ...workColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await replaceContributors(tx, 'translation', id, value.contributors);
          await audit(tx, {
            actorId,
            action: 'quran.translation.created',
            targetType: 'quran-translation',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              source: value.sourceId ?? 'none',
              contributors: String(value.contributors.length),
            },
          });
          return translationOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateTranslation({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.quranTranslation.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceId: true,
              publishedAt: true,
              name: true,
              description: true,
              attribution: true,
              languageCode: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const changed = await tx.quranTranslation.updateMany({
            where: { id, version: expectedVersion },
            data: {
              ...workColumns(value),
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await replaceContributors(tx, 'translation', id, value.contributors);
          await edited(
            tx,
            'translation',
            { actorId, id },
            previous,
            changedFields(previous, workColumns(value)),
          );
          return translationOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTranslationState(input) {
      try {
        return await db.$transaction(async (tx) => {
          await changeState(tx, 'translation', input, () =>
            tx.quranTranslationText.count({ where: { translationId: input.id } }),
          );
          return translationOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async translationTexts(id, surah) {
      const rows = await db.quranTranslationText.findMany({
        where: { translationId: id, surahNumber: surah },
        select: { ayahNumber: true, text: true },
        orderBy: { ayahNumber: 'asc' },
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map((row) => ({ ayah: row.ayahNumber, text: row.text }));
    },

    async saveTranslationTexts(input) {
      try {
        return await db.$transaction(async (tx) => {
          await saveTexts(tx, 'translation', input);
          return translationOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Transliteration ------------------------------------------------ */

    async transliterations(offset) {
      const [total, rows] = await Promise.all([
        db.quranTransliteration.count(),
        db.quranTransliteration.findMany({
          select: TRANSLITERATION_SELECT,
          orderBy: [...BY_SLUG],
          skip: boundedOffset(offset),
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toTransliteration), total, offset: boundedOffset(offset) };
    },

    async transliteration(id) {
      const row = await db.quranTransliteration.findUnique({
        where: { id },
        select: TRANSLITERATION_SELECT,
      });
      return row === null ? null : toTransliteration(row);
    },

    async createTransliteration({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranTransliteration.create({
            data: {
              id,
              slug: value.slug,
              ...workColumns(value),
              scheme: value.scheme,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await audit(tx, {
            actorId,
            action: 'quran.transliteration.created',
            targetType: 'quran-transliteration',
            targetId: id,
            after: { version: '1', state: 'draft', source: value.sourceId ?? 'none' },
          });
          return transliterationOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateTransliteration({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.quranTransliteration.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceId: true,
              publishedAt: true,
              name: true,
              description: true,
              attribution: true,
              languageCode: true,
              scheme: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const columns = { ...workColumns(value), scheme: value.scheme };
          const changed = await tx.quranTransliteration.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await edited(
            tx,
            'transliteration',
            { actorId, id },
            previous,
            changedFields(previous, columns),
          );
          return transliterationOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTransliterationState(input) {
      try {
        return await db.$transaction(async (tx) => {
          await changeState(tx, 'transliteration', input, () =>
            tx.quranTransliterationText.count({ where: { transliterationId: input.id } }),
          );
          return transliterationOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async transliterationTexts(id, surah) {
      const rows = await db.quranTransliterationText.findMany({
        where: { transliterationId: id, surahNumber: surah },
        select: { ayahNumber: true, text: true },
        orderBy: { ayahNumber: 'asc' },
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map((row) => ({ ayah: row.ayahNumber, text: row.text }));
    },

    async saveTransliterationTexts(input) {
      try {
        return await db.$transaction(async (tx) => {
          await saveTexts(tx, 'transliteration', input);
          return transliterationOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Tafsir ---------------------------------------------------------- */

    async tafsirs(offset) {
      const [total, rows] = await Promise.all([
        db.quranTafsir.count(),
        db.quranTafsir.findMany({
          select: TAFSIR_SELECT,
          orderBy: [...BY_SLUG],
          skip: boundedOffset(offset),
          take: QURAN_PAGE,
        }),
      ]);
      return { items: rows.map(toTafsir), total, offset: boundedOffset(offset) };
    },

    async tafsir(id) {
      const row = await db.quranTafsir.findUnique({
        where: { id },
        select: TAFSIR_SELECT,
      });
      return row === null ? null : toTafsir(row);
    },

    async createTafsir({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranTafsir.create({
            data: {
              id,
              slug: value.slug,
              ...workColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await replaceContributors(tx, 'tafsir', id, value.contributors);
          await audit(tx, {
            actorId,
            action: 'quran.tafsir.created',
            targetType: 'quran-tafsir',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              source: value.sourceId ?? 'none',
              contributors: String(value.contributors.length),
            },
          });
          return tafsirOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateTafsir({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.quranTafsir.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceId: true,
              publishedAt: true,
              name: true,
              description: true,
              attribution: true,
              languageCode: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const changed = await tx.quranTafsir.updateMany({
            where: { id, version: expectedVersion },
            data: {
              ...workColumns(value),
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          await replaceContributors(tx, 'tafsir', id, value.contributors);
          await edited(
            tx,
            'tafsir',
            { actorId, id },
            previous,
            changedFields(previous, workColumns(value)),
          );
          return tafsirOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTafsirState(input) {
      try {
        return await db.$transaction(async (tx) => {
          await changeState(tx, 'tafsir', input, () =>
            tx.quranTafsirText.count({ where: { tafsirId: input.id } }),
          );
          return tafsirOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async tafsirEntries(id, surah) {
      const rows = await db.quranTafsirText.findMany({
        where: { tafsirId: id, surahNumber: surah },
        select: ENTRY_SELECT,
        orderBy: [{ startAyah: 'asc' }, { id: 'asc' }],
        take: QURAN_AYAH_NUMBER_MAX,
      });
      return rows.map(toEntry);
    },

    /**
     * One entry over one Surah's range. Two entries of one Tafsir never cover
     * the same Ayah — the database refuses an overlap (51186) — and both ends
     * are typed foreign keys to real ayat.
     */
    async saveTafsirEntry({ actorId, id, expectedVersion, entryId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'tafsir', id, expectedVersion);
          const entry = entryId ?? randomUUID();
          const columns = {
            surahNumber: value.surah,
            startAyah: value.startAyah,
            endAyah: value.endAyah,
            text: value.text,
          };
          if (entryId === null) {
            await tx.quranTafsirText.create({
              data: { id: entry, tafsirId: id, ...columns },
            });
          } else {
            const changed = await tx.quranTafsirText.updateMany({
              where: { id: entryId, tafsirId: id },
              data: columns,
            });
            if (changed.count !== 1) throw new QuranDataError('not-found');
          }
          await audit(tx, {
            actorId,
            action: `quran.tafsir.entry-${entryId === null ? 'added' : 'replaced'}`,
            targetType: 'quran-tafsir',
            targetId: id,
            before: { version: String(previous.version) },
            after: {
              version: String(previous.version + 1),
              entry,
              surah: String(value.surah),
              startAyah: String(value.startAyah),
              endAyah: String(value.endAyah),
            },
          });
          return tafsirOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async removeTafsirEntry({ actorId, id, expectedVersion, entryId }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'tafsir', id, expectedVersion);
          const removed = await tx.quranTafsirText.deleteMany({
            where: { id: entryId, tafsirId: id },
          });
          if (removed.count !== 1) throw new QuranDataError('not-found');
          await audit(tx, {
            actorId,
            action: 'quran.tafsir.entry-removed',
            targetType: 'quran-tafsir',
            targetId: id,
            before: { version: String(previous.version) },
            after: { version: String(previous.version + 1), entry: entryId },
          });
          return tafsirOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Tajweed ---------------------------------------------------------- */

    async tajweedRules() {
      const rows = await db.quranTajweedRule.findMany({
        select: TAJWEED_SELECT,
        orderBy: [{ position: 'asc' }, ...BY_SLUG],
        take: QURAN_LIMITS.tajweedRules,
      });
      return rows.map(toTajweed);
    },

    async tajweedRule(id) {
      const row = await db.quranTajweedRule.findUnique({
        where: { id },
        select: TAJWEED_SELECT,
      });
      return row === null ? null : toTajweed(row);
    },

    async createTajweedRule({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.quranTajweedRule.create({
            data: {
              id,
              slug: value.slug,
              position: value.position,
              attribution: value.attribution,
              sourceId: value.sourceId,
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await tx.quranTajweedRuleText.createMany({
            data: value.texts.map((text) => ({ ruleId: id, ...text })),
          });
          await audit(tx, {
            actorId,
            action: 'quran.tajweed-rule.created',
            targetType: 'quran-tajweed-rule',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              source: value.sourceId ?? 'none',
              languages: value.texts.map((text) => text.languageCode).join(','),
            },
          });
          return tajweedOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The texts are replaced language by language — each kept language
     * updated in place, each new one inserted, each dropped one removed LAST —
     * so a published rule never passes through a moment without text.
     */
    async updateTajweedRule({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.quranTajweedRule.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceId: true,
              publishedAt: true,
              position: true,
              attribution: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const columns = {
            position: value.position,
            attribution: value.attribution,
            sourceId: value.sourceId,
          };
          const changed = await tx.quranTajweedRule.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new QuranDataError('conflict');
          for (const text of value.texts)
            await tx.quranTajweedRuleText.upsert({
              where: {
                ruleId_languageCode: { ruleId: id, languageCode: text.languageCode },
              },
              create: { ruleId: id, ...text },
              update: { title: text.title, body: text.body },
            });
          await tx.quranTajweedRuleText.deleteMany({
            where: {
              ruleId: id,
              languageCode: { notIn: value.texts.map((text) => text.languageCode) },
            },
          });
          await audit(tx, {
            actorId,
            action: 'quran.tajweed-rule.updated',
            targetType: 'quran-tajweed-rule',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: {
              version: String(previous.version + 1),
              changed: changedFields(previous, columns),
              languages: value.texts.map((text) => text.languageCode).join(','),
            },
          });
          return tajweedOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTajweedRuleState(input) {
      try {
        return await db.$transaction(async (tx) => {
          await changeState(tx, 'tajweed', input, () =>
            tx.quranTajweedRuleText.count({ where: { ruleId: input.id } }),
          );
          return tajweedOf(tx, input.id);
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
