import { learningRuntime } from '@/composition/learning';
import { appLogger } from '@/composition/logging';
import { learningFailure } from '@/contexts/learning';
import {
  PRIVATE_HEADERS,
  failed,
  isPrivateRead,
  readActor,
} from '../../personal-transport';

/**
 * `GET /api/my/export/learning` — the person's own Learning data as a JSON
 * download (SECURITY_BASELINE.md §19.1: "user rights — view, export").
 *
 * LEARNING'S OWN EXPORT, BESIDE PERSONALISATION'S. Each owner exports what it
 * keeps; `/api/my/export` stays Personalisation's, so neither document claims
 * data the other context owns. This one carries the Enrolments, completed
 * lessons and trial-class requests, by typed identifier — never a Course's
 * words or a lesson's body.
 *
 * A GET because it changes nothing a person owns; the service spends a
 * per-account export budget, and a cross-site embed is refused so another site
 * cannot spend it. Built in memory and sent: nothing is written to disk or to
 * any store, the answer is private and `no-store`, and the document is the
 * service's own deterministic order, pretty-printed.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The UTC calendar date of the document, for its file name. */
function dateOf(generatedAt: string): string {
  const date = generatedAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
}

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return failed('denied');

  const resolved = await readActor('learning-export');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('no-session');

  try {
    const document = await learningRuntime().account.export(resolved.actor);
    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-learning-data-${dateOf(document.generatedAt)}.json"`,
      },
    });
  } catch (error) {
    const failure = learningFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'learning-export' }, 'Learning export failed.');
    return failed(failure);
  }
}
