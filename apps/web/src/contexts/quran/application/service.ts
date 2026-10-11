import 'server-only';

import { z } from 'zod';

import {
  layerTextSaveSchema,
  quranIdSchema,
  quranLayerStateSchema,
  quranRefSchema,
  quranVersionSchema,
  recitationInputSchema,
  recitationSegmentInputSchema,
  surahNamesInputSchema,
  surahNumberSchema,
  tafsirEntryInputSchema,
  tafsirInputSchema,
  tajweedRuleInputSchema,
  translationInputSchema,
  transliterationInputSchema,
  type LayerTextChange,
  type QuranActor,
  type QuranAuthorityPort,
  type QuranLayerState,
  type QuranPersistencePort,
  type QuranRef,
  type QuranSourceAuthority,
} from '@minhaj/contracts/quran';

import { QuranRefusal, asRefusal } from '../domain/refusal.ts';

/**
 * The Quran administrative service — the LAYERED works (Translation,
 * Transliteration, Tafsir, Recitation and its segments, Tajweed guidance),
 * Surah display names and Ayah topic assignments (DOMAIN_MODEL.md §8.2;
 * DELIVERY_PLAN.md Phase 18).
 *
 * IT CANNOT TOUCH CANONICAL ARABIC. The persistence port it is handed has no
 * method that writes canonical text or structure, and the application principal
 * holds no write on those tables. The two canonical authority operations live
 * in `./canonical-service.ts`, behind a step-up-bound privileged actor.
 *
 * TWO AUTHORITIES, RE-CHECKED LIVE ON EVERY CALL. `quran.read` opens anything;
 * `quran.administer` is what every change requires. The check is a read of the
 * principal's CURRENT permission set through the authority port, so a revoked
 * role refuses the next action rather than the next sign-in. No profile, no
 * reciter or contributor credit, and no `content.*`, `library.*` or `media.*`
 * key is consulted: only these two keys grant anything here.
 *
 * EVERY INPUT IS PARSED HERE, by the contract's strict schemas inside strict
 * envelopes. A field nobody named is `invalid`, religious text that would need
 * repairing is `invalid` (it is never repaired), and an expected version is
 * compared by the adapter rather than trusted.
 *
 * PUBLICATION IS CHECKED HERE FIRST, so the operator is told what to do: a
 * work without a registered source is `source-required`, one without text is
 * `text-required`, and a recitation with no segment audio is `audio-required`.
 * The adapter and the database refuse each again under the expected version.
 */

const offsetSchema = z.number().int().min(0).max(25_000);

/** Parses or refuses as `invalid` — a schema failure is never an outage. */
function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new QuranRefusal('invalid');
  return parsed.data;
}

/** The envelope every versioned edit arrives in, around its own value. */
const versioned = <S extends z.ZodType>(value: S) =>
  z.strictObject({
    id: quranIdSchema,
    expectedVersion: quranVersionSchema,
    value,
  });

const stateChange = z.strictObject({
  id: quranIdSchema,
  expectedVersion: quranVersionSchema,
  state: quranLayerStateSchema,
});

const textSave = z.strictObject({
  id: quranIdSchema,
  expectedVersion: quranVersionSchema,
  surah: z.unknown(),
  changes: z.unknown(),
});

const tafsirEntrySave = z.strictObject({
  id: quranIdSchema,
  expectedVersion: quranVersionSchema,
  entryId: quranIdSchema.nullable(),
  value: tafsirEntryInputSchema,
});

const tafsirEntryRemoval = z.strictObject({
  id: quranIdSchema,
  expectedVersion: quranVersionSchema,
  entryId: quranIdSchema,
});

const segmentRemoval = z.strictObject({
  id: quranIdSchema,
  expectedVersion: quranVersionSchema,
  segmentId: quranIdSchema,
});

const surahNamesSave = z.strictObject({
  expectedVersion: quranVersionSchema,
  value: surahNamesInputSchema,
});

const topicChange = z.strictObject({ ref: quranRefSchema, topicId: quranIdSchema });

const creation = <S extends z.ZodType>(value: S) => z.strictObject({ value });

const translationCreate = creation(translationInputSchema);
const translationEdit = versioned(translationInputSchema);
const transliterationCreate = creation(transliterationInputSchema);
const transliterationEdit = versioned(transliterationInputSchema);
const tafsirCreate = creation(tafsirInputSchema);
const tafsirEdit = versioned(tafsirInputSchema);
const recitationCreate = creation(recitationInputSchema);
const recitationEdit = versioned(recitationInputSchema);
const segmentAddition = versioned(recitationSegmentInputSchema);
const tajweedCreate = creation(tajweedRuleInputSchema);
const tajweedEdit = versioned(tajweedRuleInputSchema);

/**
 * What each operation is CALLED with. The types are ergonomics for the caller;
 * the parse inside each method is the rule, so a value that merely claims this
 * shape is refused all the same.
 */
type In<S extends z.ZodType> = z.input<S>;

export interface LayerTextSaveInput {
  readonly id: string;
  readonly expectedVersion: number;
  readonly surah: number;
  readonly changes: readonly LayerTextChange[];
}

/** What publication needs of a work, whatever kind it is. */
interface Publishable {
  readonly version: number;
  readonly sourceId: string | null;
  readonly sourceAuthority: QuranSourceAuthority | null;
}

export function createQuranService(deps: {
  readonly persistence: QuranPersistencePort;
  readonly authority: QuranAuthorityPort;
}) {
  const store = deps.persistence;

  async function permit(actor: QuranActor, key: 'quran.read' | 'quran.administer') {
    if (
      typeof actor?.accountId !== 'string' ||
      actor.accountId === '' ||
      !(await deps.authority.permits(actor.accountId, key))
    )
      throw new QuranRefusal('denied');
  }

  /** An adapter's data error, re-thrown as the refusal it names. */
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asRefusal);

  async function read(actor: QuranActor) {
    await permit(actor, 'quran.read');
  }

  async function administer(actor: QuranActor) {
    await permit(actor, 'quran.administer');
  }

  /**
   * The publication pre-check: the work exists, is the version the operator
   * saw, names a registered source, and carries what a reader would get.
   */
  async function publishable<R extends Publishable>(
    state: QuranLayerState,
    expectedVersion: number,
    current: () => Promise<R | null>,
    carries: (record: R) => boolean,
    missing: 'text-required' | 'audio-required',
  ): Promise<void> {
    if (state !== 'published') return;
    const record = await run(current());
    if (record === null) throw new QuranRefusal('not-found');
    if (record.version !== expectedVersion) throw new QuranRefusal('conflict');
    if (record.sourceId === null || record.sourceAuthority === null)
      throw new QuranRefusal('source-required');
    if (!carries(record)) throw new QuranRefusal(missing);
  }

  return {
    /* ---- Canonical position (read-only here) ------------------------------ */

    async corpusStatus(actor: QuranActor) {
      await read(actor);
      return run(store.corpusStatus());
    },

    async source(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.source(parse(quranIdSchema, id)));
    },

    async sourceText(actor: QuranActor, sourceId: string, ref: QuranRef) {
      await read(actor);
      return run(
        store.sourceText(parse(quranIdSchema, sourceId), parse(quranRefSchema, ref)),
      );
    },

    async surahs(actor: QuranActor) {
      await read(actor);
      return run(store.surahs());
    },

    async surahAyat(actor: QuranActor, surah: number, offset = 0) {
      await read(actor);
      return run(
        store.surahAyat(parse(surahNumberSchema, surah), parse(offsetSchema, offset)),
      );
    },

    async ayah(actor: QuranActor, ref: QuranRef) {
      await read(actor);
      return run(store.ayah(parse(quranRefSchema, ref)));
    },

    async correctionPreview(actor: QuranActor, ref: QuranRef, sourceId: string) {
      await read(actor);
      return run(
        store.correctionPreview(
          parse(quranRefSchema, ref),
          parse(quranIdSchema, sourceId),
        ),
      );
    },

    /** Replaces a Surah's localised display names. Presentation only. */
    async saveSurahNames(actor: QuranActor, input: In<typeof surahNamesSave>) {
      await administer(actor);
      const { expectedVersion, value } = parse(surahNamesSave, input);
      return run(
        store.saveSurahNames({ actorId: actor.accountId, expectedVersion, value }),
      );
    },

    async addAyahTopic(actor: QuranActor, input: In<typeof topicChange>) {
      await administer(actor);
      const { ref, topicId } = parse(topicChange, input);
      return run(store.addAyahTopic({ actorId: actor.accountId, ref, topicId }));
    },

    async removeAyahTopic(actor: QuranActor, input: In<typeof topicChange>) {
      await administer(actor);
      const { ref, topicId } = parse(topicChange, input);
      return run(store.removeAyahTopic({ actorId: actor.accountId, ref, topicId }));
    },

    /* ---- Translation ------------------------------------------------------ */

    async translations(actor: QuranActor, offset = 0) {
      await read(actor);
      return run(store.translations(parse(offsetSchema, offset)));
    },

    async translation(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.translation(parse(quranIdSchema, id)));
    },

    async createTranslation(actor: QuranActor, input: In<typeof translationCreate>) {
      await administer(actor);
      const { value } = parse(translationCreate, input);
      return run(store.createTranslation({ actorId: actor.accountId, value }));
    },

    async updateTranslation(actor: QuranActor, input: In<typeof translationEdit>) {
      await administer(actor);
      const edit = parse(translationEdit, input);
      return run(store.updateTranslation({ actorId: actor.accountId, ...edit }));
    },

    async setTranslationState(actor: QuranActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.translation(change.id),
        (work) => work.textCount > 0,
        'text-required',
      );
      return run(store.setTranslationState({ actorId: actor.accountId, ...change }));
    },

    async translationTexts(actor: QuranActor, id: string, surah: number) {
      await read(actor);
      return run(
        store.translationTexts(parse(quranIdSchema, id), parse(surahNumberSchema, surah)),
      );
    },

    async saveTranslationTexts(actor: QuranActor, input: LayerTextSaveInput) {
      await administer(actor);
      const { id, expectedVersion, surah, changes } = parse(textSave, input);
      const save = parse(layerTextSaveSchema, { surah, changes });
      return run(
        store.saveTranslationTexts({
          actorId: actor.accountId,
          id,
          expectedVersion,
          ...save,
        }),
      );
    },

    /* ---- Transliteration -------------------------------------------------- */

    async transliterations(actor: QuranActor, offset = 0) {
      await read(actor);
      return run(store.transliterations(parse(offsetSchema, offset)));
    },

    async transliteration(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.transliteration(parse(quranIdSchema, id)));
    },

    async createTransliteration(
      actor: QuranActor,
      input: In<typeof transliterationCreate>,
    ) {
      await administer(actor);
      const { value } = parse(transliterationCreate, input);
      return run(store.createTransliteration({ actorId: actor.accountId, value }));
    },

    async updateTransliteration(
      actor: QuranActor,
      input: In<typeof transliterationEdit>,
    ) {
      await administer(actor);
      const edit = parse(transliterationEdit, input);
      return run(store.updateTransliteration({ actorId: actor.accountId, ...edit }));
    },

    async setTransliterationState(actor: QuranActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.transliteration(change.id),
        (work) => work.textCount > 0,
        'text-required',
      );
      return run(store.setTransliterationState({ actorId: actor.accountId, ...change }));
    },

    async transliterationTexts(actor: QuranActor, id: string, surah: number) {
      await read(actor);
      return run(
        store.transliterationTexts(
          parse(quranIdSchema, id),
          parse(surahNumberSchema, surah),
        ),
      );
    },

    async saveTransliterationTexts(actor: QuranActor, input: LayerTextSaveInput) {
      await administer(actor);
      const { id, expectedVersion, surah, changes } = parse(textSave, input);
      const save = parse(layerTextSaveSchema, { surah, changes });
      return run(
        store.saveTransliterationTexts({
          actorId: actor.accountId,
          id,
          expectedVersion,
          ...save,
        }),
      );
    },

    /* ---- Tafsir ----------------------------------------------------------- */

    async tafsirs(actor: QuranActor, offset = 0) {
      await read(actor);
      return run(store.tafsirs(parse(offsetSchema, offset)));
    },

    async tafsir(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.tafsir(parse(quranIdSchema, id)));
    },

    async createTafsir(actor: QuranActor, input: In<typeof tafsirCreate>) {
      await administer(actor);
      const { value } = parse(tafsirCreate, input);
      return run(store.createTafsir({ actorId: actor.accountId, value }));
    },

    async updateTafsir(actor: QuranActor, input: In<typeof tafsirEdit>) {
      await administer(actor);
      const edit = parse(tafsirEdit, input);
      return run(store.updateTafsir({ actorId: actor.accountId, ...edit }));
    },

    async setTafsirState(actor: QuranActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.tafsir(change.id),
        (work) => work.textCount > 0,
        'text-required',
      );
      return run(store.setTafsirState({ actorId: actor.accountId, ...change }));
    },

    async tafsirEntries(actor: QuranActor, id: string, surah: number) {
      await read(actor);
      return run(
        store.tafsirEntries(parse(quranIdSchema, id), parse(surahNumberSchema, surah)),
      );
    },

    /** Adds an entry, or replaces `entryId`'s, under the Tafsir's expected version. */
    async saveTafsirEntry(actor: QuranActor, input: In<typeof tafsirEntrySave>) {
      await administer(actor);
      const entry = parse(tafsirEntrySave, input);
      return run(store.saveTafsirEntry({ actorId: actor.accountId, ...entry }));
    },

    async removeTafsirEntry(actor: QuranActor, input: In<typeof tafsirEntryRemoval>) {
      await administer(actor);
      const removal = parse(tafsirEntryRemoval, input);
      return run(store.removeTafsirEntry({ actorId: actor.accountId, ...removal }));
    },

    /* ---- Recitation ------------------------------------------------------- */

    async recitations(actor: QuranActor, offset = 0) {
      await read(actor);
      return run(store.recitations(parse(offsetSchema, offset)));
    },

    async recitation(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.recitation(parse(quranIdSchema, id)));
    },

    async createRecitation(actor: QuranActor, input: In<typeof recitationCreate>) {
      await administer(actor);
      const { value } = parse(recitationCreate, input);
      return run(store.createRecitation({ actorId: actor.accountId, value }));
    },

    async updateRecitation(actor: QuranActor, input: In<typeof recitationEdit>) {
      await administer(actor);
      const edit = parse(recitationEdit, input);
      return run(store.updateRecitation({ actorId: actor.accountId, ...edit }));
    },

    /**
     * A PUBLISHED RECITATION HAS AUDIO — at least one segment whose file
     * Storage cleared and the upload recorded. A segment's FILE is never set
     * here: it arrives only through `./recitation-upload.ts`.
     */
    async setRecitationState(actor: QuranActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.recitation(change.id),
        (work) => work.segments.some((segment) => segment.assetId !== null),
        'audio-required',
      );
      return run(store.setRecitationState({ actorId: actor.accountId, ...change }));
    },

    async addRecitationSegment(actor: QuranActor, input: In<typeof segmentAddition>) {
      await administer(actor);
      const segment = parse(segmentAddition, input);
      return run(store.addRecitationSegment({ actorId: actor.accountId, ...segment }));
    },

    async removeRecitationSegment(actor: QuranActor, input: In<typeof segmentRemoval>) {
      await administer(actor);
      const removal = parse(segmentRemoval, input);
      return run(store.removeRecitationSegment({ actorId: actor.accountId, ...removal }));
    },

    /* ---- Tajweed ---------------------------------------------------------- */

    async tajweedRules(actor: QuranActor) {
      await read(actor);
      return run(store.tajweedRules());
    },

    async tajweedRule(actor: QuranActor, id: string) {
      await read(actor);
      return run(store.tajweedRule(parse(quranIdSchema, id)));
    },

    async createTajweedRule(actor: QuranActor, input: In<typeof tajweedCreate>) {
      await administer(actor);
      const { value } = parse(tajweedCreate, input);
      return run(store.createTajweedRule({ actorId: actor.accountId, value }));
    },

    async updateTajweedRule(actor: QuranActor, input: In<typeof tajweedEdit>) {
      await administer(actor);
      const edit = parse(tajweedEdit, input);
      return run(store.updateTajweedRule({ actorId: actor.accountId, ...edit }));
    },

    async setTajweedRuleState(actor: QuranActor, input: In<typeof stateChange>) {
      await administer(actor);
      const change = parse(stateChange, input);
      await publishable(
        change.state,
        change.expectedVersion,
        () => store.tajweedRule(change.id),
        (rule) => rule.texts.length > 0,
        'text-required',
      );
      return run(store.setTajweedRuleState({ actorId: actor.accountId, ...change }));
    },
  };
}

export type QuranService = ReturnType<typeof createQuranService>;
