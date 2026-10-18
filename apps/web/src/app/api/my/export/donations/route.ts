import { appLogger } from '@/composition/logging';
import { donationsRuntime } from '@/composition/donations';
import { donationsFailure } from '@/contexts/donations';
import {
  PRIVATE_HEADERS,
  failed,
  isPrivateRead,
  readActor,
} from '../../personal-transport';

/**
 * `GET /api/my/export/donations` — the person's own Donations data as a JSON
 * download (SECURITY_BASELINE.md §19.1: "user rights — view, export").
 *
 * DONATIONS' OWN EXPORT, BESIDE THE OTHER OWNERS'. Each owner exports what it
 * keeps, so no document claims data another context owns. This one carries
 * the donations the person gave while signed in — campaign by identifier,
 * currency, exact amount and refunded amount as decimal text, state,
 * environment and instants. No provider reference, status token, card or bank
 * detail exists to include, and a gift given anonymously is never in it.
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

  const resolved = await readActor('donations-export');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('no-session');

  try {
    const document = await donationsRuntime().owner.export(resolved.actor);
    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-donations-data-${dateOf(document.generatedAt)}.json"`,
      },
    });
  } catch (error) {
    const failure = donationsFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'donations-export' }, 'Donations export failed.');
    return failed(failure);
  }
}
