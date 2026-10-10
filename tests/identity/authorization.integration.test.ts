import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATFORM_ADMINISTRATOR_ROLE } from '../../packages/contracts/src/identity/index.ts';
import type { PrivilegedActor } from '../../packages/contracts/src/identity/index.ts';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from './harness.ts';
import {
  createIdentityHarness,
  sessionContext,
  type IdentityHarness,
} from './service.ts';
import {
  actorFor,
  createAccount,
  createAdministrator,
  enrolSecondFactor,
  grantCount,
  sessionCount,
  sessionOf,
  signIn,
  signInWithFactor,
  type Administrator,
} from './privileged.ts';

/**
 * PHASE 2 CHUNK 2 — authorisation, against real SQL Server.
 *
 * Every proof here runs through the delivered path: the real authorisation
 * service in `packages/server-core`, the real Identity administration service,
 * the real persistence adapter and the real database. Nothing is stubbed, so a
 * rule that holds here holds in the product.
 *
 * THE ADMINISTRATOR IS BUILT THE WAY ONE REALLY IS — the one-time bootstrap
 * procedure, then a second factor, then its recovery codes, then a step-up
 * grant. That chain is itself under test: if any link stopped being required,
 * these suites would still pass while the platform got weaker, so the negative
 * proofs below assert each link's absence separately.
 */

describe.skipIf(!databaseConfigured)(
  'Phase 2 Chunk 2 — authorisation (live SQL Server)',
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

    /** A custom role nobody else's test is editing. */
    async function makeRole(
      permissions: readonly string[],
      key = `proof-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    ) {
      const actor = await actorFor(
        harness,
        administrator,
        'roles.administer',
        'privilege-administration',
      );

      const created = await harness.administration.createCustomRole(actor, {
        key,
        name: `Proof ${key}`,
        description: 'A custom role created by the authorisation proofs.',
        permissions,
      });
      if (!created.ok) throw new Error(`Role creation refused: ${created.failure}`);

      return created.role;
    }

    async function grantAdministrator(prefix: string): Promise<Administrator> {
      const account = await createAccount(harness, harness.provider, prefix);
      const enrolment = await enrolSecondFactor(harness, account);
      const role = await harness.administration.findRole(PLATFORM_ADMINISTRATOR_ROLE);
      if (role === null) throw new Error('The protected administrator role is missing.');

      const actor = await actorFor(
        harness,
        administrator,
        'permissions.grant',
        'privilege-administration',
      );
      const granted = await harness.administration.grantRole(actor, {
        accountId: account.accountId,
        roleId: role.id,
        reason: 'PROOF final-administrator race participant',
      });
      if (!granted.ok) throw new Error('Administrator grant was refused.');

      return {
        ...(await signInWithFactor(harness, { ...account, ...enrolment })),
        ...enrolment,
      };
    }

    async function usableAdministratorCount(): Promise<number> {
      const [row] = await database.admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total
        FROM [dbo].[RoleAssignment] ra
        INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
        INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
        WHERE r.[key] = N'platform-administrator'
          AND r.[deactivatedAt] IS NULL
          AND ra.[revokedAt] IS NULL
          AND u.[status] = N'active'
          AND u.[emailVerified] = 1;
      `);
      return Number(row?.total ?? 0);
    }

    async function restoreBootstrapAdministrator(
      candidates: readonly Administrator[],
    ): Promise<void> {
      const account = await harness.administration.findAccount(administrator.accountId);
      if (account?.status !== 'active') {
        const restored = await harness.identity.setAccountStatus({
          accountId: administrator.accountId,
          status: 'active',
          actorId: null,
          actorType: 'system',
        });
        if (!restored.ok)
          throw new Error('Could not restore the bootstrap administrator.');
      }

      const refreshed = await signInWithFactor(harness, administrator);
      Object.assign(administrator, refreshed);
      const actor = await actorFor(
        harness,
        administrator,
        'permissions.grant',
        'privilege-administration',
      );

      for (const candidate of candidates) {
        const assignments = await harness.administration.listAssignments({
          accountId: candidate.accountId,
          includeRevoked: false,
          limit: 10,
          offset: 0,
        });
        const assignment = assignments.items.find(
          (entry) => entry.roleKey === PLATFORM_ADMINISTRATOR_ROLE,
        );
        if (assignment !== undefined) {
          const revoked = await harness.administration.revokeRole(actor, {
            assignmentId: assignment.id,
            reason: 'PROOF cleanup',
          });
          if (!revoked.ok) throw new Error('Could not clean up an administrator grant.');
        }
      }
    }

    async function administratorAssignment(accountId: string) {
      const assignments = await harness.administration.listAssignments({
        accountId,
        includeRevoked: false,
        limit: 10,
        offset: 0,
      });
      const assignment = assignments.items.find(
        (entry) => entry.roleKey === PLATFORM_ADMINISTRATOR_ROLE,
      );
      if (assignment === undefined) {
        throw new Error('The expected live administrator assignment is missing.');
      }
      return assignment;
    }

    /* ---- can() and requirePermission() ---------------------------------- */

    describe('live evaluation', () => {
      it('denies an authenticated account that holds no permission', async () => {
        const stranger = await createAccount(harness, harness.provider, 'stranger');
        const session = await sessionOf(harness, stranger);

        const evaluated = await harness.authorization.evaluate(session);
        expect([...evaluated.permissions]).toEqual([]);
        expect(evaluated.can('users.read')).toBe(false);

        const outcome = await harness.authorization.requirePermission(
          session,
          'users.read',
        );
        expect(outcome.state).toBe('denied');
        expect(outcome.state === 'denied' ? outcome.reason : '').toBe('no-permission');
      });

      it('allows the account the bootstrap provisioned', async () => {
        const session = await sessionOf(harness, administrator);

        const outcome = await harness.authorization.requirePermission(
          session,
          'permissions.grant',
        );
        expect(outcome.state).toBe('allowed');
        expect(
          outcome.state === 'allowed' ? outcome.authorization.can('audit.read') : false,
        ).toBe(true);
      });

      it('DEFAULT DENIES a permission this catalogue does not define', async () => {
        // The single enforcement path answers "no" to anything it was not told
        // to permit, rather than treating an unknown key as unconstrained
        // (SECURITY_BASELINE.md §3.4 rule 3).
        const session = await sessionOf(harness, administrator);
        const evaluated = await harness.authorization.evaluate(session);

        expect(evaluated.can('quran.editCanonical' as 'users.read')).toBe(false);
      });

      it('denies every non-active status, whatever the account may hold', async () => {
        const target = await createAccount(harness, harness.provider, 'suspendable');
        const before = await sessionOf(harness, target);

        for (const status of ['disabled', 'suspended'] as const) {
          await harness.identity.setAccountStatus({
            accountId: target.accountId,
            status,
            actorId: administrator.accountId,
            actorType: 'user',
          });

          const outcome = await harness.authorization.requirePermission(
            { ...before, account: { ...before.account, status } },
            'users.read',
          );
          expect(outcome.state).toBe('denied');
          expect(outcome.state === 'denied' ? outcome.reason : '').toBe(
            'account-inactive',
          );

          await harness.identity.setAccountStatus({
            accountId: target.accountId,
            status: 'active',
            actorId: administrator.accountId,
            actorType: 'user',
          });
        }
      });
    });

    /* ---- The permission catalogue --------------------------------------- */

    describe('the permission catalogue', () => {
      /**
       * The Phase-2 vocabulary, which is not this phase's to change.
       *
       * RETARGETED WHEN PHASE 3B ARRIVED, not deleted. The original assertion
       * read "exactly this, and nothing else", which was correct while one
       * phase owned the catalogue. What it was PROTECTING — that Phase 2's keys
       * are all still there and that nobody has quietly renamed one — is still
       * worth protecting, so it is stated separately from the part that
       * legitimately grows.
       */
      const PHASE_2_KEYS = [
        'assignments.read',
        'audit.read',
        'delivery.operate',
        'delivery.read',
        'integrations.read',
        'permissions.grant',
        'permissions.read',
        'roles.administer',
        'roles.read',
        'security.read',
        'users.administer',
        'users.read',
      ];

      /** The keys the Phase-3B migration appended, and the only ones. */
      const PHASE_3B_KEYS = ['taxonomy.administer', 'taxonomy.read'];

      /**
       * The key the Phase-4 migration appended, and the only one.
       *
       * READ ONLY BY DESIGN. There is no `navigation.administer`, because the
       * surface it opens has no mutation: the shell route registry is code, and
       * a write key with no action behind it would be grantable authority over
       * nothing.
       */
      const PHASE_4_KEYS = ['navigation.read'];

      /**
       * The keys the Phase-5 migration appended, and the only ones.
       *
       * TWO, NOT FIVE. ROUTE_MAP.md §7 gives People five administrative routes
       * — persons, authors, speakers, scholars, teachers — and they are five
       * VIEWS of one administrative concern with one owner, so they share one
       * read key and one administer key.
       */
      const PHASE_5_KEYS = ['people.administer', 'people.read'];
      const PHASE_6_KEYS = [
        'content.author',
        'content.publish',
        'content.read',
        'content.review',
        'correspondence.administer',
        'correspondence.read',
      ];
      const PHASE_8_KEYS = ['library.administer', 'library.read'];
      const PHASE_17_KEYS = ['search.operate', 'search.read'];
      const PHASE_10_KEYS = ['media.administer', 'media.read'];

      /**
       * The keys the Phase-16 migration appended, and the only ones: Global has
       * no review step, so no `global.publish`, and no key per level.
       */
      const PHASE_16_KEYS = ['global.administer', 'global.read'];

      /**
       * The four capability-projection sources, which MUST NOT be grantable.
       *
       * DOMAIN_MODEL.md §4.5 derives `canTeach`, `canReceiveQuestions`,
       * `canReviewContent` and `canIssueFatwa` from these codes, and Phase 5
       * consumes that projection — which made seeding one of them the obvious
       * shortcut for a projection test. They belong to Learning, Fatwa and
       * Editorial, none of which has shipped, and OPEN_DECISIONS.md §6.3
       * separately reserves who receives them to the organisation.
       */
      const UNSEEDED_CAPABILITY_KEYS = [
        'teaching.perform',
        'question.receive',
        'fatwa.answer',
        'fatwa.publish',
      ];

      it('is exactly what the delivered migrations seeded', async () => {
        const catalogue = await harness.administration.catalogue();
        const keys = catalogue.map((entry) => entry.key).sort();

        expect(keys).toEqual(
          [
            ...PHASE_2_KEYS,
            ...PHASE_3B_KEYS,
            ...PHASE_4_KEYS,
            ...PHASE_5_KEYS,
            ...PHASE_6_KEYS,
            ...PHASE_8_KEYS,
            ...PHASE_17_KEYS,
            ...PHASE_10_KEYS,
            ...PHASE_16_KEYS,
          ].sort(),
        );

        // AND NOT ONE CAPABILITY SOURCE, asserted against the live catalogue
        // rather than the migration text: a key seeded by any route at all
        // would be grantable authority over a context that has not shipped.
        for (const key of UNSEEDED_CAPABILITY_KEYS) {
          expect(keys, `${key} belongs to a later phase`).not.toContain(key);
        }

        // Every stored key is one this build can describe: a catalogue the
        // interface cannot explain is a catalogue nobody can administer.
        expect(catalogue.every((entry) => entry.known)).toBe(true);
      });

      it('still holds every Phase-2 key, unrenamed', async () => {
        const keys = (await harness.administration.catalogue()).map((entry) => entry.key);

        for (const key of PHASE_2_KEYS) {
          expect(keys, `${key} must still exist`).toContain(key);
        }
      });

      it('holds no vocabulary belonging to a context that has not shipped', async () => {
        const keys = (await harness.administration.catalogue()).map((entry) => entry.key);

        // Seeding one now would fix another context's language before that
        // context exists to have an opinion, and would leave grantable
        // authority over nothing. `taxonomy.` is absent from this list because
        // Taxonomy HAS shipped — which is the whole rule: a domain leaves it at
        // its owning phase and not before.
        for (const domain of [
          'quran.',
          'hadith.',
          'fatwa.',
          'learning.',
          'membership.',
          'donations.',
          'migration.',
          'teaching.',
          'editorial.',
          // Library shipped in Phase 8, Search in Phase 17, Media in Phase 10
          // and Global in Phase 16. Still absent: research and publication
          // keys, per-aggregate Media keys, audio and gallery vocabulary, and
          // per-level Global keys.
          'research.',
          'publication.',
          'video.',
          'playlist.',
          'audio.',
          'gallery.',
          'country.',
          'region.',
          'city.',
          'centre.',
          'messaging.',
        ]) {
          expect(keys.some((key) => key.startsWith(domain))).toBe(false);
        }
      });

      it('gives the protected role the appended Taxonomy keys, by migration', async () => {
        // The protected bundle is the whole catalogue, so an appended
        // permission widens what a live administrator may do. That extension is
        // migration-controlled: no runtime path can re-bundle a protected role,
        // and this proves the migration did it rather than some later write.
        const role = await harness.administration.findRole('platform-administrator');

        expect(role).not.toBeNull();
        expect(role?.system).toBe(true);
        for (const key of PHASE_3B_KEYS) {
          expect(role?.permissions, `${key} must be bundled`).toContain(key);
        }
      });

      it('offers no operation that could create or remove a permission', () => {
        // Structural, and deliberately so: the catalogue's immutability is a
        // property of the SURFACE as well as of the database grant. The
        // least-privilege proof (`db:test:operator`, `db:test:permissions`)
        // covers the database half.
        const store = harness.authorizationStore as unknown as Record<string, unknown>;

        for (const method of [
          'createPermission',
          'deletePermission',
          'updatePermission',
          'setPermissions',
        ]) {
          expect(store[method]).toBeUndefined();
        }
      });
    });

    /* ---- Protected system role ------------------------------------------ */

    describe('the protected system role', () => {
      it('exists as migration-controlled foundation data', async () => {
        const role = await harness.administration.findRole(PLATFORM_ADMINISTRATOR_ROLE);

        expect(role).not.toBeNull();
        expect(role?.system).toBe(true);
        expect(role?.deactivatedAt).toBeNull();
        expect(role?.activeAssignments).toBeGreaterThanOrEqual(1);
      });

      it('cannot be renamed, re-bundled or deactivated through administration', async () => {
        const role = await harness.administration.findRole(PLATFORM_ADMINISTRATOR_ROLE);
        expect(role).not.toBeNull();
        const roleId = role?.id ?? '';

        const roleActor = await actorFor(
          harness,
          administrator,
          'roles.administer',
          'privilege-administration',
        );
        const grantActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const renamed = await harness.administration.renameCustomRole(roleActor, {
          roleId,
          name: 'Renamed',
          description: 'Renamed',
        });
        expect(renamed.ok).toBe(false);
        expect(renamed.ok ? '' : renamed.failure).toBe('protected-role');

        const rebundled = await harness.administration.setRolePermissions(grantActor, {
          roleId,
          permissions: ['audit.read'],
        });
        expect(rebundled.ok).toBe(false);
        expect(rebundled.ok ? '' : rebundled.failure).toBe('protected-role');

        const deactivated = await harness.administration.deactivateCustomRole(roleActor, {
          roleId,
        });
        expect(deactivated.ok).toBe(false);
        expect(deactivated.ok ? '' : deactivated.failure).toBe('protected-role');

        // And nothing moved.
        const after = await harness.administration.findRole(PLATFORM_ADMINISTRATOR_ROLE);
        expect(after?.name).toBe(role?.name);
        expect(after?.permissions).toEqual(role?.permissions);
        expect(after?.deactivatedAt).toBeNull();
      });
    });

    /* ---- Custom role lifecycle ------------------------------------------ */

    describe('custom roles', () => {
      it('creates, renames and deactivates, retaining history', async () => {
        const role = await makeRole(['audit.read']);
        expect(role.system).toBe(false);
        expect(role.permissions).toEqual(['audit.read']);

        const actor = await actorFor(
          harness,
          administrator,
          'roles.administer',
          'privilege-administration',
        );

        const renamed = await harness.administration.renameCustomRole(actor, {
          roleId: role.id,
          name: 'Renamed proof role',
          description: 'Still the same role.',
        });
        expect(renamed.ok).toBe(true);

        const deactivated = await harness.administration.deactivateCustomRole(actor, {
          roleId: role.id,
        });
        expect(deactivated.ok).toBe(true);
        expect(deactivated.ok ? deactivated.role.deactivatedAt : null).not.toBeNull();

        // The row survives, and so does its key: a deactivated role is history,
        // not a hole where history used to be.
        const listed = await harness.administration.listRoles({
          includeDeactivated: true,
        });
        expect(listed.some((entry) => entry.id === role.id)).toBe(true);

        const live = await harness.administration.listRoles({
          includeDeactivated: false,
        });
        expect(live.some((entry) => entry.id === role.id)).toBe(false);
      });

      it('refuses a bundle naming a permission the catalogue does not define', async () => {
        const role = await makeRole([]);
        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const outcome = await harness.administration.setRolePermissions(actor, {
          roleId: role.id,
          permissions: ['quran.editCanonical'],
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.failure).toBe('unknown-permission');
      });

      it('adds and removes memberships with SET semantics', async () => {
        const role = await makeRole(['audit.read']);
        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const widened = await harness.administration.setRolePermissions(actor, {
          roleId: role.id,
          permissions: ['audit.read', 'users.read'],
        });
        expect(widened.ok).toBe(true);
        expect(widened.ok ? widened.before : []).toEqual(['audit.read']);
        expect(widened.ok ? widened.after : []).toEqual(['audit.read', 'users.read']);

        const narrowed = await harness.administration.setRolePermissions(actor, {
          roleId: role.id,
          permissions: ['users.read'],
        });
        expect(narrowed.ok ? narrowed.after : []).toEqual(['users.read']);

        const reread = await harness.administration.listRoles({
          includeDeactivated: true,
        });
        expect(reread.find((entry) => entry.id === role.id)?.permissions).toEqual([
          'users.read',
        ]);
      });

      it('cannot produce a duplicate membership under concurrency', async () => {
        const role = await makeRole([]);
        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        // The same bundle, twice, at once. The composite primary key makes a
        // duplicate impossible; the row lock makes the audit trail coherent.
        const outcomes = await Promise.allSettled([
          harness.administration.setRolePermissions(actor, {
            roleId: role.id,
            permissions: ['audit.read', 'users.read'],
          }),
          harness.administration.setRolePermissions(actor, {
            roleId: role.id,
            permissions: ['audit.read', 'users.read'],
          }),
        ]);

        expect(
          outcomes.filter((outcome) => outcome.status === 'fulfilled' && outcome.value.ok)
            .length,
        ).toBeGreaterThanOrEqual(1);

        const [row] = await database.admin.query<{ total: number }>(
          `SELECT COUNT_BIG(*) AS total FROM [dbo].[RolePermission]
           WHERE [roleId] = N'${role.id}';`,
        );
        expect(Number(row?.total ?? 0)).toBe(2);
      });
    });

    /* ---- Assignments ----------------------------------------------------- */

    describe('assignments', () => {
      it('grants, takes effect immediately, and revokes', async () => {
        const role = await makeRole(['audit.read']);
        const target = await createAccount(harness, harness.provider, 'grantee');

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const granted = await harness.administration.grantRole(actor, {
          accountId: target.accountId,
          roleId: role.id,
          reason: 'PROOF-2',
        });
        expect(granted.ok).toBe(true);
        expect(granted.ok ? granted.outcome : '').toBe('granted');

        // LIVE: the next request already sees it, without a new sign-in.
        const after = await signIn(harness, target.email);
        const session = await sessionOf(harness, after);
        expect((await harness.authorization.evaluate(session)).can('audit.read')).toBe(
          true,
        );

        const assignments = await harness.administration.listAssignments({
          accountId: target.accountId,
          includeRevoked: false,
          limit: 10,
          offset: 0,
        });
        expect(assignments.items).toHaveLength(1);
        const assignmentId = assignments.items[0]?.id ?? '';

        const revokeActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const revoked = await harness.administration.revokeRole(revokeActor, {
          assignmentId,
          reason: 'PROOF-3',
        });
        expect(revoked.ok).toBe(true);

        // The ROW is retained, marked revoked.
        const history = await harness.administration.listAssignments({
          accountId: target.accountId,
          includeRevoked: true,
          limit: 10,
          offset: 0,
        });
        expect(history.items).toHaveLength(1);
        expect(history.items[0]?.revokedAt).not.toBeNull();
        expect(history.items[0]?.revokedById).toBe(administrator.accountId);

        // And it grants nothing any more.
        const reSignedIn = await signIn(harness, target.email);
        const reread = await sessionOf(harness, reSignedIn);
        expect((await harness.authorization.evaluate(reread)).can('audit.read')).toBe(
          false,
        );
      });

      it('resolves concurrent grants of the same role to exactly one assignment', async () => {
        const role = await makeRole(['audit.read']);
        const target = await createAccount(harness, harness.provider, 'racer');

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const outcomes = await Promise.all([
          harness.administration.grantRole(actor, {
            accountId: target.accountId,
            roleId: role.id,
            reason: 'race A',
          }),
          harness.administration.grantRole(actor, {
            accountId: target.accountId,
            roleId: role.id,
            reason: 'race B',
          }),
        ]);

        const granted = outcomes.filter(
          (outcome) => outcome.ok && outcome.outcome === 'granted',
        );
        const held = outcomes.filter(
          (outcome) => outcome.ok && outcome.outcome === 'already-held',
        );

        expect(granted).toHaveLength(1);
        expect(held).toHaveLength(1);

        const [row] = await database.admin.query<{ total: number }>(
          `SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment]
           WHERE [userId] = N'${target.accountId}' AND [revokedAt] IS NULL;`,
        );
        expect(Number(row?.total ?? 0)).toBe(1);
      });

      it('refuses self-elevation, whatever the role', async () => {
        const role = await makeRole(['audit.read']);
        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const outcome = await harness.administration.grantRole(actor, {
          accountId: administrator.accountId,
          roleId: role.id,
          reason: 'self',
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.failure).toBe('self-elevation');
      });

      it('refuses a forged privileged actor at runtime', async () => {
        const forged = {
          authorisation: 'verified',
          accountId: administrator.accountId,
          sessionId: administrator.sessionId,
          permission: 'roles.administer',
          stepUp: 'privilege-administration',
          stepUpGrantId: 'forged-step-up-grant',
        } as PrivilegedActor;

        const outcome = await harness.administration.createCustomRole(forged, {
          key: 'forged-actor-proof',
          name: 'Forged actor proof',
          description: 'This role must never be created.',
          permissions: ['audit.read'],
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.failure).toBe('unavailable');
        expect(await harness.administration.findRole('forged-actor-proof')).toBeNull();
      });

      it('refuses to revoke the last Platform Administrator', async () => {
        const assignments = await harness.administration.listAssignments({
          accountId: administrator.accountId,
          includeRevoked: false,
          limit: 10,
          offset: 0,
        });
        const administrable = assignments.items.find(
          (entry) => entry.roleKey === PLATFORM_ADMINISTRATOR_ROLE,
        );
        expect(administrable).toBeDefined();

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        const outcome = await harness.administration.revokeRole(actor, {
          assignmentId: administrable?.id ?? '',
          reason: 'should be refused',
        });

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.failure).toBe('final-administrator');
      });

      it('refuses every lifecycle path that would remove the final administrator', async () => {
        for (const status of ['disabled', 'suspended', 'closed'] as const) {
          const changed = await harness.identity.setAccountStatus({
            accountId: administrator.accountId,
            status,
            actorId: administrator.accountId,
            actorType: 'user',
          });
          expect(changed.ok).toBe(false);
          expect(changed.ok ? '' : changed.failure).toBe('final-administrator');
        }

        const closed = await harness.identity.closeAccount(
          sessionContext(administrator.cookie),
          await sessionOf(harness, administrator),
        );
        expect(closed.ok).toBe(false);
        expect(closed.ok ? '' : closed.failure).toBe('final-administrator');
        expect(await usableAdministratorCount()).toBe(1);
      });

      it('serialises two administrators concurrently revoking each other', async () => {
        const first = await grantAdministrator('mutual-revoke-a');
        const second = await grantAdministrator('mutual-revoke-b');

        try {
          const firstActor = await actorFor(
            harness,
            first,
            'permissions.grant',
            'privilege-administration',
          );
          const secondActor = await actorFor(
            harness,
            second,
            'permissions.grant',
            'privilege-administration',
          );
          const firstAssignment = await administratorAssignment(first.accountId);
          const secondAssignment = await administratorAssignment(second.accountId);

          const suspended = await harness.identity.setAccountStatus({
            accountId: administrator.accountId,
            status: 'suspended',
            actorId: first.accountId,
            actorType: 'user',
          });
          expect(suspended.ok).toBe(true);

          const outcomes = await Promise.allSettled([
            harness.authorizationStore.revokeRoleAssignment({
              assignmentId: secondAssignment.id,
              reason: 'PROOF concurrent mutual revoke',
              actor: firstActor,
              auditAction: 'identity.assignment.revoked',
            }),
            harness.authorizationStore.revokeRoleAssignment({
              assignmentId: firstAssignment.id,
              reason: 'PROOF concurrent mutual revoke',
              actor: secondActor,
              auditAction: 'identity.assignment.revoked',
            }),
          ]);

          expect(
            outcomes.filter((outcome) => outcome.status === 'fulfilled'),
          ).toHaveLength(1);
          const refused = outcomes.find((outcome) => outcome.status === 'rejected');
          expect(
            refused?.status === 'rejected'
              ? (refused.reason as { reason?: unknown }).reason
              : '',
          ).toBe('final-administrator');
          expect(await usableAdministratorCount()).toBe(1);
        } finally {
          await restoreBootstrapAdministrator([first, second]);
        }
      });

      it('serialises a concurrent status change and assignment revoke', async () => {
        const first = await grantAdministrator('status-race-a');
        const second = await grantAdministrator('status-race-b');

        try {
          const firstActor = await actorFor(
            harness,
            first,
            'permissions.grant',
            'privilege-administration',
          );
          const firstAssignment = await administratorAssignment(first.accountId);

          const suspended = await harness.identity.setAccountStatus({
            accountId: administrator.accountId,
            status: 'suspended',
            actorId: second.accountId,
            actorType: 'user',
          });
          expect(suspended.ok).toBe(true);

          const [statusOutcome, revokeOutcome] = await Promise.allSettled([
            harness.identity.setAccountStatus({
              accountId: second.accountId,
              status: 'suspended',
              actorId: first.accountId,
              actorType: 'user',
            }),
            harness.authorizationStore.revokeRoleAssignment({
              assignmentId: firstAssignment.id,
              reason: 'PROOF concurrent status and revoke',
              actor: firstActor,
              auditAction: 'identity.assignment.revoked',
            }),
          ]);

          const statusSucceeded =
            statusOutcome.status === 'fulfilled' && statusOutcome.value.ok ? 1 : 0;
          const revokeSucceeded = revokeOutcome.status === 'fulfilled' ? 1 : 0;
          expect(statusSucceeded + revokeSucceeded).toBe(1);
          expect(await usableAdministratorCount()).toBe(1);
        } finally {
          await restoreBootstrapAdministrator([first, second]);
        }
      });

      it('serialises concurrent closure of the final two administrators', async () => {
        const first = await grantAdministrator('closure-race-a');
        const second = await grantAdministrator('closure-race-b');

        try {
          const suspended = await harness.identity.setAccountStatus({
            accountId: administrator.accountId,
            status: 'suspended',
            actorId: first.accountId,
            actorType: 'user',
          });
          expect(suspended.ok).toBe(true);

          const outcomes = await Promise.all([
            harness.identity.closeAccount(
              sessionContext(first.cookie),
              await sessionOf(harness, first),
            ),
            harness.identity.closeAccount(
              sessionContext(second.cookie),
              await sessionOf(harness, second),
            ),
          ]);

          expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
          expect(
            outcomes.filter(
              (outcome) => !outcome.ok && outcome.failure === 'final-administrator',
            ),
          ).toHaveLength(1);
          expect(await usableAdministratorCount()).toBe(1);
        } finally {
          await restoreBootstrapAdministrator([first, second]);
        }
      });

      it('grants nothing through a DEACTIVATED role', async () => {
        const role = await makeRole(['audit.read']);
        const target = await createAccount(harness, harness.provider, 'deactivated');

        const grantActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        await harness.administration.grantRole(grantActor, {
          accountId: target.accountId,
          roleId: role.id,
          reason: 'before deactivation',
        });

        const roleActor = await actorFor(
          harness,
          administrator,
          'roles.administer',
          'privilege-administration',
        );
        await harness.administration.deactivateCustomRole(roleActor, {
          roleId: role.id,
        });

        const after = await signIn(harness, target.email);
        const session = await sessionOf(harness, after);
        expect((await harness.authorization.evaluate(session)).can('audit.read')).toBe(
          false,
        );

        // A deactivated role cannot be assigned either.
        const another = await createAccount(harness, harness.provider, 'late');
        const lateActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const refused = await harness.administration.grantRole(lateActor, {
          accountId: another.accountId,
          roleId: role.id,
          reason: 'after deactivation',
        });
        expect(refused.ok).toBe(false);
        expect(refused.ok ? '' : refused.failure).toBe('role-deactivated');
      });
    });

    /* ---- Privilege invalidation ------------------------------------------ */

    describe('privilege invalidation', () => {
      it('revokes the holder’s sessions and step-up grants when a bundle changes', async () => {
        const role = await makeRole(['audit.read']);
        const holder = await createAccount(harness, harness.provider, 'holder');

        const grantActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        await harness.administration.grantRole(grantActor, {
          accountId: holder.accountId,
          roleId: role.id,
          reason: 'for invalidation',
        });

        // The grant itself revoked the holder's session; sign in again and give
        // the account a step-up grant so BOTH consequences are observable.
        const signedIn = await signIn(harness, holder.email);
        const session = await sessionOf(harness, signedIn);
        await harness.authorizationStore.createStepUpGrant({
          accountId: holder.accountId,
          sessionId: session.sessionId,
          purpose: 'privilege-administration',
          lifetimeSeconds: 300,
        });

        expect(await sessionCount(database.admin, holder.accountId)).toBe(1);
        expect(await grantCount(database.admin, holder.accountId)).toBe(1);

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const changed = await harness.administration.setRolePermissions(actor, {
          roleId: role.id,
          permissions: ['users.read'],
        });

        expect(changed.ok).toBe(true);
        expect(changed.ok ? changed.invalidation.accountsAffected : 0).toBe(1);
        expect(changed.ok ? changed.invalidation.sessionsRevoked : 0).toBe(1);
        expect(changed.ok ? changed.invalidation.stepUpGrantsRevoked : 0).toBe(1);

        expect(await sessionCount(database.admin, holder.accountId)).toBe(0);
        expect(await grantCount(database.admin, holder.accountId)).toBe(0);
      });

      it('does NOT revoke anything for a display-name-only edit', async () => {
        const role = await makeRole(['audit.read']);
        const holder = await createAccount(harness, harness.provider, 'renamed-holder');

        const grantActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        await harness.administration.grantRole(grantActor, {
          accountId: holder.accountId,
          roleId: role.id,
          reason: 'for rename',
        });

        const signedIn = await signIn(harness, holder.email);
        expect(await sessionCount(database.admin, signedIn.accountId)).toBe(1);

        const actor = await actorFor(
          harness,
          administrator,
          'roles.administer',
          'privilege-administration',
        );
        const renamed = await harness.administration.renameCustomRole(actor, {
          roleId: role.id,
          name: 'A clearer name',
          description: 'Same authority, clearer words.',
        });

        expect(renamed.ok).toBe(true);
        // Still signed in: a name carries no authority, and signing everyone
        // out over a spelling correction is a cost with no security benefit.
        expect(await sessionCount(database.admin, holder.accountId)).toBe(1);
      });

      it('revokes the affected account on grant and on revoke', async () => {
        const role = await makeRole(['audit.read']);
        const target = await createAccount(harness, harness.provider, 'invalidated');

        expect(await sessionCount(database.admin, target.accountId)).toBe(1);

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const granted = await harness.administration.grantRole(actor, {
          accountId: target.accountId,
          roleId: role.id,
          reason: 'invalidate on grant',
        });

        expect(granted.ok ? granted.invalidation.sessionsRevoked : 0).toBe(1);
        expect(await sessionCount(database.admin, target.accountId)).toBe(0);

        const back = await signIn(harness, target.email);
        expect(await sessionCount(database.admin, back.accountId)).toBe(1);

        const assignments = await harness.administration.listAssignments({
          accountId: target.accountId,
          includeRevoked: false,
          limit: 10,
          offset: 0,
        });

        const revokeActor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const revoked = await harness.administration.revokeRole(revokeActor, {
          assignmentId: assignments.items[0]?.id ?? '',
          reason: 'invalidate on revoke',
        });

        expect(revoked.ok ? revoked.invalidation.sessionsRevoked : 0).toBe(1);
        expect(await sessionCount(database.admin, target.accountId)).toBe(0);
      });

      it('revokes sessions and step-up grants when an account stops being active', async () => {
        const target = await createAccount(harness, harness.provider, 'disableable');
        const session = await sessionOf(harness, target);

        await harness.authorizationStore.createStepUpGrant({
          accountId: target.accountId,
          sessionId: session.sessionId,
          purpose: 'account-administration',
          lifetimeSeconds: 300,
        });
        expect(await grantCount(database.admin, target.accountId)).toBe(1);

        await harness.identity.setAccountStatus({
          accountId: target.accountId,
          status: 'suspended',
          actorId: administrator.accountId,
          actorType: 'user',
        });

        expect(await sessionCount(database.admin, target.accountId)).toBe(0);
        expect(await grantCount(database.admin, target.accountId)).toBe(0);
      });
    });

    /* ---- Audit ------------------------------------------------------------ */

    describe('audit', () => {
      it('records the before and after permission SET for a bundle change', async () => {
        const role = await makeRole(['audit.read']);
        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );

        await harness.administration.setRolePermissions(actor, {
          roleId: role.id,
          permissions: ['users.read', 'audit.read'],
        });

        const [row] = await database.admin.query<{
          beforeState: string | null;
          afterState: string | null;
          authorisingSource: string | null;
          actorId: string | null;
        }>(
          `SELECT TOP 1 [beforeState], [afterState], [authorisingSource], [actorId]
           FROM [dbo].[AuditLog]
           WHERE [action] = N'identity.role.permissions-changed'
             AND [targetId] = N'${role.id}'
           ORDER BY [occurredAt] DESC;`,
        );

        expect(row?.beforeState).toContain('audit.read');
        expect(row?.afterState).toContain('users.read');
        // The permission that authorised it, which the action name alone does
        // not say.
        expect(row?.authorisingSource).toBe('permissions.grant');
        expect(row?.actorId).toBe(administrator.accountId);
      });

      it('never writes a bare identifier into an audit relation', async () => {
        // `AuditLog` stays FK-FREE: actor and target are historical identifier
        // strings, so a record survives the closure or purge of its subject
        // (SECURITY_BASELINE.md §13.3).
        const [row] = await database.admin.query<{ total: number }>(`
          SELECT COUNT_BIG(*) AS total
          FROM sys.foreign_keys
          WHERE parent_object_id = OBJECT_ID(N'[dbo].[AuditLog]');
        `);
        expect(Number(row?.total ?? 0)).toBe(0);
      });
    });
  },
);
