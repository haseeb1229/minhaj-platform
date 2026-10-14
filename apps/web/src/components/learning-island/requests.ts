/**
 * The Learning island's side of `/api/my/learning/*` — plain browser `fetch`,
 * same origin, with the session cookie the browser already holds and nothing
 * else.
 *
 * NOTHING HERE IS TRUSTED BY THE SERVER, and nothing the server answers is
 * trusted here beyond its shape: an answer that is not one of the expected
 * forms is `failed`, which hides the island — never a broken page.
 */

/** The header every personal POST carries; the server refuses a POST without it. */
const INTENT_HEADER = 'x-minhaj-intent';
const INTENT_VALUE = 'personal';

/** The signed-in person's standing on one Course. */
export interface CourseStanding {
  readonly enrolled: boolean;
  readonly trialRequested: boolean;
}

export type LearningRead =
  | { readonly state: 'signed-out' }
  | { readonly state: 'signed-in'; readonly value: CourseStanding }
  | { readonly state: 'failed' };

export type LearningWrite =
  { readonly ok: true } | { readonly ok: false; readonly failure: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A standing with exactly the two answers the island renders, or `null`. */
function standingOf(value: unknown): CourseStanding | null {
  if (
    !isRecord(value) ||
    typeof value['enrolled'] !== 'boolean' ||
    typeof value['trialRequested'] !== 'boolean'
  )
    return null;
  return { enrolled: value['enrolled'], trialRequested: value['trialRequested'] };
}

/** The person's own standing on one Course, after the page has rendered. */
export async function readCourseStanding(
  courseId: string,
  signal: AbortSignal,
): Promise<LearningRead> {
  try {
    const query = new URLSearchParams({ course: courseId });
    const response = await fetch(`/api/my/learning/state?${query.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return { state: 'failed' };
    const body: unknown = await response.json();
    if (!isRecord(body)) return { state: 'failed' };
    if (body['signedIn'] === false) return { state: 'signed-out' };
    const value = body['signedIn'] === true ? standingOf(body['state']) : null;
    return value === null ? { state: 'failed' } : { state: 'signed-in', value };
  } catch {
    return { state: 'failed' };
  }
}

/** One Learning POST: enrol, or request a trial class. */
export async function sendLearning(
  path: 'enrolments' | 'trials',
  courseId: string,
): Promise<LearningWrite> {
  try {
    const response = await fetch(`/api/my/learning/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        [INTENT_HEADER]: INTENT_VALUE,
      },
      body: JSON.stringify({ courseId }),
    });
    const answer: unknown = await response.json().catch(() => null);
    if (!isRecord(answer)) return { ok: false, failure: 'unavailable' };
    if (answer['ok'] === true) return { ok: true };
    return {
      ok: false,
      failure: typeof answer['failure'] === 'string' ? answer['failure'] : 'unavailable',
    };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}
