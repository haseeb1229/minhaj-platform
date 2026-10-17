import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { databaseConfigured } from '../identity/harness.ts';
import { n, op } from '../messaging/fixture-sql.ts';
import {
  body,
  catchUpOver,
  connect,
  connected,
  fanOutDone,
  failureOf,
  messagesIn,
  realtimeWorld,
  sendOver,
  startRealtimeProcess,
  subscribe,
  type Client,
  type LogRecord,
  type Person,
  type RealtimeProcess,
  type RealtimeWorld,
} from './harness.ts';

/**
 * Phase 25 — durability: SQL is the truth, the transport only carries it.
 *
 * Against the REAL realtime process and a real SQL Server:
 *
 *   - a send is COMMITTED before anybody hears of it: the row is in SQL when
 *     the sender's ack arrives and when a recipient's frame arrives, and the
 *     frame is exactly the row;
 *   - an operation id replayed over the socket makes ONE message, fans out
 *     nothing new, and a conflicting payload under it is refused and writes
 *     nothing;
 *   - concurrent sends from several sockets get unique, dense sequences;
 *   - the process killed with SIGKILL mid-session loses nothing: while it is
 *     down the web path (the Messaging service the web composition calls) still
 *     sends and reads history, and after a restart a reconnecting client
 *     catches up the missed sequence exactly once;
 *   - nothing in the process is needed to recover: catch-up reads SQL.
 */

const live = databaseConfigured ? describe : describe.skip;

const me = (accountId: string) => ({ accountId });

live('Phase 25 realtime process — durable send, replay, restart and catch-up', () => {
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

  const messageFanOut = (record: LogRecord) =>
    fanOutDone('fan-out:message')(record) && Number(record['recipients']) >= 1;

  async function stored(id: string) {
    const [row] = await world.messaging.db.admin.query<{
      id: string;
      sequence: number | string;
      body: string;
      conversationId: string;
    }>(
      `SELECT [id], [sequence], [body], [conversationId] FROM [dbo].[Message] WHERE [id] = ${n(id)};`,
    );
    return row === undefined ? null : { ...row, sequence: Number(row.sequence) };
  }

  it('commits before it acknowledges and before it delivers, and delivers exactly the row', async () => {
    const pair = await world.pair('commit');
    const learner = await open(pair.learner);
    const teacher = await open(pair.teacher);
    expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
    expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');

    const sent = await sendOver(teacher, pair.conversationId, body('commit'));
    if (!sent.ok) throw new Error('The send was refused.');
    // The ack is in hand: the row is already there.
    expect(await stored(sent.value.message.id)).toMatchObject({
      sequence: 1,
      body: body('commit'),
      conversationId: pair.conversationId,
    });

    const frame = (await learner.next(
      'message:created',
      (payload: { conversationId: string }) =>
        payload.conversationId === pair.conversationId,
    )) as { message: { id: string; sequence: number; body: string; sentAt: string } };
    const row = await stored(frame.message.id);
    expect(row).not.toBeNull();
    expect(frame.message).toMatchObject({
      id: row?.id,
      sequence: row?.sequence,
      body: row?.body,
    });
    expect(Number.isNaN(Date.parse(frame.message.sentAt))).toBe(false);
  });

  it('a replayed operation id makes one message and fans out once; a conflicting replay writes nothing', async () => {
    const pair = await world.pair('replay');
    const learner = await open(pair.learner);
    const teacher = await open(pair.teacher);
    expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
    expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');

    const mark = realtime.records.length;
    const operationId = op();
    const first = await sendOver(
      teacher,
      pair.conversationId,
      body('replay'),
      operationId,
    );
    const second = await sendOver(
      teacher,
      pair.conversationId,
      body('replay'),
      operationId,
    );
    // A second socket of the same person replaying the same operation.
    const otherTab = await open(pair.teacher);
    const third = await sendOver(
      otherTab,
      pair.conversationId,
      body('replay'),
      operationId,
    );
    if (!first.ok || !second.ok || !third.ok) throw new Error('A replay was refused.');
    expect(first.value.replayed).toBe(false);
    expect(second.value).toMatchObject({ replayed: true, message: first.value.message });
    expect(third.value).toMatchObject({ replayed: true, message: first.value.message });
    expect(await messagesIn(world, pair.conversationId)).toBe(1);

    const conflicting = await sendOver(
      teacher,
      pair.conversationId,
      body('replay-different'),
      operationId,
    );
    expect(failureOf(conflicting)).toBe('operation-conflict');
    expect(await messagesIn(world, pair.conversationId)).toBe(1);
    expect(await stored(first.value.message.id)).toMatchObject({ body: body('replay') });

    // A later, new message is the barrier: once it has fanned out, every fan-out
    // the replays could have caused would have been logged before it.
    const next = await sendOver(teacher, pair.conversationId, body('replay-next'));
    expect(next.ok).toBe(true);
    await learner.next(
      'message:created',
      (payload: { message: { sequence: number } }) => payload.message.sequence === 2,
    );
    await realtime.waitForRecord(
      () => realtime.records.slice(mark).filter(messageFanOut).length >= 2,
      { from: mark },
    );
    const fanOuts = realtime.records.slice(mark).filter(messageFanOut);
    expect(fanOuts).toHaveLength(2);
    const frames = learner
      .framesFor(pair.conversationId)
      .filter((frame) => frame.event === 'message:created')
      .map(
        (frame) => (frame.payload as { message: { sequence: number } }).message.sequence,
      );
    expect(frames).toEqual([1, 2]);
  });

  it('concurrent sends from several sockets get unique, dense sequences', async () => {
    const pair = await world.pair('dense');
    const sockets = [
      await open(pair.learner),
      await open(pair.learner),
      await open(pair.teacher),
      await open(pair.teacher),
    ];
    for (const socket of sockets)
      expect(failureOf(await subscribe(socket, pair.conversationId))).toBe('accepted');

    const acks = await Promise.all(
      sockets.flatMap((socket, index) =>
        Array.from({ length: 6 }, (_, round) =>
          sendOver(
            socket,
            pair.conversationId,
            body(`dense-${String(index)}-${String(round)}`),
          ),
        ),
      ),
    );
    const sequences = acks.map((ack) => {
      if (!ack.ok) throw new Error(`A concurrent send was refused: ${ack.failure}`);
      return ack.value.message.sequence;
    });
    expect([...sequences].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
    const inSql = await world.messaging.db.admin.query<{ sequence: number | string }>(
      `SELECT [sequence] FROM [dbo].[Message] WHERE [conversationId] = ${n(pair.conversationId)} ORDER BY [sequence];`,
    );
    expect(inSql.map((row) => Number(row.sequence))).toEqual(
      Array.from({ length: 24 }, (_, index) => index + 1),
    );
  });

  it('killed mid-session, it loses nothing: the web path keeps working and a restart catches up exactly once', async () => {
    const pair = await world.pair('restart');
    const learner = await open(pair.learner);
    const teacher = await open(pair.teacher);
    expect(failureOf(await subscribe(learner, pair.conversationId))).toBe('accepted');
    expect(failureOf(await subscribe(teacher, pair.conversationId))).toBe('accepted');
    const first = await sendOver(teacher, pair.conversationId, body('before-crash'));
    expect(first.ok).toBe(true);
    await learner.next(
      'message:created',
      (payload: { message: { sequence: number } }) => payload.message.sequence === 1,
    );
    const lastSeen = 1;

    // A crash, not a shutdown: no grace, no goodbye.
    const port = realtime.port;
    await realtime.stop('SIGKILL');
    await learner.disconnected;
    await teacher.disconnected;
    expect(
      (await connect(`http://127.0.0.1:${String(port)}`, { cookie: pair.learner.cookie }))
        .connected,
    ).toBe(false);

    // DEGRADED, NOT BROKEN. Messaging is the web's own service over SQL; the
    // realtime process is a courtesy on top of it.
    const service = world.messaging.service;
    const whileDown = [];
    for (const label of ['while-down-1', 'while-down-2'])
      whileDown.push(
        await service.send(me(pair.teacher.accountId), pair.conversationId, {
          operationId: op(),
          body: body(label),
          attachmentIds: [],
        }),
      );
    expect(whileDown.map((sent) => sent.message.sequence)).toEqual([2, 3]);
    const history = await service.history(
      me(pair.learner.accountId),
      pair.conversationId,
      null,
    );
    expect(
      history.messages.map((message) => message.sequence).sort((a, b) => a - b),
    ).toEqual([1, 2, 3]);

    // The same process, started again on the same port.
    realtime = await startRealtimeProcess({ databaseUrl: world.databaseUrl, port });
    const back = await open(pair.learner);
    const followed = await subscribe(back, pair.conversationId);
    expect(followed).toMatchObject({ ok: true, value: { lastSequence: 3 } });

    const caught = await catchUpOver(back, pair.conversationId, lastSeen);
    if (!caught.ok) throw new Error('Catch-up was refused.');
    expect(caught.value.messages.map((message) => message.sequence)).toEqual([2, 3]);
    expect(caught.value.messages.map((message) => message.id)).toEqual(
      whileDown.map((sent) => sent.message.id),
    );
    expect(caught.value.messages.map((message) => message.body)).toEqual([
      body('while-down-1'),
      body('while-down-2'),
    ]);
    expect(caught.value).toMatchObject({ more: false, lastSequence: 3 });

    // Exactly once: nothing is re-pushed, and catching up from the end is empty.
    const again = await catchUpOver(back, pair.conversationId, 3);
    expect(again).toMatchObject({ ok: true, value: { messages: [], more: false } });
    expect(
      back
        .framesFor(pair.conversationId)
        .filter((frame) => frame.event === 'message:created'),
    ).toEqual([]);
    expect(await messagesIn(world, pair.conversationId)).toBe(3);

    // And the restarted process delivers live again.
    const teacherBack = await open(pair.teacher);
    expect(failureOf(await subscribe(teacherBack, pair.conversationId))).toBe('accepted');
    const after = await sendOver(teacherBack, pair.conversationId, body('after-restart'));
    expect(after.ok).toBe(true);
    await back.next(
      'message:created',
      (payload: { message: { sequence: number } }) => payload.message.sequence === 4,
    );
  });
});
