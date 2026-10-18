import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  PROOF_DOMAIN,
  account,
  applicationColumns,
  approved,
  auditFor,
  count,
  intentsFor,
  label,
  membershipWorld,
  n,
  ownerApplication,
  ownerMembership,
  publishedType,
  reasonOf,
  sentinel,
  sqlNumber,
  submitted,
  underReview,
  wordlessDraft,
  type MembershipWorld,
} from './fixture-sql.ts';

/**
 * Phase 26 — Membership's persistence adapter over a REAL SQL Server, as the
 * provisioned RUNTIME principal, under the migration's real grants, keys and
 * triggers.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that a type moves draft → published →
 * archived → published and never back, and is published only with its primary
 * locale's words; that an application moves only along its lifecycle and a
 * decided or withdrawn one never changes; that an approval creates exactly
 * one Membership in the SAME transaction as its audit row and its intent, and
 * a refusal at any step leaves none of them; that an applicant reaches only
 * their own records; that owed mail is committed once, to the right person,
 * and is owed only while the record still stands where the message says; that
 * every operator read is audited content-free; and that the runtime principal
 * can neither delete a record nor rewrite what identifies it.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 26 Membership persistence against real SQL Server', () => {
  let world: MembershipWorld;
  let admin: SqlSession;
  let operator: string;

  beforeAll(async () => {
    world = await membershipWorld();
    admin = world.db.admin;
    operator = await account(admin);
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  /* ---- the type lifecycle ---------------------------------------------- */

  it('moves a type draft → published → archived → published, one version per change, never back to draft', async () => {
    const id = randomUUID();
    const created = await world.catalogue.createType({
      id,
      actorId: operator,
      value: { primaryLocale: 'en', displayOrder: 7, label: label('en', id) },
    });
    expect(created).toMatchObject({
      id,
      state: 'draft',
      version: 1,
      primaryLocale: 'en',
      displayOrder: 7,
      publishedAt: null,
      archivedAt: null,
      openApplications: 0,
      activeMemberships: 0,
    });
    expect(created.labels).toHaveLength(1);
    expect((await world.reader.publishedTypes()).map((type) => type.id)).not.toContain(
      id,
    );

    const moved = await world.catalogue.reorderType({
      actorId: operator,
      id,
      expectedVersion: 1,
      displayOrder: 3,
    });
    expect(moved).toMatchObject({ version: 2, displayOrder: 3, state: 'draft' });

    // Words are added per locale, and replaced in place — never duplicated.
    const urdu = await world.catalogue.saveLabel({
      actorId: operator,
      id,
      expectedVersion: 2,
      label: label('ur', id),
    });
    expect(urdu.version).toBe(3);
    expect(urdu.labels.map((entry) => entry.locale)).toEqual(['en', 'ur']);
    const replaced = await world.catalogue.saveLabel({
      actorId: operator,
      id,
      expectedVersion: 3,
      label: { ...label('ur', id), title: sentinel('TITLE_REPLACED', id), guidance: 'x' },
    });
    expect(replaced.version).toBe(4);
    expect(replaced.labels).toHaveLength(2);
    expect(replaced.labels.find((entry) => entry.locale === 'ur')).toMatchObject({
      title: sentinel('TITLE_REPLACED', id),
      guidance: 'x',
    });

    // A stale version is a conflict, and changes nothing.
    expect(
      await reasonOf(
        world.catalogue.reorderType({
          actorId: operator,
          id,
          expectedVersion: 3,
          displayOrder: 9,
        }),
      ),
    ).toBe('conflict');
    // A draft cannot be archived.
    expect(
      await reasonOf(
        world.catalogue.transitionType({
          actorId: operator,
          id,
          expectedVersion: 4,
          to: 'archived',
        }),
      ),
    ).toBe('invalid-state');

    const published = await world.catalogue.transitionType({
      actorId: operator,
      id,
      expectedVersion: 4,
      to: 'published',
    });
    expect(published).toMatchObject({ state: 'published', version: 5, archivedAt: null });
    expect(published.publishedAt).toBeInstanceOf(Date);
    expect((await world.reader.publishedTypes()).map((type) => type.id)).toContain(id);
    expect(
      await reasonOf(
        world.catalogue.transitionType({
          actorId: operator,
          id,
          expectedVersion: 5,
          to: 'published',
        }),
      ),
    ).toBe('invalid-state');

    const archived = await world.catalogue.transitionType({
      actorId: operator,
      id,
      expectedVersion: 5,
      to: 'archived',
    });
    expect(archived).toMatchObject({ state: 'archived', version: 6 });
    expect(archived.archivedAt).toBeInstanceOf(Date);
    expect((await world.reader.publishedTypes()).map((type) => type.id)).not.toContain(
      id,
    );

    const republished = await world.catalogue.transitionType({
      actorId: operator,
      id,
      expectedVersion: 6,
      to: 'published',
    });
    expect(republished).toMatchObject({
      state: 'published',
      version: 7,
      archivedAt: null,
    });

    // THE FLOOR: even the owner cannot return a public type to draft (51320),
    // nor move its version other than by one.
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipType] SET [state] = N'draft', [publishedAt] = NULL, [version] = 8 WHERE [id] = ${n(id)};`,
        ),
      ),
    ).toBe(51320);
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipType] SET [displayOrder] = 1 WHERE [id] = ${n(id)};`,
        ),
      ),
    ).toBe(51320);

    // Every change audited, by field and state — never by the words.
    const audit = await auditFor(admin, id);
    expect(audit.map((row) => row.action)).toEqual([
      'membership.type.created',
      'membership.type.updated',
      'membership.type.updated',
      'membership.type.updated',
      'membership.type.published',
      'membership.type.archived',
      'membership.type.published',
    ]);
    expect(new Set(audit.map((row) => row.authorisingSource))).toEqual(
      new Set(['membership.administer']),
    );
    expect(audit.every((row) => row.targetType === 'membership-type')).toBe(true);
    for (const row of audit)
      expect(`${row.beforeState ?? ''}${row.afterState ?? ''}`).not.toContain(
        'NON_MEMBERSHIP_FIXTURE',
      );
    expect(JSON.parse(audit[2]?.afterState ?? '{}')).toEqual({
      version: '3',
      state: 'draft',
      changed: 'label',
      locale: 'ur',
    });

    expect(await world.catalogue.type(randomUUID())).toBeNull();
    expect(
      await reasonOf(
        world.catalogue.reorderType({
          actorId: operator,
          id: randomUUID(),
          expectedVersion: 1,
          displayOrder: 1,
        }),
      ),
    ).toBe('not-found');
  });

  it('publishes a type only with its primary locale’s words — the adapter asks, the trigger is the floor', async () => {
    const id = await wordlessDraft(admin);
    expect(
      await reasonOf(
        world.catalogue.transitionType({
          actorId: operator,
          id,
          expectedVersion: 1,
          to: 'published',
        }),
      ),
    ).toBe('incomplete');
    // Words in another locale are not the primary locale's.
    await world.catalogue.saveLabel({
      actorId: operator,
      id,
      expectedVersion: 1,
      label: label('ar', id),
    });
    expect(
      await reasonOf(
        world.catalogue.transitionType({
          actorId: operator,
          id,
          expectedVersion: 2,
          to: 'published',
        }),
      ),
    ).toBe('incomplete');
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipType] SET [state] = N'published', [publishedAt] = SYSUTCDATETIME(), [version] = 3 WHERE [id] = ${n(id)};`,
        ),
      ),
    ).toBe(51321);
    expect((await world.catalogue.type(id))?.state).toBe('draft');
    await world.catalogue.saveLabel({
      actorId: operator,
      id,
      expectedVersion: 2,
      label: label('en', id),
    });
    expect(
      (
        await world.catalogue.transitionType({
          actorId: operator,
          id,
          expectedVersion: 3,
          to: 'published',
        })
      ).state,
    ).toBe('published');
  });

  /* ---- submission ------------------------------------------------------ */

  it('takes an application only on a published type, once per open application', async () => {
    const applicant = await account(admin);
    const draft = randomUUID();
    await world.catalogue.createType({
      id: draft,
      actorId: operator,
      value: { primaryLocale: 'en', displayOrder: 50, label: label('en', draft) },
    });
    const archived = await publishedType(world, operator);
    await world.catalogue.transitionType({
      actorId: operator,
      id: archived,
      expectedVersion: 2,
      to: 'archived',
    });
    for (const membershipTypeId of [draft, archived, randomUUID()])
      expect(
        await reasonOf(
          world.applicant.submit({
            id: randomUUID(),
            accountId: applicant,
            membershipTypeId,
          }),
        ),
      ).toBe('type-unavailable');
    expect(
      await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(applicant)}`),
    ).toBe(0);

    const type = await publishedType(world, operator);
    const first = randomUUID();
    expect(
      await world.applicant.submit({
        id: first,
        accountId: applicant,
        membershipTypeId: type,
      }),
    ).toEqual({ applicationId: first, created: true });
    // The duplicate answers with the open application, and owes nothing new.
    expect(
      await world.applicant.submit({
        id: randomUUID(),
        accountId: applicant,
        membershipTypeId: type,
      }),
    ).toEqual({ applicationId: first, created: false });
    expect(
      await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(applicant)}`),
    ).toBe(1);
    const intents = await intentsFor(admin, first);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      purpose: 'membership.application.submitted',
      recipientUserId: applicant,
      applicationId: first,
      membershipId: null,
      state: 'pending',
      idempotencyKey: `membership.application.submitted:${first}`,
    });
    const state = await world.applicant.state(applicant);
    expect(state.applications).toHaveLength(1);
    expect(state.applications[0]).toMatchObject({
      id: first,
      membershipTypeId: type,
      status: 'submitted',
      version: 1,
      withdrawalSource: null,
      membershipId: null,
    });
    expect(state.applications[0]).not.toHaveProperty('applicantAccountId');
    expect(state.available.map((entry) => entry.id)).toContain(type);
    expect(state.available.map((entry) => entry.id)).not.toContain(draft);
    expect(state.types.map((entry) => entry.id)).toEqual([type]);
    // Self-service acts are not audited.
    expect(await auditFor(admin, first)).toEqual([]);
  });

  /* ---- the application lifecycle -------------------------------------- */

  it('moves an application only along its lifecycle; a decided or withdrawn one never changes', async () => {
    const type = await publishedType(world, operator);

    // A decision needs a review first.
    const a = await account(admin);
    const fresh = await submitted(world, a, type);
    for (const decision of ['approve', 'reject'] as const)
      expect(
        await reasonOf(
          world.staff.decide({
            actorId: operator,
            id: fresh,
            expectedVersion: 1,
            decision,
            membershipId: randomUUID(),
          }),
        ),
      ).toBe('invalid-state');
    // Withdrawn from submitted, then final.
    const withdrawn = await world.applicant.withdraw({
      accountId: a,
      id: fresh,
      expectedVersion: 1,
    });
    expect(withdrawn).toMatchObject({
      status: 'withdrawn',
      withdrawalSource: 'applicant',
      version: 2,
    });
    expect(withdrawn.withdrawnAt).toBeInstanceOf(Date);
    expect(
      await reasonOf(
        world.staff.startReview({ actorId: operator, id: fresh, expectedVersion: 2 }),
      ),
    ).toBe('invalid-state');
    expect(
      await reasonOf(
        world.applicant.withdraw({ accountId: a, id: fresh, expectedVersion: 2 }),
      ),
    ).toBe('invalid-state');

    // Withdrawn from under review.
    const b = await account(admin);
    const reviewing = await underReview(world, operator, b, type);
    expect(
      (
        await world.applicant.withdraw({
          accountId: b,
          id: reviewing,
          expectedVersion: 2,
        })
      ).status,
    ).toBe('withdrawn');

    // Rejected from under review, then final; no Membership.
    const c = await account(admin);
    const rejectedId = await underReview(world, operator, c, type);
    expect(
      await reasonOf(
        world.staff.startReview({
          actorId: operator,
          id: rejectedId,
          expectedVersion: 2,
        }),
      ),
    ).toBe('invalid-state');
    const rejected = await world.staff.decide({
      actorId: operator,
      id: rejectedId,
      expectedVersion: 2,
      decision: 'reject',
      membershipId: randomUUID(),
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      version: 3,
      membershipId: null,
      applicantAccountId: c,
    });
    expect(rejected.decidedAt).toBeInstanceOf(Date);
    // Each attempt is started only when it is awaited, one at a time.
    for (const attempt of [
      () =>
        world.staff.decide({
          actorId: operator,
          id: rejectedId,
          expectedVersion: 3,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      () =>
        world.staff.startReview({
          actorId: operator,
          id: rejectedId,
          expectedVersion: 3,
        }),
      () =>
        world.applicant.withdraw({ accountId: c, id: rejectedId, expectedVersion: 3 }),
    ])
      expect(await reasonOf(attempt())).toBe('invalid-state');
    expect(
      await count(admin, 'Membership', `[sourceApplicationId] = ${n(rejectedId)}`),
    ).toBe(0);

    // Approved from under review: exactly one Membership, active, from it.
    const d = await account(admin);
    const { applicationId, membershipId } = await approved(world, operator, d, type);
    expect(await count(admin, 'Membership', `[memberUserId] = ${n(d)}`)).toBe(1);
    const state = await world.applicant.state(d);
    expect(state.applications[0]).toMatchObject({
      id: applicationId,
      status: 'approved',
      version: 3,
      membershipId,
    });
    expect(state.memberships).toHaveLength(1);
    expect(state.memberships[0]).toMatchObject({
      id: membershipId,
      membershipTypeId: type,
      sourceApplicationId: applicationId,
      status: 'active',
      version: 1,
      closureSource: null,
      closedAt: null,
    });
    expect(state.memberships[0]?.activatedAt.getTime()).toBe(
      state.applications[0]?.decidedAt?.getTime(),
    );
    expect(
      await reasonOf(
        world.applicant.withdraw({ accountId: d, id: applicationId, expectedVersion: 3 }),
      ),
    ).toBe('invalid-state');

    // A stale version is a conflict, whatever the step.
    const e = await account(admin);
    const stale = await underReview(world, operator, e, type);
    expect(
      await reasonOf(
        world.staff.decide({
          actorId: operator,
          id: stale,
          expectedVersion: 1,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      ),
    ).toBe('conflict');
    expect(
      await reasonOf(
        world.applicant.withdraw({ accountId: e, id: stale, expectedVersion: 1 }),
      ),
    ).toBe('conflict');

    // THE FLOOR beneath every refusal above, even for the owner (51322).
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipApplication] SET [status] = N'under_review', [decidedAt] = NULL, [version] = 4 WHERE [id] = ${n(rejectedId)};`,
        ),
      ),
    ).toBe(51322);
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipApplication] SET [status] = N'approved', [reviewStartedAt] = SYSUTCDATETIME(), [decidedAt] = SYSUTCDATETIME(), [version] = 2 WHERE [id] = ${n(await submitted(world, await account(admin), type))};`,
        ),
      ),
    ).toBe(51322);
  });

  it('blocks a new application while a Membership is active, and allows one after closure, rejection or withdrawal', async () => {
    const type = await publishedType(world, operator);
    const member = await account(admin);
    const { membershipId } = await approved(world, operator, member, type);
    expect(
      await reasonOf(
        world.applicant.submit({
          id: randomUUID(),
          accountId: member,
          membershipTypeId: type,
        }),
      ),
    ).toBe('already-member');
    // The trigger floor says the same to the owner (51323).
    expect(
      await sqlNumber(
        admin.query(`
          INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[version],[submittedAt])
          VALUES (NEWID(), ${n(member)}, ${n(type)}, N'submitted', 1, SYSUTCDATETIME());`),
      ),
    ).toBe(51323);

    const closed = await world.applicant.closeOwn({
      accountId: member,
      id: membershipId,
      expectedVersion: 1,
    });
    expect(closed).toMatchObject({
      status: 'closed',
      closureSource: 'member',
      version: 2,
    });
    expect(closed.closedAt).toBeInstanceOf(Date);
    expect(
      await reasonOf(
        world.applicant.closeOwn({
          accountId: member,
          id: membershipId,
          expectedVersion: 2,
        }),
      ),
    ).toBe('invalid-state');
    // Closing never edits the application, and a closed Membership never reopens.
    expect(
      await count(
        admin,
        'MembershipApplication',
        `[applicantUserId] = ${n(member)} AND [status] = N'approved' AND [version] = 3`,
      ),
    ).toBe(1);
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[Membership] SET [status] = N'active', [closedAt] = NULL, [closureSource] = NULL, [version] = 3 WHERE [id] = ${n(membershipId)};`,
        ),
      ),
    ).toBe(51324);
    expect(
      (
        await world.applicant.submit({
          id: randomUUID(),
          accountId: member,
          membershipTypeId: type,
        })
      ).created,
    ).toBe(true);

    // After a rejection.
    const rejectedApplicant = await account(admin);
    const rejected = await underReview(world, operator, rejectedApplicant, type);
    await world.staff.decide({
      actorId: operator,
      id: rejected,
      expectedVersion: 2,
      decision: 'reject',
      membershipId: randomUUID(),
    });
    expect(
      (
        await world.applicant.submit({
          id: randomUUID(),
          accountId: rejectedApplicant,
          membershipTypeId: type,
        })
      ).created,
    ).toBe(true);
  });

  it('lets an applicant reach only their own records — another person’s id is not found', async () => {
    const type = await publishedType(world, operator);
    const mine = await account(admin);
    const theirs = await account(admin);
    const myApplication = await submitted(world, mine, type);
    const their = await approved(world, operator, theirs, type);
    const theirOpenType = await publishedType(world, operator);
    const theirOpen = await submitted(world, theirs, theirOpenType);

    for (const id of [theirOpen, their.applicationId, randomUUID()])
      expect(
        await reasonOf(
          world.applicant.withdraw({ accountId: mine, id, expectedVersion: 1 }),
        ),
      ).toBe('not-found');
    for (const id of [their.membershipId, randomUUID()])
      expect(
        await reasonOf(
          world.applicant.closeOwn({ accountId: mine, id, expectedVersion: 1 }),
        ),
      ).toBe('not-found');
    // The owner cannot withdraw another's application by naming their own account either.
    expect(
      await reasonOf(
        world.applicant.withdraw({
          accountId: theirs,
          id: myApplication,
          expectedVersion: 1,
        }),
      ),
    ).toBe('not-found');

    const state = await world.applicant.state(mine);
    expect(state.applications.map((row) => row.id)).toEqual([myApplication]);
    expect(state.memberships).toEqual([]);
    const exported = await world.exporter.collect(mine);
    expect(exported.applications.map((row) => row.id)).toEqual([myApplication]);
    expect(exported.memberships).toEqual([]);

    // Nothing of theirs moved.
    expect((await applicationColumns(admin, theirOpen))?.status).toBe('submitted');
    expect(
      await count(
        admin,
        'Membership',
        `[id] = ${n(their.membershipId)} AND [status] = N'active'`,
      ),
    ).toBe(1);
  });

  /* ---- approval atomicity --------------------------------------------- */

  it('commits an approval whole or not at all', async () => {
    const type = await publishedType(world, operator);

    // (1) The type archived between review and decision: no approval…
    const archivedFor = await account(admin);
    const waiting = await underReview(world, operator, archivedFor, type);
    await world.catalogue.transitionType({
      actorId: operator,
      id: type,
      expectedVersion: 2,
      to: 'archived',
    });
    expect(
      await reasonOf(
        world.staff.decide({
          actorId: operator,
          id: waiting,
          expectedVersion: 2,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      ),
    ).toBe('type-unavailable');
    expect(await applicationColumns(admin, waiting)).toMatchObject({
      status: 'under_review',
      version: 2,
    });
    expect(
      await count(admin, 'Membership', `[sourceApplicationId] = ${n(waiting)}`),
    ).toBe(0);
    expect((await auditFor(admin, waiting)).map((row) => row.action)).toEqual([
      'membership.application.review-started',
    ]);
    expect((await intentsFor(admin, waiting)).map((row) => row.purpose)).toEqual([
      'membership.application.submitted',
      'membership.application.under-review',
    ]);
    // …but a rejection is allowed whatever the type's state.
    expect(
      (
        await world.staff.decide({
          actorId: operator,
          id: waiting,
          expectedVersion: 2,
          decision: 'reject',
          membershipId: randomUUID(),
        })
      ).status,
    ).toBe('rejected');

    // (2) A failure AFTER the decision was written — the Membership insert
    // meets an identifier already taken — rolls the decision back with it.
    const open = await publishedType(world, operator);
    const earlier = await approved(world, operator, await account(admin), open);
    const unlucky = await account(admin);
    const midway = await underReview(world, operator, unlucky, open);
    expect(
      await reasonOf(
        world.staff.decide({
          actorId: operator,
          id: midway,
          expectedVersion: 2,
          decision: 'approve',
          membershipId: earlier.membershipId,
        }),
      ),
    ).toBe('conflict');
    expect(await applicationColumns(admin, midway)).toMatchObject({
      status: 'under_review',
      version: 2,
    });
    expect(await count(admin, 'Membership', `[memberUserId] = ${n(unlucky)}`)).toBe(0);
    expect((await auditFor(admin, midway)).map((row) => row.action)).toEqual([
      'membership.application.review-started',
    ]);
    expect((await intentsFor(admin, midway)).map((row) => row.purpose)).not.toContain(
      'membership.application.approved',
    );

    // (3) An active Membership the owner inserted while the application was
    // under review: refused `already-member`, precisely, before any write.
    const owner = await account(admin);
    const source = await ownerApplication(admin, owner, open, 'approved');
    const pending = await underReview(world, operator, owner, open);
    await ownerMembership(admin, {
      id: randomUUID(),
      accountId: owner,
      membershipTypeId: open,
      applicationId: source,
    });
    expect(
      await reasonOf(
        world.staff.decide({
          actorId: operator,
          id: pending,
          expectedVersion: 2,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      ),
    ).toBe('already-member');
    expect(await applicationColumns(admin, pending)).toMatchObject({
      status: 'under_review',
      version: 2,
    });
    expect(await count(admin, 'Membership', `[memberUserId] = ${n(owner)}`)).toBe(1);
    expect((await auditFor(admin, pending)).map((row) => row.action)).toEqual([
      'membership.application.review-started',
    ]);
  });

  /* ---- owed mail -------------------------------------------------------- */

  it('commits each owed message once, to the applicant or member, naming the one record', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const { applicationId, membershipId } = await approved(world, operator, person, type);
    // A replayed decision changes nothing and owes nothing more.
    expect(
      await reasonOf(
        world.staff.decide({
          actorId: operator,
          id: applicationId,
          expectedVersion: 2,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      ),
    ).toBe('conflict');
    const intents = await intentsFor(admin, applicationId);
    expect(intents.map((row) => row.purpose)).toEqual([
      'membership.application.approved',
      'membership.application.submitted',
      'membership.application.under-review',
    ]);
    for (const row of intents)
      expect(row).toMatchObject({
        recipientUserId: person,
        applicationId,
        membershipId: null,
        state: 'pending',
        idempotencyKey: `${row.purpose}:${applicationId}`,
      });

    await world.staff.closeMembership({
      actorId: operator,
      id: membershipId,
      expectedVersion: 1,
    });
    const closure = await intentsFor(admin, membershipId);
    expect(closure).toHaveLength(1);
    expect(closure[0]).toMatchObject({
      purpose: 'membership.closed',
      recipientUserId: person,
      applicationId: null,
      membershipId,
      idempotencyKey: `membership.closed:${membershipId}`,
    });
    // Nothing else names this person.
    expect(
      await count(
        admin,
        'MembershipCommunicationIntent',
        `[recipientUserId] = ${n(person)}`,
      ),
    ).toBe(4);
  });

  it('leases due intents, relays and abandons each once', async () => {
    // A clean slate for the claim: every intent earlier proofs left pending is
    // settled by the owner, so the claim sees only this proof's intents.
    await admin.query(
      `UPDATE [dbo].[MembershipCommunicationIntent] SET [state] = N'abandoned' WHERE [state] = N'pending';`,
    );
    const type = await publishedType(world, operator);
    const first = await submitted(world, await account(admin), type);
    const second = await submitted(world, await account(admin), type);
    const [firstIntent] = await intentsFor(admin, first);
    const [secondIntent] = await intentsFor(admin, second);
    const ids = [firstIntent?.id, secondIntent?.id];

    // Not due yet in the past.
    expect(
      await world.communication.claimDue(new Date(Date.now() - 3_600_000), 100, 120),
    ).toEqual([]);
    const now = new Date(Date.now() + 60_000);
    const claimed = await world.communication.claimDue(now, 100, 120);
    expect(claimed.map((row) => row.id).sort()).toEqual([...ids].sort());
    expect(claimed[0]).toMatchObject({
      state: 'pending',
      purpose: 'membership.application.submitted',
    });
    // The lease holds: a second dispatcher at the same instant claims nothing…
    expect(await world.communication.claimDue(now, 100, 120)).toEqual([]);
    // …and a bounded claim takes at most its limit once the lease lapses.
    const later = new Date(now.getTime() + 121_000);
    expect(await world.communication.claimDue(later, 1, 120)).toHaveLength(1);

    await world.communication.markRelayed(firstIntent?.id ?? '');
    await world.communication.markAbandoned(secondIntent?.id ?? '');
    // Settled once: a second mark of either kind moves nothing.
    await world.communication.markAbandoned(firstIntent?.id ?? '');
    await world.communication.markRelayed(secondIntent?.id ?? '');
    const [relayed] = await intentsFor(admin, first);
    const [abandoned] = await intentsFor(admin, second);
    expect(relayed?.state).toBe('relayed');
    expect(abandoned?.state).toBe('abandoned');
    expect(
      await count(
        admin,
        'MembershipCommunicationIntent',
        `[id] = ${n(firstIntent?.id ?? '')} AND [relayedAt] IS NOT NULL AND [claimedUntil] IS NULL`,
      ),
    ).toBe(1);
    expect(
      await world.communication.claimDue(new Date(later.getTime() + 600_000), 100, 120),
    ).toEqual([]);
    // THE FLOOR: a settled intent never reopens, even for the owner (51325).
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MembershipCommunicationIntent] SET [state] = N'pending' WHERE [id] = ${n(firstIntent?.id ?? '')};`,
        ),
      ),
    ).toBe(51325);
  });

  it('answers what is owed from Membership’s own rows as they stand', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await submitted(world, person, type);
    const intent = async (purpose: string) =>
      (await intentsFor(admin, id)).find((row) => row.purpose === purpose)?.id ?? '';
    const owed = async (intentId: string) =>
      (await world.communication.deliverySource(intentId))?.owed;

    const submittedIntent = await intent('membership.application.submitted');
    const source = await world.communication.deliverySource(submittedIntent);
    expect(source).toMatchObject({
      owed: true,
      intent: {
        id: submittedIntent,
        purpose: 'membership.application.submitted',
        recipientAccountId: person,
        applicationId: id,
        membershipId: null,
        state: 'pending',
      },
      type: { id: type, state: 'published', primaryLocale: 'en' },
    });
    expect(source?.type.labels.map((entry) => entry.locale)).toEqual(['en']);

    // RELAYED IS STILL OWED while the record stands — the send-time question
    // the service asks after it marked the intent relayed.
    await world.communication.markRelayed(submittedIntent);
    expect(await world.communication.deliverySource(submittedIntent)).toMatchObject({
      owed: true,
      intent: { state: 'relayed' },
    });

    // A later transition makes the earlier message stale, relayed or not, and
    // owes its own.
    await world.staff.startReview({ actorId: operator, id, expectedVersion: 1 });
    expect(await owed(submittedIntent)).toBe(false);
    const reviewIntent = await intent('membership.application.under-review');
    expect(await owed(reviewIntent)).toBe(true);
    await world.applicant.withdraw({ accountId: person, id, expectedVersion: 2 });
    expect(await owed(reviewIntent)).toBe(false);
    const withdrawnIntent = await intent('membership.application.withdrawn');
    expect(await owed(withdrawnIntent)).toBe(true);
    // The answer is the record's: an abandoned intent reports its state, and
    // the service — not this answer — refuses to send it.
    await world.communication.markAbandoned(withdrawnIntent);
    expect(await world.communication.deliverySource(withdrawnIntent)).toMatchObject({
      owed: true,
      intent: { state: 'abandoned' },
    });

    // A closure is owed while the Membership stays closed.
    const member = await account(admin);
    const { membershipId } = await approved(world, operator, member, type);
    await world.applicant.closeOwn({
      accountId: member,
      id: membershipId,
      expectedVersion: 1,
    });
    const [closure] = await intentsFor(admin, membershipId);
    expect(await world.communication.deliverySource(closure?.id ?? '')).toMatchObject({
      owed: true,
      intent: { purpose: 'membership.closed', membershipId, applicationId: null },
      type: { id: type },
    });
    // A type archived since is still named, in its current state.
    await world.catalogue.transitionType({
      actorId: operator,
      id: type,
      expectedVersion: 2,
      to: 'archived',
    });
    expect(
      (await world.communication.deliverySource(closure?.id ?? ''))?.type.state,
    ).toBe('archived');

    expect(await world.communication.deliverySource(randomUUID())).toBeNull();
  });

  /* ---- operator reads --------------------------------------------------- */

  it('audits every operator read in the same transaction, by identifiers only', async () => {
    const type = await publishedType(world, operator);
    const older = await account(admin);
    const newer = await account(admin);
    const first = await submitted(world, older, type);
    const second = await underReview(world, operator, newer, type);

    const page = await world.staff.applications(operator, {
      status: 'open',
      membershipTypeId: type,
      offset: 0,
    });
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.id)).toEqual([first, second]);
    expect(page.rows[0]).toMatchObject({
      applicantAccountId: older,
      status: 'submitted',
    });
    expect(
      (
        await world.staff.applications(operator, {
          status: 'under_review',
          membershipTypeId: type,
          offset: 0,
        })
      ).rows.map((row) => row.id),
    ).toEqual([second]);
    expect(
      (
        await world.staff.applications(operator, {
          status: 'open',
          membershipTypeId: type,
          offset: 1,
        })
      ).rows.map((row) => row.id),
    ).toEqual([second]);

    const listed = await admin.query<{ afterState: string; authorisingSource: string }>(`
      SELECT [afterState], [authorisingSource] FROM [dbo].[AuditLog]
      WHERE [action] = N'membership.applications.listed' AND [actorId] = ${n(operator)}
        AND [targetId] IS NULL AND [targetType] = N'membership-application'
        AND [afterState] LIKE ${n(`%${type}%`)}
      ORDER BY [occurredAt], [id];`);
    expect(listed).toHaveLength(3);
    expect(JSON.parse(listed[0]?.afterState ?? '{}')).toEqual({
      count: '2',
      status: 'open',
      typeId: type,
    });
    expect(listed[0]?.authorisingSource).toBe('membership.read');

    const detail = await world.staff.application(operator, second);
    expect(detail).toMatchObject({ id: second, applicantAccountId: newer, version: 2 });
    expect((await auditFor(admin, second)).map((row) => row.action)).toEqual([
      'membership.application.review-started',
      'membership.application.accessed',
    ]);
    // Nothing returned, nothing recorded.
    const missing = randomUUID();
    expect(await world.staff.application(operator, missing)).toBeNull();
    expect(await auditFor(admin, missing)).toEqual([]);

    // The service's identifier-only lookup: the applicant, and NO audit row.
    const before = await count(admin, 'AuditLog');
    expect(await world.staff.applicantOf(first)).toBe(older);
    expect(await world.staff.applicantOf(missing)).toBeNull();
    expect(await count(admin, 'AuditLog')).toBe(before);
    expect((await auditFor(admin, first)).map((row) => row.action)).toEqual([]);

    const members = await world.staff.memberships(operator, {
      status: 'active',
      membershipTypeId: type,
      offset: 0,
    });
    expect(members).toEqual({ rows: [], total: 0 });
    expect(
      await count(
        admin,
        'AuditLog',
        `[action] = N'membership.memberships.listed' AND [targetType] = N'membership' AND [afterState] LIKE ${n(`%${type}%`)}`,
      ),
    ).toBe(1);

    // NO membership audit row anywhere names an address or a fixture's words.
    expect(
      await count(
        admin,
        'AuditLog',
        `[action] LIKE N'membership.%' AND (
           ISNULL([beforeState], N'') + ISNULL([afterState], N'') LIKE ${n(`%${PROOF_DOMAIN}%`)}
           OR ISNULL([beforeState], N'') + ISNULL([afterState], N'') LIKE N'%NON[_]MEMBERSHIP[_]FIXTURE%')`,
      ),
    ).toBe(0);
  });

  it('pages Memberships most recently activated first, closure audited by identifiers', async () => {
    const type = await publishedType(world, operator);
    const a = await approved(world, operator, await account(admin), type);
    const b = await approved(world, operator, await account(admin), type);
    const page = await world.staff.memberships(operator, {
      status: null,
      membershipTypeId: type,
      offset: 0,
    });
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.id)).toEqual([b.membershipId, a.membershipId]);

    const closed = await world.staff.closeMembership({
      actorId: operator,
      id: a.membershipId,
      expectedVersion: 1,
    });
    expect(closed).toMatchObject({
      status: 'closed',
      closureSource: 'operator',
      version: 2,
    });
    expect(
      await reasonOf(
        world.staff.closeMembership({
          actorId: operator,
          id: a.membershipId,
          expectedVersion: 2,
        }),
      ),
    ).toBe('invalid-state');
    expect(
      await reasonOf(
        world.staff.closeMembership({
          actorId: operator,
          id: randomUUID(),
          expectedVersion: 1,
        }),
      ),
    ).toBe('not-found');
    const [audit] = await auditFor(admin, a.membershipId);
    expect(audit).toMatchObject({
      action: 'membership.membership.closed',
      targetType: 'membership',
      authorisingSource: 'membership.administer',
    });
    expect(JSON.parse(audit?.afterState ?? '{}')).toEqual({
      status: 'closed',
      version: '2',
      membershipTypeId: type,
      closureSource: 'operator',
    });
    expect(
      (
        await world.staff.memberships(operator, {
          status: 'active',
          membershipTypeId: type,
          offset: 0,
        })
      ).rows.map((row) => row.id),
    ).toEqual([b.membershipId]);
  });

  /* ---- export ----------------------------------------------------------- */

  it('exports only the account’s own rows, in a fixed order', async () => {
    const one = await publishedType(world, operator);
    const two = await publishedType(world, operator);
    const person = await account(admin);
    const other = await account(admin);
    const withdrawn = await submitted(world, person, one);
    await world.applicant.withdraw({
      accountId: person,
      id: withdrawn,
      expectedVersion: 1,
    });
    const membership = await approved(world, operator, person, two);
    await approved(world, operator, other, one);

    const exported = await world.exporter.collect(person);
    expect(exported.applications.map((row) => row.id)).toEqual([
      withdrawn,
      membership.applicationId,
    ]);
    expect(exported.applications[0]).toMatchObject({
      membershipTypeId: one,
      status: 'withdrawn',
      withdrawalSource: 'applicant',
      decidedAt: null,
    });
    expect(typeof exported.applications[0]?.withdrawnAt).toBe('string');
    expect(exported.memberships).toEqual([
      expect.objectContaining({
        id: membership.membershipId,
        membershipTypeId: two,
        sourceApplicationId: membership.applicationId,
        status: 'active',
        closureSource: null,
        closedAt: null,
      }),
    ]);
    const serialised = JSON.stringify(exported);
    expect(serialised).not.toContain(other);
    expect(serialised).not.toContain('NON_MEMBERSHIP_FIXTURE');
    expect(serialised).not.toContain(PROOF_DOMAIN);
    expect(await world.exporter.collect(person)).toEqual(exported);
  });

  /* ---- the runtime principal's floor ----------------------------------- */

  it('denies the runtime principal every delete and every identifying column', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const { applicationId, membershipId } = await approved(world, operator, person, type);
    const openApplicant = await account(admin);
    const open = await submitted(world, openApplicant, type);

    for (const statement of [
      `DELETE FROM [dbo].[MembershipApplication] WHERE [id] = ${n(applicationId)};`,
      `DELETE FROM [dbo].[Membership] WHERE [id] = ${n(membershipId)};`,
      `DELETE FROM [dbo].[MembershipType] WHERE [id] = ${n(type)};`,
      `DELETE FROM [dbo].[MembershipTypeTranslation] WHERE [membershipTypeId] = ${n(type)};`,
    ])
      expect(await sqlNumber(world.app.query(statement))).toBe(229);

    for (const statement of [
      `UPDATE [dbo].[MembershipApplication] SET [applicantUserId] = ${n(operator)} WHERE [id] = ${n(open)};`,
      `UPDATE [dbo].[MembershipApplication] SET [submittedAt] = SYSUTCDATETIME() WHERE [id] = ${n(open)};`,
      `UPDATE [dbo].[Membership] SET [memberUserId] = ${n(operator)} WHERE [id] = ${n(membershipId)};`,
      `UPDATE [dbo].[Membership] SET [sourceApplicationId] = ${n(open)} WHERE [id] = ${n(membershipId)};`,
      `UPDATE [dbo].[MembershipType] SET [primaryLocale] = N'ar' WHERE [id] = ${n(type)};`,
      `UPDATE [dbo].[MembershipTypeTranslation] SET [locale] = N'ar' WHERE [membershipTypeId] = ${n(type)};`,
      `UPDATE [dbo].[MembershipCommunicationIntent] SET [idempotencyKey] = N'x' WHERE [applicationId] = ${n(open)};`,
      `UPDATE [dbo].[MembershipCommunicationIntent] SET [recipientUserId] = ${n(operator)} WHERE [applicationId] = ${n(open)};`,
    ])
      expect(await sqlNumber(world.app.query(statement))).toBe(230);

    // The triggers refuse an illegal transition by direct runtime SQL too.
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[MembershipApplication] SET [status] = N'approved', [reviewStartedAt] = SYSUTCDATETIME(), [decidedAt] = SYSUTCDATETIME(), [version] = 2 WHERE [id] = ${n(open)};`,
        ),
      ),
    ).toBe(51322);
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[MembershipApplication] SET [version] = 7 WHERE [id] = ${n(open)};`,
        ),
      ),
    ).toBe(51322);
    // A Membership only from its own APPROVED application (51324).
    expect(
      await sqlNumber(
        world.app.query(
          `INSERT INTO [dbo].[Membership] ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[status],[version],[activatedAt])
           VALUES (NEWID(), ${n(openApplicant)}, ${n(type)}, ${n(open)}, N'active', 1, SYSUTCDATETIME());`,
        ),
      ),
    ).toBe(51324);
    await world.applicant.closeOwn({
      accountId: person,
      id: membershipId,
      expectedVersion: 1,
    });
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[Membership] SET [status] = N'active', [closedAt] = NULL, [closureSource] = NULL, [version] = 3 WHERE [id] = ${n(membershipId)};`,
        ),
      ),
    ).toBe(51324);
    // Every row is still there.
    expect(
      await count(admin, 'MembershipApplication', `[id] = ${n(applicationId)}`),
    ).toBe(1);
    expect(await count(admin, 'Membership', `[id] = ${n(membershipId)}`)).toBe(1);
  });

  /* ---- the catalogue bound (last: it fills the catalogue) -------------- */

  it('holds at most fifty types, whatever their state', async () => {
    const existing = await count(admin, 'MembershipType');
    for (let index = existing; index < 49; index += 1) await wordlessDraft(admin);
    const fiftieth = randomUUID();
    await world.catalogue.createType({
      id: fiftieth,
      actorId: operator,
      value: { primaryLocale: 'ar', displayOrder: 1, label: label('ar', fiftieth) },
    });
    expect(await count(admin, 'MembershipType')).toBe(50);
    const refused = randomUUID();
    expect(
      await reasonOf(
        world.catalogue.createType({
          id: refused,
          actorId: operator,
          value: { primaryLocale: 'en', displayOrder: 1, label: label('en', refused) },
        }),
      ),
    ).toBe('limit');
    expect(await count(admin, 'MembershipType')).toBe(50);
    expect(
      await count(
        admin,
        'MembershipTypeTranslation',
        `[membershipTypeId] = ${n(refused)}`,
      ),
    ).toBe(0);
    expect(await world.catalogue.types()).toHaveLength(50);
  });
});
