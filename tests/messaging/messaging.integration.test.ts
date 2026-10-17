import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { MessagingService } from '../../packages/server-core/src/messaging/index.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activateLive,
  activateMessaging,
  count,
  endScope,
  enrol,
  grantRole,
  liveCourse,
  messagingRows,
  messagingWorld,
  n,
  op,
  publicTeacher,
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
 * Phase 24 — Messaging's access decision and its durable order, over a REAL
 * SQL Server, through the REAL service wired as the web composition root
 * wires it, with every Messaging, Learning and Identity read made by the
 * provisioned least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that nothing exists until the owner
 * activates a kind, and that an activated kind still admits nobody without
 * live learning; that a teaching conversation is reachable exactly while
 * Learning reports BOTH halves of the relationship current — a public
 * teacher profile, a key without a scope, a scope under a revoked
 * assignment, another Course, an ended scope and a withdrawn learner each
 * read nothing, on the very next call; that two people opening one
 * conversation at once make one row; that concurrent sends get unique, dense
 * sequences; that a retried operation makes one message and a different
 * payload under it touches nothing; that a read position never moves back;
 * and that the production peer policy admits no pair even when the kind is
 * activated.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner session writes the activations,
 * accounts, roles, Courses, scopes and Enrolments — rows other owners or the
 * operator write — and inspects. Every Messaging row is made by the service
 * through its adapter. Nothing here is content or a real address.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

live('Phase 24 Messaging access and ordering against real SQL Server', () => {
  let world: MessagingWorld;
  let admin: SqlSession;
  let service: MessagingService;

  beforeAll(async () => {
    world = await messagingWorld();
    admin = world.db.admin;
    service = world.service;
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  /* ---- fixtures --------------------------------------------------------- */

  interface Relationship {
    readonly teacher: RoleFixture;
    readonly learner: string;
    readonly courseId: string;
    readonly scopeId: string;
  }

  /** A fresh, CURRENT teaching relationship: a scoped teacher and an enrolled learner. */
  async function relationship(): Promise<Relationship> {
    const teacher = await teacherAccount(admin);
    const learner = await account(admin);
    const courseId = await liveCourse(admin);
    const scopeId = await scope(admin, courseId, teacher);
    await enrol(admin, learner, courseId);
    return { teacher, learner, courseId, scopeId };
  }

  const startAsLearner = (rel: Relationship) =>
    service.startTeaching(me(rel.learner), {
      counterpartAccountId: rel.teacher.accountId,
      courseId: rel.courseId,
    });

  const startAsTeacher = (rel: Relationship) =>
    service.startTeaching(me(rel.teacher.accountId), {
      counterpartAccountId: rel.learner,
      courseId: rel.courseId,
    });

  const text = (label: string) => sentinel('BODY', label);

  const send = (
    actor: string,
    conversationId: string,
    body: string,
    operationId = op(),
  ) => service.send(me(actor), conversationId, { operationId, body, attachmentIds: [] });

  /** Every person-facing path through the ONE decision, refused or not. */
  async function everyPath(actor: string, conversationId: string) {
    return {
      conversation: await reasonOf(service.conversation(me(actor), conversationId)),
      history: await reasonOf(service.history(me(actor), conversationId, null)),
      catchUp: await reasonOf(service.catchUp(me(actor), conversationId, 0)),
      send: await reasonOf(send(actor, conversationId, text('probe'))),
      markRead: await reasonOf(service.markRead(me(actor), conversationId, 1)),
      report: await reasonOf(
        service.report(me(actor), { conversationId, messageId: null, reason: 'other' }),
      ),
    };
  }

  const everywhere = (reason: string) => ({
    conversation: reason,
    history: reason,
    catchUp: reason,
    send: reason,
    markRead: reason,
    report: reason,
  });

  async function listed(actor: string, surface: 'my' | 'teacher'): Promise<string[]> {
    const page = await service.conversations(me(actor), { surface, cursor: null });
    return page.conversations.map((summary) => summary.id);
  }

  /* ======================================================================
   * Activation — fail closed
   * ==================================================================== */

  describe('nothing exists until the owner activates a kind', () => {
    let rel: Relationship;
    let conversationId: string;

    it('refuses every start and finds nothing while no kind is activated', async () => {
      rel = await relationship();
      expect(await service.capabilities()).toEqual({
        support: false,
        teacherStudent: false,
        studentStudent: false,
        fixture: false,
      });
      expect(await reasonOf(startAsLearner(rel))).toBe('not-found');
      expect(await reasonOf(startAsTeacher(rel))).toBe('not-found');
      expect(
        await reasonOf(
          service.startPeer(me(rel.learner), {
            counterpartAccountId: rel.teacher.accountId,
            courseId: rel.courseId,
          }),
        ),
      ).toBe('not-found');
      expect(await reasonOf(service.openSupport(me(rel.learner)))).toBe('not-found');
      expect(await reasonOf(service.support(me(rel.learner)))).toBe('not-found');
      expect(await reasonOf(service.conversation(me(rel.learner), randomUUID()))).toBe(
        'not-found',
      );
      expect(await service.startable(me(rel.learner))).toEqual([]);
      expect(await listed(rel.learner, 'my')).toEqual([]);
      expect(await listed(rel.teacher.accountId, 'teacher')).toEqual([]);
      expect(await service.unreadTotal(me(rel.learner))).toBe(0);
      expect(await messagingRows(admin)).toBe(0);

      // THE FLOOR. The runtime principal cannot switch a kind on, and even
      // the owner cannot create a conversation of a kind that is off.
      expect(
        await sqlNumber(
          world.app.query(`
            INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy])
            VALUES (N'teacher-student', N'fixture', N'NON_MESSAGING_FIXTURE runtime');`),
        ),
      ).toBe(229);
      const [low, high] = [rel.learner, rel.teacher.accountId].sort();
      expect(
        await sqlNumber(
          admin.query(`
            INSERT INTO [dbo].[Conversation] ([id],[kind],[courseId],[lowUserId],[highUserId])
            VALUES (NEWID(), N'teacher-student', ${n(rel.courseId)}, ${n(low ?? '')}, ${n(high ?? '')});`),
        ),
      ).toBe(51302);
    });

    it('admits nobody to an activated kind while live learning is off, then admits the pair', async () => {
      await activateMessaging(admin, 'teacher-student');
      expect(await service.capabilities()).toEqual({
        support: false,
        teacherStudent: true,
        studentStudent: false,
        fixture: true,
      });
      expect(
        await sqlNumber(admin.query(`DELETE FROM [dbo].[MessagingActivation];`)),
      ).toBe(51300);

      // No live learning: Learning reports no relationship for anybody.
      expect(await reasonOf(startAsLearner(rel))).toBe('not-found');
      expect(await service.startable(me(rel.learner))).toEqual([]);

      // A conversation that already exists (written by Messaging's own
      // adapter) is a participant's ENDED one — nothing of it is shown.
      const opened = await world.persistence.openDirect({
        kind: 'teacher-student',
        courseId: rel.courseId,
        first: { accountId: rel.teacher.accountId, role: 'teacher' },
        second: { accountId: rel.learner, role: 'learner' },
      });
      conversationId = opened.conversation.id;
      expect(await everyPath(rel.learner, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(rel.teacher.accountId, conversationId)).toEqual(
        everywhere('ended'),
      );
      expect(await listed(rel.learner, 'my')).toEqual([]);
      expect(await listed(rel.teacher.accountId, 'teacher')).toEqual([]);
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(0);

      await activateLive(admin, 'fixture');
      expect((await startAsLearner(rel)).conversationId).toBe(conversationId);
      const view = await service.conversation(me(rel.learner), conversationId);
      expect(view.summary.access).toBe('available');
      expect(view.canSend).toBe(true);
    });
  });

  /* ======================================================================
   * The teaching relationship — both halves, live, every call
   * ==================================================================== */

  describe('a teaching conversation is reachable exactly while the relationship is current', () => {
    it('a public teacher profile and a Course attribution grant nothing', async () => {
      const learner = await account(admin);
      const named = await account(admin);
      const courseId = await liveCourse(admin);
      await enrol(admin, learner, courseId);
      await publicTeacher(admin, named, courseId);

      for (const [actor, counterpart] of [
        [learner, named],
        [named, learner],
      ] as const)
        expect(
          await reasonOf(
            service.startTeaching(me(actor), {
              counterpartAccountId: counterpart,
              courseId,
            }),
          ),
        ).toBe('not-found');
      expect(await service.startable(me(learner))).toEqual([]);
      expect(await count(admin, 'Conversation', `[courseId] = ${n(courseId)}`)).toBe(0);
    });

    it('teaching.perform without a scope, and a scope under a revoked assignment, deny', async () => {
      const learner = await account(admin);
      const courseId = await liveCourse(admin);
      await enrol(admin, learner, courseId);

      const unscoped = await teacherAccount(admin);
      expect(
        await reasonOf(
          service.startTeaching(me(learner), {
            counterpartAccountId: unscoped.accountId,
            courseId,
          }),
        ),
      ).toBe('not-found');
      expect(
        await reasonOf(
          service.startTeaching(me(unscoped.accountId), {
            counterpartAccountId: learner,
            courseId,
          }),
        ),
      ).toBe('not-found');

      // A scope names ONE assignment. Revoking it ends the scope's authority
      // even while the teacher still holds another live teaching.perform.
      const teacher = await teacherAccount(admin);
      await scope(admin, courseId, teacher);
      const other = await grantRole(admin, teacher.accountId, ['teaching.perform']);
      expect(other.accountId).toBe(teacher.accountId);
      await revokeAssignment(admin, teacher.roleAssignmentId);
      expect(
        await reasonOf(
          service.startTeaching(me(learner), {
            counterpartAccountId: teacher.accountId,
            courseId,
          }),
        ),
      ).toBe('not-found');
      expect(await service.startable(me(learner))).toEqual([]);
      expect(await count(admin, 'Conversation', `[courseId] = ${n(courseId)}`)).toBe(0);
    });

    it('a relationship on another Course is not this one', async () => {
      const rel = await relationship();
      const elsewhere = await liveCourse(admin);
      // The learner is on BOTH Courses; the teacher is scoped on one.
      await enrol(admin, rel.learner, elsewhere);
      for (const [actor, counterpart] of [
        [rel.learner, rel.teacher.accountId],
        [rel.teacher.accountId, rel.learner],
      ] as const)
        expect(
          await reasonOf(
            service.startTeaching(me(actor), {
              counterpartAccountId: counterpart,
              courseId: elsewhere,
            }),
          ),
        ).toBe('not-found');
      expect(await service.startable(me(rel.learner))).toEqual([
        { counterpartAccountId: rel.teacher.accountId, courseId: rel.courseId },
      ]);
    });

    it('opens from either side, then lists, sends, pages, catches up and marks read', async () => {
      const rel = await relationship();
      expect(await service.startable(me(rel.learner))).toEqual([
        { counterpartAccountId: rel.teacher.accountId, courseId: rel.courseId },
      ]);
      const { conversationId } = await startAsLearner(rel);
      expect((await startAsTeacher(rel)).conversationId).toBe(conversationId);
      expect(await count(admin, 'Conversation', `[courseId] = ${n(rel.courseId)}`)).toBe(
        1,
      );

      const first = await send(rel.teacher.accountId, conversationId, text('t1'));
      const second = await send(rel.teacher.accountId, conversationId, text('t2'));
      expect([first.message.sequence, second.message.sequence]).toEqual([1, 2]);
      expect(first.replayed).toBe(false);

      const summary = (
        await service.conversations(me(rel.learner), { surface: 'my', cursor: null })
      ).conversations;
      expect(summary).toHaveLength(1);
      expect(summary[0]).toMatchObject({
        id: conversationId,
        kind: 'teacher-student',
        courseId: rel.courseId,
        role: 'learner',
        counterpartAccountId: rel.teacher.accountId,
        lastSequence: 2,
        unread: 2,
        access: 'available',
      });
      expect(summary[0]?.lastMessageAt).toBeInstanceOf(Date);
      expect(await listed(rel.teacher.accountId, 'teacher')).toEqual([conversationId]);
      // Each surface is the person's OWN role in it.
      expect(await listed(rel.learner, 'teacher')).toEqual([]);
      expect(await listed(rel.teacher.accountId, 'my')).toEqual([]);
      expect(await service.unreadTotal(me(rel.learner))).toBe(2);

      const history = await service.history(me(rel.learner), conversationId, null);
      expect(
        history.messages.map((message) => [message.sequence, message.body, message.own]),
      ).toEqual([
        [1, text('t1'), false],
        [2, text('t2'), false],
      ]);
      expect(history.before).toBeNull();
      expect(await service.catchUp(me(rel.learner), conversationId, 1)).toMatchObject({
        more: false,
        lastSequence: 2,
      });
      expect(
        (await service.catchUp(me(rel.learner), conversationId, 1)).messages.map(
          (m) => m.sequence,
        ),
      ).toEqual([2]);

      expect(await service.markRead(me(rel.learner), conversationId, 1)).toEqual({
        readSequence: 1,
      });
      expect(await service.unreadTotal(me(rel.learner))).toBe(1);
      // Clamped to the last message, and never moved back.
      expect(await service.markRead(me(rel.learner), conversationId, 999)).toEqual({
        readSequence: 2,
      });
      expect(await service.markRead(me(rel.learner), conversationId, 0)).toEqual({
        readSequence: 2,
      });
      expect(await service.unreadTotal(me(rel.learner))).toBe(0);

      // The sender has read their own message.
      const reply = await send(rel.learner, conversationId, text('l1'));
      expect(reply.message).toMatchObject({ sequence: 3, own: true, body: text('l1') });
      expect(
        (await service.conversation(me(rel.learner), conversationId)).readSequence,
      ).toBe(3);
      const teacherView = await service.conversation(
        me(rel.teacher.accountId),
        conversationId,
      );
      expect(teacherView.summary).toMatchObject({ role: 'teacher', unread: 1 });

      // Paging: 32 more messages, so the newest page is 30 and the older one the rest.
      for (let index = 0; index < 32; index += 1)
        await send(rel.learner, conversationId, text(`page-${String(index)}`));
      const newest = await service.history(
        me(rel.teacher.accountId),
        conversationId,
        null,
      );
      expect(newest.messages.map((m) => m.sequence)).toEqual(
        Array.from({ length: 30 }, (_, index) => index + 6),
      );
      expect(newest.before).toBe(6);
      const older = await service.history(me(rel.teacher.accountId), conversationId, 6);
      expect(older.messages.map((m) => m.sequence)).toEqual([1, 2, 3, 4, 5]);
      expect(older.before).toBeNull();
      const caught = await service.catchUp(me(rel.teacher.accountId), conversationId, 0);
      expect(caught.messages).toHaveLength(35);
      expect(caught).toMatchObject({ more: false, lastSequence: 35 });
    });

    it('revoking the teacher’s RoleAssignment ends it on the very next call, for both people', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      await send(rel.learner, conversationId, text('before-revocation'));

      await revokeAssignment(admin, rel.teacher.roleAssignmentId);
      expect(await everyPath(rel.learner, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(rel.teacher.accountId, conversationId)).toEqual(
        everywhere('ended'),
      );
      expect(await listed(rel.learner, 'my')).toEqual([]);
      expect(await listed(rel.teacher.accountId, 'teacher')).toEqual([]);
      expect(await reasonOf(startAsLearner(rel))).toBe('not-found');
      expect(await reasonOf(startAsTeacher(rel))).toBe('not-found');
      expect(await service.startable(me(rel.learner))).toEqual([]);
      // Ending is not deleting: the history is still there, and still one message.
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(1);
    });

    it('an ended scope ends it', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsTeacher(rel);
      await endScope(admin, rel.scopeId);
      expect(await everyPath(rel.learner, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(rel.teacher.accountId, conversationId)).toEqual(
        everywhere('ended'),
      );
    });

    it('a withdrawn learner ends it', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      await withdrawEnrolment(admin, rel.learner, rel.courseId);
      expect(await everyPath(rel.learner, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(rel.teacher.accountId, conversationId)).toEqual(
        everywhere('ended'),
      );
      expect(await reasonOf(startAsTeacher(rel))).toBe('not-found');
    });

    it('a Course withdrawn from publication ends it', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      await admin.query(
        `UPDATE [dbo].[Course] SET [state] = N'archived' WHERE [id] = ${n(rel.courseId)};`,
      );
      expect(await everyPath(rel.learner, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(rel.teacher.accountId, conversationId)).toEqual(
        everywhere('ended'),
      );
    });

    it('somebody who is not in it — even a teacher of the same Course — finds nothing', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      const message = await send(rel.learner, conversationId, text('private'));
      const stranger = await account(admin);
      const colleague = await teacherAccount(admin);
      await scope(admin, rel.courseId, colleague);
      await enrol(admin, stranger, rel.courseId);

      for (const outsider of [stranger, colleague.accountId]) {
        expect(await everyPath(outsider, conversationId)).toEqual(
          everywhere('not-found'),
        );
        expect(await reasonOf(service.block(me(outsider), conversationId))).toBe(
          'not-found',
        );
        expect(
          await reasonOf(
            service.report(me(outsider), {
              conversationId,
              messageId: message.message.id,
              reason: 'spam',
            }),
          ),
        ).toBe('not-found');
        expect(await listed(outsider, 'my')).toEqual([]);
        expect(await listed(outsider, 'teacher')).toEqual([]);
      }
      // A malformed identifier is `invalid`, never a probe for existence.
      expect(await reasonOf(service.conversation(me(stranger), 'not-a-uuid'))).toBe(
        'invalid',
      );
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(1);
      expect(await count(admin, 'MessagingReport')).toBe(0);
      expect(await count(admin, 'MessagingBlock')).toBe(0);
    });
  });

  /* ======================================================================
   * Concurrency — one row, one order, one message per operation
   * ==================================================================== */

  describe('concurrent people converge on one durable answer', () => {
    it('concurrent starts from both sides make exactly one conversation', async () => {
      const rel = await relationship();
      const results = await Promise.all([
        startAsLearner(rel),
        startAsTeacher(rel),
        startAsLearner(rel),
        startAsTeacher(rel),
        startAsLearner(rel),
        startAsTeacher(rel),
      ]);
      expect(new Set(results.map((result) => result.conversationId)).size).toBe(1);
      const id = results[0]?.conversationId ?? '';
      expect(await count(admin, 'Conversation', `[courseId] = ${n(rel.courseId)}`)).toBe(
        1,
      );
      expect(
        await count(admin, 'ConversationParticipant', `[conversationId] = ${n(id)}`),
      ).toBe(2);
      expect(await count(admin, 'MessageReadState', `[conversationId] = ${n(id)}`)).toBe(
        2,
      );
    });

    // THE ALLOCATOR IS THE ADAPTER'S, SO IT IS RACED THERE. Twenty appends at
    // once, from both participants, straight into Messaging's own locked
    // append — the one place a sequence is allocated. Raced through the
    // service instead, every send would also queue on the SAME account's
    // rate-limit row, and on a loaded machine the pool waits that adds prove
    // nothing about ordering. The service path is raced in the next proof.
    it('twenty concurrent appends get the unique, dense sequences 1..20', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      const appends = Array.from({ length: 20 }, (_, index) =>
        world.persistence.append({
          conversationId,
          senderAccountId: index % 2 === 0 ? rel.learner : rel.teacher.accountId,
          operationId: op(),
          body: text(`concurrent-${String(index)}`),
          payloadDigest: createHash('sha256').update(String(index)).digest('hex'),
          attachmentIds: [],
          blockPair: null,
        }),
      );
      const sequences = (await Promise.all(appends)).map((outcome) => {
        if (outcome.state !== 'created') throw new Error(`append ${outcome.state}`);
        return outcome.message.sequence;
      });
      expect([...sequences].sort((a, b) => a - b)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      const rows = await admin.query<{ sequence: number }>(
        `SELECT [sequence] FROM [dbo].[Message] WHERE [conversationId] = ${n(conversationId)} ORDER BY [sequence];`,
      );
      expect(rows.map((row) => row.sequence)).toEqual(
        Array.from({ length: 20 }, (_, index) => index + 1),
      );
      const [conversation] = await admin.query<{ lastSequence: number }>(
        `SELECT [lastSequence] FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
      );
      expect(conversation?.lastSequence).toBe(20);
    });

    it('concurrent sends through the service keep a dense, unique order', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      const sends = Array.from({ length: 6 }, (_, index) =>
        send(
          index % 2 === 0 ? rel.learner : rel.teacher.accountId,
          conversationId,
          text(`service-concurrent-${String(index)}`),
        ),
      );
      const sequences = (await Promise.all(sends)).map(
        (result) => result.message.sequence,
      );
      expect([...sequences].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
      const rows = await admin.query<{ sequence: number }>(
        `SELECT [sequence] FROM [dbo].[Message] WHERE [conversationId] = ${n(conversationId)} ORDER BY [sequence];`,
      );
      expect(rows.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('a retried operation is one message, and a different payload under it touches nothing', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      const operationId = op();
      const original = await send(
        rel.learner,
        conversationId,
        text('original'),
        operationId,
      );
      const retry = await send(
        rel.learner,
        conversationId,
        text('original'),
        operationId,
      );
      expect(retry.replayed).toBe(true);
      expect(retry.message.id).toBe(original.message.id);
      expect(retry.message.sequence).toBe(1);

      // Concurrent retries of a NEW operation: one message, every answer it.
      const fresh = op();
      const racing = await Promise.all(
        Array.from({ length: 6 }, () =>
          send(rel.learner, conversationId, text('raced'), fresh),
        ),
      );
      expect(new Set(racing.map((result) => result.message.id)).size).toBe(1);
      expect(racing.filter((result) => !result.replayed)).toHaveLength(1);
      expect(
        await count(
          admin,
          'Message',
          `[conversationId] = ${n(conversationId)} AND [operationId] = ${n(fresh)}`,
        ),
      ).toBe(1);

      // The same identifier with a different body is refused; the original stands.
      expect(
        await reasonOf(send(rel.learner, conversationId, text('tampered'), operationId)),
      ).toBe('operation-conflict');
      const [stored] = await admin.query<{ body: string; total: number }>(`
        SELECT MIN([body]) AS [body], COUNT(*) AS [total] FROM [dbo].[Message]
        WHERE [conversationId] = ${n(conversationId)} AND [operationId] = ${n(operationId)};`);
      expect(stored).toEqual({ body: text('original'), total: 1 });
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(2);

      // An operation identifier is the SENDER's: the other person's same id is theirs.
      const theirs = await send(
        rel.teacher.accountId,
        conversationId,
        text('theirs'),
        operationId,
      );
      expect(theirs.replayed).toBe(false);
      expect(theirs.message.sequence).toBe(3);
    });

    it('concurrent read marks never move the position back, and unread counts only the other person', async () => {
      const rel = await relationship();
      const { conversationId } = await startAsLearner(rel);
      for (let index = 0; index < 12; index += 1)
        await send(rel.teacher.accountId, conversationId, text(`read-${String(index)}`));
      const marks = [5, 3, 12, 1, 9, 12, 2, 7, 11, 4];
      const results = await Promise.all(
        marks.map((sequence) =>
          service.markRead(me(rel.learner), conversationId, sequence),
        ),
      );
      for (const [index, result] of results.entries())
        expect(result.readSequence).toBeGreaterThanOrEqual(marks[index] ?? 0);
      const [state] = await admin.query<{ lastReadSequence: number }>(`
        SELECT [lastReadSequence] FROM [dbo].[MessageReadState]
        WHERE [conversationId] = ${n(conversationId)} AND [userId] = ${n(rel.learner)};`);
      expect(state?.lastReadSequence).toBe(12);
      expect(await service.markRead(me(rel.learner), conversationId, 2)).toEqual({
        readSequence: 12,
      });

      // The learner's own messages are never unread to them; the teacher's are.
      await send(rel.learner, conversationId, text('mine'));
      await send(rel.teacher.accountId, conversationId, text('theirs-1'));
      await send(rel.teacher.accountId, conversationId, text('theirs-2'));
      const view = await service.conversation(me(rel.learner), conversationId);
      expect(view.readSequence).toBe(13);
      expect(view.summary.unread).toBe(2);
      expect(await service.unreadTotal(me(rel.learner))).toBe(2);
      const teacherView = await service.conversation(
        me(rel.teacher.accountId),
        conversationId,
      );
      expect(teacherView.readSequence).toBe(15);
      expect(teacherView.summary.unread).toBe(0);

      // THE FLOOR. Even the owner cannot move a read position back or past the end.
      expect(
        await sqlNumber(
          admin.query(`
            UPDATE [dbo].[MessageReadState] SET [lastReadSequence] = 1
            WHERE [conversationId] = ${n(conversationId)} AND [userId] = ${n(rel.learner)};`),
        ),
      ).toBe(51307);
      expect(
        await sqlNumber(
          admin.query(`
            UPDATE [dbo].[MessageReadState] SET [lastReadSequence] = 99
            WHERE [conversationId] = ${n(conversationId)} AND [userId] = ${n(rel.learner)};`),
        ),
      ).toBe(51307);
    });
  });

  /* ======================================================================
   * Student-to-student — activated, and still refused
   * ==================================================================== */

  describe('student-to-student stays refused under the production peer policy', () => {
    it('denies start, list, history and send even when activated; a fixture policy proves the mechanics', async () => {
      await activateMessaging(admin, 'student-student');
      expect((await service.capabilities()).studentStudent).toBe(true);
      const courseId = await liveCourse(admin);
      const first = await account(admin);
      const second = await account(admin);
      const third = await account(admin);
      for (const learner of [first, second, third]) await enrol(admin, learner, courseId);

      expect(
        await reasonOf(
          service.startPeer(me(first), { counterpartAccountId: second, courseId }),
        ),
      ).toBe('not-found');
      expect(await count(admin, 'Conversation', `[courseId] = ${n(courseId)}`)).toBe(0);

      // One written by Messaging's adapter is still nothing anybody may read.
      const opened = await world.persistence.openDirect({
        kind: 'student-student',
        courseId,
        first: { accountId: first, role: 'peer' },
        second: { accountId: second, role: 'peer' },
      });
      const conversationId = opened.conversation.id;
      expect(await everyPath(first, conversationId)).toEqual(everywhere('ended'));
      expect(await everyPath(second, conversationId)).toEqual(everywhere('ended'));
      expect(await listed(first, 'my')).toEqual([]);
      expect(await everyPath(third, conversationId)).toEqual(everywhere('not-found'));

      // THE MECHANICS, under a fixture policy admitting exactly this pair.
      const [low, high] = [first, second].sort();
      const fixture = world.serviceWith({
        peers: {
          permits: async (pair) =>
            pair.firstAccountId === low &&
            pair.secondAccountId === high &&
            pair.courseId === courseId,
        },
      });
      expect(
        (await fixture.startPeer(me(second), { counterpartAccountId: first, courseId }))
          .conversationId,
      ).toBe(conversationId);
      const sent = await fixture.send(me(first), conversationId, {
        operationId: op(),
        body: text('peer'),
        attachmentIds: [],
      });
      expect(sent.message.sequence).toBe(1);
      const seen = await fixture.history(me(second), conversationId, null);
      expect(seen.messages.map((message) => message.body)).toEqual([text('peer')]);
      expect(
        (
          await fixture.conversations(me(second), { surface: 'my', cursor: null })
        ).conversations.map((summary) => [summary.id, summary.role, summary.unread]),
      ).toEqual([[conversationId, 'peer', 1]]);
      // The policy is the whole admission: another pair is still refused.
      expect(
        await reasonOf(
          fixture.startPeer(me(third), { counterpartAccountId: first, courseId }),
        ),
      ).toBe('not-found');

      // Nothing the fixture did is authority under production wiring.
      expect(await everyPath(second, conversationId)).toEqual(everywhere('ended'));
      expect(
        await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
      ).toBe(1);
    });
  });

  /* ======================================================================
   * Residue
   * ==================================================================== */

  describe('residue', () => {
    it('every Messaging row this file made belongs to its own synthetic accounts', async () => {
      const foreign = await admin.query<{ total: number }>(`
        SELECT COUNT(*) AS [total] FROM [dbo].[ConversationParticipant] p
        JOIN [dbo].[User] u ON u.[id] = p.[userId]
        WHERE u.[email] NOT LIKE N'%@messaging-proof.invalid';`);
      expect(Number(foreign[0]?.total)).toBe(0);
      const sentinelOnly = await admin.query<{ total: number }>(`
        SELECT COUNT(*) AS [total] FROM [dbo].[Message]
        WHERE [body] NOT LIKE N'NON[_]MESSAGING[_]FIXTURE[_]%';`);
      expect(Number(sentinelOnly[0]?.total)).toBe(0);
    });
  });
});
