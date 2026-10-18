import { appLogger } from '@/composition/logging';
import { membershipRuntime } from '@/composition/membership';
import { membershipFailure } from '@/contexts/membership';
import {
  PRIVATE_HEADERS,
  failed,
  isPrivateRead,
  readActor,
} from '../../personal-transport';

/**
 * `GET /api/my/export/membership` — the person's own Membership data as a JSON
 * download (SECURITY_BASELINE.md §19.1: "user rights — view, export").
 *
 * MEMBERSHIP'S OWN EXPORT, BESIDE THE OTHER OWNERS'. Each owner exports what it
 * keeps, so no document claims data another context owns. This one carries
 * the person's applications and Memberships — their types by identifier, their
 * states, who withdrew or closed them and their instants. A type's words, an
 * operator and any other person are never in it.
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

  const resolved = await readActor('membership-export');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('no-session');

  try {
    const document = await membershipRuntime().applicant.export(resolved.actor);
    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-membership-data-${dateOf(document.generatedAt)}.json"`,
      },
    });
  } catch (error) {
    const failure = membershipFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'membership-export' }, 'Membership export failed.');
    return failed(failure);
  }
}
