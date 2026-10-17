import 'server-only';

import type { CourseListing } from '@minhaj/contracts/learning';
import type { MessagingSurface } from '@minhaj/contracts/messaging';
import {
  messagingFailure,
  type MessagingRefusalReason,
} from '@minhaj/server-core/messaging';

import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';

/**
 * The reads a Messaging page makes, each with its failure kept visible rather
 * than thrown (DELIVERY_PLAN.md Phase 24).
 *
 * A REFUSAL IS AN ANSWER, AN OUTAGE IS NOT. `messagingRead` returns the
 * service's own refusal category — `not-found` becomes the page's 404,
 * `ended` its ended state — and only an outage is logged, by operation name:
 * never an account, a conversation, a body or a file name
 * (SECURITY_BASELINE.md §19.2).
 *
 * NAMES AND COURSE TITLES ARE DECORATION, read separately. A conversation the
 * service just authorised is shown even when Identity cannot name its people
 * or Learning cannot title its Course just now: the page falls back to
 * "Teacher" or "Learner" in words and omits the Course line, rather than
 * failing a conversation the person may read.
 */

export type MessagingRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: MessagingRefusalReason | 'unavailable' };

export async function messagingRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<MessagingRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const failure = messagingFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation }, 'Messaging read failed.');
    return { ok: false, failure };
  }
}

/**
 * Display names for accounts the caller was JUST authorised to see in a
 * conversation it read — Identity's name and nothing else. Absent on failure.
 */
export async function participantNames(
  accountIds: readonly (string | null)[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(accountIds.filter((id): id is string => id !== null))];
  if (unique.length === 0) return new Map();
  try {
    return await messagingRuntime().names(unique);
  } catch {
    appLogger().error({ operation: 'messaging-names' }, 'Messaging names unavailable.');
    return new Map();
  }
}

/**
 * The Courses a surface's conversations may name, titled by Learning's own
 * read for that surface: a learner's teachers' Courses on `my`, the teacher's
 * current scopes on `teacher`. A Course outside it simply has no title line.
 */
export async function courseListings(
  surface: MessagingSurface,
  accountId: string,
): Promise<ReadonlyMap<string, CourseListing>> {
  const actor = { accountId };
  try {
    const courses =
      surface === 'my'
        ? (await learningRuntime().myClasses.teachers(actor)).flatMap(
            (teacher) => teacher.courses,
          )
        : (await learningRuntime().teaching.courses(actor)).map((entry) => entry.course);
    return new Map(courses.map((course) => [course.id, course]));
  } catch {
    appLogger().error(
      { operation: 'messaging-course-titles' },
      'Messaging course titles unavailable.',
    );
    return new Map();
  }
}
