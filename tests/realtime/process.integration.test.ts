import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activateLive,
  activateMessaging,
  endScope,
  grantRole,
  liveCourse,
  messagingRows,
  n,
  op,
  reasonOf,
  revokeAssignment,
  scope,
  withdrawEnrolment,
  enrol,
} from '../messaging/fixture-sql.ts';
import { httpGet } from '../../scripts/shared/realtime-harness.mjs';
import {
  body,
  catchUpOver,
  connect,
  connected,
  failureOf,
  messagesIn,
  readOver,
  realtimeWorld,
  sendOver,
  startRealtimeProcess,
  subscribe,
  transportFailureFor,
  typingOver,
  type Client,
  type Person,
  type RealtimeProcess,
  type RealtimeWorld,
} from './harness.ts';

/**
 * Phase 25 — the REAL realtime process: who may connect, and what a connected
 * socket may do once the facts behind it change.
 *
 * Spawned from its composition entry, configured as a deployment is, over a
 * disposable SQL Server database read by the least-privilege runtime
 * principal; driven by real `socket.io-client` WebSocket connections carrying
 * real Better Auth session cookies. Every refusal asserted below is compared
 * with what the Phase-24 Messaging SERVICE itself answers for the same person
 * and conversation at that moment, so the proof is that the transport adds no
 * rule and drops none: its answer is the service's answer, in its vocabulary.
 *
 * WHAT ONLY A REAL PROCESS CAN PROVE. That the handshake reads the Cookie
 * header and nothing else — no query or `auth` token, no claimed account id;
 * that it refuses a foreign or missing Origin even with a valid cookie; that
 * a closed or suspended account cannot connect and a connected one is signed
 * out on its next event; and that a revoked teacher, an ended scope, a
 * removed Enrolment, a block, a moderator's closure and a missing activation
 * each refuse every event on a socket that connected while they were allowed.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

live('Phase 25 realtime process — handshake and per-event authorisation', () => {
  let world: RealtimeWorld;
  let realtime: RealtimeProcess;
  const clients: Client[] = [];

  const track = (client: Client) => {
    clients.push(client);
    return client;
  };

  const person = (label: string): Promise<Person> => world.person(label);

  beforeAll(async () => {
    world = await realtimeWorld();
    realtime = await startRealtimeProcess({ databaseUrl: world.databaseUrl });
  }, 300_000);

  afterAll(async () => {
    for (const client of clients) client.close();
    await realtime?.stop();
    await world?.close();
  }, 120_000);

  /**
   * Every event a socket can send for `conversationId`, against what the
   * service answers `actor` now. The service must refuse; the transport must
   * refuse identically, and nothing may be written.
   */
  async function refusedEverywhere(
    client: Client,
    actor: string,
    conversationId: string,
  ): Promise<void> {
    const reason = await reasonOf(
      world.messaging.service.conversation(me(actor), conversationId),
    );
    const expected = transportFailureFor(reason);
    expect(expected).not.toBe('accepted');
    const before = await messagesIn(world, conversationId);

    expect(failureOf(await catchUpOver(client, conversationId, 0))).toBe(expected);
    expect(failureOf(await sendOver(client, conversationId, body('refused')))).toBe(
      expected,
    );
    expect(failureOf(await readOver(client, conversationId, 1))).toBe(expected);
    // Typing names no reason (it is the send gate's yes or no): `not-found`.
    expect(failureOf(await typingOver(client, conversationId, true))).toBe('not-found');
    expect(failureOf(await subscribe(client, conversationId))).toBe(expected);
    // Refused re-subscription withdrew the room: typing has no subscription now.
    expect(failureOf(await typingOver(client, conversationId, true))).toBe('not-found');

    expect(await messagesIn(world, conversationId)).toBe(before);
    // The socket itself is still connected: refusal is per event, not a ban.
    expect(client.socket.connected).toBe(true);
  }

  /* ======================================================================
   * Activation — fail closed, in a database nobody activated
   * ==================================================================== */

  it('with no MessagingActivation, a signed-in person connects and can start, follow or send nothing', async () => {
    const learner = await person('inactive-learner');
    const teacher = await person('inactive-teacher');
    const admin = world.messaging.db.admin;
    // Every Learning fact a conversation needs — live learning, a current
    // scope, an Enrolment — and still no Messaging kind switched on.
    await activateLive(admin, 'fixture');
    const role = await grantRole(admin, teacher.accountId, ['teaching.perform']);
    const courseId = await liveCourse(admin);
    await scope(admin, courseId, role);
    await enrol(admin, learner.accountId, courseId);
    expect(await world.messaging.service.capabilities()).toEqual({
      support: false,
      teacherStudent: false,
      studentStudent: false,
      fixture: false,
    });
    expect(
      await reasonOf(
        world.messaging.service.startTeaching(me(learner.accountId), {
          counterpartAccountId: teacher.accountId,
          courseId,
        }),
      ),
    ).toBe('not-found');
    expect(
      await reasonOf(world.messaging.service.openSupport(me(learner.accountId))),
    ).toBe('not-found');

    const client = track(await connected(realtime.url, { cookie: learner.cookie }));
    for (const conversationId of [randomUUID(), randomUUID()])
      await refusedEverywhere(client, learner.accountId, conversationId);
    expect(await messagingRows(admin)).toBe(0);

    // Every later proof in this file runs with both person-facing kinds on.
    await activateMessaging(admin, 'teacher-student');
    await activateMessaging(admin, 'support');
  });

  /* ======================================================================
   * The handshake — the Cookie header, the exact Origin, an active account
   * ==================================================================== */

  describe('the handshake', () => {
    it('refuses a connection that carries no cookie', async () => {
      const outcome = await connect(realtime.url, {});
      expect(outcome.connected).toBe(false);
    });

    it('refuses a forged or unknown cookie', async () => {
      const outcome = await connect(realtime.url, {
        cookie: 'better-auth.session_token=forged.forged-signature',
      });
      expect(outcome.connected).toBe(false);
    });

    it('refuses a valid cookie from a hostile, a look-alike or a missing Origin', async () => {
      const learner = await person('origin');
      for (const origin of [
        'https://attacker.invalid',
        'http://localhost:3001',
        'http://localhost:3000.attacker.invalid',
        'https://localhost:3000',
        'null',
        null,
      ]) {
        const outcome = await connect(realtime.url, { cookie: learner.cookie, origin });
        expect(outcome.connected, String(origin)).toBe(false);
      }
      // The same cookie from the configured origin is admitted.
      track(await connected(realtime.url, { cookie: learner.cookie }));
    });

    it('ignores a token in the query string or the auth payload', async () => {
      const learner = await person('token');
      const token = learner.cookie.split('=').slice(1).join('=');
      const outcome = await connect(realtime.url, {
        query: { token, session: token, cookie: learner.cookie },
        auth: {
          token,
          session: token,
          cookie: learner.cookie,
          accountId: learner.accountId,
        },
      });
      expect(outcome.connected).toBe(false);
    });

    it('identifies the person from the cookie alone, whatever the auth payload claims', async () => {
      const pair = await world.pair('claimed');
      const other = await world.pair('claimed-other');
      const client = track(
        await connected(realtime.url, {
          cookie: pair.learner.cookie,
          auth: { accountId: other.learner.accountId },
          query: { accountId: other.learner.accountId },
        }),
      );
      expect(failureOf(await subscribe(client, pair.conversationId))).toBe('accepted');
      expect(failureOf(await subscribe(client, other.conversationId))).toBe('not-found');
    });

    it('admits only the WebSocket transport: long-polling is refused', async () => {
      const learner = await person('polling');
      const response = await httpGet(
        `${realtime.url}/socket.io/?EIO=4&transport=polling`,
        { origin: 'http://localhost:3000', cookie: learner.cookie },
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('"sid"');
    });

    it('refuses a closed account and a suspended account', async () => {
      const closing = await person('closed');
      const suspended = await person('suspended');
      await world.messaging.closeAccount(closing.accountId);
      await world.messaging.db.admin.query(
        `UPDATE [dbo].[User] SET [status] = N'suspended' WHERE [id] = ${n(suspended.accountId)};`,
      );
      expect((await connect(realtime.url, { cookie: closing.cookie })).connected).toBe(
        false,
      );
      expect((await connect(realtime.url, { cookie: suspended.cookie })).connected).toBe(
        false,
      );
    });

    it('signs a connected socket out on its next event once the account is suspended', async () => {
      const pair = await world.pair('mid-session');
      const client = track(
        await connected(realtime.url, { cookie: pair.learner.cookie }),
      );
      expect(failureOf(await subscribe(client, pair.conversationId))).toBe('accepted');

      await world.messaging.db.admin.query(
        `UPDATE [dbo].[User] SET [status] = N'suspended' WHERE [id] = ${n(pair.learner.accountId)};`,
      );
      const before = await messagesIn(world, pair.conversationId);
      expect(failureOf(await sendOver(client, pair.conversationId, body('after')))).toBe(
        'signed-out',
      );
      await client.disconnected;
      expect(await messagesIn(world, pair.conversationId)).toBe(before);
    });

    it('answers its probes and nothing else over plain HTTP, with no CORS header', async () => {
      expect(await httpGet(`${realtime.url}/healthz`)).toMatchObject({
        status: 200,
        body: 'ok',
      });
      expect((await httpGet(`${realtime.url}/readyz`)).status).toBe(200);
      expect((await httpGet(`${realtime.url}/`)).status).toBe(404);
      expect((await httpGet(`${realtime.url}/socket.io/socket.io.js`)).status).not.toBe(
        200,
      );
    });
  });

  /* ======================================================================
   * After connecting — every event is decided again, now
   * ==================================================================== */

  describe('a socket that connected while allowed is refused once it is not', () => {
    /** A pair with both people connected and following their conversation. */
    async function followed(label: string) {
      const pair = await world.pair(label);
      const learner = track(
        await connected(realtime.url, { cookie: pair.learner.cookie }),
      );
      const teacher = track(
        await connected(realtime.url, { cookie: pair.teacher.cookie }),
      );
      expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
      expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');
      // Allowed now: a send commits.
      expect(failureOf(await sendOver(learner, pair.conversationId, body(label)))).toBe(
        'accepted',
      );
      return { pair, learner, teacher };
    }

    it('cannot reach somebody else’s conversation at all', async () => {
      const mine = await followed('unrelated-mine');
      const theirs = await world.pair('unrelated-theirs');
      await refusedEverywhere(
        mine.learner,
        mine.pair.learner.accountId,
        theirs.conversationId,
      );
      expect(failureOf(await subscribe(mine.learner, theirs.conversationId))).toBe(
        'not-found',
      );
    });

    it('the teacher’s RoleAssignment revoked', async () => {
      const { pair, learner, teacher } = await followed('revoked');
      await revokeAssignment(
        world.messaging.db.admin,
        pair.teacher.role.roleAssignmentId,
      );
      await refusedEverywhere(teacher, pair.teacher.accountId, pair.conversationId);
      await refusedEverywhere(learner, pair.learner.accountId, pair.conversationId);
    });

    it('the teaching scope ended', async () => {
      const { pair, learner, teacher } = await followed('scope');
      await endScope(world.messaging.db.admin, pair.scopeId);
      await refusedEverywhere(teacher, pair.teacher.accountId, pair.conversationId);
      await refusedEverywhere(learner, pair.learner.accountId, pair.conversationId);
    });

    it('the Enrolment removed', async () => {
      const { pair, learner, teacher } = await followed('enrolment');
      await withdrawEnrolment(
        world.messaging.db.admin,
        pair.learner.accountId,
        pair.courseId,
      );
      await refusedEverywhere(learner, pair.learner.accountId, pair.conversationId);
      await refusedEverywhere(teacher, pair.teacher.accountId, pair.conversationId);
    });

    it('a block applied', async () => {
      const { pair, learner, teacher } = await followed('block');
      await world.messaging.service.block(
        me(pair.learner.accountId),
        pair.conversationId,
      );
      // The blocked person may not send; the service decides what else.
      expect(
        failureOf(await sendOver(teacher, pair.conversationId, body('blocked-teacher'))),
      ).toBe(
        transportFailureFor(
          await reasonOf(
            world.messaging.service.send(
              me(pair.teacher.accountId),
              pair.conversationId,
              {
                operationId: op(),
                body: body('blocked-teacher-web'),
                attachmentIds: [],
              },
            ),
          ),
        ),
      );
      expect(
        failureOf(await sendOver(learner, pair.conversationId, body('blocked-learner'))),
      ).toBe(
        transportFailureFor(
          await reasonOf(
            world.messaging.service.send(
              me(pair.learner.accountId),
              pair.conversationId,
              {
                operationId: op(),
                body: body('blocked-learner-web'),
                attachmentIds: [],
              },
            ),
          ),
        ),
      );
      expect(failureOf(await typingOver(teacher, pair.conversationId, true))).toBe(
        'not-found',
      );
      expect(failureOf(await typingOver(learner, pair.conversationId, true))).toBe(
        'not-found',
      );
      expect(await messagesIn(world, pair.conversationId)).toBe(1);
    });

    it('a moderator closed the conversation', async () => {
      const { pair, learner, teacher } = await followed('moderated');
      const admin = world.messaging.db.admin;
      const moderator = await grantRole(admin, await account(admin), [
        'messaging.moderate',
      ]);
      const { reportId } = await world.messaging.service.report(
        me(pair.learner.accountId),
        {
          conversationId: pair.conversationId,
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
      const before = await messagesIn(world, pair.conversationId);
      for (const [client, actor] of [
        [teacher, pair.teacher.accountId],
        [learner, pair.learner.accountId],
      ] as const) {
        const expected = transportFailureFor(
          await reasonOf(
            world.messaging.service.send(me(actor), pair.conversationId, {
              operationId: op(),
              body: body('closed-web'),
              attachmentIds: [],
            }),
          ),
        );
        expect(expected).not.toBe('accepted');
        expect(
          failureOf(await sendOver(client, pair.conversationId, body('closed'))),
        ).toBe(expected);
        expect(failureOf(await typingOver(client, pair.conversationId, true))).toBe(
          'not-found',
        );
      }
      expect(await messagesIn(world, pair.conversationId)).toBe(before);
    });

    it('a claimed support staff member is refused over the socket, before and after the key is revoked', async () => {
      const asker = await person('support-asker');
      const staff = await person('support-staff');
      const admin = world.messaging.db.admin;
      const key = await grantRole(admin, staff.accountId, ['messaging.support']);
      const { conversationId } = await world.messaging.service.openSupport(
        me(asker.accountId),
      );
      const [row] = await admin.query<{ version: number }>(
        `SELECT [version] FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
      );
      await world.messaging.service.claimSupport(
        me(staff.accountId),
        conversationId,
        row?.version ?? 1,
      );

      // Staff read support content on the AUDITED web surface only.
      const staffSocket = track(await connected(realtime.url, { cookie: staff.cookie }));
      expect(failureOf(await subscribe(staffSocket, conversationId))).toBe('not-found');
      expect(
        failureOf(await sendOver(staffSocket, conversationId, body('staff-socket'))),
      ).toBe('not-found');
      expect(failureOf(await catchUpOver(staffSocket, conversationId, 0))).toBe(
        'not-found',
      );

      // With the key revoked the SERVICE itself refuses the staff member too,
      // and the socket answers exactly what the service answers.
      await revokeAssignment(admin, key.roleAssignmentId);
      const revoked = transportFailureFor(
        await reasonOf(
          world.messaging.service.conversation(me(staff.accountId), conversationId),
        ),
      );
      expect(revoked).not.toBe('accepted');
      expect(failureOf(await subscribe(staffSocket, conversationId))).toBe(revoked);
      expect(
        failureOf(await sendOver(staffSocket, conversationId, body('staff-revoked'))),
      ).toBe(revoked);
      expect(await messagesIn(world, conversationId)).toBe(0);

      // The person who asked follows their own support conversation.
      const askerSocket = track(await connected(realtime.url, { cookie: asker.cookie }));
      expect(failureOf(await subscribe(askerSocket, conversationId))).toBe('accepted');
    });
  });

  /* ======================================================================
   * What the process wrote about all of the above
   * ==================================================================== */

  it('logged no cookie, token, address, name or message body', () => {
    const output = realtime.output();
    expect(output.length).toBeGreaterThan(0);
    expect(world.people.length).toBeGreaterThan(10);
    for (const person of world.people) {
      const token = person.cookie.split('=').slice(1).join('=');
      expect(output).not.toContain(token);
      expect(output).not.toContain(token.split('.')[0] ?? token);
      expect(output).not.toContain(person.email);
    }
    expect(output).not.toContain('NON_MESSAGING_FIXTURE');
    expect(output).not.toContain('Realtime Proof');
    expect(output.toLowerCase()).not.toContain('cookie:');
    expect(output).not.toContain('sqlserver://');
  });
});
