import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { localeSchema } from '../../packages/contracts/src/env/shared.ts';
import {
  CONTRIBUTION_ROLES,
  MAX_NAME_VARIANTS_PER_LOCALE,
  MAX_PROFILE_LANGUAGES,
  PROFILE_KINDS,
  normaliseNameVariant,
} from '../../packages/contracts/src/people/index.ts';
import {
  CONTRIBUTOR_CAPABILITY_SOURCES,
  NO_CONTRIBUTOR_CAPABILITIES,
} from '../../packages/contracts/src/identity/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, databaseConfigured } from '../identity/harness.ts';
import type { DisposableDatabase } from '../identity/harness.ts';
import {
  PROOF_ACTOR,
  auditFor,
  createPeopleHarness,
  createProofAccount,
  freshSlug,
  linkCount,
  personCount,
  roleAssignmentCount,
  type PeopleHarness,
} from './harness.ts';

/**
 * PHASE 5 — People & Contributors, against a real SQL Server.
 *
 * WHY THIS IS A LIVE SUITE AND NOT A UNIT SUITE. Almost everything Phase 5
 * promises is a property of the DATABASE: slug uniqueness under concurrency, one
 * account per contributor under concurrency, one profile of each kind, a
 * translation in the primary locale that cannot be removed, a bounded and
 * de-duplicated set of name variants, and a runtime principal that cannot delete
 * a contributor. A mock would prove the adapter calls the methods it calls; it
 * would prove nothing about whether SQL Server refuses what this phase says it
 * refuses.
 *
 * The suite SKIPS only when no local database configuration can exist — no local
 * environment file, no migration credentials. It does not skip because a
 * container happens to be down, because that would report green for proofs
 * nobody ran.
 */

const describeLive = databaseConfigured ? describe : describe.skip;

describeLive('Phase 5 — People & Contributors over a live database', () => {
  let database: DisposableDatabase;
  let admin: SqlSession;
  let harness: PeopleHarness;

  beforeAll(async () => {
    database = await createProofDatabase();
    admin = database.admin;
    harness = await createPeopleHarness();
  }, 240_000);

  afterAll(async () => {
    await database?.close();
  });

  /** Creates a published contributor with a primary-locale name. */
  async function publishedPerson(
    primaryLocale: 'en' | 'ur' | 'ar' = 'en',
    name = 'Proof Contributor',
  ): Promise<{ id: string; slug: string }> {
    const slug = freshSlug();
    const created = await harness.people.createPerson(PROOF_ACTOR, {
      slug,
      primaryLocale,
      name,
      biography: null,
    });
    if (!created.ok) throw new Error(`createPerson failed: ${created.failure}`);

    const published = await harness.people.setStatus(PROOF_ACTOR, {
      personId: created.person.id,
      status: 'published',
    });
    if (!published.ok) throw new Error(`setStatus failed: ${published.failure}`);

    return { id: created.person.id, slug };
  }

  /* =====================================================================
   * Six distinct models
   * =================================================================== */

  describe('Person, User and the four profiles are six distinct models', () => {
    it('stores the four profile kinds in four separate tables', async () => {
      // DOMAIN_MODEL.md §5.2 states it as a rule, and the shape of the database
      // is what makes it true. Read from the catalogue rather than from a list
      // this test declares, so a migration that collapsed them would fail here
      // rather than pass against a stale expectation.
      const tables = await admin.query<{ name: string }>(`
        SELECT t.name FROM sys.tables t
        JOIN sys.schemas s ON s.schema_id = t.schema_id
        WHERE s.name = 'dbo'
          AND t.name IN (N'AuthorProfile', N'SpeakerProfile', N'ScholarProfile', N'TeacherProfile')
        ORDER BY t.name;
      `);

      expect(tables.map((row) => row.name)).toEqual([
        'AuthorProfile',
        'ScholarProfile',
        'SpeakerProfile',
        'TeacherProfile',
      ]);
    });

    it('has no discriminated single profile table, under any name', async () => {
      // A `Profile` table with a `type`/`kind` column would be the merge §5.2
      // prohibits, and renaming it would not make it a different design — so
      // this looks for the SHAPE: a table that references `Person` and carries
      // a discriminator instead of being one of the four named aggregates.
      const suspects = await admin.query<{ tableName: string; column: string }>(`
        SELECT t.name AS tableName, c.name AS [column]
        FROM sys.tables t
        JOIN sys.columns c ON c.object_id = t.object_id
        WHERE c.name IN (N'type', N'kind', N'profileType', N'discriminator')
          AND EXISTS (
            SELECT 1 FROM sys.foreign_keys fk
            WHERE fk.parent_object_id = t.object_id
              AND fk.referenced_object_id = OBJECT_ID(N'[dbo].[Person]')
          );
      `);

      expect(suspects).toEqual([]);
    });

    it('keeps Person and User distinct: one Person may have no account', async () => {
      const person = await publishedPerson();

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });

      expect(detail?.linkedAccountId).toBeNull();
      expect(detail?.linked).toBe(false);
    });

    it('supports a historical Author with no account at all', async () => {
      // The case DOMAIN_MODEL.md §5.1 names first: "It exists for historical
      // figures with no account". An author facet is added, activated and
      // rendered publicly, and no `User` row is involved at any point.
      const person = await publishedPerson('ur', 'مصنف');

      const withAuthor = await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'author',
      });
      expect(withAuthor.ok).toBe(true);

      const activated = await harness.people.setProfileStatus(PROOF_ACTOR, {
        personId: person.id,
        kind: 'author',
        status: 'active',
      });
      expect(activated.ok).toBe(true);

      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'ur',
      });

      expect(profile?.facets.map((facet) => facet.kind)).toEqual(['author']);
      expect(await linkCount(admin, '')).toBe(0);
    });

    it('allows a User with no Person', async () => {
      const accountId = await createProofAccount(admin);

      // The account exists and no contributor record references it. The
      // converse of the case above, and equally ordinary.
      expect(await linkCount(admin, accountId)).toBe(0);
    });

    it('lets one Person hold all four profile kinds at once', async () => {
      const person = await publishedPerson();

      for (const kind of PROFILE_KINDS) {
        const created = await harness.people.createProfile(PROOF_ACTOR, {
          personId: person.id,
          kind,
        });
        expect(created.ok, `creating the ${kind} facet`).toBe(true);
      }

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });

      expect(detail?.profileKinds).toEqual([...PROFILE_KINDS]);
      expect(detail?.profiles.filter((profile) => profile.id !== null)).toHaveLength(4);
    });

    it('refuses a second profile of the same kind for one Person', async () => {
      const person = await publishedPerson();

      const first = await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'scholar',
      });
      expect(first.ok).toBe(true);

      const second = await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'scholar',
      });
      expect(second).toEqual({ ok: false, failure: 'profile-exists' });
    });

    it('gives each profile its own lifecycle, independent of the others', async () => {
      const person = await publishedPerson();

      for (const kind of ['author', 'teacher'] as const) {
        await harness.people.createProfile(PROOF_ACTOR, { personId: person.id, kind });
        await harness.people.setProfileStatus(PROOF_ACTOR, {
          personId: person.id,
          kind,
          status: 'active',
        });
      }

      // Archiving the teacher facet must leave the author facet alone — which
      // is the whole practical point of four aggregates rather than one row.
      const archived = await harness.people.setProfileStatus(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        status: 'archived',
      });
      expect(archived.ok).toBe(true);

      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });
      expect(profile?.facets.map((facet) => facet.kind)).toEqual(['author']);

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });
      expect(detail?.profiles.find((entry) => entry.kind === 'author')?.status).toBe(
        'active',
      );
      expect(detail?.profiles.find((entry) => entry.kind === 'teacher')?.status).toBe(
        'archived',
      );
    });
  });

  /* =====================================================================
   * No profile grants any privilege
   * =================================================================== */

  describe('no profile and no link grants any privilege', () => {
    it('writes no RoleAssignment for any People mutation', async () => {
      // THE CENTRAL SECURITY CLAIM OF THE PHASE, asserted over the whole
      // surface rather than one method: a count before, every kind of People
      // mutation, and the same count after.
      const before = await roleAssignmentCount(admin);

      const person = await publishedPerson();
      const accountId = await createProofAccount(admin);

      await harness.people.setTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ur',
        name: 'نام',
        biography: null,
      });
      await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'en',
        value: 'Another Spelling',
      });
      await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId,
      });
      for (const kind of PROFILE_KINDS) {
        await harness.people.createProfile(PROOF_ACTOR, { personId: person.id, kind });
        await harness.people.setProfileStatus(PROOF_ACTOR, {
          personId: person.id,
          kind,
          status: 'active',
        });
      }
      await harness.people.setProfileLanguages(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        languages: ['ur', 'en'],
      });

      expect(await roleAssignmentCount(admin)).toBe(before);
    });

    it('projects every capability false for a Person with no account', async () => {
      const capabilities = await harness.people.capabilitiesFor(null);
      expect(capabilities).toEqual(NO_CONTRIBUTOR_CAPABILITIES);
    });

    it('projects every capability false for a linked account with no grant', async () => {
      const accountId = await createProofAccount(admin);
      harness.accounts.grant(accountId, []);

      expect(await harness.people.capabilitiesFor(accountId)).toEqual(
        NO_CONTRIBUTOR_CAPABILITIES,
      );
    });

    it('projects canTeach false for a Person holding an ACTIVE TeacherProfile', async () => {
      // The exact confusion DOMAIN_MODEL.md §4.5 exists to prevent: "Creating a
      // Teacher profile confers no teaching privilege." The facet is created,
      // activated and linked to a real account — and the projection is still
      // false, because no grant exists.
      const person = await publishedPerson();
      const accountId = await createProofAccount(admin);
      harness.accounts.grant(accountId, []);

      await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
      });
      await harness.people.setProfileStatus(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        status: 'active',
      });
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });
      expect(detail?.linkedAccountId).toBe(accountId);

      const capabilities = await harness.people.capabilitiesFor(
        detail?.linkedAccountId ?? null,
      );
      expect(capabilities.canTeach).toBe(false);
    });

    it.each(
      Object.entries(CONTRIBUTOR_CAPABILITY_SOURCES) as readonly [
        keyof typeof CONTRIBUTOR_CAPABILITY_SOURCES,
        string,
      ][],
    )(
      'maps %s to exactly one permission, and nothing else',
      async (capability, source) => {
        const accountId = await createProofAccount(admin);
        harness.accounts.grant(accountId, [source]);

        const capabilities = await harness.people.capabilitiesFor(accountId);

        expect(capabilities[capability]).toBe(true);
        // EXACTLY ONE. A mapping that lit two projections from one grant would be
        // a widening nobody reviewed, and would be invisible to a test that only
        // checked the expected one.
        expect(Object.values(capabilities).filter(Boolean)).toHaveLength(1);
      },
    );

    it('projects every capability false once the account is closed', async () => {
      const accountId = await createProofAccount(admin);
      harness.accounts.grant(accountId, [CONTRIBUTOR_CAPABILITY_SOURCES.canTeach]);
      expect((await harness.people.capabilitiesFor(accountId)).canTeach).toBe(true);

      harness.accounts.close(accountId);

      expect(await harness.people.capabilitiesFor(accountId)).toEqual(
        NO_CONTRIBUTOR_CAPABILITIES,
      );
    });
  });

  /* =====================================================================
   * The optional account link
   * =================================================================== */

  describe('the optional account link', () => {
    it('leaves exactly one link when two contributors race for one account', async () => {
      const accountId = await createProofAccount(admin);
      const first = await publishedPerson();
      const second = await publishedPerson();

      // BOTH AT ONCE, and the database decides. An application pre-check would
      // read a state the other transaction is in the middle of writing.
      const outcomes = await Promise.all([
        harness.people.linkAccount(PROOF_ACTOR, {
          personId: first.id,
          accountId,
        }),
        harness.people.linkAccount(PROOF_ACTOR, {
          personId: second.id,
          accountId,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      expect(
        outcomes.filter(
          (outcome) => !outcome.ok && outcome.failure === 'account-already-linked',
        ),
      ).toHaveLength(1);
      expect(await linkCount(admin, accountId)).toBe(1);
    });

    it('refuses a forged account identifier', async () => {
      const person = await publishedPerson();

      const outcome = await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId: 'account-that-was-never-created',
      });

      expect(outcome).toEqual({ ok: false, failure: 'account-not-found' });
      expect(
        (await harness.people.findPerson({ personId: person.id, locale: 'en' }))
          ?.linkedAccountId,
      ).toBeNull();
    });

    it('refuses an account Identity already reports closed', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      harness.accounts.close(accountId);

      const outcome = await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId,
      });

      expect(outcome).toEqual({ ok: false, failure: 'account-not-found' });
      expect(await linkCount(admin, accountId)).toBe(0);
    });

    it('releases a link when closure races between validation and commit', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      harness.accounts.closeAfterNextCheck(accountId);

      const outcome = await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId,
      });

      expect(outcome).toEqual({ ok: false, failure: 'account-not-found' });
      expect(await linkCount(admin, accountId)).toBe(0);
    });

    it('copies nothing from the account into the contributor record', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson('en', 'Entered By An Editor');

      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });

      // The account's own name is `Proof Account` and its address is on
      // `.invalid`. Neither may appear: a contributor's public name is editorial
      // content, and an account's is whatever somebody typed at sign-up.
      expect(detail?.label.name).toBe('Entered By An Editor');
      expect(JSON.stringify(detail)).not.toContain('Proof Account');
      expect(JSON.stringify(detail)).not.toContain('people-proof.invalid');
    });

    it('never exposes the account identifier on a public shape', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });

      expect(profile).not.toBeNull();
      expect(JSON.stringify(profile)).not.toContain(accountId);

      // The LISTING shape too, which is the one most likely to be handed
      // somewhere it should not go.
      const page = await harness.people.listPeople({
        query: person.slug,
        status: null,
        profileKind: null,
        locale: 'en',
        offset: 0,
      });
      expect(JSON.stringify(page)).not.toContain(accountId);
      expect(page.items[0]?.linked).toBe(true);
    });

    it('is idempotent to unlink', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const first = await harness.people.unlinkAccount(PROOF_ACTOR, {
        personId: person.id,
      });
      const second = await harness.people.unlinkAccount(PROOF_ACTOR, {
        personId: person.id,
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(await linkCount(admin, accountId)).toBe(0);
    });

    it('refuses to silently repoint an already-linked contributor', async () => {
      const first = await createProofAccount(admin);
      const second = await createProofAccount(admin);
      const person = await publishedPerson();

      await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId: first,
      });

      const outcome = await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId: second,
      });

      expect(outcome).toEqual({ ok: false, failure: 'person-already-linked' });
      expect(await linkCount(admin, first)).toBe(1);
      expect(await linkCount(admin, second)).toBe(0);
    });
  });

  /* =====================================================================
   * Account closure — People's own disposition
   * =================================================================== */

  describe('account closure disposes of the link and nothing else', () => {
    it('releases the link, keeps the public contributor record', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const released = await harness.people.releaseAccountLink({ accountId });
      expect(released).toEqual({ ok: true, released: true });

      // THE PERSON FOLLOWS ITS OWN LIFECYCLE. Closure is not a decision to
      // withdraw somebody's authorship, and destroying the record would break
      // attributions later content domains will carry.
      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });
      expect(profile?.slug).toBe(person.slug);

      const detail = await harness.people.findPerson({
        personId: person.id,
        locale: 'en',
      });
      expect(detail?.status).toBe('published');
      expect(detail?.linkedAccountId).toBeNull();
    });

    it('is idempotent, so an interrupted closure can be retried', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      const first = await harness.people.releaseAccountLink({ accountId });
      const second = await harness.people.releaseAccountLink({ accountId });

      expect(first).toEqual({ ok: true, released: true });
      // `false` rather than a failure: nothing was left to release, which is
      // what a second attempt after a successful first one must report.
      expect(second).toEqual({ ok: true, released: false });
    });

    it('succeeds for an account that never had a contributor record', async () => {
      const accountId = await createProofAccount(admin);

      expect(await harness.people.releaseAccountLink({ accountId })).toEqual({
        ok: true,
        released: false,
      });
    });

    it('records the release as its own audited action, not as an operator unlink', async () => {
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });
      await harness.people.releaseAccountLink({ accountId });

      const rows = await auditFor(admin, person.id);
      const release = rows.find(
        (row) => row.action === 'people.person.account-link-released',
      );

      expect(release).toBeDefined();
      expect(release?.actorType).toBe('system');
      expect(release?.actorId).toBeNull();
      // NOT A PERMISSION. Nobody exercised `people.administer`: the person
      // closed their own account, and claiming an authorisation that did not
      // happen is the one thing an audit record must not do.
      expect(release?.authorisingSource).toBe('account-closure');
      // AND NOT THE ACCOUNT IDENTIFIER, which would put the association between
      // a public contributor and a private account into a table with different
      // retention — the same association this operation exists to release.
      expect(release?.afterState ?? '').not.toContain(accountId);
    });

    it('repairs a link left behind by an interrupted closure', async () => {
      // THE RESUMABLE HALF of ARCHITECTURE.md §3.1.2.1. Identity commits the
      // closure in its own transaction; if the process stops before People
      // disposes of its link, the link survives. Simulated exactly that way:
      // the account is closed as far as Identity is concerned, and People's
      // release never ran.
      const accountId = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, { personId: person.id, accountId });

      harness.accounts.close(accountId);
      expect(await linkCount(admin, accountId)).toBe(1);

      const released = await harness.people.reconcileClosedAccountLinks();

      expect(released).toBeGreaterThanOrEqual(1);
      expect(await linkCount(admin, accountId)).toBe(0);
    });

    it('does not starve a closed link beyond the first reconciliation page', async () => {
      const batch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

      // Fifty-one OPEN links sort before the stranded closed link. A reconciler
      // that repeatedly examines only its first bounded page can therefore run
      // forever without repairing the record this test places last.
      await admin.query(`
        DECLARE @numbers TABLE ([n] INT NOT NULL PRIMARY KEY);
        WITH numbers AS (
          SELECT 1 AS [n]
          UNION ALL SELECT [n] + 1 FROM numbers WHERE [n] < 51
        )
        INSERT INTO @numbers ([n]) SELECT [n] FROM numbers OPTION (MAXRECURSION 51);

        BEGIN TRAN;
        INSERT INTO [dbo].[User]
          ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
           [locale], [status], [twoFactorEnabled])
        SELECT
          CONCAT(N'recon-${batch}-a-', FORMAT([n], '00')),
          N'Reconciliation Open Account',
          CONCAT(N'recon-${batch}-', FORMAT([n], '00'), N'@people-proof.invalid'),
          0, SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', N'active', 0
        FROM @numbers;

        INSERT INTO [dbo].[Person]
          ([id], [slug], [userId], [primaryLocale], [status])
        SELECT
          CONCAT(N'recon-${batch}-p-', FORMAT([n], '00')),
          CONCAT(N'000-reconcile-${batch}-', FORMAT([n], '00')),
          CONCAT(N'recon-${batch}-a-', FORMAT([n], '00')),
          N'en', N'draft'
        FROM @numbers;

        INSERT INTO [dbo].[PersonTranslation]
          ([personId], [locale], [name])
        SELECT
          CONCAT(N'recon-${batch}-p-', FORMAT([n], '00')),
          N'en', N'Reconciliation Open Contributor'
        FROM @numbers;
        COMMIT TRAN;
      `);

      const closedAccount = await createProofAccount(admin);
      const closedPerson = `recon-${batch}-closed`;
      await admin.query(`
        BEGIN TRAN;
        INSERT INTO [dbo].[Person]
          ([id], [slug], [userId], [primaryLocale], [status])
        VALUES
          (N'${closedPerson}', N'zzz-reconcile-${batch}', N'${closedAccount}', N'en', N'draft');
        INSERT INTO [dbo].[PersonTranslation] ([personId], [locale], [name])
        VALUES (N'${closedPerson}', N'en', N'Stranded Closed Contributor');
        COMMIT TRAN;
      `);
      harness.accounts.close(closedAccount);

      expect(await harness.people.reconcileClosedAccountLinks()).toBeGreaterThanOrEqual(
        1,
      );
      expect(await linkCount(admin, closedAccount)).toBe(0);
    }, 30_000);

    it('leaves links for accounts that are still open', async () => {
      const open = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId: open,
      });

      await harness.people.reconcileClosedAccountLinks();

      expect(await linkCount(admin, open)).toBe(1);
    });

    it('does not relink a new account registered with the same address', async () => {
      // DOMAIN_MODEL.md §4.6: "Later re-registration with the same address
      // starts clean." Identity mints a NEW `User` id; nothing in People links
      // by email, and nothing here runs on sign-up — so the new account arrives
      // with no contributor record: nothing links it by email or name,
      // whatever the previous one held.
      const original = await createProofAccount(admin);
      const person = await publishedPerson();
      await harness.people.linkAccount(PROOF_ACTOR, {
        personId: person.id,
        accountId: original,
      });
      await harness.people.releaseAccountLink({ accountId: original });

      const replacement = await createProofAccount(admin);
      expect(replacement).not.toBe(original);

      expect(await linkCount(admin, replacement)).toBe(0);
      expect(
        (await harness.people.findPerson({ personId: person.id, locale: 'en' }))
          ?.linkedAccountId,
      ).toBeNull();
    });
  });

  /* =====================================================================
   * Slug, lifecycle and public visibility
   * =================================================================== */

  describe('the slug is unique and immutable, and visibility fails closed', () => {
    it('leaves exactly one row when two creates race for one slug', async () => {
      const slug = freshSlug();

      const outcomes = await Promise.all([
        harness.people.createPerson(PROOF_ACTOR, {
          slug,
          primaryLocale: 'en',
          name: 'First',
          biography: null,
        }),
        harness.people.createPerson(PROOF_ACTOR, {
          slug,
          primaryLocale: 'en',
          name: 'Second',
          biography: null,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      expect(await personCount(admin, slug)).toBe(1);
    });

    it('offers no runtime path that changes a slug', async () => {
      // THE CONTRACT HALF. `PeopleService` has no method that accepts a new
      // slug, so a caller cannot ask for one — which is what makes the absence
      // of slug history and 301s correct rather than an omission
      // (DOMAIN_MODEL.md §19.7). The SQL half is proved by the runtime-principal
      // suite, which shows the column-level DENY.
      const methods = Object.keys(harness.people);
      expect(methods.filter((name) => /slug/i.test(name))).toEqual([]);

      const store = Object.keys(harness.store);
      expect(store.filter((name) => /slug/i.test(name))).toEqual([]);
    });

    it('hides a draft contributor from every public read', async () => {
      const slug = freshSlug();
      const created = await harness.people.createPerson(PROOF_ACTOR, {
        slug,
        primaryLocale: 'en',
        name: 'Not Yet Published',
        biography: null,
      });
      expect(created.ok).toBe(true);

      // Created as a draft, without anybody asking for that: nothing arrives
      // publicly visible.
      expect(created.ok && created.person.status).toBe('draft');
      expect(await harness.people.publicProfile({ slug, locale: 'en' })).toBeNull();
      expect(await harness.people.publicPersonExists(slug)).toBe(false);
      expect(
        (await harness.people.sitemapEntries(500)).some((entry) => entry.slug === slug),
      ).toBe(false);
    });

    it('hides an archived contributor from every public read', async () => {
      const person = await publishedPerson();
      expect(await harness.people.publicPersonExists(person.slug)).toBe(true);

      await harness.people.setStatus(PROOF_ACTOR, {
        personId: person.id,
        status: 'archived',
      });

      expect(
        await harness.people.publicProfile({ slug: person.slug, locale: 'en' }),
      ).toBeNull();
      expect(await harness.people.publicPersonExists(person.slug)).toBe(false);
      expect(
        (await harness.people.sitemapEntries(500)).some(
          (entry) => entry.slug === person.slug,
        ),
      ).toBe(false);
    });

    it('reports an unknown slug as absent rather than failing', async () => {
      expect(
        await harness.people.publicProfile({ slug: 'no-such-contributor', locale: 'en' }),
      ).toBeNull();
      expect(await harness.people.publicPersonExists('no-such-contributor')).toBe(false);
    });
  });

  /* =====================================================================
   * Translations, fallback and name variants
   * =================================================================== */

  describe('translations are rows, and the fallback is honest', () => {
    it('keeps one row per (person, locale) however many times it is saved', async () => {
      const person = await publishedPerson();

      await Promise.all([
        harness.people.setTranslation(PROOF_ACTOR, {
          personId: person.id,
          locale: 'ur',
          name: 'پہلا',
          biography: null,
        }),
        harness.people.setTranslation(PROOF_ACTOR, {
          personId: person.id,
          locale: 'ur',
          name: 'دوسرا',
          biography: null,
        }),
      ]);

      const [row] = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[PersonTranslation]
        WHERE [personId] = N'${person.id}' AND [locale] = N'ur';
      `);
      expect(Number(row?.total)).toBe(1);
    });

    it('reports a fallback as a fallback rather than hiding it', async () => {
      // ROUTE_MAP.md §9.3 requires a VISIBLE language notice, which the page can
      // only render if the read model says the content came from elsewhere.
      const person = await publishedPerson('ur', 'اردو نام');

      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });

      expect(profile?.label.name).toBe('اردو نام');
      expect(profile?.label.resolvedLocale).toBe('ur');
      expect(profile?.label.fallback).toBe(true);
    });

    it('falls back to the PRIMARY locale, not to English', async () => {
      // A Topic falls back to `en` because it is interface chrome. A Person's
      // biography is CONTENT, much of it Urdu-original or Arabic-original, and
      // falling back to English would show an empty page for a record that is
      // complete in Arabic.
      const person = await publishedPerson('ar', 'الاسم');
      await harness.people.setTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'en',
        name: 'English Name',
        biography: null,
      });

      const urdu = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'ur',
      });

      expect(urdu?.label.resolvedLocale).toBe('ar');
      expect(urdu?.label.name).toBe('الاسم');
    });

    it('lists only the locales a translation genuinely exists in', async () => {
      const person = await publishedPerson('en');
      await harness.people.setTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ur',
        name: 'نام',
        biography: null,
      });

      const profile = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });

      // `ar` is absent, so it must not appear — "untranslated content is never
      // listed as an alternate" (ROUTE_MAP.md §9.2).
      expect([...(profile?.contentLocales ?? [])].sort()).toEqual(['en', 'ur']);
      expect(profile?.contentLocales).not.toContain('ar');
    });

    it('refuses to remove the primary-locale translation', async () => {
      const person = await publishedPerson('ur', 'نام');

      const outcome = await harness.people.removeTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ur',
      });

      expect(outcome).toEqual({
        ok: false,
        failure: 'primary-translation-required',
      });
    });

    it('refuses the same removal at the DATABASE, not only in the service', async () => {
      // The application branch above produces a message an administrator can
      // act on. This is the invariant that holds when a writer which never runs
      // that code removes the row — the reason it is a trigger rather than a
      // validation.
      const person = await publishedPerson('ur', 'نام');

      let refused = false;
      try {
        await admin.query(`
          DELETE FROM [dbo].[PersonTranslation]
          WHERE [personId] = N'${person.id}' AND [locale] = N'ur';
        `);
      } catch {
        refused = true;
      }

      expect(refused).toBe(true);
    });

    it('removes a non-primary translation, because an error must be retractable', async () => {
      const person = await publishedPerson('en');
      await harness.people.setTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ar',
        name: 'خطأ',
        biography: null,
      });

      const outcome = await harness.people.removeTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ar',
      });

      expect(outcome.ok).toBe(true);
      expect(outcome.ok && outcome.person.translatedLocales).toEqual(['en']);
    });

    it('de-duplicates name variants by the normalised form', async () => {
      const person = await publishedPerson();

      const first = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'en',
        value: 'Abu  Hamid',
      });
      // Different spacing and case, same normalised value.
      const second = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'en',
        value: 'abu hamid',
      });

      expect(first.ok).toBe(true);
      expect(second).toEqual({ ok: false, failure: 'duplicate-variant' });
      expect(normaliseNameVariant('Abu  Hamid')).toBe(normaliseNameVariant('abu hamid'));
    });

    it('does not merge two genuinely different Arabic-script names', async () => {
      // Normalisation case-folds and collapses whitespace and does NOT strip
      // diacritics: removing them from a name written in Arabic script can
      // change which name it is, and merging two would silently discard one.
      const person = await publishedPerson();

      const first = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ar',
        value: 'حامد',
      });
      const second = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ar',
        value: 'حَامِد',
      });

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it('bounds name variants per locale at the DATABASE', async () => {
      const person = await publishedPerson();

      for (let index = 0; index < MAX_NAME_VARIANTS_PER_LOCALE; index += 1) {
        const outcome = await harness.people.addNameVariant(PROOF_ACTOR, {
          personId: person.id,
          locale: 'en',
          value: `Variant Number ${index}`,
        });
        expect(outcome.ok, `variant ${index}`).toBe(true);
      }

      const beyond = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'en',
        value: 'One Too Many',
      });
      expect(beyond).toEqual({ ok: false, failure: 'variant-limit' });

      // PER LOCALE, not per person: a full English list must not stop an Urdu
      // spelling being recorded.
      const otherLocale = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ur',
        value: 'اردو ہجے',
      });
      expect(otherLocale.ok).toBe(true);
    });

    it('serialises two concurrent inserts at the per-locale bound', async () => {
      const person = await publishedPerson();

      for (let index = 0; index < MAX_NAME_VARIANTS_PER_LOCALE - 1; index += 1) {
        const seeded = await harness.people.addNameVariant(PROOF_ACTOR, {
          personId: person.id,
          locale: 'en',
          value: `Concurrent Seed ${index}`,
        });
        expect(seeded.ok).toBe(true);
      }

      const outcomes = await Promise.all([
        harness.people.addNameVariant(PROOF_ACTOR, {
          personId: person.id,
          locale: 'en',
          value: 'Concurrent Final A',
        }),
        harness.people.addNameVariant(PROOF_ACTOR, {
          personId: person.id,
          locale: 'en',
          value: 'Concurrent Final B',
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      expect(
        outcomes.filter((outcome) => !outcome.ok && outcome.failure === 'variant-limit'),
      ).toHaveLength(1);

      const [count] = await admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total FROM [dbo].[PersonNameVariant]
        WHERE [personId] = N'${person.id}' AND [locale] = N'en';
      `);
      expect(Number(count?.total ?? 0)).toBe(MAX_NAME_VARIANTS_PER_LOCALE);
    });

    it('refuses to remove a variant belonging to a different contributor', async () => {
      const owner = await publishedPerson();
      const other = await publishedPerson();

      const added = await harness.people.addNameVariant(PROOF_ACTOR, {
        personId: owner.id,
        locale: 'en',
        value: 'Belongs To Owner',
      });
      expect(added.ok).toBe(true);
      const variantId = added.ok ? (added.person.nameVariants[0]?.id ?? '') : '';

      const outcome = await harness.people.removeNameVariant(PROOF_ACTOR, {
        personId: other.id,
        variantId,
      });

      expect(outcome).toEqual({ ok: false, failure: 'not-found' });
    });
  });

  /* =====================================================================
   * Profiles, languages and bounded listing
   * =================================================================== */

  describe('profile detail and bounded reads', () => {
    it('refuses descriptive fields on Author and Speaker, which have none', async () => {
      const person = await publishedPerson();
      await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'author',
      });

      const outcome = await harness.people.setProfileTranslation(PROOF_ACTOR, {
        personId: person.id,
        kind: 'author',
        locale: 'en',
        qualifications: 'something',
        expertise: null,
        biography: null,
        subjects: null,
      });

      // Accepting it silently would leave an administrator believing they had
      // saved something. DOMAIN_MODEL.md §5.2 names no field for either kind.
      expect(outcome).toEqual({ ok: false, failure: 'profile-has-no-detail' });
    });

    it('stores scholar and teacher prose per locale and resolves it honestly', async () => {
      const person = await publishedPerson('en');
      await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'scholar',
      });
      await harness.people.setProfileStatus(PROOF_ACTOR, {
        personId: person.id,
        kind: 'scholar',
        status: 'active',
      });
      await harness.people.setProfileTranslation(PROOF_ACTOR, {
        personId: person.id,
        kind: 'scholar',
        locale: 'en',
        qualifications: 'Synthetic qualification entry',
        expertise: null,
        biography: null,
        subjects: null,
      });

      const english = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'en',
      });
      const scholar = english?.facets.find((facet) => facet.kind === 'scholar');
      expect(scholar?.details).toEqual([
        {
          field: 'qualifications',
          value: 'Synthetic qualification entry',
          resolvedLocale: 'en',
          fallback: false,
        },
      ]);

      // Read in Urdu, the same text is shown and SAYS it is a fallback.
      const urdu = await harness.people.publicProfile({
        slug: person.slug,
        locale: 'ur',
      });
      expect(
        urdu?.facets.find((facet) => facet.kind === 'scholar')?.details[0]?.fallback,
      ).toBe(true);
    });

    it('writes profile languages as a whole set, de-duplicated and bounded', async () => {
      const person = await publishedPerson();
      await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
      });

      const first = await harness.people.setProfileLanguages(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        languages: ['ur', 'en', 'ur'],
      });
      expect(first.ok).toBe(true);
      expect(
        first.ok &&
          [
            ...(first.person.profiles.find((p) => p.kind === 'teacher')?.languages ?? []),
          ].sort(),
      ).toEqual(['en', 'ur']);

      // Replaced wholesale: a language is listed or it is not.
      const second = await harness.people.setProfileLanguages(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        languages: ['ar'],
      });
      expect(
        second.ok && second.person.profiles.find((p) => p.kind === 'teacher')?.languages,
      ).toEqual(['ar']);

      const tooMany = await harness.people.setProfileLanguages(PROOF_ACTOR, {
        personId: person.id,
        kind: 'teacher',
        languages: Array.from(
          { length: MAX_PROFILE_LANGUAGES + 1 },
          (_value, index) => `qaa-x-l${index}`,
        ),
      });
      expect(tooMany).toEqual({ ok: false, failure: 'too-many-languages' });
    });

    it('bounds every administrative page and orders it totally', async () => {
      const read = (offset: number) =>
        harness.people.listPeople({
          query: null,
          status: null,
          profileKind: null,
          locale: 'en',
          offset,
        });

      const first = await read(0);
      expect(first.items.length).toBeLessThanOrEqual(25);
      expect(first.more).toBe(true);

      // DETERMINISTIC: the same query returns the same sequence. Asserted by
      // re-reading rather than by comparing against a sort computed here —
      // SQL Server orders under its own collation and JavaScript orders by
      // UTF-16 code unit, so the two disagree about where `person-10` sits
      // relative to `person-2`. What the design actually promises is that the
      // order is TOTAL and stable, and that is what this checks.
      expect((await read(0)).items.map((item) => item.slug)).toEqual(
        first.items.map((item) => item.slug),
      );

      // AND THE PAGE BOUNDARY IS SOUND: because the order is over a unique
      // column, the second page repeats nothing from the first. An unstable or
      // non-total order is exactly what would show a row twice here and lose
      // another entirely.
      const second = await read(25);
      const firstSlugs = new Set(first.items.map((item) => item.slug));
      expect(second.items.filter((item) => firstSlugs.has(item.slug))).toEqual([]);
    });

    it('filters a listing by profile kind', async () => {
      const person = await publishedPerson();
      await harness.people.createProfile(PROOF_ACTOR, {
        personId: person.id,
        kind: 'speaker',
      });

      const speakers = await harness.people.listPeople({
        query: person.slug,
        status: null,
        profileKind: 'speaker',
        locale: 'en',
        offset: 0,
      });
      expect(speakers.items.map((item) => item.slug)).toContain(person.slug);

      const scholars = await harness.people.listPeople({
        query: person.slug,
        status: null,
        profileKind: 'scholar',
        locale: 'en',
        offset: 0,
      });
      expect(scholars.items.map((item) => item.slug)).not.toContain(person.slug);
    });

    it('moves the contributor timestamp when a CHILD row changes', async () => {
      // `lastmod` must reflect genuine modification of the PAGE, which renders
      // the Person, its translations, its variants and its facets as one thing.
      // A timestamp that moved only for the Person row would tell a crawler
      // that a profile rewritten this morning was last touched a year ago.
      const person = await publishedPerson();
      const before = (
        await harness.people.findPerson({ personId: person.id, locale: 'en' })
      )?.updatedAt;

      await new Promise((resolve) => setTimeout(resolve, 20));
      await harness.people.setTranslation(PROOF_ACTOR, {
        personId: person.id,
        locale: 'ar',
        name: 'اسم',
        biography: null,
      });

      const after = (
        await harness.people.findPerson({ personId: person.id, locale: 'en' })
      )?.updatedAt;

      expect(after?.getTime() ?? 0).toBeGreaterThan(before?.getTime() ?? 0);
    });
  });

  /* =====================================================================
   * Contribution roles — vocabulary only
   * =================================================================== */

  describe('contribution roles are a vocabulary, not a relationship', () => {
    it('exports exactly the seven roles DOMAIN_MODEL.md §5.3 names', () => {
      expect([...CONTRIBUTION_ROLES]).toEqual([
        'author',
        'translator',
        'editor',
        'compiler',
        'narrator',
        'reciter',
        'speaker',
      ]);
    });

    it('creates no table that relates a contributor to a work', async () => {
      // §5.3 puts the relationship row in the context that owns the TARGET, and
      // no such context has shipped. Read from the catalogue: every table with a
      // foreign key to `Person` must be one of People's own.
      const referencing = await admin.query<{ tableName: string }>(`
        SELECT DISTINCT OBJECT_NAME(fk.parent_object_id) AS tableName
        FROM sys.foreign_keys fk
        WHERE fk.referenced_object_id = OBJECT_ID(N'[dbo].[Person]')
        ORDER BY tableName;
      `);

      expect(referencing.map((row) => row.tableName)).toEqual([
        'AuthorProfile',
        'PersonNameVariant',
        'PersonTranslation',
        'ScholarProfile',
        'SpeakerProfile',
        'TeacherProfile',
      ]);
    });

    it('creates no polymorphic contribution pair', async () => {
      const suspects = await admin.query<{ tableName: string }>(`
        SELECT t.name AS tableName
        FROM sys.tables t
        WHERE EXISTS (
            SELECT 1 FROM sys.columns c
            WHERE c.object_id = t.object_id AND c.name IN (N'targetType', N'targetId')
        )
          AND EXISTS (
            SELECT 1 FROM sys.foreign_keys fk
            WHERE fk.parent_object_id = t.object_id
              AND fk.referenced_object_id = OBJECT_ID(N'[dbo].[Person]')
        );
      `);

      expect(suspects).toEqual([]);
    });
  });

  /* =====================================================================
   * Locale vocabulary
   * =================================================================== */

  it('accepts every interface locale as a primary locale, and no other', async () => {
    // The three the platform actually has. A fourth would be a data operation
    // once `localeSchema` grows, not a schema change here.
    for (const locale of localeSchema.options) {
      const slug = freshSlug(`primary-${locale}`);
      const created = await harness.people.createPerson(PROOF_ACTOR, {
        slug,
        primaryLocale: locale,
        name: `Name in ${locale}`,
        biography: null,
      });
      expect(created.ok, `primary locale ${locale}`).toBe(true);
      expect(created.ok && created.person.primaryLocale).toBe(locale);
    }
  });
});
