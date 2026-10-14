'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';
import {
  FATWA_PERMISSIONS,
  FATWA_STEP_UP_PURPOSE,
  categoryCreateSchema,
  categoryUpdateSchema,
  fatwaWithdrawalSchema,
  questionAssignmentSchema,
  questionDeclineSchema,
  questionTriageSchema,
  revisionDecisionSchema,
  revisionDraftSchema,
  revisionReturnSchema,
  type FatwaActor,
} from '@minhaj/contracts/fatwa';
import type { PermissionKey } from '@minhaj/contracts/identity';

import {
  requirePermittedAction,
  requirePrivilegedActor,
} from '@/composition/authorization';
import { fatwaRuntime } from '@/composition/fatwa';
import { notifyAsker } from '@/composition/fatwa-notifications';
import { appLogger } from '@/composition/logging';
import { indexAfterResponse } from '@/composition/search';
import { fatwaFailure } from '@/contexts/fatwa';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Fatwa administrative mutations (ROUTE_MAP.md §7: `/admin/fatwa/*`),
 * Phase 20.
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, carrying the framework's Origin and CSRF protections and
 * unreachable by GET — and every one RE-CHECKS AUTHORISATION SERVER-SIDE
 * against the principal's CURRENT permission set before it reads a field. The
 * page that rendered the form decided whether to show it, which is navigation,
 * not a boundary (§3.4 rule 2). The workflow service then asks Identity again,
 * live, and the database procedure checks a fourth time.
 *
 * ONE KEY PER STAGE, AND NONE IMPLIES ANOTHER.
 *
 *   - `question.receive`, through `requirePermittedAction`: triage, assignment
 *     and declining.
 *   - `fatwa.answer`: saving a revision and sending it for review — and only
 *     for a question assigned to the actor now, which the procedure enforces.
 *   - `fatwa.publish`: returning a revision, and maintaining categories.
 *   - `fatwa.publish` WITH a live `fatwa-publication` step-up grant, through
 *     `requirePrivilegedActor`, for the two acts that change what the public
 *     sees: publication and withdrawal. Each also needs an explicit
 *     confirmation before it is attempted.
 *
 * NO MASS ASSIGNMENT. Each action names the fields it reads and parses them
 * with the contract's strict schemas; a submitted `version` is an EXPECTED
 * version — compared, never trusted.
 *
 * WRITTEN TEXT IS PASSED ON AS TYPED, with ONE transport decoding: the HTML form
 * encoding sends every textarea line break as CRLF, so CRLF is turned back into
 * the LF the textarea held. The contract keeps line breaks and trims the ends;
 * nothing here rewrites, redacts or anonymises a word.
 *
 * NO TEXT LEAVES THROUGH A SIDE DOOR. A question, ruling, note or reason never
 * goes into a URL, a log line or an error: a failure is mapped onto the fixed
 * refusal vocabulary, and an unrecognised one is logged by operation name only
 * (§19.2).
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

function rejected(error: unknown, operation: string): FormActionState {
  const failure = fatwaFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Fatwa administration mutation failed.');
  return { status: 'error', failure };
}

const INVALID: FormActionState = { status: 'error', failure: 'invalid' };
const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const SAVED: FormActionState = { status: 'success' };

/** A whole decimal number, or `NaN` — never a zero for a missing field. */
function whole(form: FormData, field: string): number {
  const raw = form.get(field);
  return typeof raw === 'string' && /^[0-9]{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
}

/** One label-like form value, trimmed, or `null` when absent or empty. */
function value(form: FormData, field: string): string | null {
  const raw = form.get(field);
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A textarea's text, transport-decoded and otherwise exactly as typed: the
 * form encoding's CRLF becomes the LF the textarea held, and nothing else
 * changes here.
 */
function textarea(form: FormData, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.replace(/\r\n/g, '\n') : null;
}

/** An optional textarea: an EMPTY field is no text. */
function optionalText(form: FormData, field: string): string | null {
  const text = textarea(form, field);
  return text === null || text === '' ? null : text;
}

/** The locale, then the live permission: who acts, or the gate's refusal word. */
async function permitted(
  form: FormData,
  permission: PermissionKey,
): Promise<
  | { readonly locale: string; readonly actor: FatwaActor }
  | { readonly locale: string; readonly failure: string }
> {
  const locale = localeSchema.parse(form.get('locale'));
  const gate = await requirePermittedAction(locale, permission);
  return gate.state === 'allowed'
    ? { locale, actor: { accountId: gate.session.account.id } }
    : { locale, failure: gate.reason };
}

/** Re-renders the Fatwa administration after a change it displays. */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/admin/fatwa`, 'layout');
}

/** A category's names: one optional field per interface locale. */
function categoryNames(form: FormData) {
  return localeSchema.options.flatMap((locale) => {
    const name = value(form, `name-${locale}`);
    return name === null ? [] : [{ locale, name }];
  });
}

/* ===========================================================================
 * Intake — `question.receive`
 * ========================================================================= */

/** Files a question under an active category (or moves it to another). */
export async function triageFatwaQuestion(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.receive);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = questionTriageSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      categoryId: form.get('categoryId'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.triage(gate.actor, parsed.data);
    refresh(gate.locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-triage');
  }
}

/** Assigns a question to a current `fatwa.answer` holder, or reassigns it. */
export async function assignFatwaQuestion(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.receive);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = questionAssignmentSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      assigneeId: value(form, 'assigneeId'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.assign(gate.actor, parsed.data);
    refresh(gate.locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-assign');
  }
}

/** Declines a question. It leaves intake, so the operator returns to the list. */
export async function declineFatwaQuestion(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    if (form.get('confirm') !== 'on') return UNCONFIRMED;
    const gate = await permitted(form, FATWA_PERMISSIONS.receive);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = questionDeclineSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
    });
    if (!parsed.success) return INVALID;

    const asker = await fatwaRuntime().workflow.decline(gate.actor, parsed.data);
    await notifyAsker(asker, 'question-declined');
    refresh(gate.locale);
    destination = `/${gate.locale}/admin/fatwa/questions`;
  } catch (error) {
    return rejected(error, 'fatwa-decline');
  }

  redirect(destination);
}

/* ===========================================================================
 * Drafting — `fatwa.answer`
 * ========================================================================= */

/**
 * Saves a NEW immutable revision of the ruling for a question assigned to the
 * actor. The public question is the answerer's own anonymised wording — a
 * separate field, stored exactly as typed. A correction of a published ruling
 * carries its public reason; a first draft carries none.
 */
export async function saveFatwaDraft(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.answer);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = revisionDraftSchema.safeParse({
      questionId: form.get('questionId'),
      expectedVersion: whole(form, 'version'),
      slug: value(form, 'slug'),
      title: form.get('title'),
      publicQuestion: textarea(form, 'publicQuestion'),
      ruling: textarea(form, 'ruling'),
      language: form.get('language'),
      categoryId: form.get('categoryId'),
      topicIds: form.getAll('topicIds'),
      correctionReason: optionalText(form, 'correctionReason'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.saveDraft(gate.actor, parsed.data);
    refresh(gate.locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-save-draft');
  }
}

/** Sends the exact pending revision to scholar review. */
export async function submitFatwaForReview(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.answer);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = revisionDecisionSchema.safeParse({
      fatwaId: form.get('fatwaId'),
      expectedVersion: whole(form, 'version'),
      revisionId: form.get('revisionId'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.submitForReview(gate.actor, parsed.data);
    refresh(gate.locale);
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-submit-for-review');
  }
}

/* ===========================================================================
 * Scholar review — `fatwa.publish`
 * ========================================================================= */

/**
 * Returns the revision under review to its answerer with a private note. The
 * ruling leaves the review queue, so the reviewer returns to it.
 */
export async function returnFatwaRevision(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.publish);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = revisionReturnSchema.safeParse({
      fatwaId: form.get('fatwaId'),
      expectedVersion: whole(form, 'version'),
      revisionId: form.get('revisionId'),
      note: textarea(form, 'note'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.returnForRevision(gate.actor, parsed.data);
    refresh(gate.locale);
    destination = `/${gate.locale}/admin/fatwa/review`;
  } catch (error) {
    return rejected(error, 'fatwa-return');
  }

  redirect(destination);
}

/**
 * THE publication: the exact revision under review becomes the public ruling —
 * a first publication and a correction alike. `fatwa.publish`, a complete
 * second-factor posture and a live `fatwa-publication` grant, re-verified by the
 * service and again by the procedure, which also refuses the revision's own
 * author and the asker.
 */
export async function publishFatwaRevision(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const gate = await requirePrivilegedActor(
      locale,
      FATWA_PERMISSIONS.publish,
      FATWA_STEP_UP_PURPOSE,
    );
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const parsed = revisionDecisionSchema.safeParse({
      fatwaId: form.get('fatwaId'),
      expectedVersion: whole(form, 'version'),
      revisionId: form.get('revisionId'),
    });
    if (!parsed.success) return INVALID;

    const asker = await fatwaRuntime().workflow.publish(gate.actor, parsed.data);
    await notifyAsker(asker, 'question-answered');
    refresh(locale);
    // The procedure already owes Search a pass; this only indexes it sooner.
    indexAfterResponse();
    destination = `/${locale}/admin/fatwa/published/${parsed.data.fatwaId}`;
  } catch (error) {
    return rejected(error, 'fatwa-publish');
  }

  redirect(destination);
}

/**
 * Withdraws a published ruling from public view, with a private reason. Its
 * history is kept and its address stays reserved. Same authority as
 * publication.
 */
export async function withdrawFatwa(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const locale = localeSchema.parse(form.get('locale'));
    if (form.get('confirm') !== 'on') return UNCONFIRMED;

    const gate = await requirePrivilegedActor(
      locale,
      FATWA_PERMISSIONS.publish,
      FATWA_STEP_UP_PURPOSE,
    );
    if (gate.state === 'denied') return { status: 'error', failure: gate.reason };

    const parsed = fatwaWithdrawalSchema.safeParse({
      fatwaId: form.get('fatwaId'),
      expectedVersion: whole(form, 'version'),
      reason: textarea(form, 'reason'),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.withdraw(gate.actor, parsed.data);
    refresh(locale);
    // The procedure already owes Search a pass; this only removes it sooner.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-withdraw');
  }
}

/* ===========================================================================
 * Categories — `fatwa.publish`
 * ========================================================================= */

/** Creates a category mapped onto one canonical Topic. Its slug is fixed from now on. */
export async function createFatwaCategory(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;

  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.publish);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = categoryCreateSchema.safeParse({
      slug: value(form, 'slug'),
      topicId: form.get('topicId'),
      position: whole(form, 'position'),
      names: categoryNames(form),
    });
    if (!parsed.success) return INVALID;

    const created = await fatwaRuntime().workflow.createCategory(gate.actor, parsed.data);
    refresh(gate.locale);
    // A category's topic is part of every ruling's search projection.
    indexAfterResponse();
    destination = `/${gate.locale}/admin/fatwa/categories/${created.id}`;
  } catch (error) {
    return rejected(error, 'fatwa-create-category');
  }

  redirect(destination);
}

/** Changes a category's topic, position, status and names under its expected version. */
export async function updateFatwaCategory(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const gate = await permitted(form, FATWA_PERMISSIONS.publish);
    if ('failure' in gate) return { status: 'error', failure: gate.failure };

    const parsed = categoryUpdateSchema.safeParse({
      id: form.get('id'),
      expectedVersion: whole(form, 'version'),
      topicId: form.get('topicId'),
      position: whole(form, 'position'),
      status: form.get('status'),
      names: categoryNames(form),
    });
    if (!parsed.success) return INVALID;

    await fatwaRuntime().workflow.updateCategory(gate.actor, parsed.data);
    refresh(gate.locale);
    // A category's topic is part of every ruling's search projection.
    indexAfterResponse();
    return SAVED;
  } catch (error) {
    return rejected(error, 'fatwa-update-category');
  }
}
