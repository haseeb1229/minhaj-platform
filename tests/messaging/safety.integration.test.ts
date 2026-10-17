import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { MessagingService } from '../../packages/server-core/src/messaging/index.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activateLive,
  activateMessaging,
  auditRows,
  count,
  enrol,
  grantRole,
  liveCourse,
  messagingWorld,
  n,
  op,
  platformAdministrator,
  reasonOf,
  revokeAssignment,
  scope,
  sentinel,
  teacherAccount,
  type MessagingWorld,
  type RoleFixture,
} from './fixture-sql.ts';

/**
 * Phase 24 — Messaging's safety surfaces over a REAL SQL Server, through the
 * REAL service, as the provisioned RUNTIME principal: support, blocks,
 * reports and moderation.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that a support conversation is its
 * person's alone, that staff reach the queue only through Identity's LIVE,
 * externally gated `messaging.support` — which the Platform Administrator
 * bundle does not carry — and that every opening of content is audited with
 * identifiers only; that a claim and a resolution each win exactly once
 * against a stale version; that one person has one open support conversation
 * however many requests race; that a block and a send racing it are strictly
 * ordered (no message ever commits after the block that refused it); that a
 * report names a typed target and a moderator reads only its bounded window;
 * that withholding hides a message from its participants and keeps it as
 * evidence; that a decision is permanent; and that closing a conversation
 * for moderation suspends nobody.
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

/** Every audit row's state columns must be free of message text. */
const BODY_MARK = 'NON[_]MESSAGING[_]FIXTURE[_]BODY';

live(
  'Phase 24 Messaging support, blocks, reports and moderation against real SQL Server',
  () => {
    let world: MessagingWorld;
    let admin: SqlSession;
    let service: MessagingService;

    beforeAll(async () => {
      world = await messagingWorld();
      admin = world.db.admin;
      service = world.service;
      await activateMessaging(admin, 'support');
      await activateMessaging(admin, 'teacher-student');
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

    /** A fresh current teaching relationship and its conversation. */
    async function pair(): Promise<Pair> {
      const teacher = await teacherAccount(admin);
      const learner = await account(admin);
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

    /** `count` messages alternating between the two people, oldest first. */
    async function exchange(p: Pair, total: number) {
      const ids: string[] = [];
      for (let index = 0; index < total; index += 1) {
        const sender = index % 2 === 0 ? p.learner : p.teacher.accountId;
        ids.push(
          (await send(sender, p.conversationId, text(`m${String(index + 1)}`))).message
            .id,
        );
      }
      return ids;
    }

    const staffAccount = async (keys: readonly string[]) =>
      await grantRole(admin, await account(admin), keys);

    /* ======================================================================
     * Support
     * ==================================================================== */

    describe('support conversations', () => {
      it('belong to the signed-in person who asked, and to nobody else', async () => {
        const asker = await account(admin);
        const other = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        const theirs = (await service.openSupport(me(other))).conversationId;
        expect(theirs).not.toBe(conversationId);
        // Opening again returns the one open conversation.
        expect((await service.openSupport(me(asker))).conversationId).toBe(
          conversationId,
        );

        await send(asker, conversationId, text('help'));
        const overview = await service.support(me(asker));
        expect(overview.open?.id).toBe(conversationId);
        expect(overview.open?.counterpartAccountId).toBeNull();
        expect(overview.earlier).toEqual([]);
        expect(
          (
            await service.conversations(me(asker), { surface: 'my', cursor: null })
          ).conversations.map((summary) => [summary.id, summary.role]),
        ).toEqual([[conversationId, 'requester']]);

        expect(await reasonOf(service.conversation(me(other), conversationId))).toBe(
          'not-found',
        );
        expect(await reasonOf(service.history(me(other), conversationId, null))).toBe(
          'not-found',
        );
        expect(await reasonOf(send(other, conversationId, text('intrude')))).toBe(
          'not-found',
        );
        expect(await reasonOf(service.markRead(me(other), conversationId, 1))).toBe(
          'not-found',
        );
        expect(
          (
            await service.conversations(me(other), { surface: 'my', cursor: null })
          ).conversations.map((summary) => summary.id),
        ).toEqual([theirs]);
        expect(
          await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
        ).toBe(1);
      });

      it('one person has one open conversation however many openings race', async () => {
        const asker = await account(admin);
        const opened = await Promise.all(
          Array.from({ length: 4 }, () => service.openSupport(me(asker))),
        );
        expect(new Set(opened.map((result) => result.conversationId)).size).toBe(1);
        expect(
          await count(
            admin,
            'Conversation',
            `[kind] = N'support' AND [requesterUserId] = ${n(asker)}`,
          ),
        ).toBe(1);
        expect(
          await count(admin, 'ConversationParticipant', `[userId] = ${n(asker)}`),
        ).toBe(1);
      });

      it('refuses staff without the live key — the Platform Administrator bundle does not carry it', async () => {
        const asker = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        const [version] = await admin.query<{ version: number }>(
          `SELECT [version] FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
        );

        const unrelated = await staffAccount(['teaching.perform']);
        const platformAdmin = await account(admin);
        await platformAdministrator(admin, platformAdmin);
        expect(
          await count(
            admin,
            'RolePermission',
            `[permissionKey] LIKE N'messaging.%' AND [roleId] IN (SELECT [id] FROM [dbo].[Role] WHERE [key] = N'platform-administrator')`,
          ),
        ).toBe(0);

        for (const actor of [unrelated.accountId, platformAdmin, asker]) {
          expect(
            await reasonOf(
              service.supportQueue(me(actor), { state: 'open', cursor: null }),
            ),
          ).toBe('denied');
          expect(
            await reasonOf(service.supportConversation(me(actor), conversationId)),
          ).toBe('denied');
          expect(
            await reasonOf(service.supportHistory(me(actor), conversationId, null)),
          ).toBe('denied');
          expect(
            await reasonOf(
              service.claimSupport(me(actor), conversationId, version?.version ?? 1),
            ),
          ).toBe('denied');
          expect(
            await reasonOf(
              service.resolveSupport(me(actor), conversationId, version?.version ?? 1),
            ),
          ).toBe('denied');
        }
        expect(await count(admin, 'AuditLog', `[targetId] = ${n(conversationId)}`)).toBe(
          0,
        );
      });

      it('staff with the key see queue metadata; opening content is audited, identifiers only', async () => {
        const asker = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        await send(asker, conversationId, text('support-question'));
        const staff = await staffAccount(['messaging.support']);

        const queue = await service.supportQueue(me(staff.accountId), {
          state: 'open',
          cursor: null,
        });
        const item = queue.items.find((entry) => entry.id === conversationId);
        expect(item).toMatchObject({
          state: 'open',
          closedReason: null,
          claimed: false,
          claimedByMe: false,
          awaitingReply: true,
        });
        // METADATA: no text, no person, no name.
        expect(Object.keys(item ?? {}).sort()).toEqual(
          [
            'awaitingReply',
            'claimed',
            'claimedByMe',
            'closedReason',
            'createdAt',
            'id',
            'lastMessageAt',
            'state',
            'version',
          ].sort(),
        );
        expect(JSON.stringify(queue)).not.toContain('NON_MESSAGING_FIXTURE_BODY');
        // Reading the queue opened no content, so it recorded no content access.
        expect(await count(admin, 'AuditLog', `[targetId] = ${n(conversationId)}`)).toBe(
          0,
        );

        const view = await service.supportConversation(
          me(staff.accountId),
          conversationId,
        );
        expect(view).toMatchObject({
          requesterAccountId: asker,
          claimedByAccountId: null,
        });
        expect(view.conversation.sendRefusal).toBe('unclaimed');
        const history = await service.supportHistory(
          me(staff.accountId),
          conversationId,
          null,
        );
        expect(history.messages.map((message) => message.body)).toEqual([
          text('support-question'),
        ]);
        // Staff are not participants until they claim: the person-facing paths refuse.
        expect(
          await reasonOf(service.conversation(me(staff.accountId), conversationId)),
        ).toBe('not-found');
        expect(await reasonOf(send(staff.accountId, conversationId, text('early')))).toBe(
          'not-found',
        );

        const audit = await auditRows(admin, conversationId);
        expect(audit.map((row) => row.action)).toEqual([
          'messaging.support.accessed',
          'messaging.support.history.accessed',
        ]);
        for (const row of audit) {
          expect(row).toMatchObject({
            actorId: staff.accountId,
            targetType: 'conversation',
            authorisingSource: 'messaging.support',
          });
          expect(`${row.beforeState ?? ''}${row.afterState ?? ''}`).not.toContain(
            'NON_MESSAGING',
          );
        }
      });

      it('a claim and a resolution each win once against a stale version', async () => {
        const asker = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        await send(asker, conversationId, text('claim-me'));
        const first = await staffAccount(['messaging.support']);
        const second = await staffAccount(['messaging.support']);
        const version = (
          await service.supportConversation(me(first.accountId), conversationId)
        ).version;

        const raced = await Promise.all([
          reasonOf(service.claimSupport(me(first.accountId), conversationId, version)),
          reasonOf(service.claimSupport(me(second.accountId), conversationId, version)),
        ]);
        expect([...raced].sort()).toEqual(['accepted', 'conflict']);
        const winner = raced[0] === 'accepted' ? first : second;
        const loser = winner === first ? second : first;
        expect(
          await count(
            admin,
            'ConversationParticipant',
            `[conversationId] = ${n(conversationId)} AND [role] = N'support' AND [leftAt] IS NULL`,
          ),
        ).toBe(1);

        const reply = await send(winner.accountId, conversationId, text('staff-reply'));
        expect(reply.message.sequence).toBe(2);
        const seen = await service.history(me(asker), conversationId, null);
        expect(seen.messages.map((message) => [message.body, message.own])).toEqual([
          [text('claim-me'), true],
          [text('staff-reply'), false],
        ]);
        expect(await reasonOf(send(loser.accountId, conversationId, text('loser')))).toBe(
          'not-found',
        );

        // The loser takes it over at the CURRENT version; the stale one is refused.
        expect(
          await reasonOf(
            service.claimSupport(me(loser.accountId), conversationId, version),
          ),
        ).toBe('conflict');
        const current = (
          await service.supportConversation(me(loser.accountId), conversationId)
        ).version;
        await service.claimSupport(me(loser.accountId), conversationId, current);
        expect(await reasonOf(send(winner.accountId, conversationId, text('left')))).toBe(
          'not-found',
        );
        await send(loser.accountId, conversationId, text('handover'));

        const resolving = (
          await service.supportConversation(me(loser.accountId), conversationId)
        ).version;
        expect(
          await reasonOf(
            service.resolveSupport(me(loser.accountId), conversationId, current),
          ),
        ).toBe('conflict');
        await service.resolveSupport(me(loser.accountId), conversationId, resolving);
        expect(
          await reasonOf(
            service.resolveSupport(me(loser.accountId), conversationId, resolving + 1),
          ),
        ).toBe('closed');
        expect(
          await reasonOf(
            service.claimSupport(me(winner.accountId), conversationId, resolving + 1),
          ),
        ).toBe('closed');

        expect(await reasonOf(send(asker, conversationId, text('after')))).toBe('closed');
        const overview = await service.support(me(asker));
        expect(overview.open).toBeNull();
        expect(
          overview.earlier.map((summary) => [summary.id, summary.closedReason]),
        ).toEqual([[conversationId, 'resolved']]);
        // A resolved conversation lets the person ask again.
        const again = await service.openSupport(me(asker));
        expect(again.conversationId).not.toBe(conversationId);

        const actions = (await auditRows(admin, conversationId)).map((row) => row.action);
        expect(
          actions.filter((action) => action === 'messaging.support.claimed'),
        ).toHaveLength(2);
        expect(
          actions.filter((action) => action === 'messaging.support.resolved'),
        ).toHaveLength(1);
      });

      it('revoking the staff assignment refuses the very next call', async () => {
        const asker = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        const staff = await staffAccount(['messaging.support']);
        const version = (
          await service.supportConversation(me(staff.accountId), conversationId)
        ).version;
        await service.claimSupport(me(staff.accountId), conversationId, version);
        await send(staff.accountId, conversationId, text('while-staff'));

        await revokeAssignment(admin, staff.roleAssignmentId);
        expect(
          await reasonOf(
            service.supportQueue(me(staff.accountId), { state: 'open', cursor: null }),
          ),
        ).toBe('denied');
        expect(
          await reasonOf(
            service.supportConversation(me(staff.accountId), conversationId),
          ),
        ).toBe('denied');
        expect(
          await reasonOf(
            service.supportHistory(me(staff.accountId), conversationId, null),
          ),
        ).toBe('denied');
        // Still the claimed participant row — and that row is worth nothing now.
        expect(
          await reasonOf(send(staff.accountId, conversationId, text('after-revoke'))),
        ).toBe('ended');
        expect(
          await reasonOf(service.history(me(staff.accountId), conversationId, null)),
        ).toBe('ended');
        expect(
          await count(admin, 'Message', `[conversationId] = ${n(conversationId)}`),
        ).toBe(1);
      });
    });

    /* ======================================================================
     * Blocks
     * ==================================================================== */

    describe('blocks', () => {
      it('stop starting and sending in both directions, keep the history, and lift on unblock', async () => {
        const p = await pair();
        await exchange(p, 2);
        await service.block(me(p.learner), p.conversationId);
        await service.block(me(p.learner), p.conversationId);
        expect(
          await count(admin, 'MessagingBlock', `[blockerUserId] = ${n(p.learner)}`),
        ).toBe(1);

        for (const [actor, counterpart] of [
          [p.learner, p.teacher.accountId],
          [p.teacher.accountId, p.learner],
        ] as const) {
          expect(await reasonOf(send(actor, p.conversationId, text('blocked')))).toBe(
            'blocked',
          );
          expect(
            await reasonOf(
              service.startTeaching(me(actor), {
                counterpartAccountId: counterpart,
                courseId: p.courseId,
              }),
            ),
          ).toBe('blocked');
          const view = await service.conversation(me(actor), p.conversationId);
          expect(view).toMatchObject({ canSend: false, sendRefusal: 'blocked' });
          expect(view.blockedByMe).toBe(actor === p.learner);
          // A block hides nothing already said.
          expect(
            (await service.history(me(actor), p.conversationId, null)).messages,
          ).toHaveLength(2);
        }
        expect(
          (await service.blocks(me(p.learner))).map((entry) => entry.blockedAccountId),
        ).toEqual([p.teacher.accountId]);
        expect(await service.blocks(me(p.teacher.accountId))).toEqual([]);
        expect(
          await count(admin, 'Message', `[conversationId] = ${n(p.conversationId)}`),
        ).toBe(2);

        // Only the blocker lifts their own block.
        await service.unblock(me(p.teacher.accountId), p.learner);
        expect(
          await reasonOf(send(p.teacher.accountId, p.conversationId, text('still'))),
        ).toBe('blocked');
        await service.unblock(me(p.learner), p.teacher.accountId);
        await service.unblock(me(p.learner), p.teacher.accountId);
        expect(
          (await send(p.teacher.accountId, p.conversationId, text('restored'))).message
            .sequence,
        ).toBe(3);
        expect(
          (await send(p.learner, p.conversationId, text('restored-2'))).message.sequence,
        ).toBe(4);

        // A support conversation has no counterpart to block.
        const { conversationId } = await service.openSupport(me(p.learner));
        expect(await reasonOf(service.block(me(p.learner), conversationId))).toBe(
          'invalid',
        );
      });

      it('a block committed after the send was checked still refuses it, under the send’s own lock', async () => {
        const p = await pair();
        await exchange(p, 1);
        // The service has ALREADY decided the send may go when the block lands:
        // only the adapter's re-check, under the conversation's lock, stands
        // between the two.
        const paused = world.serviceWith({
          persistence: {
            ...world.persistence,
            append: async (input) => {
              await service.block(me(p.learner), p.conversationId);
              return world.persistence.append(input);
            },
          },
        });
        expect(
          await reasonOf(
            paused.send(me(p.teacher.accountId), p.conversationId, {
              operationId: op(),
              body: text('slipped'),
              attachmentIds: [],
            }),
          ),
        ).toBe('blocked');
        expect(
          await count(admin, 'Message', `[conversationId] = ${n(p.conversationId)}`),
        ).toBe(1);
      });

      it('a send racing a block either commits or is refused as blocked — never half of either', async () => {
        const p = await pair();
        const outcomes: string[] = [];
        for (let round = 0; round < 6; round += 1) {
          const [, sent] = await Promise.all([
            service.block(me(p.learner), p.conversationId),
            reasonOf(
              send(p.teacher.accountId, p.conversationId, text(`race-${String(round)}`)),
            ),
          ]);
          outcomes.push(sent);
          // Whatever the interleaving, the block holds once both settle.
          expect(
            await reasonOf(send(p.teacher.accountId, p.conversationId, text('after'))),
          ).toBe('blocked');
          await service.unblock(me(p.learner), p.teacher.accountId);
        }
        for (const outcome of outcomes)
          expect(['accepted', 'blocked']).toContain(outcome);
        const sequences = await admin.query<{ sequence: number }>(
          `SELECT [sequence] FROM [dbo].[Message] WHERE [conversationId] = ${n(p.conversationId)} ORDER BY [sequence];`,
        );
        const accepted = outcomes.filter((outcome) => outcome === 'accepted').length;
        expect(sequences.map((row) => row.sequence)).toEqual(
          Array.from({ length: accepted }, (_, index) => index + 1),
        );
      });
    });

    /* ======================================================================
     * Reports and moderation
     * ==================================================================== */

    describe('reports', () => {
      it('only a participant files one; its target is a typed message or the conversation', async () => {
        const p = await pair();
        const [, second] = await exchange(p, 3);
        const elsewhere = await pair();
        const [foreign] = await exchange(elsewhere, 1);
        const stranger = await account(admin);

        expect(
          await reasonOf(
            service.report(me(stranger), {
              conversationId: p.conversationId,
              messageId: second ?? '',
              reason: 'spam',
            }),
          ),
        ).toBe('not-found');

        const onMessage = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: second ?? '',
          reason: 'harassment',
        });
        const onConversation = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: null,
          reason: 'safety',
        });
        expect(onMessage.duplicate).toBe(false);
        expect(onConversation.duplicate).toBe(false);
        expect(onConversation.reportId).not.toBe(onMessage.reportId);
        const rows = await admin.query<{
          id: string;
          messageId: string | null;
          atSequence: number;
        }>(
          `SELECT [id], [messageId], [atSequence] FROM [dbo].[MessagingReport] WHERE [conversationId] = ${n(p.conversationId)} ORDER BY [createdAt], [id];`,
        );
        expect(rows.map((row) => [row.id, row.messageId, row.atSequence]).sort()).toEqual(
          [
            [onMessage.reportId, second, 3],
            [onConversation.reportId, null, 3],
          ].sort(),
        );

        // One OPEN report per reporter and target.
        expect(
          await service.report(me(p.learner), {
            conversationId: p.conversationId,
            messageId: second ?? '',
            reason: 'spam',
          }),
        ).toEqual({ reportId: onMessage.reportId, duplicate: true });
        expect(
          await service.report(me(p.learner), {
            conversationId: p.conversationId,
            messageId: null,
            reason: 'other',
          }),
        ).toEqual({ reportId: onConversation.reportId, duplicate: true });
        // The other person's report on the same message is their own.
        expect(
          (
            await service.report(me(p.teacher.accountId), {
              conversationId: p.conversationId,
              messageId: second ?? '',
              reason: 'other',
            })
          ).duplicate,
        ).toBe(false);

        // A message of ANOTHER conversation is not a target here.
        expect(
          await reasonOf(
            service.report(me(p.learner), {
              conversationId: p.conversationId,
              messageId: foreign ?? '',
              reason: 'spam',
            }),
          ),
        ).toBe('invalid');
        expect(
          await count(
            admin,
            'MessagingReport',
            `[conversationId] = ${n(p.conversationId)}`,
          ),
        ).toBe(3);

        // No generic polymorphic target exists to aim elsewhere.
        const columns = await admin.query<{ name: string }>(
          `SELECT [name] FROM sys.columns WHERE [object_id] = OBJECT_ID(N'dbo.MessagingReport') ORDER BY [name];`,
        );
        expect(columns.map((column) => column.name)).not.toContain('targetType');
        expect(columns.map((column) => column.name)).not.toContain('targetId');
      });

      it('a moderator needs the live key; the Platform Administrator bundle does not carry it', async () => {
        const p = await pair();
        const [message] = await exchange(p, 1);
        const { reportId } = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: message ?? '',
          reason: 'spam',
        });
        const platformAdmin = await account(admin);
        await platformAdministrator(admin, platformAdmin);
        const supportOnly = await staffAccount(['messaging.support']);
        for (const actor of [platformAdmin, supportOnly.accountId, p.learner]) {
          expect(
            await reasonOf(service.reports(me(actor), { state: 'open', cursor: null })),
          ).toBe('denied');
          expect(await reasonOf(service.evidence(me(actor), reportId))).toBe('denied');
          expect(
            await reasonOf(
              service.decide(me(actor), {
                reportId,
                action: 'dismiss',
                expectedVersion: 1,
              }),
            ),
          ).toBe('denied');
        }
        expect(await count(admin, 'MessagingModerationDecision')).toBe(0);

        const moderator = await staffAccount(['messaging.moderate']);
        const page = await service.reports(me(moderator.accountId), {
          state: 'open',
          cursor: null,
        });
        const summary = page.reports.find((entry) => entry.id === reportId);
        expect(summary).toMatchObject({
          conversationId: p.conversationId,
          conversationKind: 'teacher-student',
          messageId: message,
          reason: 'spam',
          state: 'open',
          version: 1,
        });
        expect(JSON.stringify(page)).not.toContain('NON_MESSAGING_FIXTURE_BODY');
        // The queue opened no evidence.
        expect(await count(admin, 'AuditLog', `[targetId] = ${n(reportId)}`)).toBe(0);
      });

      it('evidence is the bounded window one report authorises, and every read of it is audited', async () => {
        const p = await pair();
        const ids = await exchange(p, 25);
        const moderator = await staffAccount(['messaging.moderate']);
        const onMessage = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: ids[14] ?? '',
          reason: 'harassment',
        });
        // Later messages are outside a report filed before them.
        for (let index = 26; index <= 35; index += 1)
          await send(p.teacher.accountId, p.conversationId, text(`m${String(index)}`));
        const onConversation = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: null,
          reason: 'safety',
        });

        const around = await service.evidence(
          me(moderator.accountId),
          onMessage.reportId,
        );
        expect(around.messages.map((message) => message.sequence)).toEqual(
          Array.from({ length: 21 }, (_, index) => index + 5),
        );
        expect(
          around.messages.filter((message) => message.reported).map((m) => m.sequence),
        ).toEqual([15]);
        expect(
          around.messages.every((message) =>
            message.body.startsWith('NON_MESSAGING_FIXTURE_BODY_'),
          ),
        ).toBe(true);
        expect(around.reporterAccountId).toBe(p.learner);
        expect(around.conversation).toMatchObject({
          id: p.conversationId,
          state: 'open',
        });

        const recent = await service.evidence(
          me(moderator.accountId),
          onConversation.reportId,
        );
        expect(recent.messages.map((message) => message.sequence)).toEqual(
          Array.from({ length: 30 }, (_, index) => index + 6),
        );

        for (const reportId of [onMessage.reportId, onConversation.reportId]) {
          const audit = await auditRows(admin, reportId);
          expect(audit).toHaveLength(1);
          expect(audit[0]).toMatchObject({
            action: 'messaging.evidence.accessed',
            actorId: moderator.accountId,
            targetType: 'messaging-report',
            authorisingSource: 'messaging.moderate',
          });
          expect(
            `${audit[0]?.beforeState ?? ''}${audit[0]?.afterState ?? ''}`,
          ).not.toContain('NON_MESSAGING');
        }
      });

      it('withholding hides a message from its participants and keeps it as evidence; a decision is permanent', async () => {
        const p = await pair();
        const ids = await exchange(p, 3);
        const target = ids[1] ?? '';
        const { reportId } = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: target,
          reason: 'inappropriate',
        });
        const conversationReport = await service.report(me(p.learner), {
          conversationId: p.conversationId,
          messageId: null,
          reason: 'other',
        });
        const first = await staffAccount(['messaging.moderate']);
        const second = await staffAccount(['messaging.moderate']);

        // Withholding needs a message; a conversation report has none.
        expect(
          await reasonOf(
            service.decide(me(first.accountId), {
              reportId: conversationReport.reportId,
              action: 'withhold-message',
              expectedVersion: 1,
            }),
          ),
        ).toBe('invalid');
        expect(
          await reasonOf(
            service.decide(me(first.accountId), {
              reportId,
              action: 'withhold-message',
              expectedVersion: 2,
            }),
          ),
        ).toBe('conflict');

        // Two moderators decide at once: exactly one decision exists.
        const raced = await Promise.all([
          reasonOf(
            service.decide(me(first.accountId), {
              reportId,
              action: 'withhold-message',
              expectedVersion: 1,
            }),
          ),
          reasonOf(
            service.decide(me(second.accountId), {
              reportId,
              action: 'withhold-message',
              expectedVersion: 1,
            }),
          ),
        ]);
        expect([...raced].sort()).toEqual(['accepted', 'conflict']);
        expect(
          await count(
            admin,
            'MessagingModerationDecision',
            `[reportId] = ${n(reportId)}`,
          ),
        ).toBe(1);
        expect(
          await reasonOf(
            service.decide(me(first.accountId), {
              reportId,
              action: 'dismiss',
              expectedVersion: 2,
            }),
          ),
        ).toBe('conflict');

        for (const actor of [p.learner, p.teacher.accountId]) {
          const history = await service.history(me(actor), p.conversationId, null);
          const withheld = history.messages.find((message) => message.id === target);
          expect(withheld).toMatchObject({ body: null, withheld: true, attachments: [] });
          expect(
            history.messages.filter((message) => message.body !== null),
          ).toHaveLength(2);
        }
        const evidence = await service.evidence(me(first.accountId), reportId);
        const kept = evidence.messages.find((message) => message.id === target);
        expect(kept).toMatchObject({ body: text('m2'), withheld: true, reported: true });
        expect(evidence.report.state).toBe('resolved');
        expect(evidence.decision?.action).toBe('withhold-message');

        // THE FLOOR. The text never changes, the withholding never lifts, and
        // the decision can be neither edited nor removed.
        const [stored] = await admin.query<{ body: string; moderation: string }>(
          `SELECT [body], [moderation] FROM [dbo].[Message] WHERE [id] = ${n(target)};`,
        );
        expect(stored).toEqual({ body: text('m2'), moderation: 'withheld' });
        expect(
          await sqlNumber(
            admin.query(
              `UPDATE [dbo].[Message] SET [body] = N'x' WHERE [id] = ${n(target)};`,
            ),
          ),
        ).toBe(51304);
        expect(
          await sqlNumber(
            admin.query(
              `UPDATE [dbo].[Message] SET [moderation] = N'visible', [withheldAt] = NULL WHERE [id] = ${n(target)};`,
            ),
          ),
        ).toBe(51304);
        expect(
          await sqlNumber(
            admin.query(
              `UPDATE [dbo].[MessagingModerationDecision] SET [action] = N'dismiss' WHERE [reportId] = ${n(reportId)};`,
            ),
          ),
        ).toBe(51309);
        expect(
          await sqlNumber(
            admin.query(
              `DELETE FROM [dbo].[MessagingModerationDecision] WHERE [reportId] = ${n(reportId)};`,
            ),
          ),
        ).toBe(51309);

        const decided = (await auditRows(admin, reportId)).filter(
          (row) => row.action === 'messaging.moderation.decided',
        );
        expect(decided).toHaveLength(1);
        expect(decided[0]?.afterState).toContain('withhold-message');
        expect(decided[0]?.afterState ?? '').not.toContain('NON_MESSAGING');
      });

      it('closing a conversation for moderation stops sending and suspends nobody', async () => {
        const p = await pair();
        await exchange(p, 2);
        const { reportId } = await service.report(me(p.teacher.accountId), {
          conversationId: p.conversationId,
          messageId: null,
          reason: 'harassment',
        });
        const moderator = await staffAccount(['messaging.moderate']);
        const statusBefore = await admin.query<{ id: string; status: string }>(
          `SELECT [id], [status] FROM [dbo].[User] WHERE [id] IN (${n(p.learner)}, ${n(p.teacher.accountId)}) ORDER BY [id];`,
        );
        await service.decide(me(moderator.accountId), {
          reportId,
          action: 'close-conversation',
          expectedVersion: 1,
        });

        for (const actor of [p.learner, p.teacher.accountId]) {
          expect(await reasonOf(send(actor, p.conversationId, text('after-close')))).toBe(
            'closed',
          );
          const view = await service.conversation(me(actor), p.conversationId);
          expect(view.summary).toMatchObject({
            state: 'closed',
            closedReason: 'moderation',
          });
          expect(view).toMatchObject({ canSend: false, sendRefusal: 'closed' });
          // The relationship still holds, so what was said stays readable.
          expect(
            (await service.history(me(actor), p.conversationId, null)).messages,
          ).toHaveLength(2);
        }
        // Starting again finds the same, still-closed conversation.
        expect(
          (
            await service.startTeaching(me(p.learner), {
              counterpartAccountId: p.teacher.accountId,
              courseId: p.courseId,
            })
          ).conversationId,
        ).toBe(p.conversationId);
        expect(await reasonOf(send(p.learner, p.conversationId, text('reopen')))).toBe(
          'closed',
        );

        // NO IDENTITY SIDE EFFECT: nobody is suspended, no authority moves.
        expect(
          await admin.query<{ id: string; status: string }>(
            `SELECT [id], [status] FROM [dbo].[User] WHERE [id] IN (${n(p.learner)}, ${n(p.teacher.accountId)}) ORDER BY [id];`,
          ),
        ).toEqual(statusBefore);
        expect(statusBefore.every((row) => row.status === 'active')).toBe(true);
        expect(
          await count(
            admin,
            'RoleAssignment',
            `[id] = ${n(p.teacher.roleAssignmentId)} AND [revokedAt] IS NULL`,
          ),
        ).toBe(1);

        // A dismissal resolves a report and changes nothing else.
        const other = await pair();
        const [message] = await exchange(other, 1);
        const dismissed = await service.report(me(other.learner), {
          conversationId: other.conversationId,
          messageId: message ?? '',
          reason: 'spam',
        });
        await service.decide(me(moderator.accountId), {
          reportId: dismissed.reportId,
          action: 'dismiss',
          expectedVersion: 1,
        });
        const history = await service.history(
          me(other.learner),
          other.conversationId,
          null,
        );
        expect(history.messages[0]).toMatchObject({ body: text('m1'), withheld: false });
        expect(
          (await send(other.teacher.accountId, other.conversationId, text('fine')))
            .message.sequence,
        ).toBe(2);
      });

      it('an upload whose conversation closes after its check is refused as closed and records nothing', async () => {
        const p = await pair();
        const { reportId } = await service.report(me(p.teacher.accountId), {
          conversationId: p.conversationId,
          messageId: null,
          reason: 'other',
        });
        const moderator = await staffAccount(['messaging.moderate']);
        // The send gate has passed when the moderator closes the conversation;
        // only the adapter's own locked check stands between the two.
        const paused = world.serviceWith({
          persistence: {
            ...world.persistence,
            prepareAttachment: async (input) => {
              await service.decide(me(moderator.accountId), {
                reportId,
                action: 'close-conversation',
                expectedVersion: 1,
              });
              return world.persistence.prepareAttachment(input);
            },
          },
        });
        const nothing: AsyncIterable<Uint8Array> = {
          [Symbol.asyncIterator]: () => ({
            next: async () => ({ done: true as const, value: undefined }),
          }),
        };
        const released = world.releases.tokens.length;
        expect(
          await reasonOf(
            paused.uploadAttachment(me(p.learner), p.conversationId, nothing, {
              mediaType: 'image/png',
              displayName: null,
            }),
          ),
        ).toBe('closed');
        expect(
          await count(
            admin,
            'MessageAttachment',
            `[conversationId] = ${n(p.conversationId)}`,
          ),
        ).toBe(0);
        expect(world.releases.tokens.length).toBe(released);
      });
    });

    /* ======================================================================
     * Residue
     * ==================================================================== */

    describe('residue', () => {
      it('no audit row carries message text, and every participant is a synthetic account', async () => {
        expect(
          await count(
            admin,
            'AuditLog',
            `[beforeState] LIKE N'%${BODY_MARK}%' OR [afterState] LIKE N'%${BODY_MARK}%'`,
          ),
        ).toBe(0);
        const [foreign] = await admin.query<{ total: number }>(`
        SELECT COUNT(*) AS [total] FROM [dbo].[ConversationParticipant] p
        JOIN [dbo].[User] u ON u.[id] = p.[userId]
        WHERE u.[email] NOT LIKE N'%@messaging-proof.invalid';`);
        expect(Number(foreign?.total)).toBe(0);
      });
    });
  },
);
