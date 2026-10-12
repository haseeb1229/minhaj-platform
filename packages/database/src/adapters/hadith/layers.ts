import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Prisma } from '@prisma/client';

import {
  HADITH_PAGE,
  type HadithCommentaryEntryRecord,
  type HadithCommentaryRecord,
  type HadithContributorRecord,
  type HadithPersistencePort,
  type HadithScienceRecord,
  type HadithTranslationRecord,
} from '@minhaj/contracts/hadith';

import { getDatabaseClient } from '../../client.ts';
import {
  audit,
  authorityOf,
  boundedOffset,
  changedFields,
  claim,
  guardEdit,
  HadithDataError,
  publication,
  refuse,
  requestCommentaryScopes,
  requestRecordScopes,
  roleOf,
  stateOf,
  WORK_LIST,
  type Client,
} from './shared.ts';

/**
 * The Hadith adapter's LAYERED WORKS — Translation, Commentary and Sciences
 * study material (DOMAIN_MODEL.md §9; DELIVERY_PLAN.md Phase 19).
 *
 * OWNED BY THE HADITH CONTEXT, hosted here, and spread into
 * `createHadithPersistence` so Hadith keeps one persistence port. Each work is
 * its own aggregate with its own source, lifecycle and version, layered over a
 * source-qualified record by a typed foreign key and never a field on it.
 *
 * TEXT IS STORED EXACTLY AS GIVEN. Nothing here trims, folds or re-composes a
 * character: the contract refuses what would need repairing, and the adapter
 * writes what it was handed.
 *
 * EVERY WRITE IS ONE TRANSACTION under the work's expected version (`claim`),
 * with its audit entry and — wherever a citation's public projection can move —
 * its durable search intent for exactly the citations it reaches.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

const LAYER = {
  id: true,
  state: true,
  version: true,
  attribution: true,
  sourceSystemId: true,
  publishedAt: true,
  updatedAt: true,
  sourceSystem: { select: { authority: true } },
} as const;

const CONTRIBUTORS = {
  select: { personId: true, role: true, position: true },
  orderBy: [{ position: 'asc' }, { personId: 'asc' }, { role: 'asc' }],
} satisfies Prisma.HadithTranslation$contributorsArgs;

const TRANSLATION_SELECT = {
  ...LAYER,
  hadithId: true,
  languageCode: true,
  text: true,
  contributors: CONTRIBUTORS,
} satisfies Prisma.HadithTranslationSelect;

const COMMENTARY_SELECT = {
  ...LAYER,
  slug: true,
  name: true,
  description: true,
  languageCode: true,
  contributors: CONTRIBUTORS,
  _count: { select: { entries: true } },
} satisfies Prisma.HadithCommentarySelect;

const SCIENCE_SELECT = {
  ...LAYER,
  slug: true,
  position: true,
  texts: {
    select: { languageCode: true, title: true, body: true },
    orderBy: { languageCode: 'asc' },
  },
} satisfies Prisma.HadithScienceSelect;

const ENTRY_SELECT = {
  commentaryId: true,
  hadithId: true,
  text: true,
  hadith: {
    select: {
      sourceReference: true,
      collection: { select: { slug: true } },
      edition: { select: { code: true } },
    },
  },
} satisfies Prisma.HadithCommentaryEntrySelect;

/* ===========================================================================
 * Mapping
 * ========================================================================= */

interface LayerRow {
  readonly id: string;
  readonly state: string;
  readonly version: number;
  readonly attribution: string | null;
  readonly sourceSystemId: string | null;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
  readonly sourceSystem: { readonly authority: string } | null;
}

interface ContributorRow {
  readonly personId: string;
  readonly role: string;
  readonly position: number;
}

interface TranslationRow extends LayerRow {
  readonly hadithId: string;
  readonly languageCode: string;
  readonly text: string;
  readonly contributors: readonly ContributorRow[];
}

interface CommentaryRow extends LayerRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly languageCode: string;
  readonly contributors: readonly ContributorRow[];
  readonly _count: { readonly entries: number };
}

interface ScienceRow extends LayerRow {
  readonly slug: string;
  readonly position: number;
  readonly texts: readonly {
    readonly languageCode: string;
    readonly title: string;
    readonly body: string;
  }[];
}

interface EntryRow {
  readonly commentaryId: string;
  readonly hadithId: string;
  readonly text: string;
  readonly hadith: {
    readonly sourceReference: string;
    readonly collection: { readonly slug: string };
    readonly edition: { readonly code: string };
  };
}

/** What every layered record carries, whichever work it is. */
type LayerRecord = Pick<
  HadithTranslationRecord,
  | 'id'
  | 'state'
  | 'version'
  | 'attribution'
  | 'sourceSystemId'
  | 'sourceAuthority'
  | 'publishedAt'
  | 'updatedAt'
>;

function layerRecord(row: LayerRow): LayerRecord {
  return {
    id: row.id,
    state: stateOf(row.state),
    version: row.version,
    attribution: row.attribution,
    sourceSystemId: row.sourceSystemId,
    sourceAuthority: authorityOf(row.sourceSystem),
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

function contributorsOf(rows: readonly ContributorRow[]): HadithContributorRecord[] {
  return rows.map((row) => ({
    personId: row.personId,
    role: roleOf(row.role),
    position: row.position,
  }));
}

function toTranslation(row: TranslationRow): HadithTranslationRecord {
  return {
    ...layerRecord(row),
    hadithId: row.hadithId,
    languageCode: row.languageCode,
    text: row.text,
    contributors: contributorsOf(row.contributors),
  };
}

function toCommentary(row: CommentaryRow): HadithCommentaryRecord {
  return {
    ...layerRecord(row),
    slug: row.slug,
    name: row.name,
    description: row.description,
    languageCode: row.languageCode,
    entryCount: row._count.entries,
    contributors: contributorsOf(row.contributors),
  };
}

function toScience(row: ScienceRow): HadithScienceRecord {
  return {
    ...layerRecord(row),
    slug: row.slug,
    position: row.position,
    texts: row.texts.map((text) => ({ ...text })),
  };
}

function toEntry(row: EntryRow): HadithCommentaryEntryRecord {
  return {
    commentaryId: row.commentaryId,
    hadithId: row.hadithId,
    collectionSlug: row.hadith.collection.slug,
    sourceReference: row.hadith.sourceReference,
    editionCode: row.hadith.edition.code,
    text: row.text,
  };
}

/* ===========================================================================
 * Writing
 * ========================================================================= */

/** A translation's own columns — never its record, which is fixed on creation. */
function translationColumns(value: {
  readonly languageCode: string;
  readonly text: string;
  readonly attribution: string | null;
  readonly sourceSystemId: string | null;
}) {
  return {
    languageCode: value.languageCode,
    text: value.text,
    attribution: value.attribution,
    sourceSystemId: value.sourceSystemId,
  };
}

/** A commentary's descriptive columns — never its slug, which is set once. */
function commentaryColumns(value: {
  readonly name: string;
  readonly description: string | null;
  readonly attribution: string | null;
  readonly languageCode: string;
  readonly sourceSystemId: string | null;
}) {
  return {
    name: value.name,
    description: value.description,
    attribution: value.attribution,
    languageCode: value.languageCode,
    sourceSystemId: value.sourceSystemId,
  };
}

/** A science's own columns — never its slug, which is set once. */
function scienceColumns(value: {
  readonly position: number;
  readonly attribution: string | null;
  readonly sourceSystemId: string | null;
}) {
  return {
    position: value.position,
    attribution: value.attribution,
    sourceSystemId: value.sourceSystemId,
  };
}

/** Contributors are replaced wholesale, in the order given. */
async function replaceContributors(
  tx: Client,
  kind: 'translation' | 'commentary',
  id: string,
  contributors: readonly { readonly personId: string; readonly role: string }[],
): Promise<void> {
  const rows = contributors.map((entry, position) => ({
    personId: entry.personId,
    role: entry.role,
    position,
  }));
  if (kind === 'translation') {
    await tx.hadithTranslationContributor.deleteMany({ where: { translationId: id } });
    if (rows.length > 0)
      await tx.hadithTranslationContributor.createMany({
        data: rows.map((row) => ({ ...row, translationId: id })),
      });
  } else {
    await tx.hadithCommentaryContributor.deleteMany({ where: { commentaryId: id } });
    if (rows.length > 0)
      await tx.hadithCommentaryContributor.createMany({
        data: rows.map((row) => ({ ...row, commentaryId: id })),
      });
  }
}

/**
 * A science's texts, language by language — each kept language updated in
 * place, each new one inserted, each dropped one removed LAST — so a published
 * science never passes through a moment without text.
 */
async function replaceScienceTexts(
  tx: Client,
  id: string,
  texts: readonly {
    readonly languageCode: string;
    readonly title: string;
    readonly body: string;
  }[],
): Promise<void> {
  for (const text of texts)
    await tx.hadithScienceText.upsert({
      where: {
        scienceId_languageCode: { scienceId: id, languageCode: text.languageCode },
      },
      create: { scienceId: id, ...text },
      update: { title: text.title, body: text.body },
    });
  await tx.hadithScienceText.deleteMany({
    where: {
      scienceId: id,
      languageCode: { notIn: texts.map((text) => text.languageCode) },
    },
  });
}

/* ===========================================================================
 * Reading a just-written record back
 * ========================================================================= */

async function translationOf(tx: Client, id: string): Promise<HadithTranslationRecord> {
  const row = await tx.hadithTranslation.findUnique({
    where: { id },
    select: TRANSLATION_SELECT,
  });
  if (row === null) throw new HadithDataError('conflict');
  return toTranslation(row);
}

async function commentaryOf(tx: Client, id: string): Promise<HadithCommentaryRecord> {
  const row = await tx.hadithCommentary.findUnique({
    where: { id },
    select: COMMENTARY_SELECT,
  });
  if (row === null) throw new HadithDataError('conflict');
  return toCommentary(row);
}

async function scienceOf(tx: Client, id: string): Promise<HadithScienceRecord> {
  const row = await tx.hadithScience.findUnique({
    where: { id },
    select: SCIENCE_SELECT,
  });
  if (row === null) throw new HadithDataError('conflict');
  return toScience(row);
}

/* ===========================================================================
 * Administration
 * ========================================================================= */

type LayerPersistence = Pick<
  HadithPersistencePort,
  | 'translations'
  | 'translation'
  | 'createTranslation'
  | 'updateTranslation'
  | 'setTranslationState'
  | 'commentaries'
  | 'commentary'
  | 'createCommentary'
  | 'updateCommentary'
  | 'setCommentaryState'
  | 'commentaryEntries'
  | 'saveCommentaryEntry'
  | 'sciences'
  | 'science'
  | 'createScience'
  | 'updateScience'
  | 'setScienceState'
>;

export function layerPersistence(): LayerPersistence {
  const db = getDatabaseClient();

  return {
    /* ---- Translation ----------------------------------------------------- */

    async translations(hadithId) {
      const rows = await db.hadithTranslation.findMany({
        where: { hadithId },
        select: TRANSLATION_SELECT,
        orderBy: [{ languageCode: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        take: WORK_LIST,
      });
      return rows.map(toTranslation);
    },

    async translation(id) {
      const row = await db.hadithTranslation.findUnique({
        where: { id },
        select: TRANSLATION_SELECT,
      });
      return row === null ? null : toTranslation(row);
    },

    async createTranslation({ actorId, hadithId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const record = await tx.hadith.findUnique({
            where: { id: hadithId },
            select: { id: true },
          });
          if (record === null) throw new HadithDataError('not-found');
          const id = randomUUID();
          await tx.hadithTranslation.create({
            data: {
              id,
              hadithId,
              ...translationColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await replaceContributors(tx, 'translation', id, value.contributors);
          await requestRecordScopes(tx, [hadithId]);
          await audit(tx, {
            actorId,
            action: 'hadith.translation.created',
            targetType: 'hadith-translation',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              record: hadithId,
              source: value.sourceSystemId ?? 'none',
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
          const previous = await tx.hadithTranslation.findUnique({
            where: { id },
            select: {
              hadithId: true,
              state: true,
              version: true,
              sourceSystemId: true,
              publishedAt: true,
              languageCode: true,
              text: true,
              attribution: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          const columns = translationColumns(value);
          const changed = await tx.hadithTranslation.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new HadithDataError('conflict');
          await replaceContributors(tx, 'translation', id, value.contributors);
          await requestRecordScopes(tx, [previous.hadithId]);
          await audit(tx, {
            actorId,
            action: 'hadith.translation.updated',
            targetType: 'hadith-translation',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: {
              version: String(previous.version + 1),
              changed: changedFields(previous, columns),
              contributors: String(value.contributors.length),
            },
          });
          return translationOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setTranslationState({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          // A translation always carries its text: the CHECK requires it.
          const previous = await claim(tx, 'translation', id, expectedVersion, (head) =>
            publication(head, state, async () => 1),
          );
          const record = await translationOf(tx, id);
          await requestRecordScopes(tx, [record.hadithId]);
          await audit(tx, {
            actorId,
            action: 'hadith.translation.state-changed',
            targetType: 'hadith-translation',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: { version: String(previous.version + 1), state },
          });
          return record;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Commentary ------------------------------------------------------ */

    async commentaries(offset) {
      const skip = boundedOffset(offset);
      const [total, rows] = await Promise.all([
        db.hadithCommentary.count(),
        db.hadithCommentary.findMany({
          select: COMMENTARY_SELECT,
          orderBy: [{ slug: 'asc' }, { id: 'asc' }],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toCommentary), total, offset: skip };
    },

    async commentary(id) {
      const row = await db.hadithCommentary.findUnique({
        where: { id },
        select: COMMENTARY_SELECT,
      });
      return row === null ? null : toCommentary(row);
    },

    async createCommentary({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.hadithCommentary.create({
            data: {
              id,
              slug: value.slug,
              ...commentaryColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          await replaceContributors(tx, 'commentary', id, value.contributors);
          await audit(tx, {
            actorId,
            action: 'hadith.commentary.created',
            targetType: 'hadith-commentary',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              source: value.sourceSystemId ?? 'none',
              contributors: String(value.contributors.length),
            },
          });
          return commentaryOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateCommentary({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.hadithCommentary.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceSystemId: true,
              publishedAt: true,
              name: true,
              description: true,
              attribution: true,
              languageCode: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          // The column refuses UPDATE, so a public address never changes.
          if (previous.slug !== value.slug) throw new HadithDataError('invalid');
          const columns = commentaryColumns(value);
          const changed = await tx.hadithCommentary.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new HadithDataError('conflict');
          await replaceContributors(tx, 'commentary', id, value.contributors);
          // A published commentary's name, language, attribution or source
          // reaches every citation page its entries are shown on.
          if (previous.state === 'published') await requestCommentaryScopes(tx, id);
          await audit(tx, {
            actorId,
            action: 'hadith.commentary.updated',
            targetType: 'hadith-commentary',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: {
              version: String(previous.version + 1),
              changed: changedFields(previous, columns),
              contributors: String(value.contributors.length),
            },
          });
          return commentaryOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Whenever a commentary enters or leaves publication, every citation whose
     * record it carries an entry for is re-projected, in the same transaction.
     */
    async setCommentaryState({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'commentary', id, expectedVersion, (head) =>
            publication(head, state, () =>
              tx.hadithCommentaryEntry.count({ where: { commentaryId: id } }),
            ),
          );
          if (previous.state === 'published' || state === 'published')
            await requestCommentaryScopes(tx, id);
          await audit(tx, {
            actorId,
            action: 'hadith.commentary.state-changed',
            targetType: 'hadith-commentary',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: { version: String(previous.version + 1), state },
          });
          return commentaryOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async commentaryEntries(commentaryId, offset) {
      const skip = boundedOffset(offset);
      const where = { commentaryId };
      const [total, rows] = await Promise.all([
        db.hadithCommentaryEntry.count({ where }),
        db.hadithCommentaryEntry.findMany({
          where,
          select: ENTRY_SELECT,
          orderBy: [
            { hadith: { collection: { slug: 'asc' } } },
            { hadith: { sourceReference: 'asc' } },
            { hadithId: 'asc' },
          ],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toEntry), total, offset: skip };
    },

    /**
     * One entry on one record, saved or (with `null`) removed, under the
     * commentary's expected version. Removing a published commentary's last
     * entry is refused by its trigger (51207): a published work keeps text.
     */
    async saveCommentaryEntry({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'commentary', id, expectedVersion);
          const key = {
            commentaryId_hadithId: { commentaryId: id, hadithId: value.hadithId },
          };
          if (value.text === null) {
            const removed = await tx.hadithCommentaryEntry.deleteMany({
              where: { commentaryId: id, hadithId: value.hadithId },
            });
            if (removed.count !== 1) throw new HadithDataError('not-found');
          } else {
            await tx.hadithCommentaryEntry.upsert({
              where: key,
              create: { commentaryId: id, hadithId: value.hadithId, text: value.text },
              update: { text: value.text },
            });
          }
          await requestRecordScopes(tx, [value.hadithId]);
          await audit(tx, {
            actorId,
            action:
              value.text === null
                ? 'hadith.commentary.entry-removed'
                : 'hadith.commentary.entry-saved',
            targetType: 'hadith-commentary',
            targetId: id,
            before: { version: String(previous.version) },
            after: { version: String(previous.version + 1), record: value.hadithId },
          });
          return commentaryOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- Sciences study material ----------------------------------------- */

    async sciences(offset) {
      const skip = boundedOffset(offset);
      const [total, rows] = await Promise.all([
        db.hadithScience.count(),
        db.hadithScience.findMany({
          select: SCIENCE_SELECT,
          orderBy: [{ position: 'asc' }, { slug: 'asc' }, { id: 'asc' }],
          skip,
          take: HADITH_PAGE,
        }),
      ]);
      return { items: rows.map(toScience), total, offset: skip };
    },

    async science(id) {
      const row = await db.hadithScience.findUnique({
        where: { id },
        select: SCIENCE_SELECT,
      });
      return row === null ? null : toScience(row);
    },

    async createScience({ actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const id = randomUUID();
          await tx.hadithScience.create({
            data: {
              id,
              slug: value.slug,
              ...scienceColumns(value),
              state: 'draft',
              version: 1,
              updatedAt: new Date(),
            },
          });
          if (value.texts.length > 0)
            await tx.hadithScienceText.createMany({
              data: value.texts.map((text) => ({ scienceId: id, ...text })),
            });
          await audit(tx, {
            actorId,
            action: 'hadith.science.created',
            targetType: 'hadith-science',
            targetId: id,
            after: {
              version: '1',
              state: 'draft',
              source: value.sourceSystemId ?? 'none',
              languages: value.texts.map((text) => text.languageCode).join(','),
            },
          });
          return scienceOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async updateScience({ actorId, id, expectedVersion, value }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await tx.hadithScience.findUnique({
            where: { id },
            select: {
              slug: true,
              state: true,
              version: true,
              sourceSystemId: true,
              publishedAt: true,
              position: true,
              attribution: true,
            },
          });
          guardEdit(previous, expectedVersion, value);
          if (previous.slug !== value.slug) throw new HadithDataError('invalid');
          const columns = scienceColumns(value);
          const changed = await tx.hadithScience.updateMany({
            where: { id, version: expectedVersion },
            data: { ...columns, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (changed.count !== 1) throw new HadithDataError('conflict');
          await replaceScienceTexts(tx, id, value.texts);
          await audit(tx, {
            actorId,
            action: 'hadith.science.updated',
            targetType: 'hadith-science',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: {
              version: String(previous.version + 1),
              changed: changedFields(previous, columns),
              languages: value.texts.map((text) => text.languageCode).join(','),
            },
          });
          return scienceOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },

    async setScienceState({ actorId, id, expectedVersion, state }) {
      try {
        return await db.$transaction(async (tx) => {
          const previous = await claim(tx, 'science', id, expectedVersion, (head) =>
            publication(head, state, () =>
              tx.hadithScienceText.count({ where: { scienceId: id } }),
            ),
          );
          await audit(tx, {
            actorId,
            action: 'hadith.science.state-changed',
            targetType: 'hadith-science',
            targetId: id,
            before: { version: String(previous.version), state: previous.state },
            after: { version: String(previous.version + 1), state },
          });
          return scienceOf(tx, id);
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
