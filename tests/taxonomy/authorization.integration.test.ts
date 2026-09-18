import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import { createIdentityHarness, type IdentityHarness } from '../identity/service.ts';
import {
  actorFor,
  createAccount,
  createAdministrator,
  sessionOf,
  signIn,
  type Administrator,
} from '../identity/privileged.ts';

/**
 * PHASE 3B — who may administer the taxonomy.
 *
 * WHAT THIS SUITE PROVES that the Taxonomy suites cannot. Those act as somebody
 * who has already passed the gate; this one proves the gate. Every assertion
 * below goes through the SAME authorisation service `requireAdminPage` and
 * `requirePermittedAction` call, with real accounts created through the real
 * sign-up and verification flows — because an account inserted directly would
 * skip exactly the state these proofs reason about.
 *
 * NEGATIVE FIRST, and deliberately: a permission model is only worth what it
 * REFUSES, and a suite that only demonstrated the happy path would pass just as
 * well against a system that permitted everything.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

describeLive('Phase 3B — taxonomy administration is permission-checked', () => {
  let database: DisposableDatabase;
  let admin: SqlSession;
  let harness: IdentityHarness;
  let administrator: Administrator;

  beforeAll(async () => {
    database = await createProofDatabase();
    admin = database.admin;
    harness = await createIdentityHarness();
    administrator = await createAdministrator(
      harness,
      harness.provider,
      admin,
      'taxonomy-admin',
    );
  }, 300_000);

  /** A verified, signed-in account with no authority at all. */
  async function plainAccount(prefix: string) {
    return createAccount(harness, harness.provider, prefix);
  }

  /**
   * Creates a custom role with one bundle and grants it to one account.
   *
   * Through the EXISTING Phase-2 role administration, which is itself part of
   * what these proofs are for: a permission a new phase appends has to be
   * grantable by the machinery that was already there, not by a path of its
   * own.
   *
   * The grant revokes the target's sessions — a privilege change always does —
   * so the account signs in again and the caller gets a live session back.
   */
  async function grantRoleWith(
    accountPrefix: string,
    key: string,
    permissions: readonly string[],
  ) {
    const account = await plainAccount(accountPrefix);

    const roleActor = await actorFor(
      harness,
      administrator,
      'roles.administer',
      'privilege-administration',
    );
    const role = await harness.administration.createCustomRole(roleActor, {
      key: `${key}-${Date.now()}`,
      name: `Proof role ${key}`,
      description: 'Created by the Phase-3B authorisation proofs.',
      permissions: [...permissions],
    });
    if (!role.ok) throw new Error(`Role creation failed: ${role.failure}`);

    const grantActor = await actorFor(
      harness,
      administrator,
      'permissions.grant',
      'privilege-administration',
    );
    const granted = await harness.administration.grantRole(grantActor, {
      accountId: account.accountId,
      roleId: role.role.id,
      reason: `PROOF ${key}`,
    });
    if (!granted.ok) throw new Error(`Grant failed: ${granted.failure}`);

    const resumed = await signIn(harness, account.email);
    return {
      account,
      roleId: role.role.id,
      session: await sessionOf(harness, resumed),
      invalidation: granted.invalidation,
    };
  }

  afterAll(async () => {
    await database?.close();
  });

  /* =====================================================================
   * The catalogue and the protected bundle
   * =================================================================== */

  describe('the permission vocabulary this phase added', () => {
    it('holds exactly the two Taxonomy keys, seeded by the migration', async () => {
      const catalogue = await harness.administration.catalogue();
      const taxonomy = catalogue
        .filter((entry) => entry.key.startsWith('taxonomy.'))
        .map((entry) => entry.key)
        .sort();

      expect(taxonomy).toEqual(['taxonomy.administer', 'taxonomy.read']);
      // Both describable by this build. A catalogue the interface cannot
      // explain is a catalogue nobody can administer.
      expect(
        catalogue
          .filter((entry) => entry.key.startsWith('taxonomy.'))
          .every((entry) => entry.known),
      ).toBe(true);
    });

    it('cannot be extended at runtime', async () => {
      // The database holds the rule: the runtime principal has SELECT on
      // `Permission` and nothing else, so "a permission cannot be created at
      // runtime" is enforced rather than remembered. The SURFACE carries the
      // same rule structurally — there is no operation to call.
      const store = harness.authorizationStore as unknown as Record<string, unknown>;

      for (const method of ['createPermission', 'deletePermission', 'setPermissions']) {
        expect(store[method]).toBeUndefined();
      }
    });

    it('gives the protected role the new keys through migration foundation data', async () => {
      const role = await harness.administration.findRole('platform-administrator');

      expect(role?.system).toBe(true);
      expect(role?.permissions).toContain('taxonomy.read');
      expect(role?.permissions).toContain('taxonomy.administer');

      // NOT through a runtime write. The protected bundle is immutable at
      // runtime, so the only path that could have put them there is the one
      // that did.
      const [rows] = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
        WHERE [action] = N'taxonomy.permissions.provisioned'
          AND [actorType] = N'migration';
      `);
      expect(Number(rows?.total)).toBe(1);
    });

    it('refuses a runtime attempt to re-bundle the protected role', async () => {
      const role = await harness.administration.findRole('platform-administrator');
      const actor = await actorFor(
        harness,
        administrator,
        'permissions.grant',
        'privilege-administration',
      );

      const attempt = await harness.administration.setRolePermissions(actor, {
        roleId: role?.id ?? '',
        permissions: ['taxonomy.read'],
      });

      expect(attempt.ok).toBe(false);
      expect(attempt.ok ? null : attempt.failure).toBe('protected-role');

      // And the bundle is unchanged.
      const after = await harness.administration.findRole('platform-administrator');
      expect(after?.permissions).toContain('taxonomy.administer');
    });
  });

  /* =====================================================================
   * Live authorisation for the taxonomy permissions
   * =================================================================== */

  describe('live authorisation', () => {
    it('DENIES an account that holds no role', async () => {
      const nobody = await plainAccount('taxonomy-nobody');
      const session = await sessionOf(harness, nobody);

      for (const permission of ['taxonomy.read', 'taxonomy.administer'] as const) {
        const decision = await harness.authorization.requirePermission(
          session,
          permission,
        );
        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : null).toBe(
          'no-permission',
        );
      }
    });

    it('DENIES a holder of an unrelated permission', async () => {
      // A custom role that grants something else entirely. Without this, a
      // "denied" result could mean the account had no authority at all rather
      // than that the two permissions are genuinely separate.
      const { session } = await grantRoleWith('taxonomy-unrelated', 'audit-only', [
        'audit.read',
      ]);

      expect(
        (await harness.authorization.requirePermission(session, 'audit.read')).state,
      ).toBe('allowed');
      expect(
        (await harness.authorization.requirePermission(session, 'taxonomy.read')).state,
      ).toBe('denied');
    });

    it('ALLOWS an account granted the Taxonomy permissions through a custom role', async () => {
      // The positive half, and the one that proves a newly appended permission
      // is genuinely grantable through the EXISTING Phase-2 role administration
      // rather than needing a path of its own.
      const { session, invalidation } = await grantRoleWith(
        'taxonomy-editor',
        'taxonomy-editor',
        ['taxonomy.read', 'taxonomy.administer'],
      );

      // A privilege change ends the affected account's sessions.
      expect(invalidation.accountsAffected).toBe(1);

      for (const permission of ['taxonomy.read', 'taxonomy.administer'] as const) {
        const decision = await harness.authorization.requirePermission(
          session,
          permission,
        );
        expect(decision.state).toBe('allowed');
      }
    });

    it('DENIES on the NEXT REQUEST once the role is deactivated', async () => {
      // Live authorisation, not a session copy. The account's session object is
      // untouched by the deactivation; what changes is what the database says,
      // and the permission set is computed from it on every call
      // (SECURITY_BASELINE.md §3.4 rule 5).
      const { session, roleId } = await grantRoleWith(
        'taxonomy-revoked',
        'taxonomy-temp',
        ['taxonomy.read'],
      );

      expect(
        (await harness.authorization.requirePermission(session, 'taxonomy.read')).state,
      ).toBe('allowed');

      const deactivating = await actorFor(
        harness,
        administrator,
        'roles.administer',
        'privilege-administration',
      );
      const deactivated = await harness.administration.deactivateCustomRole(
        deactivating,
        { roleId },
      );
      expect(deactivated.ok).toBe(true);

      // THE SAME SESSION OBJECT, asked again. No re-authentication, no new
      // request context — and the answer has changed.
      const decision = await harness.authorization.requirePermission(
        session,
        'taxonomy.read',
      );
      expect(decision.state).toBe('denied');
      expect(decision.state === 'denied' ? decision.reason : null).toBe('no-permission');
    });

    it('DENIES an account whose status is no longer active', async () => {
      // Enforced on EVERY authenticated request, not only at sign-in
      // (DOMAIN_MODEL.md §4.6). A suspended editor stops being an editor
      // immediately, whatever role they still hold.
      const { account, session } = await grantRoleWith(
        'taxonomy-suspended',
        'taxonomy-suspend',
        ['taxonomy.read', 'taxonomy.administer'],
      );

      expect(
        (await harness.authorization.requirePermission(session, 'taxonomy.read')).state,
      ).toBe('allowed');

      const suspending = await actorFor(
        harness,
        administrator,
        'users.administer',
        'account-administration',
      );
      const suspended = await harness.identity.setAccountStatus({
        accountId: account.accountId,
        status: 'suspended',
        actorId: suspending.accountId,
        actorType: 'user',
      });
      expect(suspended.ok).toBe(true);

      // THE ASSIGNMENT IS STILL THERE — it was not revoked, and the record of
      // who held what survives. What has gone is the authority, because the
      // permission set is computed from assignments on an ACTIVE account.
      const stillAssigned = await harness.authorizationStore.listAssignments({
        accountId: account.accountId,
        includeRevoked: false,
        limit: 10,
        offset: 0,
      });
      expect(stillAssigned.items.length).toBeGreaterThan(0);

      const effective = await effectivePermissionsOf(account.accountId);
      expect(effective).not.toContain('taxonomy.read');
      expect(effective).not.toContain('taxonomy.administer');
    });
  });

  /* =====================================================================
   * Step-up is deliberately not required
   * =================================================================== */

  describe('what taxonomy administration does NOT cost', () => {
    it('is not among the operations the security baseline gives a step-up scope', async () => {
      // SECURITY_BASELINE.md §8.1 names the operations that cost a step-up
      // grant; §8.2 says the requirement is "deliberately not universal". The
      // Phase-2 vocabulary is closed at three purposes, and none of them is
      // "editing the subject taxonomy" — so requiring one here would mean
      // stretching a scope past what it names.
      const { STEP_UP_PURPOSES } =
        await import('../../packages/contracts/src/identity/index.ts');

      expect([...STEP_UP_PURPOSES]).toEqual([
        'privilege-administration',
        'account-administration',
        'second-factor',
      ]);
    });

    it('permits a taxonomy read with no step-up grant and no second factor', async () => {
      // A Taxonomy editor is not an administrator, and requiring them to enrol
      // a second factor to look at a list of topics would be a cost with no
      // corresponding consequence.
      const { account, session } = await grantRoleWith(
        'taxonomy-plain',
        'taxonomy-plain',
        ['taxonomy.read', 'taxonomy.administer'],
      );

      const posture = await harness.privilegedSecurity.describe(account.accountId);
      expect(posture.complete).toBe(false);

      // Permitted anyway — which is the point.
      expect(
        (await harness.authorization.requirePermission(session, 'taxonomy.administer'))
          .state,
      ).toBe('allowed');

      // And the privileged gate, which is what the Identity surfaces use, still
      // refuses the same account for a privileged operation. The two gates are
      // genuinely different.
      const privileged = await harness.authorization.requirePrivilegedAction({
        session,
        permission: 'permissions.grant',
        stepUp: 'privilege-administration',
      });
      expect(privileged.state).toBe('denied');
    });
  });
});

/**
 * Every permission an account effectively holds, read through the SAME narrow
 * reader Layer 4 hands the authorisation service.
 *
 * Used where a proof needs the whole SET rather than one decision. Reading it
 * through the real port is what stops the assertion being about a different
 * computation from the one the platform performs.
 *
 * Imported dynamically for the reason the harness does: the Prisma client binds
 * to `DATABASE_URL` at first use, and the disposable database repoints it.
 */
async function effectivePermissionsOf(accountId: string): Promise<readonly string[]> {
  const { createAuthorizationReader } =
    await import('../../packages/database/src/adapters/identity-access/index.ts');
  return createAuthorizationReader().effectivePermissions(accountId);
}
