import { appLogger } from '@/composition/logging';
import { personalisationRuntime } from '@/composition/personalisation';
import { personalFailure } from '@/contexts/personalisation-notifications';
import { PRIVATE_HEADERS, failed, isPrivateRead, readActor } from '../personal-transport';

/**
 * `GET /api/my/export` — the person's own Personalisation data as a JSON
 * download (SECURITY_BASELINE.md §19.1: "user rights — view, export").
 *
 * A GET because it changes nothing a person owns; the service spends a
 * per-account export budget, and a cross-site embed is refused so another site
 * cannot spend it. Typed target identities only — no content title or body —
 * and no newsletter, which is not the account's.
 *
 * BUILT IN MEMORY AND SENT. Nothing is written to disk or to any store, the
 * answer is private and `no-store`, and the document is deterministic: the
 * service's own order, pretty-printed.
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

  const resolved = await readActor('personal-export');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('no-session');

  try {
    const document = await personalisationRuntime().account.export(resolved.actor);
    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-personal-data-${dateOf(document.generatedAt)}.json"`,
      },
    });
  } catch (error) {
    const failure = personalFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'personal-export' }, 'Personal export failed.');
    return failed(failure);
  }
}
