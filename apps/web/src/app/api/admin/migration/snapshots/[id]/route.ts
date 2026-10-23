import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { migrationRuntime } from '@/composition/migration';
import { migrationFailure } from '@/contexts/migration-provenance';

/**
 * `GET /api/admin/migration/snapshots/{id}` — one raw snapshot's bytes, as an
 * attachment, for an operator holding `migration.administer`
 * (DELIVERY_PLAN.md Phase 29; SECURITY_BASELINE.md §10.3).
 *
 * RAW EVIDENCE IS NEVER RENDERED. The bytes leave with exactly the headers
 * the context sets — `application/octet-stream`, `attachment`, `nosniff`, a
 * `sandbox; default-src 'none'` policy and `private, no-store` — so a browser
 * neither interprets, sniffs, scripts, frames nor caches them. The read is
 * audited by the service in the same transaction as the read itself.
 *
 * A PRIVATE READ that changes nothing, so a GET: a cross-site request is
 * refused by Fetch Metadata before anything else, the session and the key are
 * re-resolved live (and the service checks the key again), and EVERY refusal —
 * signed out, no key, malformed, unknown, disposed — is the same empty 404,
 * which confirms nothing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REFUSED_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
});

function refused(status = 404): Response {
  return new Response(null, { status, headers: REFUSED_HEADERS });
}

/** Fetch Metadata, where the browser sends it, must not name another site. */
function isPrivateRead(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly id: string }> },
): Promise<Response> {
  if (!isPrivateRead(request)) return refused();

  // The locale is used only to build a sign-in redirect a PAGE would follow;
  // this is not a page, and a refusal here is an empty 404.
  const permitted = await requirePermittedAction('en', 'migration.administer');
  if (permitted.state === 'denied') return refused();

  const { id } = await params;
  try {
    const download = await migrationRuntime().raw.download(
      { accountId: permitted.session.account.id },
      id,
    );
    // Exactly the context's headers — nothing added that could relax them.
    return new Response(Buffer.from(download.bytes), {
      status: 200,
      headers: { ...download.headers },
    });
  } catch (error) {
    const failure = migrationFailure(error);
    if (failure !== 'unavailable') return refused();
    appLogger().error(
      { operation: 'migration-admin-snapshot-download' },
      'Migration snapshot download failed.',
    );
    return refused(503);
  }
}
