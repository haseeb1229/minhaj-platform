import { readDonationQuery, type Query } from '@/components/donations/presentation';
import { requirePermittedAction } from '@/composition/authorization';
import { donationsRuntime } from '@/composition/donations';
import { appLogger } from '@/composition/logging';
import { donationsFailure } from '@/contexts/donations';

/**
 * `GET /api/admin/donations/export` — the filtered donation records as CSV,
 * for an operator holding `donations.read` (DELIVERY_PLAN.md Phase 27).
 *
 * A PRIVATE READ. It changes nothing, so it is a GET — but it is an audited
 * access to financial records, so a cross-site embed is refused by Fetch
 * Metadata before anything else, the session and `donations.read` are
 * re-resolved live (and the service checks the key again), and a refusal is
 * an empty 404 that confirms nothing.
 *
 * WHAT THE FILE HOLDS is the service's: a fixed column order, exact decimal
 * amounts, provider references reduced to their last six characters, the
 * donor only as `linked` or `anonymous`, and every cell neutralised against
 * spreadsheet formula injection. Bounded, newest first; the same filters as
 * the records screen, and a malformed filter is refused rather than dropped.
 *
 * Built in memory and sent: nothing is written to disk or any store, and the
 * answer is `private, no-store`, `noindex` and an attachment.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
});

function refused(status: number): Response {
  return new Response(null, { status, headers: HEADERS });
}

/** Fetch Metadata, where the browser sends it, must not name another site. */
function isPrivateRead(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site === null || site === 'same-origin' || site === 'none';
}

export async function GET(request: Request): Promise<Response> {
  if (!isPrivateRead(request)) return refused(403);

  // The locale is used only to build a sign-in redirect a PAGE would follow;
  // this is not a page, and a refusal here is an empty 404.
  const permitted = await requirePermittedAction('en', 'donations.read');
  if (permitted.state === 'denied') return refused(404);

  const search = new URL(request.url).searchParams;
  const query: Query = {};
  for (const name of ['state', 'campaign', 'environment', 'donor', 'attention'])
    query[name] = search.get(name) ?? undefined;
  const filters = readDonationQuery(query, 0);
  if (filters === null) return refused(400);

  try {
    const csv = await donationsRuntime().admin.exportCsv(
      { accountId: permitted.session.account.id },
      {
        state: filters.state,
        campaignId: filters.campaignId,
        environment: filters.environment,
        donor: filters.donor,
        attention: filters.attention,
      },
    );
    const date = new Date().toISOString().slice(0, 10);
    return new Response(csv, {
      status: 200,
      headers: {
        ...HEADERS,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="minhaj-donations-${date}.csv"`,
      },
    });
  } catch (error) {
    const failure = donationsFailure(error);
    if (failure === 'denied') return refused(404);
    if (failure === 'invalid') return refused(400);
    if (failure === 'rate-limited') return refused(429);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'donations-admin-export' },
        'Donations export failed.',
      );
    return refused(503);
  }
}
