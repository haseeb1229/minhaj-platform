import { learningRuntime } from '@/composition/learning';
import { learnerCourseBodySchema, learningFailure } from '@/contexts/learning';
import { answer, personalMutation } from '../../personal-transport';

/**
 * `POST /api/my/learning/enrolments` — `{ courseId }`: the signed-in person
 * enrols on a Course, from the island on its public page.
 *
 * Enrolment is accepted only on a Course published NOW — anything else is
 * `course-unavailable` — and is idempotent: enrolling twice is one Enrolment.
 * It enrols; it requests no class and books nothing. Leaving, which removes
 * the person's progress, is offered only on their own My Learning page, behind
 * an explicit confirmation.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return personalMutation(
    request,
    {
      operation: 'learning-enrol',
      schema: learnerCourseBodySchema,
      failure: learningFailure,
    },
    async (actor, value) => {
      await learningRuntime().learner.enrol(actor, value.courseId);
      return answer(200, { ok: true });
    },
  );
}
