import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { MessagingService } from '../../packages/server-core/src/messaging/index.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activateLive,
  activateMessaging,
  enrol,
  grantRole,
  liveCourse,
  messagingWorld,
  op,
  reasonOf,
  scope,
  sentinel,
  teacherAccount,
  type MessagingWorld,
  type RoleFixture,
} from './fixture-sql.ts';

/**
 * Phase 24 — keyset paging over a REAL SQL Server, through the REAL service,
 * as the provisioned RUNTIME principal.
 *
 * WHY THE DATABASE. Every list is a keyset: newest activity first, the id
 * breaking ties, continued from an opaque `iso|id` cursor of the last row
 * read. The adapter writes every instant those keysets order by at
 * MILLISECOND precision so that a cursor built from a JavaScript `Date` names
 * exactly the stored value. Only real `DATETIME2` columns can show that the
 * second page starts strictly after the first — no row read twice, none
 * skipped — including when many rows share one millisecond.
 *
 * WHAT A KEYSET PROMISES UNDER CHANGE, and what is asserted: a row whose
 * activity moves to the front between two page reads now sorts BEFORE the
 * cursor, so the continuation does not return it (the reader meets it again
 * on a fresh first page); every OTHER row keeps its place relative to the
 * cursor, so none is duplicated and none is skipped.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

/** The keyset order: time descending, then id descending (ordinal, as the ids are ASCII UUIDs). */
function keysetOrdered(
  rows: readonly { readonly at: Date; readonly id: string }[],
): boolean {
  return rows.every((row, index) => {
    const previous = rows[index - 1];
    if (previous === undefined) return true;
    const delta = previous.at.getTime() - row.at.getTime();
    return delta > 0 || (delta === 0 && previous.id > row.id);
  });
}

live('Phase 24 Messaging keyset paging against real SQL Server', () => {
  let world: MessagingWorld;
  let admin: SqlSession;
  let service: MessagingService;

  const learner = { id: '' };
  const teachers: RoleFixture[] = [];
  /** Each conversation of the learner with the teacher who opened it and its first message. */
  const conversations: { id: string; teacher: string; messageId: string }[] = [];

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

  const text = (label: string) => sentinel('BODY', label);

  const send = (actor: string, conversationId: string, body: string) =>
    service.send(me(actor), conversationId, {
      operationId: op(),
      body,
      attachmentIds: [],
    });

  async function page(cursor: string | null) {
    return service.conversations(me(learner.id), { surface: 'my', cursor });
  }

  const activity = (summary: { id: string; lastMessageAt: Date | null }) => ({
    id: summary.id,
    at: summary.lastMessageAt ?? new Date(0),
  });

  describe('a person’s conversations', () => {
    it('30 conversations read as 25 then 5: ordered, no duplicate, no gap', async () => {
      learner.id = await account(admin);
      // Six teachers, five Courses each: thirty distinct relationships.
      for (let t = 0; t < 6; t += 1) teachers.push(await teacherAccount(admin));
      for (const teacher of teachers)
        for (let c = 0; c < 5; c += 1) {
          const courseId = await liveCourse(admin);
          await scope(admin, courseId, teacher);
          await enrol(admin, learner.id, courseId);
          // Opened from the teacher's side, so the starts spend the teachers' budgets.
          const { conversationId } = await service.startTeaching(me(teacher.accountId), {
            counterpartAccountId: learner.id,
            courseId,
          });
          const sent = await send(
            teacher.accountId,
            conversationId,
            text(`hello-${String(c)}`),
          );
          conversations.push({
            id: conversationId,
            teacher: teacher.accountId,
            messageId: sent.message.id,
          });
        }
      expect(new Set(conversations.map((entry) => entry.id)).size).toBe(30);

      const first = await page(null);
      expect(first.conversations).toHaveLength(25);
      expect(first.next).not.toBeNull();
      const second = await page(first.next);
      expect(second.conversations).toHaveLength(5);
      expect(second.next).toBeNull();

      const all = [...first.conversations, ...second.conversations];
      expect(new Set(all.map((summary) => summary.id))).toEqual(
        new Set(conversations.map((entry) => entry.id)),
      );
      expect(all.every((summary) => summary.lastMessageAt instanceof Date)).toBe(true);
      expect(keysetOrdered(all.map(activity))).toBe(true);

      // The service's order IS the stored keyset, millisecond for millisecond.
      const stored = await admin.query<{ id: string }>(`
        SELECT c.[id] FROM [dbo].[Conversation] c
        WHERE EXISTS (SELECT 1 FROM [dbo].[ConversationParticipant] p
                      WHERE p.[conversationId] = c.[id] AND p.[userId] = N'${learner.id}')
        ORDER BY c.[activityAt] DESC, c.[id] DESC;`);
      expect(all.map((summary) => summary.id)).toEqual(stored.map((row) => row.id));

      // A cursor is opaque, and a forged one is refused rather than guessed at.
      expect(await reasonOf(page('not-a-cursor'))).toBe('invalid');
    });

    it('a conversation that moves to the front between reads disturbs no OTHER row', async () => {
      const first = await page(null);
      const before = (await page(first.next)).conversations.map((summary) => summary.id);
      expect(before).toHaveLength(5);
      const fromFirst = first.conversations[10]?.id ?? '';
      const fromSecond = before[2] ?? '';
      const owner = (id: string) =>
        conversations.find((entry) => entry.id === id)?.teacher ?? '';

      // Between the two reads, one row of each page receives a new message.
      await send(owner(fromFirst), fromFirst, text('moved-1'));
      await send(owner(fromSecond), fromSecond, text('moved-2'));

      // The continuation from the OLD cursor: the row that moved out of the
      // second page now sorts before the cursor and is not returned; the row
      // that moved within the first page is not returned twice; every other
      // second-page row is still there, in the same order.
      const continued = (await page(first.next)).conversations.map(
        (summary) => summary.id,
      );
      expect(continued).toEqual(before.filter((id) => id !== fromSecond));
      expect(continued).not.toContain(fromFirst);

      // A fresh first page leads with both moved conversations.
      const fresh = await page(null);
      expect(
        new Set(fresh.conversations.slice(0, 2).map((summary) => summary.id)),
      ).toEqual(new Set([fromFirst, fromSecond]));
      const whole = [...fresh.conversations, ...(await page(fresh.next)).conversations];
      expect(whole).toHaveLength(30);
      expect(new Set(whole.map((summary) => summary.id)).size).toBe(30);
      expect(keysetOrdered(whole.map(activity))).toBe(true);
    });
  });

  describe('the support queue', () => {
    it('27 open conversations from distinct people read as 25 then 2: ordered, no duplicate, no gap', async () => {
      const opened: string[] = [];
      for (let index = 0; index < 27; index += 1) {
        const asker = await account(admin);
        const { conversationId } = await service.openSupport(me(asker));
        // Only some ask anything yet: empty ones sort by their creation.
        if (index % 3 === 0)
          await send(asker, conversationId, text(`ask-${String(index)}`));
        opened.push(conversationId);
      }
      const staff = await grantRole(admin, await account(admin), ['messaging.support']);
      const first = await service.supportQueue(me(staff.accountId), {
        state: 'open',
        cursor: null,
      });
      expect(first.items).toHaveLength(25);
      expect(first.next).not.toBeNull();
      const second = await service.supportQueue(me(staff.accountId), {
        state: 'open',
        cursor: first.next,
      });
      expect(second.items).toHaveLength(2);
      expect(second.next).toBeNull();

      const all = [...first.items, ...second.items];
      expect(new Set(all.map((item) => item.id))).toEqual(new Set(opened));
      expect(
        keysetOrdered(
          all.map((item) => ({ id: item.id, at: item.lastMessageAt ?? item.createdAt })),
        ),
      ).toBe(true);
      expect(all.filter((item) => item.awaitingReply)).toHaveLength(9);
    });
  });

  describe('the report queue', () => {
    it('27 open reports read as 25 then 2: ordered, no duplicate, no gap', async () => {
      // Each reporter's budget is 20 an hour, so the learner reports fifteen
      // messages and the teachers report twelve conversations.
      const filed: string[] = [];
      for (const entry of conversations.slice(0, 15))
        filed.push(
          (
            await service.report(me(learner.id), {
              conversationId: entry.id,
              messageId: entry.messageId,
              reason: 'spam',
            })
          ).reportId,
        );
      for (const entry of conversations.slice(15, 27))
        filed.push(
          (
            await service.report(me(entry.teacher), {
              conversationId: entry.id,
              messageId: null,
              reason: 'other',
            })
          ).reportId,
        );
      expect(new Set(filed).size).toBe(27);

      const moderator = await grantRole(admin, await account(admin), [
        'messaging.moderate',
      ]);
      const first = await service.reports(me(moderator.accountId), {
        state: 'open',
        cursor: null,
      });
      expect(first.reports).toHaveLength(25);
      expect(first.next).not.toBeNull();
      const second = await service.reports(me(moderator.accountId), {
        state: 'open',
        cursor: first.next,
      });
      expect(second.reports).toHaveLength(2);
      expect(second.next).toBeNull();

      const all = [...first.reports, ...second.reports];
      expect(new Set(all.map((report) => report.id))).toEqual(new Set(filed));
      expect(
        keysetOrdered(all.map((report) => ({ id: report.id, at: report.createdAt }))),
      ).toBe(true);
      // Resolved reports are another queue.
      expect(
        (
          await service.reports(me(moderator.accountId), {
            state: 'resolved',
            cursor: null,
          })
        ).reports,
      ).toEqual([]);
    });
  });
});
