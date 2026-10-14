'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { requirePermittedAction } from '@/composition/authorization';
import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { indexAfterResponse } from '@/composition/search';
import { learningFailure } from '@/contexts/learning';
import type { FormActionState } from '../../(identity)/form-state';
import {
  courseFields,
  formInteger,
  formValue,
  lessonChange,
  moduleChange,
  pathChange,
  pathFields,
} from './forms';

/**
 * The Learning administrative mutations (ROUTE_MAP.md §7; DELIVERY_PLAN.md
 * Phase 22) — the catalogue of Courses, their syllabus, and LearningPaths.
 *
 * EVERY ONE RE-CHECKS AUTHORISATION SERVER-SIDE: `learning.administer` here,
 * against the principal's CURRENT permission set, and the Learning service
 * checks it again live. The page that rendered the form decided only whether
 * to show it (SECURITY_BASELINE.md §3.4 rule 2). Cataloguing a course grants
 * nothing, so it is not a step-up operation; being named as a Course's
 * teacher grants nothing either.
 *
 * NOTHING HERE REACHES A LEARNER. There is no action that reads or edits
 * anybody's Enrolment or Progress, and none that confirms, schedules or
 * assigns a trial class: those requests are counted, read-only.
 *
 * NAMED CHANGES UNDER AN EXPECTED VERSION. A syllabus or a path changes one
 * named change at a time — add, edit, remove, move — against the version the
 * operator was shown, so a stale page is a visible conflict, never a silent
 * reorder. NO MASS ASSIGNMENT: `./forms.ts` reads the fields each form names
 * and the service parses them strictly.
 *
 * FAILURES ARE LABELLED, NEVER ECHOED. `learningFailure` maps a thrown value
 * onto Learning's fixed vocabulary; an outage is logged by operation name and
 * nothing else (SECURITY_BASELINE.md §19.2).
 */

const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const DONE: FormActionState = { status: 'success' };

function rejected(error: unknown, operation: string): FormActionState {
  const failure = learningFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Learning mutation failed.');
  return { status: 'error', failure };
}

/** The locale, then the live permission: who acts, or `null` for a refusal. */
async function authorise(
  form: FormData,
): Promise<{ readonly locale: Locale; readonly accountId: string } | null> {
  const locale = localeSchema.parse(form.get('locale'));
  const permitted = await requirePermittedAction(locale, 'learning.administer');
  if (permitted.state === 'denied') return null;
  return { locale, accountId: permitted.session.account.id };
}

/** Re-renders the administration, and indexes catalogue words sooner. */
function refreshed(locale: Locale): void {
  revalidatePath(`/${locale}/admin/learning`, 'layout');
  // Durable intent is already committed; this only indexes it sooner.
  indexAfterResponse();
}

const DENIED: FormActionState = { status: 'error', failure: 'denied' };

/** An edit names a record and its expected version; a create names neither. */
function identity(form: FormData) {
  const id = formValue(form, 'id');
  return { id, version: id === null ? null : formInteger(form, 'version') };
}

/** A version an existing record's form always carries; absent is a refusal. */
function expected(form: FormData): number {
  return formInteger(form, 'version') ?? Number.NaN;
}

/* ===========================================================================
 * Courses
 * ========================================================================= */

export async function saveCourseAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    const { id, version } = identity(form);
    const saved = await learningRuntime().learning.saveCourse(
      { accountId: actor.accountId },
      id,
      version,
      courseFields(form),
    );
    destination = `/${actor.locale}/admin/learning/courses/${saved.id}`;
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-save-course');
  }
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(destination);
}

/** Publish, return to draft or archive — the service and adapter decide whether it may. */
export async function transitionCourseAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    await learningRuntime().learning.transitionCourse(
      { accountId: actor.accountId },
      formValue(form, 'id') ?? '',
      expected(form),
      formValue(form, 'state'),
    );
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-transition-course');
  }
  return DONE;
}

/** One named change to a draft Course's modules. Removing one is confirmed. */
export async function changeModuleAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const change = moduleChange(form);
  if (change === null) return { status: 'error', failure: 'invalid' };
  if (form.get('op') === 'remove' && form.get('confirm') !== 'on') return UNCONFIRMED;
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    await learningRuntime().learning.changeModule(
      { accountId: actor.accountId },
      formValue(form, 'courseId') ?? '',
      expected(form),
      change,
    );
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-change-module');
  }
  return DONE;
}

/** One named change to a draft Course's lessons. Removing one is confirmed. */
export async function changeLessonAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const change = lessonChange(form);
  if (change === null) return { status: 'error', failure: 'invalid' };
  if (form.get('op') === 'remove' && form.get('confirm') !== 'on') return UNCONFIRMED;
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    await learningRuntime().learning.changeLesson(
      { accountId: actor.accountId },
      formValue(form, 'courseId') ?? '',
      expected(form),
      change,
    );
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-change-lesson');
  }
  return DONE;
}

/* ===========================================================================
 * Learning paths
 * ========================================================================= */

export async function savePathAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  let destination: string;
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    const { id, version } = identity(form);
    const saved = await learningRuntime().learning.savePath(
      { accountId: actor.accountId },
      id,
      version,
      pathFields(form),
    );
    destination = `/${actor.locale}/admin/learning/paths/${saved.id}`;
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-save-path');
  }
  redirect(destination);
}

export async function transitionPathAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    await learningRuntime().learning.transitionPath(
      { accountId: actor.accountId },
      formValue(form, 'id') ?? '',
      expected(form),
      formValue(form, 'state'),
    );
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-transition-path');
  }
  return DONE;
}

/** Adds, removes or moves one Course of a path, under the version shown. */
export async function changePathAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const change = pathChange(form);
  if (change === null) return { status: 'error', failure: 'invalid' };
  try {
    const actor = await authorise(form);
    if (actor === null) return DENIED;
    await learningRuntime().learning.changePath(
      { accountId: actor.accountId },
      formValue(form, 'pathId') ?? '',
      expected(form),
      change,
    );
    refreshed(actor.locale);
  } catch (error) {
    return rejected(error, 'learning-change-path');
  }
  return DONE;
}
