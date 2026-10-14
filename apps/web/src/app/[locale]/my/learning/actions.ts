'use server';

import { redirect } from 'next/navigation';

import { learningIdSchema, learningSlugSchema } from '@minhaj/contracts/learning';

import {
  DONE,
  UNCONFIRMED,
  personalGate,
  refreshMy,
} from '@/components/personal/action-support';
import { learningRejected } from '@/components/my-learning/action-support';
import { learningRuntime } from '@/composition/learning';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * A person's own Learning acts from `/my/learning` (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 22).
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, under the framework's Origin checks and unreachable by GET.
 * Each resolves the session itself and acts as that account only; no form
 * field names an account, and the Learning adapter puts the account in every
 * predicate, so a Course or lesson identifier from somebody else's page
 * reaches only the caller's own rows.
 *
 * PROGRESS IS RECORDED ONLY HERE, BY AN EXPLICIT POST. Opening a lesson
 * records nothing; "Mark lesson complete" does.
 *
 * NO MASS ASSIGNMENT. Each action reads the identifiers it names and nothing
 * else, and the service parses each against the contract.
 */

/** One identifier field, as typed; the service validates its shape. */
function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Marks one lesson complete. Idempotent; nothing un-completes it.
 *
 * It then reopens the SAME lesson, now marked complete, rather than letting the
 * page move on by itself. The address is built here from a slug and a lesson
 * identifier that each pass their strict grammar — never a path the form
 * supplies — so it cannot be turned into a redirect anywhere else.
 */
export async function completeLessonAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const lessonId = field(form, 'lessonId');
  try {
    await learningRuntime().learner.completeLesson(
      gate.actor,
      field(form, 'courseId'),
      lessonId,
    );
  } catch (error) {
    return learningRejected(error, 'learning-complete-lesson');
  }
  refreshMy(gate.locale);
  const slug = learningSlugSchema.safeParse(form.get('slug'));
  const lesson = learningIdSchema.safeParse(lessonId);
  if (!slug.success || !lesson.success) return DONE;
  redirect(`/${gate.locale}/my/learning/courses/${slug.data}?lesson=${lesson.data}`);
}

/**
 * Leaves a Course — which removes the person's progress on it — after an
 * explicit confirmation, and returns to My Learning.
 */
export async function leaveCourseAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().learner.leave(gate.actor, field(form, 'courseId'));
  } catch (error) {
    return learningRejected(error, 'learning-leave');
  }
  refreshMy(gate.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${gate.locale}/my/learning`);
}

/** Withdraws the person's own trial-class request. Idempotent. */
export async function withdrawTrialAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().learner.withdrawTrial(gate.actor, field(form, 'courseId'));
  } catch (error) {
    return learningRejected(error, 'learning-withdraw-trial');
  }
  refreshMy(gate.locale);
  return DONE;
}
