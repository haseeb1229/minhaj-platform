import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { MIGRATION_PUBLIC_IMAGE_TYPES } from '@/composition/migration-wiring';
import { migrationRuntime } from '@/composition/migration';
import { storageRuntime } from '@/composition/storage';
import { migrationFailure } from '@/contexts/migration-provenance';
import { toWebStream } from '@/app/assets/web-stream';

/**
 * `GET /api/admin/migration/assets/{provenanceId}` — R2. The ADMINISTRATIVE
 * PREVIEW of one acquisition's PUBLIC COPY, so the person deciding a run's
 * pictures sees each one before clearing it, without the browser contacting
 * any other host.
 *
 * WHAT IT SERVES, AND NOTHING ELSE. The metadata-stripped public copy Storage
 * made of an acquired image — never the acquired evidence bytes, never an
 * asset the acquisition does not name, never a PDF. Four conditions, all of
 * which must hold:
 *
 *   1. a LIVE `migration.administer` permission, re-read on this request —
 *      the key whose holders decide rights (SECURITY_BASELINE.md §3.4 rule 2);
 *   2. the acquisition exists and records a public copy: an arbitrary asset
 *      identifier is never accepted, so this is no general file reader;
 *   3. Migration's policy allows exactly that copy's Storage asset, and only
 *      as one of the public image types;
 *   4. Storage's own technical decision — clean custody, bytes present, the
 *      checksum matching.
 *
 * A PRIVATE READ that changes nothing, so a GET: a cross-site request is
 * refused by Fetch Metadata first, and EVERY refusal — signed out, no key,
 * malformed, unknown, no public copy, refused by Storage — is the same empty
 * 404. The response is the verified image type, `nosniff`, a sandboxing
 * policy, inline, and never stored by any cache.
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

/** Allows exactly one Storage asset, as a public image type; anything else is denied. */
function publicCopyPolicy(assetId: string): AssetAuthorizationPort {
  return {
    async decide(request) {
      return request.assetId === assetId &&
        MIGRATION_PUBLIC_IMAGE_TYPES.includes(request.mediaType)
        ? 'allow'
        : 'deny';
    },
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ readonly id: string }> },
): Promise<Response> {
  if (!isPrivateRead(request)) return refused();

  // The locale only builds a sign-in redirect a PAGE would follow; this is
  // not a page, and a refusal here is an empty 404.
  const permitted = await requirePermittedAction('en', 'migration.administer');
  if (permitted.state === 'denied') return refused();

  const { id } = await params;
  try {
    const acquisition = await migrationRuntime().read.asset(
      { accountId: permitted.session.account.id },
      id,
    );
    if (acquisition === null || acquisition.publicCopy === null) return refused();
    const storage = await storageRuntime();
    const copy = await storage.open(
      acquisition.publicCopy.assetId,
      publicCopyPolicy(acquisition.publicCopy.assetId),
    );
    if (copy === null) return refused();
    return new Response(toWebStream(copy.body), {
      status: 200,
      headers: {
        // The VERIFIED type, from the bytes — one of the public image types.
        'Content-Type': copy.mediaType,
        'Content-Length': String(copy.byteSize),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    const failure = migrationFailure(error);
    if (failure !== 'unavailable') return refused();
    appLogger().error(
      { operation: 'migration-admin-asset-preview' },
      'Migration asset preview failed.',
    );
    return refused(503);
  }
}
