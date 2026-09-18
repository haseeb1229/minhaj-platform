import type { TaxonomyActor } from '../../apps/web/src/contexts/taxonomy/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * The Taxonomy service, wired to REAL adapters over a disposable database.
 *
 * Nothing is substituted. Taxonomy has no provider, no secret and no outbound
 * anything — which is itself part of what the suites prove — so the runtime
 * under test is exactly the code a deployment runs: the real Prisma-backed
 * adapter, the real triggers, the real constraints.
 *
 * Composition happens here rather than in `apps/web/src/composition/taxonomy.ts`
 * because that module holds a per-process singleton, and a suite that needs a
 * fresh disposable database per file cannot use one.
 *
 * DYNAMIC IMPORTS, for the same reason the Identity harness uses them:
 * `getDatabaseClient()` binds to `DATABASE_URL` at first use, and the shared
 * harness repoints that variable when it creates the disposable database. A
 * static import would bind the client to whatever was configured when the
 * module graph loaded.
 */

export interface TaxonomyHarness {
  readonly taxonomy: Awaited<ReturnType<typeof buildTaxonomy>>['taxonomy'];
  /** The persistence port, for proofs that need to act without the service. */
  readonly store: Awaited<ReturnType<typeof buildTaxonomy>>['store'];
  readonly reader: Awaited<ReturnType<typeof buildTaxonomy>>['reader'];
}

async function buildTaxonomy() {
  const { createTaxonomyPersistence, createTaxonomyReader } =
    await import('../../packages/database/src/adapters/taxonomy/index.ts');
  const { createTaxonomyService } =
    await import('../../apps/web/src/contexts/taxonomy/index.ts');

  const reader = createTaxonomyReader();
  const store = createTaxonomyPersistence();

  return {
    reader,
    store,
    taxonomy: createTaxonomyService({ reader, taxonomy: store }),
  };
}

export async function createTaxonomyHarness(): Promise<TaxonomyHarness> {
  return buildTaxonomy();
}

/**
 * A synthetic administrator, for the audit attribution these operations carry.
 *
 * NOT A CAPABILITY, and it matters that it is not: Taxonomy mutations are
 * guarded at the Layer-4 gate, and `TaxonomyActor` is what the audit row needs
 * afterwards. The authorisation suite proves the gate; these suites prove what
 * happens once it has been passed.
 */
export const PROOF_ACTOR: TaxonomyActor = {
  accountId: '00000000-0000-4000-8000-00000000ffff',
  permission: 'taxonomy.administer',
};

let sequence = 0;

/** A fresh, unmistakably synthetic slug per call. */
export function freshSlug(prefix = 'proof'): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now().toString(36)}`;
}

/** Audit rows written for one target, newest first. */
export async function auditFor(
  admin: SqlSession,
  targetId: string,
): Promise<readonly { action: string; authorisingSource: string | null }[]> {
  return admin.query<{ action: string; authorisingSource: string | null }>(`
    SELECT [action], [authorisingSource] FROM [dbo].[AuditLog]
    WHERE [targetId] = N'${targetId}' ORDER BY [occurredAt] DESC;
  `);
}

/** How many topics currently exist with one slug. Duplicates are the defect. */
export async function topicCount(admin: SqlSession, slug: string): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Topic] WHERE [slug] = N'${slug}';`,
  );
  return Number(row?.total ?? 0);
}
