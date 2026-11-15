import { learningSlugSchema } from '@minhaj/contracts/learning';

import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { learningFailure } from '@/contexts/learning';
import { answer, failed, isPrivateRead, readActor } from '../../personal-transport';

/**
 * `GET /api/my/learning/path-state?path=<slug>` — where the signed-in person
 * stands on ONE published LearningPath: for each of its published Courses,
 * whether they are enrolled and how many of its lessons they have completed —
 * read by the path island after the shared public path page has rendered
 * (Learn Part 2; ARCHITECTURE.md §8.2).
 *
 * AN EXISTING LEARNER READ, A NEW DOOR ONLY. The answer is Learning's own
 * `learner.path` — the very read `/my/learning/paths/{slug}` renders — derived
 * from the person's own Enrolments and Progress; there is no PathEnrolment and
 * nothing here writes. READ-ONLY, so a GET; still private, `no-store` and
 * unindexed, and a cross-site embed is refused.
 *
 * SIGNED OUT IS AN ANSWER, NOT AN ERROR: `{ signedIn: false }`. Signed in, the
 * standing is the session account's and nobody else's: the query names a path,
 * never an account. A path that is not published answers `{ path: null }`.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The path the query names: exactly one `path`, a well-formed slug, or `null`. */
function pathOf(query: URLSearchParams): string | null {
  const present = [...query.keys()];
  if (present.length !== 1 || present[0] !== 'path') return null;
  const parsed = learningSlugSchema.safeParse(query.get('path'));
  return parsed.success ? parsed.data : null;
}

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const slug = pathOf(new URL(request.url).searchParams);
  if (slug === null) return failed('invalid');

  const resolved = await readActor('learning-path-state');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return answer(200, { signedIn: false });

  try {
    const standing = await learningRuntime().learner.path(resolved.actor, slug);
    return answer(200, {
      signedIn: true,
      path:
        standing === null
          ? null
          : {
              courses: standing.courses.map((place) => ({
                courseId: place.course.id,
                enrolled: place.enrolled,
                completedLessons: place.completedLessons,
              })),
            },
    });
  } catch (error) {
    const failure = learningFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'learning-path-state' },
        'Learning path state read failed.',
      );
    return failed(failure);
  }
}
