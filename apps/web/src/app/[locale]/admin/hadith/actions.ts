'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { localeSchema } from '@minhaj/contracts';
import {
  HADITH_LIMITS,
  HADITH_NAME_LOCALES,
  bookCreateSchema,
  chapterCreateSchema,
  citationSetSchema,
  collectionCreateSchema,
  collectionNamesSchema,
  commentaryEntrySaveSchema,
  commentaryInputSchema,
  hadithIdSchema,
  hadithLayerStateSchema,
  hadithVersionSchema,
  recordCorrectionSchema,
  recordCreateSchema,
  recordVerificationSchema,
  scienceInputSchema,
  structureNamesSchema,
  translationInputSchema,
  type HadithActor,
} from '@minhaj/contracts/hadith';

import {
  requirePermittedAction,
  requirePrivilegedActor,
} from '@/composition/authorization';
import { hadithRuntime } from '@/composition/hadith';
import { appLogger } from '@/composition/logging';
import { indexAfterResponse } from '@/composition/search';
import { hadithFailure } from '@/contexts/hadith';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Hadith administrative mutations (ROUTE_MAP.md §7: `/admin/hadith/*`),
 * Phase 19.
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, carrying the framework's Origin and CSRF protections and
 * unreachable by GET — and every one RE-CHECKS AUTHORISATION SERVER-SIDE
 * against the principal's CURRENT permission set. The page that rendered the
 * form decided whether to show it, which is navigation, not a boundary (§3.4
 * rule 2). The Hadith services then re-check again, live, per call.
 *
 * TWO AUTHORITIES, AND THE SPLIT IS THE POINT.
 *
 *   - `hadith.administer`, through `requirePermittedAction`, for the LAYERED
 *     records — display names, translations, commentary, sciences and record
 *     topics. None of these can reach a sourced fact: the persistence port
 *     behind them has no method that writes one.
 *   - `hadith.editCanonical` with a step-up grant for `hadith-canonical-edit`,
 *     through `requirePrivilegedActor`, for every SOURCED write: creating a
 *     collection, book, chapter or record, correcting a record, verifying its
 *     current version, and mapping or withdrawing a public citation. Each needs
 *     an explicit confirmation before it is attempted, and the database
 *     procedure re-checks the permission and the grant itself.
 *
 * NO CONFLICT IS RESOLVED HERE. Conflict evidence is immutable and blocks a
 * citation until an external authority decides; there is no action that
 * clears it or picks a winner (OPEN_DECISIONS.md §1.6).
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads and parses them
 * with the contract's strict schemas; a submitted `version` is an EXPECTED
 * version — compared, never trusted.
 *
 * SOURCED TEXT IS NEVER TRIMMED OR NORMALISED. Original text, chain, grader,
 * grading label and reference, source reference, and the body of every layered
 * text are read exactly as submitted, with ONE transport decoding: the HTML
 * form encoding sends every textarea line break as CRLF, so CRLF is turned back
 * into the LF the textarea held. Surrounding whitespace is passed on as typed, and the schema REFUSES it
 * rather than repairing it.
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `hadithFailure` maps a thrown value onto
 * the refusal vocabulary; anything unrecognised is logged by operation name
 * only — never a text, a reference or an identifier the operator typed (§19.2).
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = hadithFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Hadith administration mutation failed.');
  return { status: 'error', failure };
}

const INVALID: FormActionState = { status: 'error', failure: 'invalid' };
const DENIED: FormActionState = { status: 'error', failure: 'denied' };
const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const SAVED: FormActionState = { status: 'success' };

/** One label-like form value, trimmed, or `null` when absent or empty. */
function value(form: FormData, field: string): string | null {
  const raw = form.get(field);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** A whole decimal number, or `NaN` — never a zero for a missing field. */
function whole(form: FormData, field: string): number {
  const raw = form.get(field);
  return typeof raw === 'string' && /^[0-9]{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** An optional whole number: an empty field is `null`, anything else must be whole. */
function optionalWhole(form: FormData, field: string): number | null {
  const raw = form.get(field);
  return typeof raw !== 'string' || raw === '' ? null : whole(form, field);
}

/**
 * A text field's text, transport-decoded and otherwise EXACTLY as typed.
 *
 * HTML form submission encodes each of a textarea's line breaks as CRLF; this
 * turns CRLF back into LF and does nothing else — no trim, no Unicode
 * normalisation, no character substitution.
 */
function textarea(form: FormData, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.replace(/\r\n/g, '\n') : null;
}

/** An optional exact text: an EMPTY field is no text; anything else is passed on as typed. */
function optionalText(form: FormData, field: string): string | null {
  const text = textarea(form, field);
  return text === null || text === '' ? null : text;
}

async function authorise(form: FormData) {
  const locale = localeSchema.parse(form.get('locale'));
  const permitted = await requirePermittedAction(locale, 'hadith.administer');
  const actor: HadithActor | null =
    permitted.state === 'allowed' ? { accountId: permitted.session.account.id } : null;
  return { locale, actor };
}

/** The verified actor for one canonical write, or the gate's refusal word. */
async function privileged(locale: string) {
  return requirePrivilegedActor(locale, 'hadith.editCanonical', 'hadith-canonical-edit');
}

/** Re-renders the Hadith administration after a change it displays. */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin/hadith`, 'layout');
}

/** The record being edited and the version the operator was looking at. */
function versioned(form: FormData) {
  return z
    .strictObject({ id: hadithIdSchema, expectedVersion: hadithVersionSchema })
    .safeParse({ id: form.get('id'), expectedVersion: whole(form, 'version') });
}

/**
 * The contributors a form names: a FIXED ceiling of rows, never a count the
 * browser supplies. An empty person row is no contributor; a person without a
 * role is passed on so the schema refuses it.
 */
function contributors(form: FormData) {
  return Array.from({ length: HADITH_LIMITS.contributors }, (_, index) => ({
    personId: value(form, `contributor-${String(index)}`),
    role: value(form, `role-${String(index)}`),
  }))
    .filter((row) => row.personId !== null)
    .map((row) => ({ personId: row.personId, role: row.role ?? '' }));
}

/**
 * The gradings a record form names, in the order shown: a FIXED ceiling of
 * rows. A row with nothing in it is no grading; a partly filled row is passed
 * on so the schema refuses it rather than the grading being silently dropped.
 * The grader, the label and the published reference are the source's own
 * words and are read exactly.
 */
function gradings(form: FormData) {
  return Array.from({ length: HADITH_LIMITS.gradings }, (_, index) => ({
    grader: optionalText(form, `grading-grader-${String(index)}`),
    label: optionalText(form, `grading-label-${String(index)}`),
    labelLanguage: value(form, `grading-language-${String(index)}`),
    reference: optionalText(form, `grading-reference-${String(index)}`),
  }))
    .filter(
      (row) =>
        row.grader !== null ||
        row.label !== null ||
        row.labelLanguage !== null ||
        row.reference !== null,
    )
    .map((row) => ({
      grader: row.grader ?? '',
      label: row.label ?? '',
      labelLanguage: row.labelLanguage ?? '',
      reference: row.reference ?? '',
    }));
}

/** Every sourced fact of one version of a record, as the form submitted it. */
function recordFacts(form: FormData) {
  return {
    sourceReference: textarea(form, 'sourceReference'),
    citationNumber: optionalWhole(form, 'citationNumber'),
    bookId: form.get('bookId'),
    chapterId: value(form, 'chapterId'),
    text: textarea(form, 'text'),
    textLanguage: form.get('textLanguage'),
    chain: optionalText(form, 'chain'),
    chainLanguage: value(form, 'chainLanguage'),
    gradings: gradings(form),
    evidence: form.get('evidence'),
  };
}

/* ===========================================================================
 * Canonical — structure, records, verification and citations
 * ========================================================================= */

/** Creates a collection. Its slug and position are fixed once created. */
export async function createHadithCollection(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = collectionCreateSchema.safeParse({
      slug: form.get('slug'),
      position: whole(form, 'position'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const created = await hadithRuntime().canonical.createCollection(
      gate.actor,
      parsed.data,
    );
    refresh(locale);
    destination = `/${locale}/admin/hadith/collections/${created.id}`;
  } catch (error) {
    return rejected(error, 'hadith-create-collection');
  }

  redirect(destination);
}

/** Creates a book for one registered edition, with its source reference and title. */
export async function createHadithBook(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = bookCreateSchema.safeParse({
      editionId: form.get('editionId'),
      slug: form.get('slug'),
      reference: textarea(form, 'reference'),
      position: whole(form, 'position'),
      title: optionalText(form, 'title'),
      titleLanguage: value(form, 'titleLanguage'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const created = await hadithRuntime().canonical.createBook(gate.actor, parsed.data);
    refresh(locale);
    destination = `/${locale}/admin/hadith/books/${created.id}`;
  } catch (error) {
    return rejected(error, 'hadith-create-book');
  }

  redirect(destination);
}

/** Creates a chapter within one book, with its source reference and title. */
export async function createHadithChapter(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = chapterCreateSchema.safeParse({
      bookId: form.get('bookId'),
      slug: form.get('slug'),
      reference: textarea(form, 'reference'),
      position: whole(form, 'position'),
      title: optionalText(form, 'title'),
      titleLanguage: value(form, 'titleLanguage'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const created = await hadithRuntime().canonical.createChapter(
      gate.actor,
      parsed.data,
    );
    refresh(locale);
    destination = `/${locale}/admin/hadith/chapters/${created.id}`;
  } catch (error) {
    return rejected(error, 'hadith-create-chapter');
  }

  redirect(destination);
}

/**
 * Creates one source-qualified record at version 1 with its gradings. Conflict
 * evidence against any disagreeing candidate for the same citation number is
 * recorded by the database, never decided here.
 */
export async function createHadithRecord(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = recordCreateSchema.safeParse({
      editionId: form.get('editionId'),
      ...recordFacts(form),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const created = await hadithRuntime().canonical.createRecord(gate.actor, parsed.data);
    refresh(locale);
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    destination = `/${locale}/admin/hadith/records/${created.id}`;
  } catch (error) {
    return rejected(error, 'hadith-create-record');
  }

  redirect(destination);
}

/**
 * Replaces every sourced fact of one record under its expected version, with
 * the evidence it was taken from and the reason for the change. The previous
 * version stays in the immutable history; verification of the new version is
 * a separate, later act.
 */
export async function correctHadithRecord(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = recordCorrectionSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      ...recordFacts(form),
      reason: form.get('reason'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    await hadithRuntime().canonical.correctRecord(gate.actor, parsed.data);
    refresh(locale);
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-correct-record');
  }
}

/** Records a human verification of the record's CURRENT version, with its evidence. */
export async function verifyHadithRecord(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = recordVerificationSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      evidence: form.get('evidence'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    await hadithRuntime().canonical.verifyRecord(gate.actor, parsed.data);
    refresh(locale);
    // Verification can make a citation public; the request is already durable.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-verify-record');
  }
}

/**
 * Maps a public citation to the record whose page submitted it, or withdraws
 * it. The record is named by the form, the collection and number are the
 * record's own declared citation, and the database refuses a candidate that
 * is unverified, conflicted or did not declare the number.
 */
export async function setHadithCitation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const parsed = citationSetSchema.safeParse({
      collectionId: form.get('collectionId'),
      number: whole(form, 'number'),
      hadithId: form.get('hadithId'),
      state: form.get('state'),
      expectedVersion: whole(form, 'version'),
      evidence: form.get('evidence'),
      reason: value(form, 'reason'),
    });
    if (!parsed.success) return INVALID;

    const gate = await privileged(locale);
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    await hadithRuntime().canonical.setCitation(gate.actor, parsed.data);
    refresh(locale);
    // Mapping or withdrawal changes what Search may show; the request is durable.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-set-citation');
  }
}

/* ===========================================================================
 * Display names and topics — presentation, never sourced facts
 * ========================================================================= */

/** Replaces one collection's display names. An empty name gives no name in that locale. */
export async function saveHadithCollectionNames(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = collectionNamesSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      names: HADITH_NAME_LOCALES.flatMap((language) => {
        const name = value(form, `name-${language}`);
        const description = value(form, `description-${language}`);
        return name === null && description === null
          ? []
          : [{ locale: language, name: name ?? '', description }];
      }),
    });
    if (!parsed.success) return INVALID;

    await hadithRuntime().hadith.saveCollectionNames(actor, parsed.data);
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-save-collection-names');
  }
}

/** Replaces one book's or chapter's display names. */
export async function saveHadithStructureNames(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const kind = z.enum(['book', 'chapter']).safeParse(form.get('kind'));
    const parsed = structureNamesSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      names: HADITH_NAME_LOCALES.flatMap((language) => {
        const name = value(form, `name-${language}`);
        return name === null ? [] : [{ locale: language, name }];
      }),
    });
    if (!kind.success || !parsed.success) return INVALID;

    const service = hadithRuntime().hadith;
    if (kind.data === 'book') await service.saveBookNames(actor, parsed.data);
    else await service.saveChapterNames(actor, parsed.data);
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-save-structure-names');
  }
}

/** Adds or removes one Topic on one record — one named change, never a list. */
export async function changeHadithTopic(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = z
      .strictObject({
        op: z.enum(['add', 'remove']),
        hadithId: hadithIdSchema,
        topicId: hadithIdSchema,
      })
      .safeParse({
        op: form.get('op'),
        hadithId: form.get('hadithId'),
        topicId: form.get('topicId'),
      });
    if (!parsed.success) return INVALID;

    const { op, hadithId, topicId } = parsed.data;
    const service = hadithRuntime().hadith;
    if (op === 'add') await service.addRecordTopic(actor, { hadithId, topicId });
    else await service.removeRecordTopic(actor, { hadithId, topicId });

    refresh(locale);
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-change-topic');
  }
}

/* ===========================================================================
 * Layered records — translations, commentary and sciences
 * ========================================================================= */

/** Creates a translation of one record, or edits one under its expected version. */
export async function saveHadithTranslation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = translationInputSchema.safeParse({
      languageCode: form.get('languageCode'),
      text: textarea(form, 'text'),
      attribution: value(form, 'attribution'),
      sourceSystemId: value(form, 'sourceSystemId'),
      contributors: contributors(form),
    });
    if (!parsed.success) return INVALID;

    const service = hadithRuntime().hadith;
    if (value(form, 'id') === null) {
      const hadithId = hadithIdSchema.safeParse(form.get('hadithId'));
      if (!hadithId.success) return INVALID;
      const created = await service.createTranslation(actor, {
        hadithId: hadithId.data,
        value: parsed.data,
      });
      destination = `/${locale}/admin/hadith/records/${hadithId.data}?translation=${created.id}#translation-editor`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateTranslation(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
    // A translation is part of the record's search projection.
    indexAfterResponse();
  } catch (error) {
    return rejected(error, 'hadith-save-translation');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

export async function saveHadithCommentary(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = commentaryInputSchema.safeParse({
      slug: form.get('slug'),
      name: form.get('name'),
      description: value(form, 'description'),
      attribution: value(form, 'attribution'),
      languageCode: form.get('languageCode'),
      sourceSystemId: value(form, 'sourceSystemId'),
      contributors: contributors(form),
    });
    if (!parsed.success) return INVALID;

    const service = hadithRuntime().hadith;
    if (value(form, 'id') === null) {
      const created = await service.createCommentary(actor, parsed.data);
      destination = `/${locale}/admin/hadith/commentary/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateCommentary(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'hadith-save-commentary');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

/**
 * Saves one commentary entry on one record, or removes it, under the
 * commentary's expected version. The entry's text is exact; removal is a
 * separate, named operation rather than an emptied field.
 */
export async function saveHadithCommentaryEntry(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const op = z.enum(['save', 'remove']).safeParse(form.get('op'));
    const target = versioned(form);
    if (!op.success || !target.success) return INVALID;
    const parsed = commentaryEntrySaveSchema.safeParse({
      hadithId: form.get('hadithId'),
      text: op.data === 'remove' ? null : textarea(form, 'text'),
    });
    if (!parsed.success) return INVALID;

    await hadithRuntime().hadith.saveCommentaryEntry(actor, {
      ...target.data,
      value: parsed.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-save-commentary-entry');
  }
}

/** How many per-language text rows a science form offers — the schema's own ceiling. */
const SCIENCE_TEXT_ROWS = 8;

export async function saveHadithScience(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    // A row with nothing in it is no text; a partly filled row is passed on so
    // the schema refuses it rather than the words being silently dropped.
    const texts = Array.from({ length: SCIENCE_TEXT_ROWS }, (_, index) => ({
      languageCode: value(form, `text-language-${String(index)}`),
      title: value(form, `text-title-${String(index)}`),
      body: textarea(form, `text-body-${String(index)}`) ?? '',
    }))
      .filter((row) => row.languageCode !== null || row.title !== null || row.body !== '')
      .map((row) => ({
        languageCode: row.languageCode ?? '',
        title: row.title ?? '',
        body: row.body,
      }));

    const parsed = scienceInputSchema.safeParse({
      slug: form.get('slug'),
      position: whole(form, 'position'),
      attribution: value(form, 'attribution'),
      sourceSystemId: value(form, 'sourceSystemId'),
      texts,
    });
    if (!parsed.success) return INVALID;

    const service = hadithRuntime().hadith;
    if (value(form, 'id') === null) {
      const created = await service.createScience(actor, parsed.data);
      destination = `/${locale}/admin/hadith/sciences/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateScience(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'hadith-save-science');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

/**
 * Moves one layered record to another state under its expected version. The
 * service decides whether publication is allowed — a registered source and
 * text to show. Whether a published record is PUBLIC is still the public
 * reader's rule: its record's citation must be public, and its source must
 * share the section's authority.
 */
export async function changeHadithState(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const kind = z
      .enum(['translation', 'commentary', 'science'])
      .safeParse(form.get('kind'));
    const target = versioned(form);
    const state = hadithLayerStateSchema.safeParse(form.get('state'));
    if (!kind.success || !target.success || !state.success) return INVALID;

    const input = { ...target.data, state: state.data };
    const service = hadithRuntime().hadith;
    switch (kind.data) {
      case 'translation':
        await service.setTranslationState(actor, input);
        break;
      case 'commentary':
        await service.setCommentaryState(actor, input);
        break;
      case 'science':
        await service.setScienceState(actor, input);
        break;
    }

    refresh(locale);
    // Publication changes what Search may show; the request is already durable.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'hadith-change-state');
  }
}
