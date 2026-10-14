import { learningIdSchema } from '@minhaj/contracts/learning';

import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { learningFailure } from '@/contexts/learning';
import { answer, failed, isPrivateRead, readActor } from '../../personal-transport';

/**
 * `GET /api/my/learning/state?course=<uuid>` — whether the signed-in person is
 * enrolled on ONE Course and whether they have requested a trial class on it,
 * read by the Learning island after the shared public Course page has rendered
 * (ARCHITECTURE.md §8.2; DELIVERY_PLAN.md Phase 22).
 *
 * READ-ONLY, so a GET; still private, `no-store` and unindexed, and a
 * cross-site embed is refused.
 *
 * SIGNED OUT IS AN ANSWER, NOT AN ERROR: `{ signedIn: false }`, so the island
 * can offer "sign in to enrol" and the page never breaks. Signed in, the state
 * is the session account's and nobody else's: the query names a Course, never
 * an account.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The Course the query names: exactly one `course`, an identifier, or `null`. */
function courseOf(query: URLSearchParams): string | null {
  const present = [...query.keys()];
  if (present.length !== 1 || present[0] !== 'course') return null;
  const parsed = learningIdSchema.safeParse(query.get('course'));
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const courseId = courseOf(new URL(request.url).searchParams);
  if (courseId === null) return failed('invalid');

  const resolved = await readActor('learning-course-state');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return answer(200, { signedIn: false });

  try {
    const state = await learningRuntime().learner.courseState(resolved.actor, courseId);
    return answer(200, {
      signedIn: true,
      state: { enrolled: state.enrolled, trialRequested: state.trialRequested },
    });
  } catch (error) {
    const failure = learningFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'learning-course-state' },
        'Learning state read failed.',
      );
    return failed(failure);
  }
}
