import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  endScope,
  enrol,
  grantRole,
  liveCourse,
  n,
  op,
  reasonOf,
  revokeAssignment,
  scope,
  withdrawEnrolment,
} from '../messaging/fixture-sql.ts';
import {
  body,
  connected,
  fanOutDone,
  failureOf,
  messagesIn,
  realtimeWorld,
  sendOver,
  startRealtimeProcess,
  subscribe,
  transportFailureFor,
  typingOver,
  type Client,
  type LogRecord,
  type Pair,
  type Person,
  type RealtimeProcess,
  type RealtimeWorld,
} from './harness.ts';

/**
 * Phase 25 — what the REAL realtime process sends OUT, and to whom.
 *
 * THE OUTBOUND LEAK MATRIX. A socket joins a conversation's room while its
 * person is allowed; then the facts change — the teacher's RoleAssignment is
 * revoked, the scope ends, the learner withdraws, a block lands, a moderator
 * closes the conversation, or the person's own account is suspended. The
 * socket is still connected and still in the room. The other participant then
 * tries everything that would reach it: a NEW message, a typing signal, and a
 * presence change by leaving and by joining afresh. The stale socket must
 * receive NOTHING — because room membership is a mailing list and never a
 * permission, and every outbound frame is decided for its recipient, now, by
 * the Messaging service.
 *
 * NOTHING-ARRIVED IS PROVED AGAINST A POSITIVE BARRIER. Each case first shows
 * the same socket DOES receive the counterpart's message, typing and presence
 * while allowed (so silence afterwards is not a dead socket). Afterwards:
 *
 *   - a refused send or typing signal fans out nothing — the refusal ack is
 *     the barrier, and the row count proves nothing was written;
 *   - presence and typing withdrawals DO fan out, so the process's own
 *     `fan-out:* done` record (counts only, logged at debug) is awaited and
 *     must report recipients but no delivery;
 *   - finally a control message on ANOTHER conversation the stale socket still
 *     legitimately follows must arrive, and nothing for the affected
 *     conversation may have arrived before it.
 *
 * PRESENCE AND TYPING NEVER TOUCH SQL. Proved by an exact row count of every
 * table before and after a burst of presence and typing, and by the schema
 * holding no presence, typing, socket or realtime table or column.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

live(
  'Phase 25 realtime process — outbound delivery is decided per recipient, now',
  () => {
    let world: RealtimeWorld;
    let realtime: RealtimeProcess;
    const clients: Client[] = [];

    const open = async (person: Person): Promise<Client> => {
      const client = await connected(realtime.url, { cookie: person.cookie });
      clients.push(client);
      return client;
    };

    beforeAll(async () => {
      world = await realtimeWorld();
      await world.activate();
      realtime = await startRealtimeProcess({ databaseUrl: world.databaseUrl });
    }, 300_000);

    afterAll(async () => {
      for (const client of clients) client.close();
      await realtime?.stop();
      await world?.close();
    }, 120_000);

    /**
     * Another conversation the TEACHER still legitimately has: a second
     * assignment, a second Course and scope, a second learner. Independent of
     * the first relationship, so revoking or ending that one leaves this one.
     */
    async function teacherControl(teacher: Person, label: string) {
      const admin = world.messaging.db.admin;
      const role = await grantRole(admin, teacher.accountId, ['teaching.perform']);
      const courseId = await liveCourse(admin);
      await scope(admin, courseId, role);
      const other = await world.person(`${label}-control-learner`);
      await enrol(admin, other.accountId, courseId);
      const { conversationId } = await world.messaging.service.startTeaching(
        me(other.accountId),
        { counterpartAccountId: teacher.accountId, courseId },
      );
      return { counterpart: other, conversationId };
    }

    /** Another conversation the LEARNER still legitimately has, with another teacher. */
    async function learnerControl(learner: Person, label: string) {
      const control = await world.pairFor(learner, `${label}-control`);
      return { counterpart: control.teacher, conversationId: control.conversationId };
    }

    interface Scene {
      readonly pair: Pair;
      readonly stale: Client;
      readonly staleAccount: string;
      readonly actor: Client;
      readonly actorPerson: Person;
      readonly control: { readonly sender: Client; readonly conversationId: string };
    }

    /**
     * Both people connected and following; the STALE side also follows a
     * control conversation. Proves the stale socket receives the actor's
     * presence, message and typing while it is allowed.
     */
    async function scene(
      label: string,
      staleSide: 'teacher' | 'learner',
    ): Promise<Scene> {
      const pair = await world.pair(label);
      const stalePerson = staleSide === 'teacher' ? pair.teacher : pair.learner;
      const actorPerson = staleSide === 'teacher' ? pair.learner : pair.teacher;
      const controlOf =
        staleSide === 'teacher'
          ? await teacherControl(stalePerson, label)
          : await learnerControl(stalePerson, label);

      const stale = await open(stalePerson);
      expect(failureOf(await subscribe(stale, pair.conversationId))).toBe('accepted');
      expect(failureOf(await subscribe(stale, controlOf.conversationId))).toBe(
        'accepted',
      );
      const controlSender = await open(controlOf.counterpart);
      expect(failureOf(await subscribe(controlSender, controlOf.conversationId))).toBe(
        'accepted',
      );

      const actor = await open(actorPerson);
      const joined = await subscribe(actor, pair.conversationId);
      expect(joined).toMatchObject({ ok: true, value: { counterpartOnline: true } });
      await stale.next(
        'presence:changed',
        (payload: { conversationId: string; online: boolean }) =>
          payload.conversationId === pair.conversationId && payload.online,
      );

      const sent = await sendOver(actor, pair.conversationId, body(`${label}-allowed`));
      expect(sent.ok).toBe(true);
      await stale.next(
        'message:created',
        (payload: { conversationId: string; message: { sequence: number } }) =>
          payload.conversationId === pair.conversationId &&
          payload.message.sequence === 1,
      );
      expect(failureOf(await typingOver(actor, pair.conversationId, true))).toBe(
        'accepted',
      );
      await stale.next(
        'typing:changed',
        (payload: { conversationId: string; typing: boolean }) =>
          payload.conversationId === pair.conversationId && payload.typing,
      );

      return {
        pair,
        stale,
        staleAccount: stalePerson.accountId,
        actor,
        actorPerson,
        control: { sender: controlSender, conversationId: controlOf.conversationId },
      };
    }

    const isFor =
      (operation: Parameters<typeof fanOutDone>[0]) =>
      (record: LogRecord): boolean =>
        fanOutDone(operation)(record) && Number(record['recipients']) >= 1;

    /**
     * With the facts changed: everything the actor does reaches the stale
     * socket as nothing at all.
     */
    async function nothingReachesTheStaleSocket(subject: Scene): Promise<void> {
      const { pair, stale, actor, actorPerson, control } = subject;
      const frames = stale.frames.length;
      const before = await messagesIn(world, pair.conversationId);

      // A NEW message — refused exactly as the service refuses it, and unwritten.
      const expected = transportFailureFor(
        await reasonOf(
          world.messaging.service.send(me(actorPerson.accountId), pair.conversationId, {
            operationId: op(),
            body: body('web-probe'),
            attachmentIds: [],
          }),
        ),
      );
      expect(expected).not.toBe('accepted');
      expect(
        failureOf(await sendOver(actor, pair.conversationId, body('stale-probe'))),
      ).toBe(expected);
      expect(await messagesIn(world, pair.conversationId)).toBe(before);

      // Typing: refused now, and the withdrawal of the earlier signal fans out —
      // decided for the stale recipient, and delivered to nobody.
      let mark = realtime.records.length;
      expect(failureOf(await typingOver(actor, pair.conversationId, true))).toBe(
        'not-found',
      );
      const typed = await realtime.waitForRecord(isFor('fan-out:typing'), { from: mark });
      expect(typed['delivered']).toBe(0);

      // Presence: the actor leaves — a fan-out, delivered to nobody.
      mark = realtime.records.length;
      actor.close();
      const left = await realtime.waitForRecord(isFor('fan-out:presence'), {
        from: mark,
      });
      expect(left['delivered']).toBe(0);

      // …and joins afresh. Whether they may follow is the service's answer for
      // THEM; if they may, their arrival is still decided for the stale
      // recipient, and delivered to nobody.
      const followable = transportFailureFor(
        await reasonOf(
          world.messaging.service.conversation(
            me(actorPerson.accountId),
            pair.conversationId,
          ),
        ),
      );
      const again = await open(actorPerson);
      mark = realtime.records.length;
      expect(failureOf(await subscribe(again, pair.conversationId))).toBe(followable);
      if (followable === 'accepted') {
        const joined = await realtime.waitForRecord(isFor('fan-out:presence'), {
          from: mark,
        });
        expect(joined['delivered']).toBe(0);
      }

      // The stale socket is alive and listening: the control message arrives…
      const controlSent = await sendOver(
        control.sender,
        control.conversationId,
        body('control'),
      );
      expect(controlSent.ok).toBe(true);
      await stale.next(
        'message:created',
        (payload: { conversationId: string }) =>
          payload.conversationId === control.conversationId,
        { from: frames },
      );
      // …and nothing about the affected conversation ever did.
      expect(stale.framesFor(pair.conversationId, frames)).toEqual([]);
    }

    describe('the outbound leak matrix', () => {
      it('a revoked teacher is told nothing more', async () => {
        const subject = await scene('leak-revoked', 'teacher');
        await revokeAssignment(
          world.messaging.db.admin,
          subject.pair.teacher.role.roleAssignmentId,
        );
        await nothingReachesTheStaleSocket(subject);
      });

      it('a teacher whose scope ended is told nothing more', async () => {
        const subject = await scene('leak-scope', 'teacher');
        await endScope(world.messaging.db.admin, subject.pair.scopeId);
        await nothingReachesTheStaleSocket(subject);
      });

      it('a withdrawn learner is told nothing more', async () => {
        const subject = await scene('leak-withdrawn', 'learner');
        await withdrawEnrolment(
          world.messaging.db.admin,
          subject.pair.learner.accountId,
          subject.pair.courseId,
        );
        await nothingReachesTheStaleSocket(subject);
      });

      it('a blocked pair tell each other nothing more', async () => {
        const subject = await scene('leak-blocked', 'teacher');
        await world.messaging.service.block(
          me(subject.pair.learner.accountId),
          subject.pair.conversationId,
        );
        await nothingReachesTheStaleSocket(subject);
      });

      it('a conversation a moderator closed tells its participants nothing more', async () => {
        const subject = await scene('leak-closed', 'learner');
        const admin = world.messaging.db.admin;
        const moderator = await grantRole(admin, await account(admin), [
          'messaging.moderate',
        ]);
        const { reportId } = await world.messaging.service.report(
          me(subject.pair.teacher.accountId),
          {
            conversationId: subject.pair.conversationId,
            messageId: null,
            reason: 'safety',
          },
        );
        const [report] = await admin.query<{ version: number }>(
          `SELECT [version] FROM [dbo].[MessagingReport] WHERE [id] = ${n(reportId)};`,
        );
        await world.messaging.service.decide(me(moderator.accountId), {
          reportId,
          action: 'close-conversation',
          expectedVersion: report?.version ?? 1,
        });
        await nothingReachesTheStaleSocket(subject);
      });

      it('a recipient whose account is suspended is signed out, not sent the new message', async () => {
        const subject = await scene('leak-suspended', 'learner');
        await world.messaging.db.admin.query(
          `UPDATE [dbo].[User] SET [status] = N'suspended' WHERE [id] = ${n(subject.staleAccount)};`,
        );
        const frames = subject.stale.frames.length;
        const mark = realtime.records.length;
        // The sender is still allowed, so this one IS committed and fanned out…
        const sent = await sendOver(
          subject.actor,
          subject.pair.conversationId,
          body('after'),
        );
        expect(sent.ok).toBe(true);
        // …and the stale recipient's own session is re-resolved first: it is
        // disconnected and told nothing.
        await subject.stale.disconnected;
        const fanned = await realtime.waitForRecord(isFor('fan-out:message'), {
          from: mark,
        });
        expect(fanned['delivered']).toBe(0);
        expect(subject.stale.framesFor(subject.pair.conversationId, frames)).toEqual([]);
      });
    });

    describe('what each allowed recipient receives', () => {
      it('every tab of the recipient and the sender’s other tabs receive a message exactly once; the sending tab is answered by its ack', async () => {
        const pair = await world.pair('tabs');
        const learnerTabs = [await open(pair.learner), await open(pair.learner)];
        const teacherTabs = [await open(pair.teacher), await open(pair.teacher)];
        for (const tab of [...learnerTabs, ...teacherTabs])
          expect(failureOf(await subscribe(tab, pair.conversationId))).toBe('accepted');

        const mark = realtime.records.length;
        const sender = teacherTabs[0]!;
        const sent = await sendOver(sender, pair.conversationId, body('tabs'));
        if (!sent.ok) throw new Error('The send was refused.');
        const fanned = await realtime.waitForRecord(isFor('fan-out:message'), {
          from: mark,
        });
        expect(fanned).toMatchObject({ recipients: 3, delivered: 3 });

        for (const tab of [...learnerTabs, teacherTabs[1]!]) {
          const created = tab
            .framesFor(pair.conversationId)
            .filter((frame) => frame.event === 'message:created');
          expect(created).toHaveLength(1);
          expect(created[0]?.payload).toMatchObject({
            conversationId: pair.conversationId,
            message: { id: sent.value.message.id, sequence: 1, body: body('tabs') },
          });
        }
        expect(
          sender
            .framesFor(pair.conversationId)
            .filter((f) => f.event === 'message:created'),
        ).toEqual([]);
      });

      it('a typing frame carries the conversation and a boolean, and nothing else', async () => {
        const pair = await world.pair('typing-shape');
        const learner = await open(pair.learner);
        const teacher = await open(pair.teacher);
        expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
        expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');
        expect(failureOf(await typingOver(teacher, pair.conversationId, true))).toBe(
          'accepted',
        );
        const frame = await learner.next(
          'typing:changed',
          (payload: { conversationId: string }) =>
            payload.conversationId === pair.conversationId,
        );
        expect(frame).toEqual({ conversationId: pair.conversationId, typing: true });
        expect(failureOf(await typingOver(teacher, pair.conversationId, false))).toBe(
          'accepted',
        );
        expect(
          await learner.next(
            'typing:changed',
            (payload: { typing: boolean }) => !payload.typing,
          ),
        ).toEqual({ conversationId: pair.conversationId, typing: false });
      });
    });

    describe('presence and typing are never persisted', () => {
      /** Exact row counts of every user table, by name. */
      async function census(): Promise<Record<string, number>> {
        const admin = world.messaging.db.admin;
        const tables = await admin.query<{ name: string }>(
          `SELECT [name] FROM sys.tables WHERE [is_ms_shipped] = 0 ORDER BY [name];`,
        );
        const query = tables
          .map(
            ({ name }) =>
              `SELECT N'${name.replaceAll("'", "''")}' AS [name], COUNT_BIG(*) AS [total] FROM [dbo].[${name.replaceAll(']', ']]')}]`,
          )
          .join(' UNION ALL ');
        const counted = await admin.query<{ name: string; total: number | string }>(
          `${query};`,
        );
        return Object.fromEntries(counted.map((row) => [row.name, Number(row.total)]));
      }

      it('no table or column exists for presence, typing, sockets or realtime state', async () => {
        const admin = world.messaging.db.admin;
        const tables = await admin.query<{ name: string }>(`
        SELECT [name] FROM sys.tables
        WHERE [name] LIKE N'%Presence%' OR [name] LIKE N'%Typing%'
           OR [name] LIKE N'%Socket%' OR [name] LIKE N'%Realtime%' OR [name] LIKE N'%Online%';
      `);
        expect(tables).toEqual([]);
        const columns = await admin.query<{ name: string }>(`
        SELECT c.[name] FROM sys.columns c JOIN sys.tables t ON t.[object_id] = c.[object_id]
        WHERE c.[name] LIKE N'%presence%' OR c.[name] LIKE N'%typing%'
           OR c.[name] LIKE N'%socket%' OR c.[name] LIKE N'%online%' OR c.[name] LIKE N'%lastSeen%';
      `);
        expect(columns).toEqual([]);
      });

      it('a burst of presence and typing changes no row anywhere', async () => {
        const pair = await world.pair('census');
        const learner = await open(pair.learner);
        expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');

        const before = await census();
        for (let round = 0; round < 3; round += 1) {
          const teacher = await open(pair.teacher);
          let mark = realtime.records.length;
          expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe(
            'accepted',
          );
          await realtime.waitForRecord(isFor('fan-out:presence'), { from: mark });
          mark = realtime.records.length;
          expect(failureOf(await typingOver(teacher, pair.conversationId, true))).toBe(
            'accepted',
          );
          await realtime.waitForRecord(isFor('fan-out:typing'), { from: mark });
          mark = realtime.records.length;
          expect(failureOf(await typingOver(teacher, pair.conversationId, false))).toBe(
            'accepted',
          );
          await realtime.waitForRecord(isFor('fan-out:typing'), { from: mark });
          mark = realtime.records.length;
          teacher.close();
          await realtime.waitForRecord(isFor('fan-out:presence'), { from: mark });
        }
        const presence = learner.framesFor(pair.conversationId);
        expect(
          presence.filter((frame) => frame.event === 'presence:changed'),
        ).toHaveLength(6);
        expect(presence.filter((frame) => frame.event === 'typing:changed')).toHaveLength(
          6,
        );

        expect(await census()).toEqual(before);
      });
    });
  },
);
