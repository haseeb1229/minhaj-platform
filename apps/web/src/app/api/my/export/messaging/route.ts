import { messagingFailure } from '@minhaj/server-core/messaging';

import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';
import {
  PRIVATE_HEADERS,
  failed,
  isPrivateRead,
  readActor,
} from '../../personal-transport';

/**
 * `GET /api/my/export/messaging` — the person's own Messaging data as a JSON
 * download (SECURITY_BASELINE.md §19.1: "user rights — view, export").
 *
 * MESSAGING'S OWN EXPORT, BESIDE PERSONALISATION'S AND LEARNING'S. Each owner
 * exports what it keeps, so no document claims data another context owns. This
 * one carries the person's participation, the messages THEY sent with their
 * text, their attachments' metadata (never bytes), their read positions, the
 * blocks they made and the reports they filed — by identifier. Another
 * person's messages are never in it, not even from a shared conversation.
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

  const resolved = await readActor('messaging-export');
  if ('refused' in resolved) return resolved.refused;
  if (resolved.actor === null) return failed('no-session');

  try {
    const document = await messagingRuntime().service.export(resolved.actor);
    return new Response(JSON.stringify(document, null, 2), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-messaging-data-${dateOf(document.generatedAt)}.json"`,
      },
    });
  } catch (error) {
    const failure = messagingFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation: 'messaging-export' }, 'Messaging export failed.');
    return failed(failure);
  }
}
