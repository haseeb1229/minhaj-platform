import 'server-only';

import { z } from 'zod';

import {
  HADITH_RECORD_FILTERS,
  collectionNamesSchema,
  commentaryEntrySaveSchema,
  commentaryInputSchema,
  hadithIdSchema,
  hadithLayerStateSchema,
  hadithVersionSchema,
  scienceInputSchema,
  structureNamesSchema,
  translationInputSchema,
  type HadithActor,
  type HadithAuthorityPort,
  type HadithLayerState,
  type HadithPersistencePort,
  type HadithSourceAuthority,
} from '@minhaj/contracts/hadith';

import { HadithRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * The Hadith administrative service — the LAYERED records (Translation,
 * Commentary and its entries, Sciences guidance), collection, book and chapter
 * display names, and record topic assignments (DOMAIN_MODEL.md §9;
 * DELIVERY_PLAN.md Phase 19).
 *
 * IT CANNOT TOUCH A SOURCED FACT. The persistence port it is handed has no
 * method that writes structure, a record's text, chain or gradings, a
 * verification or a citation, and the application principal holds no write on
 * those tables. The canonical operations live in `./canonical-service.ts`,
 * behind a step-up-bound privileged actor.
 *
 * TWO AUTHORITIES, RE-CHECKED LIVE ON EVERY CALL. `hadith.read` opens anything;
 * `hadith.administer` is what every change requires. The check is a read of
 * the principal's CURRENT permission set through the authority port, so a
 * revoked role refuses the next action rather than the next sign-in. No
 * profile, no contributor credit, and no `quran.*`, `content.*`, `library.*`
 * or `media.*` key is consulted: only these two keys grant anything here.
 *
 * EVERY INPUT IS PARSED HERE, by the contract's strict schemas inside strict
 * envelopes. A field nobody named is `invalid`, text that would need repairing
 * is `invalid` (it is never repaired), and an expected version is compared by
 * the adapter rather than trusted.
 *
 * PUBLICATION IS CHECKED HERE FIRST, so the operator is told what to do: a
 * work without a registered source is `source-required` and one without text
 * is `text-required`. The adapter and the database refuse each again under the
 * expected version.
 */

const offsetSchema = z.number().int().min(0).max(10_000_000);

/** Parses or refuses as `invalid` — a schema failure is never an outage. */
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HadithRefusal('invalid');
  return parsed.data;
}

/** The envelope every versioned edit arrives in, around its own value. */
const versioned = <S extends z.ZodType>(value: S) =>
  z.strictObject({
    id: hadithIdSchema,
    expectedVersion: hadithVersionSchema,
    value,
  });

const stateChange = z.strictObject({
  id: hadithIdSchema,
  expectedVersion: hadithVersionSchema,
  state: hadithLayerStateSchema,
});

const recordFilter = z.strictObject({
  collectionId: hadithIdSchema.nullable(),
  view: z.enum(HADITH_RECORD_FILTERS),
});

const translationCreate = z.strictObject({
  hadithId: hadithIdSchema,
  value: translationInputSchema,
});
const translationEdit = versioned(translationInputSchema);
const commentaryEdit = versioned(commentaryInputSchema);
const commentaryEntrySave = versioned(commentaryEntrySaveSchema);
const scienceEdit = versioned(scienceInputSchema);
const topicChange = z.strictObject({ hadithId: hadithIdSchema, topicId: hadithIdSchema });

/**
 * What each operation is CALLED with. The types are ergonomics for the caller;
 * the parse inside each method is the rule, so a value that merely claims this
 * shape is refused all the same.
 */
type In<S extends z.ZodType> = z.input<S>;

/** What publication needs of a work, whatever kind it is. */
interface Publishable {
  readonly version: number;
  readonly sourceSystemId: string | null;
  readonly sourceAuthority: HadithSourceAuthority | null;
}

export function createHadithService(deps: {
  readonly persistence: HadithPersistencePort;
  readonly authority: HadithAuthorityPort;
}) {
  const store = deps.persistence;

  async function permit(actor: HadithActor, key: 'hadith.read' | 'hadith.administer') {
    if (
      typeof actor?.accountId !== 'string' ||
      actor.accountId === '' ||
      !(await deps.authority.permits(actor.accountId, key))
    )
      throw new HadithRefusal('denied');
  }

  /** An adapter's data error, re-thrown as the refusal it names. */
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  async function read(actor: HadithActor) {
    await permit(actor, 'hadith.read');
  }

  async function administer(actor: HadithActor) {
    await permit(actor, 'hadith.administer');
  }

  /**
   * The publication pre-check: the work exists, is the version the operator
   * saw, names a registered source, and carries what a reader would get.
   */
  async function publishable<R extends Publishable>(
    state: HadithLayerState,
    expectedVersion: number,
    current: () => Promise<R | null>,
    carries: (record: R) => boolean,
  ): Promise<void> {
    if (state !== 'published') return;
    const record = await run(current());
    if (record === null) throw new HadithRefusal('not-found');
    if (record.version !== expectedVersion) throw new HadithRefusal('conflict');
    if (record.sourceSystemId === null || record.sourceAuthority === null)
      throw new HadithRefusal('source-required');
    if (!carries(record)) throw new HadithRefusal('text-required');
  }

  return {
    /* ---- Registered sources (read-only everywhere) ------------------------ */

    async sourceSystems(actor: HadithActor) {
      await read(actor);
      return run(store.sourceSystems());
    },

    /* ---- Structure (read here; display names only are written) ------------ */

    async collections(actor: HadithActor, offset = 0) {
      await read(actor);
      return run(store.collections(parse(offsetSchema, offset)));
    },

    async collection(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.collection(parse(hadithIdSchema, id)));
    },

    /** Replaces a collection's localised display names. Presentation only. */
    async saveCollectionNames(
      actor: HadithActor,
      input: In<typeof collectionNamesSchema>,
    ) {
      await administer(actor);
      const value = parse(collectionNamesSchema, input);
      return run(store.saveCollectionNames({ actorId: actor.accountId, value }));
    },

    async books(actor: HadithActor, collectionId: string | null, offset = 0) {
      await read(actor);
      return run(
        store.books(
          parse(hadithIdSchema.nullable(), collectionId),
          parse(offsetSchema, offset),
        ),
      );
    },

    async book(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.book(parse(hadithIdSchema, id)));
    },

    async saveBookNames(actor: HadithActor, input: In<typeof structureNamesSchema>) {
      await administer(actor);
      const value = parse(structureNamesSchema, input);
      return run(store.saveBookNames({ actorId: actor.accountId, value }));
    },

    async chapters(actor: HadithActor, bookId: string | null, offset = 0) {
      await read(actor);
      return run(
        store.chapters(
          parse(hadithIdSchema.nullable(), bookId),
          parse(offsetSchema, offset),
        ),
      );
    },

    async chapter(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.chapter(parse(hadithIdSchema, id)));
    },

    async saveChapterNames(actor: HadithActor, input: In<typeof structureNamesSchema>) {
      await administer(actor);
      const value = parse(structureNamesSchema, input);
      return run(store.saveChapterNames({ actorId: actor.accountId, value }));
    },

    /* ---- Records (read-only here) ----------------------------------------- */

    async records(actor: HadithActor, filter: In<typeof recordFilter>, offset = 0) {
      await read(actor);
      return run(store.records(parse(recordFilter, filter), parse(offsetSchema, offset)));
    },

    async record(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.record(parse(hadithIdSchema, id)));
    },

    async addRecordTopic(actor: HadithActor, input: In<typeof topicChange>) {
      await administer(actor);
      const { hadithId, topicId } = parse(topicChange, input);
      return run(store.addRecordTopic({ actorId: actor.accountId, hadithId, topicId }));
    },

    async removeRecordTopic(actor: HadithActor, input: In<typeof topicChange>) {
      await administer(actor);
      const { hadithId, topicId } = parse(topicChange, input);
      return run(
        store.removeRecordTopic({ actorId: actor.accountId, hadithId, topicId }),
      );
    },

    /* ---- Translation ------------------------------------------------------ */

    async translations(actor: HadithActor, hadithId: string) {
      await read(actor);
      return run(store.translations(parse(hadithIdSchema, hadithId)));
    },

    async createTranslation(actor: HadithActor, input: In<typeof translationCreate>) {
      await administer(actor);
      const { hadithId, value } = parse(translationCreate, input);
      return run(store.createTranslation({ actorId: actor.accountId, hadithId, value }));
    },

    async updateTranslation(actor: HadithActor, input: In<typeof translationEdit>) {
      await administer(actor);
      const edit = parse(translationEdit, input);
      return run(store.updateTranslation({ actorId: actor.accountId, ...edit }));
    },

    async setTranslationState(actor: HadithActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.translation(change.id),
        (work) => work.text.length > 0,
      );
      return run(store.setTranslationState({ actorId: actor.accountId, ...change }));
    },

    /* ---- Commentary ------------------------------------------------------- */

    async commentaries(actor: HadithActor, offset = 0) {
      await read(actor);
      return run(store.commentaries(parse(offsetSchema, offset)));
    },

    async commentary(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.commentary(parse(hadithIdSchema, id)));
    },

    async createCommentary(actor: HadithActor, input: In<typeof commentaryInputSchema>) {
      await administer(actor);
      const value = parse(commentaryInputSchema, input);
      return run(store.createCommentary({ actorId: actor.accountId, value }));
    },

    async updateCommentary(actor: HadithActor, input: In<typeof commentaryEdit>) {
      await administer(actor);
      const edit = parse(commentaryEdit, input);
      return run(store.updateCommentary({ actorId: actor.accountId, ...edit }));
    },

    async setCommentaryState(actor: HadithActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.commentary(change.id),
        (work) => work.entryCount > 0,
      );
      return run(store.setCommentaryState({ actorId: actor.accountId, ...change }));
    },

    async commentaryEntries(actor: HadithActor, commentaryId: string, offset = 0) {
      await read(actor);
      return run(
        store.commentaryEntries(
          parse(hadithIdSchema, commentaryId),
          parse(offsetSchema, offset),
        ),
      );
    },

    /** Saves one record's entry, or removes it with `text: null`, under the work's version. */
    async saveCommentaryEntry(actor: HadithActor, input: In<typeof commentaryEntrySave>) {
      await administer(actor);
      const entry = parse(commentaryEntrySave, input);
      return run(store.saveCommentaryEntry({ actorId: actor.accountId, ...entry }));
    },

    /* ---- Sciences --------------------------------------------------------- */

    async sciences(actor: HadithActor, offset = 0) {
      await read(actor);
      return run(store.sciences(parse(offsetSchema, offset)));
    },

    async science(actor: HadithActor, id: string) {
      await read(actor);
      return run(store.science(parse(hadithIdSchema, id)));
    },

    async createScience(actor: HadithActor, input: In<typeof scienceInputSchema>) {
      await administer(actor);
      const value = parse(scienceInputSchema, input);
      return run(store.createScience({ actorId: actor.accountId, value }));
    },

    async updateScience(actor: HadithActor, input: In<typeof scienceEdit>) {
      await administer(actor);
      const edit = parse(scienceEdit, input);
      return run(store.updateScience({ actorId: actor.accountId, ...edit }));
    },

    async setScienceState(actor: HadithActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.science(change.id),
        (science) => science.texts.length > 0,
      );
      return run(store.setScienceState({ actorId: actor.accountId, ...change }));
    },
  };
}

export type HadithService = ReturnType<typeof createHadithService>;
