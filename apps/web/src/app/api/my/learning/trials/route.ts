import { learningRuntime } from '@/composition/learning';
import { learnerCourseBodySchema, learningFailure } from '@/contexts/learning';
import { answer, personalMutation } from '../../personal-transport';

/**
 * `POST /api/my/learning/trials` — `{ courseId }`: the signed-in person
 * REQUESTS a trial class on a live Course, from the island on its public page.
 *
 * A REQUEST AND NOTHING MORE. It enrols nobody, reserves no teacher, names no
 * time and books no class; it is accepted only on a published `live` Course
 * (anything else is `course-unavailable`) and is idempotent. Withdrawing is
 * offered on the person's own My Learning page.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    {
      operation: 'learning-trial-request',
      schema: learnerCourseBodySchema,
      failure: learningFailure,
    },
    async (actor, value) => {
      await learningRuntime().learner.requestTrial(actor, value.courseId);
      return answer(200, { ok: true });
    },
  );
}
