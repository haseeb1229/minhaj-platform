import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from './harness.ts';
import { createIdentityHarness, type IdentityHarness } from './service.ts';
import {
  actorFor,
  createAccount,
  createAdministrator,
  type Administrator,
} from './privileged.ts';

/**
 * Phase 23 — the three questions Learning asks Identity, answered live.
 *
 * `liveAssignmentsCarrying` is the typed teaching scope's authority: the exact
 * RoleAssignment identifiers an account holds NOW for `teaching.perform`.
 * The proofs below make a real grant through the real privileged path and
 * show the answer appears with the grant, names the assignment the grant
 * created, and disappears on revocation, on role deactivation and on account
 * closure — without any of those touching a Learning table. `serviceRecipients`
 * and `participantNames` answer only for ACTIVE accounts and only what they
 * promise: an address and locale for the dispatcher, a name for a class list.
 */

describe.skipIf(!databaseConfigured)(
  'Phase 23 — Identity answers Learning live (SQL Server)',
  () => {
    let database: DisposableDatabase;
    let harness: IdentityHarness;
    let administrator: Administrator;

    beforeAll(async () => {
      database = await createProofDatabase();
      harness = await createIdentityHarness();
      administrator = await createAdministrator(
        harness,
        harness.provider,
        database.admin,
      );
    }, 240_000);

    afterAll(async () => {
      await database?.close();
    }, 60_000);

    async function teachingRole() {
      const actor = await actorFor(
        harness,
        administrator,
        'roles.administer',
        'privilege-administration',
      );
      const key = `proof-teaching-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const created = await harness.administration.createCustomRole(actor, {
        key,
        name: `Proof ${key}`,
        description: 'A synthetic teaching role created by the Phase-23 proofs.',
        permissions: ['teaching.perform'],
      });
      if (!created.ok) throw new Error(`Role creation refused: ${created.failure}`);
      return created.role;
    }

    async function grant(accountId: string, roleId: string) {
      const actor = await actorFor(
        harness,
        administrator,
        'permissions.grant',
        'privilege-administration',
      );
      const granted = await harness.administration.grantRole(actor, {
        accountId,
        roleId,
        reason: 'PROOF teaching grant',
      });
      if (!granted.ok) throw new Error(`Grant refused: ${granted.failure}`);
    }

    it('reports the exact live assignment carrying teaching.perform, and nothing after revocation', async () => {
      const teacher = await createAccount(harness, harness.provider, 'teacher');
      const role = await teachingRole();
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'teaching.perform',
        ),
      ).toEqual([]);

      await grant(teacher.accountId, role.id);
      const live = await harness.administration.liveAssignmentsCarrying(
        teacher.accountId,
        'teaching.perform',
      );
      expect(live).toHaveLength(1);
      const assignments = await harness.administration.listAssignments({
        accountId: teacher.accountId,
        includeRevoked: false,
        limit: 10,
        offset: 0,
      });
      expect(assignments.items.map((entry) => entry.id)).toEqual(live);
      // A key the role does not carry is not reported, nor an unknown key.
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'learning.read',
        ),
      ).toEqual([]);
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'not.a.key',
        ),
      ).toEqual([]);

      const actor = await actorFor(
        harness,
        administrator,
        'permissions.grant',
        'privilege-administration',
      );
      const revoked = await harness.administration.revokeRole(actor, {
        assignmentId: live[0]!,
        reason: 'PROOF revocation',
      });
      expect(revoked.ok).toBe(true);
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'teaching.perform',
        ),
      ).toEqual([]);
    });

    it('stops answering for a deactivated role and for an account that is not active', async () => {
      const teacher = await createAccount(harness, harness.provider, 'teacher');
      const role = await teachingRole();
      await grant(teacher.accountId, role.id);
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'teaching.perform',
        ),
      ).toHaveLength(1);

      await database.admin.query(
        `UPDATE [dbo].[User] SET [status] = N'suspended' WHERE [id] = N'${teacher.accountId}';`,
      );
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'teaching.perform',
        ),
      ).toEqual([]);
      expect(await harness.administration.serviceRecipients([teacher.accountId])).toEqual(
        [],
      );
      expect(await harness.administration.participantNames([teacher.accountId])).toEqual(
        [],
      );

      await database.admin.query(
        `UPDATE [dbo].[User] SET [status] = N'active' WHERE [id] = N'${teacher.accountId}';`,
      );
      const actor = await actorFor(
        harness,
        administrator,
        'roles.administer',
        'privilege-administration',
      );
      const deactivated = await harness.administration.deactivateCustomRole(actor, {
        roleId: role.id,
      });
      expect(deactivated.ok).toBe(true);
      expect(
        await harness.administration.liveAssignmentsCarrying(
          teacher.accountId,
          'teaching.perform',
        ),
      ).toEqual([]);
    });

    it('resolves recipients and names for active accounts only, and only those named', async () => {
      const one = await createAccount(harness, harness.provider, 'recipient');
      const two = await createAccount(harness, harness.provider, 'recipient');
      const recipients = await harness.administration.serviceRecipients([one.accountId]);
      expect(recipients).toEqual([
        { accountId: one.accountId, email: one.email, locale: 'en' },
      ]);
      expect(recipients.some((entry) => entry.accountId === two.accountId)).toBe(false);
      const names = await harness.administration.participantNames([
        one.accountId,
        two.accountId,
      ]);
      expect(names.map((entry) => entry.accountId).sort()).toEqual(
        [one.accountId, two.accountId].sort(),
      );
      for (const entry of names) {
        expect(Object.keys(entry).sort()).toEqual(['accountId', 'name']);
        expect(JSON.stringify(entry)).not.toContain('@');
      }
      expect(await harness.administration.serviceRecipients([])).toEqual([]);
      expect(await harness.administration.participantNames(['no-such-account'])).toEqual(
        [],
      );
    });
  },
);
