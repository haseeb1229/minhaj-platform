import type { ContributorCapabilities } from '../../packages/contracts/src/identity/index.ts';
import { projectContributorCapabilities } from '../../packages/contracts/src/identity/index.ts';
import type { ContributorAccountPort } from '../../packages/contracts/src/people/index.ts';
import type { PeopleActor } from '../../apps/web/src/contexts/people-contributors/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * The People service, wired to REAL adapters over a disposable database.
 *
 * The PERSISTENCE side is never substituted. Almost everything Phase 5 promises
 * is a property of the database — slug uniqueness, one account per contributor,
 * one profile of each kind, the primary-locale translation that cannot be
 * removed, the name-variant bound — and a mock would prove the adapter calls the
 * methods it calls while proving nothing about whether SQL Server refuses what
 * this phase says it refuses.
 *
 * THE IDENTITY SIDE IS A CONTROLLED STUB, and that is a deliberate,
 * load-bearing choice rather than a convenience.
 *
 * The four capability projections derive from `teaching.perform`,
 * `question.receive`, `content.review` and `fatwa.publish`. None of those is in
 * the permission catalogue, none is seeded by any migration, and none is
 * grantable — they belong to Learning, Fatwa and Editorial, and OPEN_DECISIONS.md
 * §6.3 reserves who receives them to the organisation. Proving the MAPPING
 * against a real database would therefore have required seeding one of them
 * early, which is precisely the shortcut the Phase-5 contract forbids and which
 * `migrate-test.ts` asserts has not been taken.
 *
 * So the mapping is proved over a controlled permission set, using the SAME pure
 * projection the production path uses — `projectContributorCapabilities`, the
 * one Identity's authorisation service calls — and the LIVE half is proved
 * separately: `people.integration.test.ts` shows that a real closed account
 * projects false through the real service, and that no People mutation writes a
 * `RoleAssignment`.
 *
 * Composition happens here rather than in `apps/web/src/composition/people.ts`
 * because that module holds a per-process singleton, and a suite that needs a
 * fresh disposable database per file cannot use one.
 *
 * DYNAMIC IMPORTS, for the same reason the Identity and Taxonomy harnesses use
 * them: `getDatabaseClient()` binds to `DATABASE_URL` at first use, and the
 * shared harness repoints that variable when it creates the disposable database.
 * A static import would bind the client to whatever was configured when the
 * module graph loaded.
 */

/**
 * An Identity stand-in whose answers the test controls.
 *
 * It implements the same two-method port Layer 4 implements over Identity's real
 * services, so the People service under test cannot tell the difference — and
 * cannot reach anything wider, because the port is the whole of its access.
 */
export interface ControlledAccounts extends ContributorAccountPort {
  /** Sets the permissions one account currently holds. */
  grant(accountId: string, permissions: readonly string[]): void;
  /** Marks an account closed, as Identity would report it. */
  close(accountId: string): void;
  /** Closes it immediately after the next closed-account answer is captured. */
  closeAfterNextCheck(accountId: string): void;
  /** How many times the capability projection was asked. */
  readonly calls: () => number;
}

export function controlledAccounts(): ControlledAccounts {
  const permissions = new Map<string, readonly string[]>();
  const closed = new Set<string>();
  const closeAfterCheck = new Set<string>();
  let calls = 0;

  return {
    grant(accountId, granted) {
      permissions.set(accountId, granted);
    },

    close(accountId) {
      closed.add(accountId);
      // Identity's own closure revokes every assignment in the same
      // transaction, so a closed account holds nothing. Modelling that here is
      // what makes "projection false after closure" a genuine consequence
      // rather than a separately stubbed answer.
      permissions.set(accountId, []);
    },

    closeAfterNextCheck(accountId) {
      closeAfterCheck.add(accountId);
    },

    calls: () => calls,

    async capabilities(accountId): Promise<ContributorCapabilities> {
      calls += 1;
      // THE PRODUCTION PROJECTION, not a second implementation of it. What the
      // test controls is the permission SET; how a set becomes four booleans is
      // the shipped function.
      return projectContributorCapabilities(permissions.get(accountId) ?? []);
    },

    async closedAccounts(accountIds) {
      const answer = accountIds.filter((id) => closed.has(id));

      // Capture the answer first, then close: the first caller observes the
      // account as active and the next observes it as closed. This reproduces
      // closure committing between the service's pre-link and post-link reads.
      for (const accountId of accountIds) {
        if (!closeAfterCheck.delete(accountId)) continue;
        closed.add(accountId);
        permissions.set(accountId, []);
      }

      return answer;
    },
  };
}

export interface PeopleHarness {
  readonly people: Awaited<ReturnType<typeof buildPeople>>['people'];
  /** The persistence port, for proofs that need to act without the service. */
  readonly store: Awaited<ReturnType<typeof buildPeople>>['store'];
  readonly reader: Awaited<ReturnType<typeof buildPeople>>['reader'];
  readonly accounts: ControlledAccounts;
}

async function buildPeople(accounts: ControlledAccounts) {
  const { createPeoplePersistence, createPeopleReader } =
    await import('../../packages/database/src/adapters/people-contributors/index.ts');
  const { createPeopleService } =
    await import('../../apps/web/src/contexts/people-contributors/index.ts');

  const reader = createPeopleReader();
  const store = createPeoplePersistence();

  return {
    reader,
    store,
    people: createPeopleService({ reader, people: store, accounts }),
  };
}

export async function createPeopleHarness(): Promise<PeopleHarness> {
  const accounts = controlledAccounts();
  return { ...(await buildPeople(accounts)), accounts };
}

/**
 * A synthetic administrator, for the audit attribution these operations carry.
 *
 * NOT A CAPABILITY, and it matters that it is not: People mutations are guarded
 * at the Layer-4 gate, and `PeopleActor` is what the audit row needs afterwards.
 * The authorisation suite proves the gate; these suites prove what happens once
 * it has been passed.
 */
export const PROOF_ACTOR: PeopleActor = {
  accountId: '00000000-0000-4000-8000-0000000005ff',
  permission: 'people.administer',
};

let sequence = 0;

/** A fresh, unmistakably synthetic slug per call. */
export function freshSlug(prefix = 'proof-person'): string {
  sequence += 1;
  return `${prefix}-${sequence}-${Date.now().toString(36)}`;
}

/**
 * Creates a synthetic account row directly, for the link proofs.
 *
 * WRITTEN WITH THE MIGRATION PRINCIPAL, not through Identity. These suites are
 * about PEOPLE's behaviour around a foreign key; standing up Better Auth to
 * obtain a `User` id would make every People proof depend on the authentication
 * stack, and Identity's own suites already prove that stack.
 *
 * UNMISTAKABLY SYNTHETIC. The address is on the reserved `.invalid` TLD, which
 * can never resolve, and carries this run's identifier
 * (SECURITY_BASELINE.md §18.1).
 */
export async function createProofAccount(
  admin: SqlSession,
  status: 'active' | 'closed' | 'disabled' = 'active',
): Promise<string> {
  sequence += 1;
  const id = `proof-account-${sequence}-${Date.now().toString(36)}`;

  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled])
    VALUES
      (N'${id}', N'Proof Account', N'${id}@people-proof.invalid', 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', N'${status}', 0);
  `);

  return id;
}

/** Audit rows written for one target, newest first. */
export async function auditFor(
  admin: SqlSession,
  targetId: string,
): Promise<
  readonly {
    action: string;
    actorType: string;
    actorId: string | null;
    authorisingSource: string | null;
    afterState: string | null;
  }[]
> {
  return admin.query<{
    action: string;
    actorType: string;
    actorId: string | null;
    authorisingSource: string | null;
    afterState: string | null;
  }>(`
    SELECT [action], [actorType], [actorId], [authorisingSource], [afterState]
    FROM [dbo].[AuditLog]
    WHERE [targetId] = N'${targetId}' ORDER BY [occurredAt] DESC;
  `);
}

/** How many contributors currently exist with one slug. Duplicates are the defect. */
export async function personCount(admin: SqlSession, slug: string): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Person] WHERE [slug] = N'${slug}';`,
  );
  return Number(row?.total ?? 0);
}

/** How many contributors are linked to one account. More than one is the defect. */
export async function linkCount(admin: SqlSession, accountId: string): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[Person] WHERE [userId] = N'${accountId}';`,
  );
  return Number(row?.total ?? 0);
}

/** Every role assignment in the database. Phase 5 must never add one. */
export async function roleAssignmentCount(admin: SqlSession): Promise<number> {
  const [row] = await admin.query<{ total: number }>(
    `SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment];`,
  );
  return Number(row?.total ?? 0);
}
