'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { localeSchema } from '@minhaj/contracts';
import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_LIMITS,
  ayahCorrectionSchema,
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
  type VerificationReport,
} from '@minhaj/contracts/quran';

import {
  requirePermittedAction,
  requirePrivilegedActor,
} from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { quranRuntime } from '@/composition/quran';
import { indexAfterResponse } from '@/composition/search';
import { quranFailure } from '@/contexts/quran';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Quran administrative mutations (ROUTE_MAP.md §7: `/admin/quran/*`),
 * Phase 18.
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, carrying the framework's Origin and CSRF protections and
 * unreachable by GET — and every one RE-CHECKS AUTHORISATION SERVER-SIDE
 * against the principal's CURRENT permission set. The page that rendered the
 * form decided whether to show it, which is navigation, not a boundary (§3.4
 * rule 2). The Quran service then re-checks again, live, per call.
 *
 * TWO AUTHORITIES, AND THE SPLIT IS THE POINT.
 *
 *   - `quran.administer`, through `requirePermittedAction`, for the LAYERED
 *     works, Surah display names and Ayah topics. None of these can reach
 *     canonical Arabic: the persistence port behind them has no method that
 *     writes it.
 *   - `quran.editCanonical` with a step-up grant for `quran-canonical-edit`,
 *     through `requirePrivilegedActor`, for the ONE canonical operation this
 *     surface offers — correcting one Ayah to its registered source's text.
 *     There is no bulk edit and no corpus import here; acceptance of a corpus
 *     is an operator act on the host.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads and parses them
 * with the contract's strict schemas; a submitted `version` is an EXPECTED
 * version — compared, never trusted.
 *
 * TEXT IS NEVER TRIMMED OR NORMALISED. Religious and layered texts are read
 * from their textarea exactly as submitted, with ONE transport decoding: the
 * HTML form encoding sends every textarea line break as CRLF, so CRLF is turned
 * back into the LF the textarea held. That is the inverse of the transport,
 * not a change to the text; surrounding whitespace is passed on as typed, and
 * the schema REFUSES it rather than repairing it (Phase 18 §14).
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `quranFailure` maps a thrown value onto
 * the refusal vocabulary; anything unrecognised is logged by operation name
 * only — never a text, a name or an identifier the operator typed (§19.2).
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = quranFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Quran administration mutation failed.');
  return { status: 'error', failure };
}

const INVALID: FormActionState = { status: 'error', failure: 'invalid' };
const DENIED: FormActionState = { status: 'error', failure: 'denied' };
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

/**
 * A textarea's text, transport-decoded and otherwise EXACTLY as typed.
 *
 * HTML form submission encodes each of a textarea's line breaks as CRLF; this
 * turns CRLF back into LF and does nothing else — no trim, no Unicode
 * normalisation, no character substitution.
 */
function textarea(form: FormData, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.replace(/\r\n/g, '\n') : null;
}

async function authorise(form: FormData) {
  const locale = localeSchema.parse(form.get('locale'));
  const permitted = await requirePermittedAction(locale, 'quran.administer');
  const actor: QuranActor | null =
    permitted.state === 'allowed' ? { accountId: permitted.session.account.id } : null;
  return { locale, actor };
}

/** Re-renders the Quran administration after a change it displays. */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin/quran`, 'layout');
}

/** The record being edited and the version the operator was looking at. */
function versioned(form: FormData) {
  return z
    .strictObject({ id: quranIdSchema, expectedVersion: quranVersionSchema })
    .safeParse({ id: form.get('id'), expectedVersion: whole(form, 'version') });
}

/**
 * The contributors a form names: a FIXED ceiling of rows, never a count the
 * browser supplies. An empty person row is no contributor; a person without a
 * role is passed on so the schema refuses it.
 */
function contributors(form: FormData) {
  return Array.from({ length: QURAN_LIMITS.contributors }, (_, index) => ({
    personId: value(form, `contributor-${String(index)}`),
    role: value(form, `role-${String(index)}`),
  }))
    .filter((row) => row.personId !== null)
    .map((row) => ({ personId: row.personId, role: row.role ?? '' }));
}

/** The metadata every Translation, Transliteration and Tafsir carries. */
function layerWork(form: FormData) {
  return {
    slug: form.get('slug'),
    name: form.get('name'),
    description: value(form, 'description'),
    attribution: value(form, 'attribution'),
    languageCode: form.get('languageCode'),
    sourceId: value(form, 'sourceId'),
  };
}

/* ===========================================================================
 * Surahs and Ayat — presentation and topics, never canonical text
 * ========================================================================= */

/** Replaces one Surah's localised display names. An empty field gives no name. */
export async function saveSurahNames(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const expectedVersion = quranVersionSchema.safeParse(whole(form, 'version'));
    const parsed = surahNamesInputSchema.safeParse({
      surah: whole(form, 'surah'),
      names: localeSchema.options.flatMap((language) => {
        const name = value(form, `name-${language}`);
        return name === null ? [] : [{ locale: language, name }];
      }),
    });
    if (!expectedVersion.success || !parsed.success) return INVALID;

    await quranRuntime().quran.saveSurahNames(actor, {
      expectedVersion: expectedVersion.data,
      value: parsed.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-save-surah-names');
  }
}

/** Adds or removes one Topic on one Ayah — one named change, never a list. */
export async function changeAyahTopic(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = z
      .strictObject({
        op: z.enum(['add', 'remove']),
        ref: quranRefSchema,
        topicId: quranIdSchema,
      })
      .safeParse({
        op: form.get('op'),
        ref: { surah: whole(form, 'surah'), ayah: whole(form, 'ayah') },
        topicId: form.get('topicId'),
      });
    if (!parsed.success) return INVALID;

    const { op, ref, topicId } = parsed.data;
    const service = quranRuntime().quran;
    if (op === 'add') await service.addAyahTopic(actor, { ref, topicId });
    else await service.removeAyahTopic(actor, { ref, topicId });

    refresh(locale);
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-change-ayah-topic');
  }
}

/* ===========================================================================
 * The canonical correction — the ONLY write path to Arabic on this surface
 * ========================================================================= */

/** A verification report as the screen may show it: positions, never text. */
export interface CorrectionReport {
  readonly checked: number;
  readonly mismatchCount: number;
  readonly mismatches: readonly {
    readonly reason: string;
    readonly surah: number | null;
    readonly ayah: number | null;
    readonly offset: number | null;
  }[];
}

export interface CorrectionState extends FormActionState {
  readonly report?: CorrectionReport;
}

/** Copies only the content-free facts of a report, bounded. */
function reportOf(report: VerificationReport): CorrectionReport {
  return {
    checked: report.checked,
    mismatchCount: report.mismatchCount,
    mismatches: report.mismatches
      .slice(0, QURAN_LIMITS.reportedMismatches)
      .map((mismatch) => ({
        reason: mismatch.reason,
        surah: mismatch.ref?.surah ?? null,
        ayah: mismatch.ref?.ayah ?? null,
        offset: mismatch.offset,
      })),
  };
}

/**
 * Corrects ONE Ayah to its registered source's text.
 *
 * HIGH CONSEQUENCE, so it costs everything SECURITY_BASELINE.md §5.1 and §8.1
 * name: `quran.editCanonical`, a complete privileged posture, and a live
 * step-up grant earned for exactly `quran-canonical-edit` — re-checked here,
 * re-verified by the canonical service through Identity, and re-checked again
 * by the database procedure that writes.
 *
 * THE APPROVAL BINDS TO WHAT WAS READ. The operator submits the exact text
 * they reviewed; it must equal the source's text character for character, or
 * the correction is refused with a content-free verification report that is
 * also recorded as immutable evidence. An explicit confirmation is required
 * before any of that is attempted.
 */
export async function correctAyah(
  _state: CorrectionState,
  form: FormData,
): Promise<CorrectionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on')
      return { status: 'error', failure: 'confirm-required' };

    const parsed = ayahCorrectionSchema.safeParse({
      surah: whole(form, 'surah'),
      ayah: whole(form, 'ayah'),
      expectedVersion: whole(form, 'version'),
      sourceId: form.get('sourceId'),
      reviewedText: textarea(form, 'reviewedText'),
      reason: form.get('reason'),
    });
    if (!parsed.success) return INVALID;

    const gate = await requirePrivilegedActor(
      locale,
      'quran.editCanonical',
      'quran-canonical-edit',
    );
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const outcome = await quranRuntime().canonical.correctAyah(gate.actor, parsed.data);
    // Either way something durable happened — a new revision, or a recorded
    // failed verification — and both are shown on these screens.
    refresh(locale);
    if (!outcome.ok) {
      return {
        status: 'error',
        failure: 'verification-failed',
        report: reportOf(outcome.report),
      };
    }

    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-correct-ayah');
  }
}

/* ===========================================================================
 * Layered works — Translation, Transliteration, Tafsir
 * ========================================================================= */

export async function saveTranslation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = translationInputSchema.safeParse({
      ...layerWork(form),
      contributors: contributors(form),
    });
    if (!parsed.success) return INVALID;

    const service = quranRuntime().quran;
    if (value(form, 'id') === null) {
      const created = await service.createTranslation(actor, { value: parsed.data });
      destination = `/${locale}/admin/quran/translations/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateTranslation(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'quran-save-translation');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

export async function saveTransliteration(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = transliterationInputSchema.safeParse({
      ...layerWork(form),
      scheme: value(form, 'scheme'),
    });
    if (!parsed.success) return INVALID;

    const service = quranRuntime().quran;
    if (value(form, 'id') === null) {
      const created = await service.createTransliteration(actor, { value: parsed.data });
      destination = `/${locale}/admin/quran/transliterations/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateTransliteration(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'quran-save-transliteration');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

export async function saveTafsir(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = tafsirInputSchema.safeParse({
      ...layerWork(form),
      contributors: contributors(form),
    });
    if (!parsed.success) return INVALID;

    const service = quranRuntime().quran;
    if (value(form, 'id') === null) {
      const created = await service.createTafsir(actor, { value: parsed.data });
      destination = `/${locale}/admin/quran/tafsir/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateTafsir(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'quran-save-tafsir');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

/**
 * Saves one Surah's page of a Translation's or Transliteration's texts.
 *
 * ONLY WHAT CHANGED IS SENT. The current texts are read back through the same
 * service and compared with what the form submitted; an ayah whose field is
 * unchanged is not part of the save, an emptied field removes that ayah's text,
 * and the save is refused when nothing changed. The read and the save are both
 * held to the expected version, so a concurrent edit is a conflict.
 *
 * NEVER CANONICAL. This writes layer texts only; the Ayah's Arabic is not on
 * this path and not in this form.
 */
export async function saveLayerTexts(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const kind = z.enum(['translation', 'transliteration']).safeParse(form.get('kind'));
    const target = versioned(form);
    const surah = surahNumberSchema.safeParse(whole(form, 'surah'));
    if (!kind.success || !target.success || !surah.success) return INVALID;

    const service = quranRuntime().quran;
    const current =
      kind.data === 'translation'
        ? await service.translationTexts(actor, target.data.id, surah.data)
        : await service.transliterationTexts(actor, target.data.id, surah.data);
    const existing = new Map(current.map((entry) => [entry.ayah, entry.text]));

    // A FIXED ceiling of fields, never a count the browser supplies.
    const changes: { ayah: number; text: string | null }[] = [];
    for (let ayah = 1; ayah <= QURAN_AYAH_NUMBER_MAX; ayah += 1) {
      const submitted = textarea(form, `text-${String(ayah)}`);
      if (submitted === null) continue;
      const before = existing.get(ayah) ?? null;
      if (submitted === '') {
        if (before !== null) changes.push({ ayah, text: null });
      } else if (submitted !== before) {
        changes.push({ ayah, text: submitted });
      }
    }
    if (changes.length === 0) return { status: 'error', failure: 'unchanged' };

    const parsed = layerTextSaveSchema.safeParse({ surah: surah.data, changes });
    if (!parsed.success) return INVALID;
    const save = {
      ...target.data,
      surah: parsed.data.surah,
      changes: parsed.data.changes as readonly LayerTextChange[],
    };

    if (kind.data === 'translation') await service.saveTranslationTexts(actor, save);
    else await service.saveTransliterationTexts(actor, save);

    refresh(locale);
    // Durable intent is already committed; this only indexes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-save-layer-texts');
  }
}

/** Adds a Tafsir entry over a same-Surah range, or replaces an existing one. */
export async function saveTafsirEntry(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const target = versioned(form);
    const entryId = quranIdSchema.nullable().safeParse(value(form, 'entryId'));
    const parsed = tafsirEntryInputSchema.safeParse({
      surah: whole(form, 'surah'),
      startAyah: whole(form, 'startAyah'),
      endAyah: whole(form, 'endAyah'),
      text: textarea(form, 'text'),
    });
    if (!target.success || !entryId.success || !parsed.success) return INVALID;

    await quranRuntime().quran.saveTafsirEntry(actor, {
      ...target.data,
      entryId: entryId.data,
      value: parsed.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-save-tafsir-entry');
  }
}

export async function removeTafsirEntry(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const target = versioned(form);
    const entryId = quranIdSchema.safeParse(form.get('entryId'));
    if (!target.success || !entryId.success) return INVALID;

    await quranRuntime().quran.removeTafsirEntry(actor, {
      ...target.data,
      entryId: entryId.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-remove-tafsir-entry');
  }
}

/* ===========================================================================
 * Recitation
 * ========================================================================= */

export async function saveRecitation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const parsed = recitationInputSchema.safeParse({
      slug: form.get('slug'),
      name: form.get('name'),
      reciterId: form.get('reciterId'),
      style: value(form, 'style'),
      attribution: value(form, 'attribution'),
      sourceId: value(form, 'sourceId'),
    });
    if (!parsed.success) return INVALID;

    const service = quranRuntime().quran;
    if (value(form, 'id') === null) {
      const created = await service.createRecitation(actor, { value: parsed.data });
      destination = `/${locale}/admin/quran/recitations/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateRecitation(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'quran-save-recitation');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

/** Adds one segment — a same-Surah range awaiting its audio. */
export async function addRecitationSegment(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const target = versioned(form);
    const parsed = recitationSegmentInputSchema.safeParse({
      surah: whole(form, 'surah'),
      startAyah: whole(form, 'startAyah'),
      endAyah: whole(form, 'endAyah'),
    });
    if (!target.success || !parsed.success) return INVALID;

    await quranRuntime().quran.addRecitationSegment(actor, {
      ...target.data,
      value: parsed.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-add-recitation-segment');
  }
}

export async function removeRecitationSegment(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const target = versioned(form);
    const segmentId = quranIdSchema.safeParse(form.get('segmentId'));
    if (!target.success || !segmentId.success) return INVALID;

    await quranRuntime().quran.removeRecitationSegment(actor, {
      ...target.data,
      segmentId: segmentId.data,
    });
    refresh(locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-remove-recitation-segment');
  }
}

/* ===========================================================================
 * Tajweed
 * ========================================================================= */

/** How many per-language text rows a Tajweed rule form offers — the schema's own ceiling. */
const TAJWEED_TEXT_ROWS = 8;

export async function saveTajweedRule(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string | null = null;

  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    // A row with nothing in it is no text; a partly filled row is passed on so
    // the schema refuses it rather than the words being silently dropped.
    const texts = Array.from({ length: TAJWEED_TEXT_ROWS }, (_, index) => ({
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

    const parsed = tajweedRuleInputSchema.safeParse({
      slug: form.get('slug'),
      position: whole(form, 'position'),
      attribution: value(form, 'attribution'),
      sourceId: value(form, 'sourceId'),
      texts,
    });
    if (!parsed.success) return INVALID;

    const service = quranRuntime().quran;
    if (value(form, 'id') === null) {
      const created = await service.createTajweedRule(actor, { value: parsed.data });
      destination = `/${locale}/admin/quran/tajweed/${created.id}`;
    } else {
      const target = versioned(form);
      if (!target.success) return INVALID;
      await service.updateTajweedRule(actor, { ...target.data, value: parsed.data });
    }
    refresh(locale);
  } catch (error) {
    return rejected(error, 'quran-save-tajweed-rule');
  }

  if (destination !== null) redirect(destination);
  return SAVED;
}

/* ===========================================================================
 * Lifecycle
 * ========================================================================= */

/**
 * Moves one layered work to another state under its expected version. The
 * service decides whether publication is allowed — a registered source, text
 * or audio to show, and never a fixture-sourced work beside an approved corpus.
 */
export async function changeQuranState(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const { locale, actor } = await authorise(form);
    if (actor === null) return DENIED;

    const kind = z
      .enum(['translation', 'transliteration', 'tafsir', 'recitation', 'tajweed'])
      .safeParse(form.get('kind'));
    const target = versioned(form);
    const state = quranLayerStateSchema.safeParse(form.get('state'));
    if (!kind.success || !target.success || !state.success) return INVALID;

    const input = { ...target.data, state: state.data };
    const service = quranRuntime().quran;
    switch (kind.data) {
      case 'translation':
        await service.setTranslationState(actor, input);
        break;
      case 'transliteration':
        await service.setTransliterationState(actor, input);
        break;
      case 'tafsir':
        await service.setTafsirState(actor, input);
        break;
      case 'recitation':
        await service.setRecitationState(actor, input);
        break;
      case 'tajweed':
        await service.setTajweedRuleState(actor, input);
        break;
    }

    refresh(locale);
    // Publication changes what Search may show; the request is already durable.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'quran-change-state');
  }
}
