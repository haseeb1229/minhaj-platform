import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { MessagingService } from '../../packages/server-core/src/messaging/index.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activateLive,
  activateMessaging,
  conversationRows,
  count,
  enrol,
  grantRole,
  liveCourse,
  messagingWorld,
  n,
  op,
  reasonOf,
  revokeAssignment,
  scope,
  sentinel,
  teacherAccount,
  withdrawEnrolment,
  type MessagingWorld,
  type RoleFixture,
} from './fixture-sql.ts';

/**
 * Phase 24 — Messaging's part of account closure, and a person's export, over
 * a REAL SQL Server, through the REAL service, as the provisioned RUNTIME
 * principal. Accounts are closed by IDENTITY's own closure (its adapter's one
 * transaction), Learning disposes of its own rows through its own adapter,
 * and Messaging then disposes of its rows only because Identity reports the
 * account closed.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that disposition refuses a living
 * account; that a closed person's conversations close as `account-closed` and
 * their live state goes, while the person left behind keeps READ-ONLY
 * history exactly while their own half of the relationship is current — and
 * loses it the moment it is not; that a conversation goes entirely once
 * everybody in it has closed, unless a report holds it as evidence; that a
 * re-registration with the same address is a new account that inherits
 * nothing; that disposition is idempotent and resumes from wherever it was
 * interrupted; and that an export is the person's own rows and own words only.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

live('Phase 24 Messaging closure, disposition and export against real SQL Server', () => {
  let world: MessagingWorld;
  let admin: SqlSession;
  let service: MessagingService;

  beforeAll(async () => {
    world = await messagingWorld();
    admin = world.db.admin;
    service = world.service;
    await activateMessaging(admin, 'teacher-student');
    await activateMessaging(admin, 'support');
    await activateLive(admin, 'fixture');
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  /* ---- fixtures --------------------------------------------------------- */

  interface Pair {
    readonly teacher: RoleFixture;
    readonly learner: string;
    readonly courseId: string;
    readonly conversationId: string;
  }

  async function pair(
    existing: { readonly teacher?: RoleFixture; readonly learner?: string } = {},
  ): Promise<Pair> {
    const teacher = existing.teacher ?? (await teacherAccount(admin));
    const learner = existing.learner ?? (await account(admin));
    const courseId = await liveCourse(admin);
    await scope(admin, courseId, teacher);
    await enrol(admin, learner, courseId);
    const { conversationId } = await service.startTeaching(me(learner), {
      counterpartAccountId: teacher.accountId,
      courseId,
    });
    return { teacher, learner, courseId, conversationId };
  }

  const text = (label: string) => sentinel('BODY', label);

  const send = (actor: string, conversationId: string, body: string) =>
    service.send(me(actor), conversationId, {
      operationId: op(),
      body,
      attachmentIds: [],
    });

  /**
   * The whole closure as the web application runs it, owner by owner:
   * Identity closes the account in its own transaction, Learning removes its
   * rows, then Messaging disposes of its own.
   */
  async function closeFully(accountId: string) {
    await world.closeAccount(accountId);
    await world.disposeLearning(accountId);
    return service.disposeAccount(accountId);
  }

  async function conversationState(conversationId: string) {
    const [row] = await admin.query<{ state: string; closedReason: string | null }>(
      `SELECT [state], [closedReason] FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
    );
    return row;
  }

  /** The account's LIVE Messaging state — what withdrawal must leave at zero. */
  async function liveState(accountId: string): Promise<number> {
    const id = n(accountId);
    return (
      (await count(
        admin,
        'ConversationParticipant',
        `[userId] = ${id} AND [leftAt] IS NULL`,
      )) +
      (await count(admin, 'MessageReadState', `[userId] = ${id}`)) +
      (await count(
        admin,
        'MessagingBlock',
        `[blockerUserId] = ${id} OR [blockedUserId] = ${id}`,
      )) +
      (await count(
        admin,
        'MessageAttachment',
        `[uploaderUserId] = ${id} AND [state] IN (N'pending', N'ready')`,
      ))
    );
  }

  /* ======================================================================
   * Only a closed account
   * ==================================================================== */

  describe('disposition is refused for anything Identity does not report closed', () => {
    it('refuses an active account, an unknown one and a malformed one, touching nothing', async () => {
      const p = await pair();
      await send(p.learner, p.conversationId, text('alive'));
      expect(await reasonOf(service.disposeAccount(p.learner))).toBe('denied');
      expect(await reasonOf(service.disposeAccount('msgp-never-existed'))).toBe('denied');
      expect(await reasonOf(service.disposeAccount(''))).toBe('invalid');
      expect(await conversationState(p.conversationId)).toEqual({
        state: 'open',
        closedReason: null,
      });
      expect(await liveState(p.learner)).toBe(2);
      expect((await service.conversation(me(p.learner), p.conversationId)).canSend).toBe(
        true,
      );
    });
  });

  /* ======================================================================
   * The person left behind
   * ==================================================================== */

  describe('a closed counterpart leaves read-only terminal history', () => {
    it('the teacher keeps it while their own half is current, and loses it when that ends', async () => {
      const p = await pair();
      await send(p.teacher.accountId, p.conversationId, text('t1'));
      await send(p.learner, p.conversationId, text('l1'));
      await send(p.teacher.accountId, p.conversationId, text('t2'));

      await world.closeAccount(p.learner);
      const [closed] = await admin.query<{
        status: string;
        email: string;
        sessions: number;
      }>(`
        SELECT u.[status], u.[email],
               (SELECT COUNT(*) FROM [dbo].[Session] s WHERE s.[userId] = u.[id]) AS [sessions]
        FROM [dbo].[User] u WHERE u.[id] = ${n(p.learner)};`);
      expect(closed).toMatchObject({ status: 'closed', sessions: 0 });
      expect(closed?.email).toMatch(/@closed\.invalid$/);
      await world.disposeLearning(p.learner);
      expect(await count(admin, 'Enrolment', `[userId] = ${n(p.learner)}`)).toBe(0);

      const progress = await service.disposeAccount(p.learner);
      expect(progress.complete).toBe(true);
      expect(progress.removed).toBeGreaterThan(0);
      expect(await conversationState(p.conversationId)).toEqual({
        state: 'closed',
        closedReason: 'account-closed',
      });
      expect(await liveState(p.learner)).toBe(0);

      const view = await service.conversation(me(p.teacher.accountId), p.conversationId);
      expect(view.summary).toMatchObject({
        access: 'terminal',
        closedReason: 'account-closed',
      });
      expect(view.canSend).toBe(false);
      expect(view.sendRefusal).toBe('terminal');
      const history = await service.history(
        me(p.teacher.accountId),
        p.conversationId,
        null,
      );
      expect(history.messages.map((message) => message.body)).toEqual([
        text('t1'),
        text('l1'),
        text('t2'),
      ]);
      expect(
        (await service.catchUp(me(p.teacher.accountId), p.conversationId, 1)).messages,
      ).toHaveLength(2);
      expect(
        await service.markRead(me(p.teacher.accountId), p.conversationId, 3),
      ).toEqual({
        readSequence: 3,
      });
      expect(
        await reasonOf(send(p.teacher.accountId, p.conversationId, text('late'))),
      ).toBe('terminal');
      expect(
        (
          await service.conversations(me(p.teacher.accountId), {
            surface: 'teacher',
            cursor: null,
          })
        ).conversations.map((summary) => [summary.id, summary.access]),
      ).toEqual([[p.conversationId, 'terminal']]);
      // The closed person holds nothing any more.
      expect(await reasonOf(service.history(me(p.learner), p.conversationId, null))).toBe(
        'not-found',
      );
      // Closure did not take the teacher's history with it.
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(p.conversationId)}`),
      ).toBe(3);

      // The teacher's OWN half ends: so does the terminal history.
      await revokeAssignment(admin, p.teacher.roleAssignmentId);
      expect(
        await reasonOf(service.history(me(p.teacher.accountId), p.conversationId, null)),
      ).toBe('ended');
      expect(
        await reasonOf(service.conversation(me(p.teacher.accountId), p.conversationId)),
      ).toBe('ended');
      expect(
        (
          await service.conversations(me(p.teacher.accountId), {
            surface: 'teacher',
            cursor: null,
          })
        ).conversations,
      ).toEqual([]);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(p.conversationId)}`),
      ).toBe(3);
    });

    it('the learner keeps it when the teacher closes, until the learner is no longer enrolled', async () => {
      const p = await pair();
      await send(p.teacher.accountId, p.conversationId, text('lesson-note'));
      const progress = await closeFully(p.teacher.accountId);
      expect(progress.complete).toBe(true);
      // Identity's closure revoked the teacher's assignment in its own transaction.
      expect(
        await count(
          admin,
          'RoleAssignment',
          `[id] = ${n(p.teacher.roleAssignmentId)} AND [revokedAt] IS NOT NULL`,
        ),
      ).toBe(1);

      const view = await service.conversation(me(p.learner), p.conversationId);
      expect(view.summary.access).toBe('terminal');
      expect(view).toMatchObject({ canSend: false, sendRefusal: 'terminal' });
      expect(
        (await service.history(me(p.learner), p.conversationId, null)).messages.map(
          (m) => m.body,
        ),
      ).toEqual([text('lesson-note')]);
      expect(await reasonOf(send(p.learner, p.conversationId, text('reply')))).toBe(
        'terminal',
      );

      await withdrawEnrolment(admin, p.learner, p.courseId);
      expect(await reasonOf(service.history(me(p.learner), p.conversationId, null))).toBe(
        'ended',
      );
      expect(
        (await service.conversations(me(p.learner), { surface: 'my', cursor: null }))
          .conversations,
      ).toEqual([]);
    });
  });

  /* ======================================================================
   * Everybody gone
   * ==================================================================== */

  describe('a conversation everybody has closed goes — unless a report holds it', () => {
    it('removes an unreported conversation entirely and keeps a reported one as evidence', async () => {
      const plain = await pair();
      await send(plain.learner, plain.conversationId, text('plain-1'));
      await send(plain.teacher.accountId, plain.conversationId, text('plain-2'));
      const reported = await pair();
      const [message] = [
        (
          await send(
            reported.teacher.accountId,
            reported.conversationId,
            text('evidence'),
          )
        ).message,
      ];
      const { reportId } = await service.report(me(reported.learner), {
        conversationId: reported.conversationId,
        messageId: message?.id ?? null,
        reason: 'safety',
      });

      // One person closed: the other still holds it, so it stays.
      expect((await closeFully(plain.learner)).complete).toBe(true);
      expect(await conversationRows(admin, plain.conversationId)).toBeGreaterThan(0);
      expect((await closeFully(plain.teacher.accountId)).complete).toBe(true);
      expect(await conversationRows(admin, plain.conversationId)).toBe(0);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(plain.conversationId)}`),
      ).toBe(0);

      expect((await closeFully(reported.learner)).complete).toBe(true);
      expect((await closeFully(reported.teacher.accountId)).complete).toBe(true);
      expect(await conversationState(reported.conversationId)).toEqual({
        state: 'closed',
        closedReason: 'account-closed',
      });
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(reported.conversationId)}`),
      ).toBe(1);
      expect(await count(admin, 'MessagingReport', `[id] = ${n(reportId)}`)).toBe(1);
      for (const accountId of [reported.learner, reported.teacher.accountId])
        expect(await liveState(accountId)).toBe(0);
      // Retained evidence costs nothing on a later run, and stays.
      expect((await service.disposeAccount(reported.learner)).complete).toBe(true);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(reported.conversationId)}`),
      ).toBe(1);
    });

    it('a re-registration with the same address is a new account that sees nothing', async () => {
      const p = await pair();
      await send(p.learner, p.conversationId, text('before-closure'));
      const { conversationId: supportId } = await service.openSupport(me(p.learner));
      const [row] = await admin.query<{ email: string }>(
        `SELECT [email] FROM [dbo].[User] WHERE [id] = ${n(p.learner)};`,
      );
      const address = row?.email ?? '';
      expect(address).toMatch(/@messaging-proof\.invalid$/);
      expect((await closeFully(p.learner)).complete).toBe(true);

      const returning = await account(admin, { email: address });
      expect(returning).not.toBe(p.learner);
      expect(
        (await service.conversations(me(returning), { surface: 'my', cursor: null }))
          .conversations,
      ).toEqual([]);
      for (const id of [p.conversationId, supportId]) {
        expect(await reasonOf(service.conversation(me(returning), id))).toBe('not-found');
        expect(await reasonOf(service.history(me(returning), id, null))).toBe(
          'not-found',
        );
      }
      expect(await service.support(me(returning))).toEqual({ open: null, earlier: [] });
      const exported = await service.export(me(returning));
      expect(exported.conversations).toEqual([]);
      expect(exported.messages).toEqual([]);
      // A new support conversation is a new one, not the closed account's.
      expect((await service.openSupport(me(returning))).conversationId).not.toBe(
        supportId,
      );
    });
  });

  /* ======================================================================
   * Bounded, idempotent, resumable
   * ==================================================================== */

  describe('disposition is idempotent and resumes from any interruption', () => {
    it('finishes a withdrawal interrupted after one row, then does nothing on a second run', async () => {
      const learner = await account(admin);
      const pairs = [
        await pair({ learner }),
        await pair({ learner }),
        await pair({ learner }),
      ];
      for (const p of pairs)
        await send(p.teacher.accountId, p.conversationId, text('hello'));
      await service.block(me(learner), pairs[0]?.conversationId ?? '');
      await service.block(
        me(pairs[1]?.teacher.accountId ?? ''),
        pairs[1]?.conversationId ?? '',
      );
      const { conversationId: supportId } = await service.openSupport(me(learner));
      expect(await liveState(learner)).toBe(3 + 3 + 2 + 2);

      await world.closeAccount(learner);
      await world.disposeLearning(learner);
      // INTERRUPTED: two bounded steps of one row each, then the process "dies".
      expect(await world.persistence.withdrawAccount(learner, 1)).toBe(1);
      expect(await world.persistence.withdrawAccount(learner, 1)).toBe(1);
      expect(
        await count(
          admin,
          'Conversation',
          `[state] = N'open' AND ([lowUserId] = ${n(learner)} OR [highUserId] = ${n(learner)} OR [requesterUserId] = ${n(learner)})`,
        ),
      ).toBeGreaterThan(0);

      const first = await service.disposeAccount(learner);
      expect(first.complete).toBe(true);
      expect(await liveState(learner)).toBe(0);
      for (const id of pairs.map((p) => p.conversationId))
        expect(await conversationState(id)).toEqual({
          state: 'closed',
          closedReason: 'account-closed',
        });
      // The support conversation had nobody else in it: it is gone entirely.
      expect(await conversationRows(admin, supportId)).toBe(0);
      // Each teacher still reads what they said, read-only.
      for (const p of pairs)
        expect(
          (await service.conversation(me(p.teacher.accountId), p.conversationId)).summary
            .access,
        ).toBe('terminal');

      const again = await service.disposeAccount(learner);
      expect(again).toEqual({ removed: 0, complete: true });
    });

    it('finishes a removal interrupted mid-batch, and the sweep finishes a closure Messaging never heard of', async () => {
      const p = await pair();
      for (let index = 0; index < 5; index += 1)
        await send(
          index % 2 === 0 ? p.learner : p.teacher.accountId,
          p.conversationId,
          text(`r${String(index)}`),
        );
      expect((await closeFully(p.learner)).complete).toBe(true);

      // The teacher's closure, interrupted by hand after ONE removal step.
      await world.closeAccount(p.teacher.accountId);
      await world.disposeLearning(p.teacher.accountId);
      while ((await world.persistence.withdrawAccount(p.teacher.accountId, 200)) > 0);
      const candidates = await world.persistence.disposalCandidates(
        p.teacher.accountId,
        null,
        50,
      );
      expect(candidates.map((candidate) => candidate.conversationId)).toEqual([
        p.conversationId,
      ]);
      await world.persistence.beginDisposal(p.conversationId);
      // Idempotent mark.
      await world.persistence.beginDisposal(p.conversationId);
      expect(await world.persistence.disposeStep(p.conversationId, 1)).toBe('progress');
      const partial = await conversationRows(admin, p.conversationId);
      expect(partial).toBeGreaterThan(0);
      // A conversation being disposed is gone to every reader at once.
      expect(await world.persistence.conversation(p.conversationId)).toBeNull();

      // A third account, closed by Identity, that Messaging was never told about.
      const unheard = await pair();
      await send(unheard.learner, unheard.conversationId, text('unheard'));
      await world.closeAccount(unheard.learner);
      await world.disposeLearning(unheard.learner);

      const swept = await service.reconcileClosedAccounts();
      expect(swept.complete).toBe(true);
      expect(await conversationRows(admin, p.conversationId)).toBe(0);
      expect(await conversationState(unheard.conversationId)).toEqual({
        state: 'closed',
        closedReason: 'account-closed',
      });
      expect(await liveState(unheard.learner)).toBe(0);
      expect(
        (
          await service.conversation(
            me(unheard.teacher.accountId),
            unheard.conversationId,
          )
        ).summary.access,
      ).toBe('terminal');

      // Nothing left to do: a second sweep is a no-op.
      expect(await service.reconcileClosedAccounts()).toEqual({
        removed: 0,
        complete: true,
      });
    });
  });

  /* ======================================================================
   * Export
   * ==================================================================== */

  describe('export', () => {
    it('is the person’s own rows and own words, deterministic, and survives the counterpart’s closure', async () => {
      const p = await pair();
      const theirs = await send(
        p.teacher.accountId,
        p.conversationId,
        text('teacher-words'),
      );
      const mine1 = await send(p.learner, p.conversationId, text('learner-words-1'));
      const mine2 = await send(p.learner, p.conversationId, text('learner-words-2'));
      await service.report(me(p.learner), {
        conversationId: p.conversationId,
        messageId: theirs.message.id,
        reason: 'other',
      });
      await service.block(me(p.learner), p.conversationId);
      // Somebody else's conversation, with the same teacher.
      const unrelated = await pair({ teacher: p.teacher });
      await send(unrelated.learner, unrelated.conversationId, text('someone-else'));

      const exported = await service.export(me(p.learner));
      expect(exported.schema).toBe('minhaj.messaging.export');
      expect(exported.conversations).toEqual([
        expect.objectContaining({
          id: p.conversationId,
          kind: 'teacher-student',
          courseId: p.courseId,
          role: 'learner',
          state: 'open',
          leftAt: null,
          lastReadSequence: 3,
        }),
      ]);
      expect(
        exported.messages.map((message) => [message.id, message.sequence, message.body]),
      ).toEqual([
        [mine1.message.id, 2, text('learner-words-1')],
        [mine2.message.id, 3, text('learner-words-2')],
      ]);
      expect(exported.blocks.map((entry) => entry.blockedAccountId)).toEqual([
        p.teacher.accountId,
      ]);
      expect(exported.reports.map((entry) => [entry.messageId, entry.reason])).toEqual([
        [theirs.message.id, 'other'],
      ]);
      const serialised = JSON.stringify(exported);
      expect(serialised).not.toContain(text('teacher-words'));
      expect(serialised).not.toContain(text('someone-else'));
      expect(serialised).not.toContain(unrelated.conversationId);

      const second = await service.export(me(p.learner));
      expect({ ...second, generatedAt: '' }).toEqual({ ...exported, generatedAt: '' });

      // The counterpart closes: the export still answers, with the same words.
      expect((await closeFully(p.teacher.accountId)).complete).toBe(true);
      const after = await service.export(me(p.learner));
      expect(after.conversations).toEqual([
        expect.objectContaining({
          id: p.conversationId,
          state: 'closed',
          closedReason: 'account-closed',
        }),
      ]);
      expect(after.messages.map((message) => message.body)).toEqual([
        text('learner-words-1'),
        text('learner-words-2'),
      ]);
      // Withdrawal removed the blocks either way.
      expect(after.blocks).toEqual([]);
      expect(JSON.stringify(after)).not.toContain(text('teacher-words'));
    });
  });

  /* ======================================================================
   * A report racing the decision to dispose
   * ==================================================================== */

  describe('a report filed while a disposal is being decided keeps the conversation', () => {
    it('the conversation the report names is evidence, never marked, and the closure still finishes', async () => {
      const asker = await account(admin);
      const { conversationId } = await service.openSupport(me(asker));
      await send(asker, conversationId, text('support-evidence'));
      const staff = await grantRole(admin, await account(admin), ['messaging.support']);
      const version = (
        await service.supportConversation(me(staff.accountId), conversationId)
      ).version;
      await service.claimSupport(me(staff.accountId), conversationId, version);
      await world.closeAccount(asker);

      // The disposal has just found the conversation disposable (its one
      // person has left) when the claimed staff member — still a current
      // participant — reports it, before the mark is taken.
      let reportId = '';
      const racing = world.serviceWith({
        persistence: {
          ...world.persistence,
          disposalCandidates: async (accountId, after, limit) => {
            const found = await world.persistence.disposalCandidates(
              accountId,
              after,
              limit,
            );
            if (reportId === '' && found.some((c) => c.conversationId === conversationId))
              reportId = (
                await service.report(me(staff.accountId), {
                  conversationId,
                  messageId: null,
                  reason: 'safety',
                })
              ).reportId;
            return found;
          },
        },
      });
      const progress = await racing.disposeAccount(asker);
      expect(reportId).not.toBe('');
      expect(progress.complete).toBe(true);
      expect(await count(admin, 'MessagingReport', `[id] = ${n(reportId)}`)).toBe(1);
      expect(
        await count(
          admin,
          'Conversation',
          `[id] = ${n(conversationId)} AND [disposingAt] IS NULL`,
        ),
      ).toBe(1);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(1);
      expect(await liveState(asker)).toBe(0);
      // A later run passes over it as evidence.
      expect((await service.disposeAccount(asker)).complete).toBe(true);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(1);
    });
  });

  /* ======================================================================
   * Residue
   * ==================================================================== */

  describe('residue', () => {
    it('no closed account holds live Messaging state, and no unreported abandoned conversation remains', async () => {
      expect(await service.reconcileClosedAccounts()).toEqual({
        removed: 0,
        complete: true,
      });
      const [closedState] = await admin.query<{ total: number }>(`
        SELECT
          (SELECT COUNT(*) FROM [dbo].[ConversationParticipant] p JOIN [dbo].[User] u ON u.[id] = p.[userId]
            WHERE u.[status] = N'closed' AND p.[leftAt] IS NULL)
        + (SELECT COUNT(*) FROM [dbo].[MessageReadState] r JOIN [dbo].[User] u ON u.[id] = r.[userId]
            WHERE u.[status] = N'closed')
        + (SELECT COUNT(*) FROM [dbo].[MessagingBlock] b JOIN [dbo].[User] u
            ON u.[id] IN (b.[blockerUserId], b.[blockedUserId]) WHERE u.[status] = N'closed') AS [total];`);
      expect(Number(closedState?.total)).toBe(0);
      const [abandoned] = await admin.query<{ total: number }>(`
        SELECT COUNT(*) AS [total] FROM [dbo].[Conversation] c
        WHERE NOT EXISTS (SELECT 1 FROM [dbo].[MessagingReport] r WHERE r.[conversationId] = c.[id])
          AND NOT EXISTS (
            SELECT 1 FROM [dbo].[ConversationParticipant] p
            WHERE p.[conversationId] = c.[id] AND p.[role] <> N'support' AND p.[leftAt] IS NULL);`);
      expect(Number(abandoned?.total)).toBe(0);
      expect(await count(admin, 'Conversation', '[disposingAt] IS NOT NULL')).toBe(0);
    });
  });
});
