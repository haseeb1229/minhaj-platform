import type { PersonalTarget, TargetState } from '@minhaj/contracts/personalisation';

/**
 * The island's side of `/api/my/*` — plain browser `fetch`, same origin, with
 * the session cookie the browser already holds and nothing else.
 *
 * NOTHING HERE IS TRUSTED BY THE SERVER, and nothing the server answers is
 * trusted here beyond its shape: an answer that is not one of the expected
 * forms is treated as `unavailable`, which renders as a calm message or as
 * nothing at all — never as a broken page.
 */

/** The header every personal POST carries; the server refuses a POST without it. */
const INTENT_HEADER = 'x-minhaj-intent';
const INTENT_VALUE = 'personal';

export type PersonalRead =
  | { readonly state: 'signed-out' }
  | { readonly state: 'signed-in'; readonly value: TargetState }
  | { readonly state: 'failed' };

export type PersonalWrite =
  | { readonly ok: true; readonly version: number | null }
  | { readonly ok: false; readonly failure: string };

/** The query that names one target, exactly as the read handler parses it. */
function queryOf(target: PersonalTarget): string {
  const query = new URLSearchParams(
    target.kind === 'ayah'
      ? { kind: 'ayah', surah: String(target.surah), ayah: String(target.ayah) }
      : { kind: target.kind, id: target.id },
  );
  return query.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** A state answer with the fields the island renders, or `null`. */
function stateOf(value: unknown): TargetState | null {
  if (!isRecord(value)) return null;
  if (
    typeof value['bookmarked'] !== 'boolean' ||
    !Array.isArray(value['collections']) ||
    typeof value['quranPosition'] !== 'boolean' ||
    typeof value['quranProgressVersion'] !== 'number' ||
    typeof value['historyEnabled'] !== 'boolean'
  )
    return null;
  const note = value['note'];
  if (note !== null && !(isRecord(note) && typeof note['body'] === 'string')) return null;
  return value as unknown as TargetState;
}

/** The person's own state for one target, after the page has rendered. */
export async function readTargetState(
  target: PersonalTarget,
  signal: AbortSignal,
): Promise<PersonalRead> {
  try {
    const response = await fetch(`/api/my/target-state?${queryOf(target)}`, {
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
    const value = body['signedIn'] === true ? stateOf(body['state']) : null;
    return value === null ? { state: 'failed' } : { state: 'signed-in', value };
  } catch {
    return { state: 'failed' };
  }
}

/** One personal POST. A 204 is success with no version. */
export async function sendPersonal(
  path: 'bookmarks' | 'notes' | 'collection-items' | 'history' | 'quran-progress',
  body: Record<string, unknown>,
): Promise<PersonalWrite> {
  try {
    const response = await fetch(`/api/my/${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        [INTENT_HEADER]: INTENT_VALUE,
      },
      body: JSON.stringify(body),
    });
    if (response.status === 204) return { ok: true, version: null };
    const answer: unknown = await response.json().catch(() => null);
    if (!isRecord(answer)) return { ok: false, failure: 'unavailable' };
    if (answer['ok'] === true)
      return {
        ok: true,
        version: typeof answer['version'] === 'number' ? answer['version'] : null,
      };
    return {
      ok: false,
      failure: typeof answer['failure'] === 'string' ? answer['failure'] : 'unavailable',
    };
  } catch {
    return { ok: false, failure: 'unavailable' };
  }
}
