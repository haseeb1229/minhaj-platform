import { ITEM_OUTCOMES } from '@minhaj/contracts/migration';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { migrationRuntime } from '@/composition/migration';
import { migrationFailure } from '@/contexts/migration-provenance';

/**
 * `GET /api/admin/migration/runs/{id}` — one import run's status as JSON, for
 * an operator holding `migration.read` (ROUTE_MAP.md §7 "import control and
 * status"; DELIVERY_PLAN.md Phase 29): its state, discovery, reconciliation
 * verdict and item counts by outcome. Identifiers, states and numbers only —
 * never a URL, a title, a payload or a body.
 *
 * A READ, so a GET, and the only verb: a run is started, resumed and
 * completed by the command line, and cancelled by a Server Action, never
 * here. A cross-site request is refused by Fetch Metadata first; the session
 * and the key are re-resolved live, and the service checks the key again.
 * Every refusal is the same empty 404.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex',
});

function refused(status = 404): Response {
  return new Response(null, { status, headers: HEADERS });
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

  const permitted = await requirePermittedAction('en', 'migration.read');
  if (permitted.state === 'denied') return refused();
  const actor = { accountId: permitted.session.account.id };

  const { id } = await params;
  try {
    const { read } = migrationRuntime();
    const run = await read.run(actor, id);
    if (run === null) return refused();
    const totals = await Promise.all(
      ITEM_OUTCOMES.map(
        async (outcome) =>
          [
            outcome,
            (await read.runItems(actor, { runId: run.id, outcome, offset: 0 })).total,
          ] as const,
      ),
    );
    const body = {
      id: run.id,
      sourceKey: run.sourceKey,
      state: run.state,
      discoveryComplete: run.discoveryComplete,
      reconciliation: run.reconciliation,
      startedAt: run.startedAt.toISOString(),
      endedAt: run.endedAt === null ? null : run.endedAt.toISOString(),
      reconciledAt: run.reconciledAt === null ? null : run.reconciledAt.toISOString(),
      version: run.version,
      counts: Object.fromEntries(totals),
    };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { ...HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (error) {
    const failure = migrationFailure(error);
    if (failure !== 'unavailable') return refused();
    appLogger().error(
      { operation: 'migration-admin-run-status' },
      'Migration run status failed.',
    );
    return refused(503);
  }
}
