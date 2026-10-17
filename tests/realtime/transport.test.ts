// First: makes Engine.IO's `require("ws")` load the entry plain Node loads.
import './ws-require-entry.ts';

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

import { pino } from 'pino';
import { io as connectClient, type Socket as ClientSocket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { SessionDenial, SessionOutcome } from '@minhaj/contracts/identity';
import {
  REALTIME_CLIENT_EVENTS as EVENTS,
  REALTIME_LIMITS,
  REALTIME_PATH,
  REALTIME_SERVER_EVENTS as SERVER_EVENTS,
  type MessageView,
  type RealtimeAck,
  type RealtimeMessageCreated,
  type RealtimePresenceChanged,
  type RealtimeSent,
  type RealtimeSubscription,
  type RealtimeTypingChanged,
} from '@minhaj/contracts/messaging';
import {
  realtimeAddressFrom,
  startRealtimeServer,
  type RealtimeServer,
  type RealtimeServerOptions,
  type RealtimeSessionPort,
} from '@minhaj/realtime';
import { loggerOptions } from '@minhaj/server-core/logger';
import { MessagingRefusal, type RealtimeMessaging } from '@minhaj/server-core/messaging';

/**
 * Phase 25 — the realtime TRANSPORT, end to end over a real socket.
 *
 * The real `startRealtimeServer` listens on an ephemeral port and the real
 * `socket.io-client` connects to it over a real WebSocket. Identity and
 * Messaging are explicit in-memory fakes: the transport owns no rule, so what
 * is proven here is that it asks the injected services at every point it must
 * — handshake, every event, every recipient of every fan-out — and does
 * exactly what they answer. The services' own rules are proven against SQL by
 * the Messaging suites; the composed process by the integration and browser
 * proofs.
 *
 * NO SLEEPS. Time-dependent behaviour (budgets, typing expiry) runs on the
 * injected clock. "Nothing was delivered" is proven deterministically: the
 * server logs a fan-out's completion (counts only), and a round trip on the
 * observing socket afterwards cannot overtake a frame emitted before it on the
 * same ordered connection.
 */

const ORIGIN = 'http://app.test:3000';
const CONVERSATION = '2b0b7f43-4e57-4d7e-9a35-1f0c5b3c7a10';
const OTHER_CONVERSATION = '6d1e2a9b-8c47-4f3a-b2e5-0a9c8d7e6f51';
const ALICE = 'account-alice';
const BOB = 'account-bob';
const CAROL = 'account-carol';

/** Synthetic sentinels: unique, authenticate nothing, and must never reach a log. */
const SENTINEL = {
  aliceToken: 'ALICE_SESSION_TOKEN_5c1f9e07d3b2',
  aliceTab2Token: 'ALICE_SECOND_TAB_TOKEN_0a7d33e1c9f8',
  bobToken: 'BOB_SESSION_TOKEN_8e2a4d61b0c7',
  bobTab2Token: 'BOB_SECOND_TAB_TOKEN_71c0e5a9d2f4',
  carolToken: 'CAROL_SESSION_TOKEN_3f9b02e6a8d1',
  body: 'MESSAGE_BODY_SENTINEL_d41c7a9e5b20',
  header: 'HEADER_VALUE_SENTINEL_9a3e1f7c0b65',
};

/* ===========================================================================
 * Fakes
 * ========================================================================= */

function fakeSessions() {
  const outcomes = new Map<string, SessionOutcome>();
  const seen: Headers[] = [];
  let outage = false;

  function active(accountId: string): SessionOutcome {
    const at = new Date('2026-10-17T09:00:00.000Z');
    return {
      state: 'active',
      session: {
        sessionId: `session-${accountId}`,
        sessionCreatedAt: at,
        sessionExpiresAt: new Date(at.getTime() + 86_400_000),
        account: {
          id: accountId,
          email: `${accountId}@example.invalid`,
          emailVerified: true,
          name: accountId,
          locale: 'en',
          timezone: null,
          status: 'active',
          accountSetupCompletedAt: at,
          createdAt: at,
        },
      },
    };
  }

  const port: RealtimeSessionPort = {
    resolve(headers) {
      seen.push(headers);
      if (outage) return Promise.reject(new Error('identity unavailable'));
      const token = /(?:^|;\s*)sid=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1];
      return Promise.resolve(
        (token === undefined ? undefined : outcomes.get(token)) ?? {
          state: 'denied',
          reason: 'no-session',
        },
      );
    },
  };

  return {
    port,
    seen,
    activate(token: string, accountId: string) {
      outcomes.set(token, active(accountId));
    },
    deny(token: string, reason: SessionDenial) {
      outcomes.set(token, { state: 'denied', reason });
    },
    setOutage(value: boolean) {
      outage = value;
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** An explicit in-memory Messaging: every call journaled, every answer configurable. */
function fakeMessaging() {
  const journal: string[] = [];
  const committed: MessageView[] = [];
  const operations = new Map<string, MessageView>();
  const denyOpen = new Set<string>();
  const denyDelivery = new Set<string>();
  const throwDelivery = new Set<string>();
  const brokenDelivery = new Set<string>();
  const denyObserve = new Set<string>();
  const denyType = new Set<string>();
  const state = { holdSend: null as Deferred | null };

  /** message id → its conversation */
  const conversationOf = new Map<string, string>();
  const inConversation = (conversationId: string) =>
    committed.filter((message) => conversationOf.get(message.id) === conversationId);

  const messaging: RealtimeMessaging = {
    open(actor, conversationId) {
      journal.push(`open:${actor.accountId}`);
      if (denyOpen.has(actor.accountId))
        return Promise.reject(new MessagingRefusal('not-found'));
      return Promise.resolve({
        conversationId,
        lastSequence: inConversation(conversationId).length,
        readSequence: 0,
        canSend: true,
      });
    },
    catchUp(actor, conversationId, after) {
      journal.push(`catch-up:${actor.accountId}`);
      return Promise.resolve({
        messages: inConversation(conversationId).filter(
          (message) => message.sequence > after,
        ),
        more: false,
        lastSequence: inConversation(conversationId).length,
      });
    },
    async send(actor, conversationId, input) {
      journal.push(`send:${actor.accountId}`);
      if (state.holdSend !== null) await state.holdSend.promise;
      const earlier = operations.get(input.operationId);
      if (earlier !== undefined) return { message: earlier, replayed: true };
      const message: MessageView = {
        id: randomUUID(),
        sequence: inConversation(conversationId).length + 1,
        senderAccountId: actor.accountId,
        own: true,
        body: input.body,
        withheld: false,
        sentAt: new Date('2026-10-17T10:00:00.000Z'),
        attachments: [],
      };
      conversationOf.set(message.id, conversationId);
      committed.push(message);
      operations.set(input.operationId, message);
      journal.push(`committed:${message.sequence}`);
      return { message, replayed: false };
    },
    markRead(actor, _conversationId, sequence) {
      journal.push(`read:${actor.accountId}`);
      return Promise.resolve({ readSequence: sequence });
    },
    canType(actor) {
      journal.push(`can-type:${actor.accountId}`);
      return Promise.resolve(!denyType.has(actor.accountId));
    },
    deliveryFor(recipient, conversationId, sequence) {
      journal.push(`deliver:${recipient.accountId}`);
      if (throwDelivery.has(recipient.accountId)) {
        return Promise.reject(new Error('delivery read failed'));
      }
      if (denyDelivery.has(recipient.accountId)) return Promise.resolve(null);
      const message = inConversation(conversationId).find(
        (each) => each.sequence === sequence,
      );
      if (message === undefined) return Promise.resolve(null);
      const view = { ...message, own: message.senderAccountId === recipient.accountId };
      // An unserialisable instant: the emit for this recipient throws.
      if (brokenDelivery.has(recipient.accountId)) {
        return Promise.resolve({ ...view, sentAt: new Date(Number.NaN) });
      }
      return Promise.resolve(view);
    },
    mayObserve(recipient) {
      journal.push(`observe:${recipient.accountId}`);
      return Promise.resolve(!denyObserve.has(recipient.accountId));
    },
  };

  return {
    messaging,
    journal,
    committed,
    denyOpen,
    denyDelivery,
    throwDelivery,
    brokenDelivery,
    denyObserve,
    denyType,
    state,
  };
}

/* ===========================================================================
 * Log capture
 * ========================================================================= */

type LogLine = Record<string, unknown>;

function captureLogs() {
  const raw: string[] = [];
  const lines: LogLine[] = [];
  const emitter = new EventEmitter();
  const logger = pino(loggerOptions('trace', 'test'), {
    write(line: string) {
      raw.push(line);
      const parsed = JSON.parse(line) as LogLine;
      lines.push(parsed);
      emitter.emit('line', parsed);
    },
  });

  /** The first line at or after `from` matching `predicate`, waiting for it if needed. */
  function waitFor(
    predicate: (line: LogLine) => boolean,
    from: number,
  ): Promise<LogLine> {
    const found = lines.slice(from).find(predicate);
    if (found !== undefined) return Promise.resolve(found);
    return new Promise((resolve) => {
      const listener = (line: LogLine) => {
        if (!predicate(line)) return;
        emitter.off('line', listener);
        resolve(line);
      };
      emitter.on('line', listener);
    });
  }

  return { logger, raw, lines, waitFor };
}

/* ===========================================================================
 * Harness
 * ========================================================================= */

let sessions: ReturnType<typeof fakeSessions>;
let fake: ReturnType<typeof fakeMessaging>;
let logs: ReturnType<typeof captureLogs>;
let clock: number;
let server: RealtimeServer;
const clients: ClientSocket[] = [];

async function boot(
  overrides: Partial<RealtimeServerOptions> = {},
): Promise<RealtimeServer> {
  server = await startRealtimeServer({
    session: sessions.port,
    messaging: fake.messaging,
    allowedOrigin: ORIGIN,
    host: '127.0.0.1',
    port: 0,
    logger: logs.logger,
    now: () => clock,
    ...overrides,
  });
  return server;
}

beforeEach(async () => {
  sessions = fakeSessions();
  fake = fakeMessaging();
  logs = captureLogs();
  clock = 1_000_000;
  sessions.activate(SENTINEL.aliceToken, ALICE);
  sessions.activate(SENTINEL.aliceTab2Token, ALICE);
  sessions.activate(SENTINEL.bobToken, BOB);
  sessions.activate(SENTINEL.bobTab2Token, BOB);
  sessions.activate(SENTINEL.carolToken, CAROL);
  await boot();
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.disconnect();
  await server.close();
});

interface ClientOptions {
  readonly cookie?: string;
  /** `null` sends no Origin header at all. */
  readonly origin?: string | null;
  readonly transports?: ('websocket' | 'polling')[];
  readonly auth?: Record<string, unknown>;
  readonly query?: Record<string, string>;
  readonly headers?: Record<string, string>;
}

function client(options: ClientOptions = {}): ClientSocket {
  const extraHeaders: Record<string, string> = { ...options.headers };
  if (options.origin !== null) extraHeaders['origin'] = options.origin ?? ORIGIN;
  if (options.cookie !== undefined) extraHeaders['cookie'] = options.cookie;
  const socket = connectClient(`http://127.0.0.1:${server.port}`, {
    path: REALTIME_PATH,
    transports: options.transports ?? ['websocket'],
    extraHeaders,
    reconnection: false,
    forceNew: true,
    ...(options.auth === undefined ? {} : { auth: options.auth }),
    ...(options.query === undefined ? {} : { query: options.query }),
  });
  clients.push(socket);
  return socket;
}

function outcomeOf(socket: ClientSocket): Promise<'connected' | 'refused'> {
  return new Promise((resolve) => {
    socket.once('connect', () => resolve('connected'));
    socket.once('connect_error', () => resolve('refused'));
  });
}

async function connect(
  token: string,
  options: ClientOptions = {},
): Promise<ClientSocket> {
  const socket = client({ cookie: `theme=dark; sid=${token}`, ...options });
  expect(await outcomeOf(socket)).toBe('connected');
  return socket;
}

function request<T = unknown>(
  socket: ClientSocket,
  event: string,
  ...payloads: unknown[]
): Promise<RealtimeAck<T>> {
  return new Promise((resolve) => {
    socket.emit(event, ...payloads, (envelope: RealtimeAck<T>) => resolve(envelope));
  });
}

async function subscribe(
  socket: ClientSocket,
  conversationId = CONVERSATION,
): Promise<RealtimeSubscription> {
  const ack = await request<RealtimeSubscription>(socket, EVENTS.subscribe, {
    conversationId,
  });
  if (!ack.ok) throw new Error(`subscribe refused: ${ack.failure}`);
  return ack.value;
}

function sendPayload(body = 'Assalamu alaikum', conversationId = CONVERSATION) {
  return { conversationId, operationId: randomUUID(), body, attachmentIds: [] };
}

interface Frame {
  readonly event: string;
  readonly payload: unknown;
}

function record(socket: ClientSocket): Frame[] {
  const frames: Frame[] = [];
  socket.onAny((event: string, payload: unknown) => frames.push({ event, payload }));
  return frames;
}

function next<T>(
  socket: ClientSocket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
) {
  return new Promise<T>((resolve) => {
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

/**
 * A round trip on `socket`. Socket.IO preserves order on one connection, so
 * any frame the server emitted to it before answering this has arrived.
 */
async function barrier(socket: ClientSocket): Promise<void> {
  const ack = await request(socket, EVENTS.read, { barrier: true });
  expect(ack).toEqual({ ok: false, failure: 'invalid' });
}

function fanOutLine(operation: string) {
  return (line: LogLine) => line['operation'] === operation && line['outcome'] === 'done';
}

function disconnected(socket: ClientSocket): Promise<string> {
  return new Promise((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
}

function url(path: string): string {
  return `http://127.0.0.1:${server.port}${path}`;
}

/* ===========================================================================
 * Configuration
 * ========================================================================= */

describe('realtimeAddressFrom', () => {
  it('defaults to 127.0.0.1:3200 and treats empty values as unset', () => {
    expect(realtimeAddressFrom({})).toEqual({ host: '127.0.0.1', port: 3200 });
    expect(realtimeAddressFrom({ REALTIME_HOST: '', REALTIME_PORT: '' })).toEqual({
      host: '127.0.0.1',
      port: 3200,
    });
    expect(
      realtimeAddressFrom({ REALTIME_HOST: '0.0.0.0', REALTIME_PORT: '3001' }),
    ).toEqual({
      host: '0.0.0.0',
      port: 3001,
    });
    expect(realtimeAddressFrom({ REALTIME_HOST: 'realtime' }).host).toBe('realtime');
    expect(realtimeAddressFrom({ REALTIME_HOST: '[::1]' }).host).toBe('::1');
  });

  it('fails fast naming the variable and never its value', () => {
    for (const value of ['0', '65536', '3200x', '-1', ' 3200', '1e3']) {
      expect(() => realtimeAddressFrom({ REALTIME_PORT: value })).toThrow(
        /REALTIME_PORT/,
      );
    }
    const secretish = 'user:SECRET_HOST_SENTINEL@evil/path';
    let message = '';
    try {
      realtimeAddressFrom({ REALTIME_HOST: secretish });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/REALTIME_HOST/);
    expect(message).not.toContain('SECRET_HOST_SENTINEL');
  });
});

describe('startRealtimeServer configuration', () => {
  it('refuses an allowed origin that is not an exact origin', async () => {
    for (const allowedOrigin of [
      'http://app.test:3000/',
      'http://app.test:3000/path',
      'ftp://app.test',
      'app.test',
      'null',
    ]) {
      await expect(boot({ allowedOrigin })).rejects.toThrow(/origin/);
    }
  });
});

/* ===========================================================================
 * Handshake
 * ========================================================================= */

describe('handshake', () => {
  it('refuses a connection with no cookie, without asking Identity', async () => {
    expect(await outcomeOf(client())).toBe('refused');
    expect(sessions.seen).toHaveLength(0);
  });

  it('refuses a cookie that resolves to no session', async () => {
    expect(await outcomeOf(client({ cookie: 'sid=UNKNOWN_TOKEN' }))).toBe('refused');
    expect(sessions.seen).toHaveLength(1);
  });

  it.each(['account-disabled', 'account-suspended', 'account-closed'] as const)(
    'refuses a session Identity denies as %s',
    async (reason) => {
      sessions.deny(SENTINEL.carolToken, reason);
      expect(await outcomeOf(client({ cookie: `sid=${SENTINEL.carolToken}` }))).toBe(
        'refused',
      );
    },
  );

  it('refuses when Identity cannot answer', async () => {
    sessions.setOutage(true);
    expect(await outcomeOf(client({ cookie: `sid=${SENTINEL.aliceToken}` }))).toBe(
      'refused',
    );
  });

  it('refuses a missing Origin even with a valid cookie, without asking Identity', async () => {
    const socket = client({ cookie: `sid=${SENTINEL.aliceToken}`, origin: null });
    expect(await outcomeOf(socket)).toBe('refused');
    expect(sessions.seen).toHaveLength(0);
  });

  it.each([
    'https://evil.example',
    'https://app.test:3000',
    'http://app.test:3001',
    'http://app.test:3000.evil.example',
    'http://APP.test:3000',
    'null',
  ])('refuses the hostile Origin %s even with a valid cookie', async (origin) => {
    const socket = client({ cookie: `sid=${SENTINEL.aliceToken}`, origin });
    expect(await outcomeOf(socket)).toBe('refused');
    expect(sessions.seen).toHaveLength(0);
  });

  it('refuses the long-polling transport', async () => {
    const socket = client({
      cookie: `sid=${SENTINEL.aliceToken}`,
      transports: ['polling'],
    });
    expect(await outcomeOf(socket)).toBe('refused');

    const response = await fetch(url(`${REALTIME_PATH}?EIO=4&transport=polling`), {
      headers: { origin: ORIGIN, cookie: `sid=${SENTINEL.aliceToken}` },
    });
    expect(response.status).toBe(400);
    expect(sessions.seen).toHaveLength(0);
  });

  it('never authenticates from a query or auth-payload token', async () => {
    const credential = `sid=${SENTINEL.aliceToken}`;
    const socket = client({
      auth: { token: SENTINEL.aliceToken, cookie: credential, sid: SENTINEL.aliceToken },
      query: { token: SENTINEL.aliceToken, cookie: credential, sid: SENTINEL.aliceToken },
    });
    expect(await outcomeOf(socket)).toBe('refused');
    expect(sessions.seen).toHaveLength(0);

    // A bad cookie is not rescued by a good token beside it.
    const mixed = client({
      cookie: 'sid=UNKNOWN_TOKEN',
      auth: { token: SENTINEL.aliceToken },
      query: { sid: SENTINEL.aliceToken },
    });
    expect(await outcomeOf(mixed)).toBe('refused');
  });

  it('admits a valid session and hands Identity only the cookie and host', async () => {
    await connect(SENTINEL.aliceToken, {
      headers: {
        authorization: `Bearer ${SENTINEL.header}`,
        'x-forwarded-for': '203.0.113.9',
        'x-sentinel': SENTINEL.header,
      },
    });
    expect(sessions.seen).toHaveLength(1);
    const handed = sessions.seen[0]!;
    expect([...handed.keys()].sort()).toEqual(['cookie', 'host']);
    expect(handed.get('cookie')).toContain(`sid=${SENTINEL.aliceToken}`);
  });

  it('refuses a namespace other than the default', async () => {
    const socket = connectClient(`http://127.0.0.1:${server.port}/admin`, {
      path: REALTIME_PATH,
      transports: ['websocket'],
      extraHeaders: { origin: ORIGIN, cookie: `sid=${SENTINEL.aliceToken}` },
      reconnection: false,
      forceNew: true,
    });
    clients.push(socket);
    expect(await outcomeOf(socket)).toBe('refused');
  });
});

/* ===========================================================================
 * Event validation
 * ========================================================================= */

const GENERIC_BAD_PAYLOADS: readonly unknown[] = [
  null,
  42,
  'conversation',
  true,
  [],
  [CONVERSATION],
  {},
  { conversationId: 'not-a-uuid' },
  { conversationId: CONVERSATION.toUpperCase().replace(/-/g, '') },
  { conversationId: 'x'.repeat(20_000) },
  { conversationId: CONVERSATION, extra: 1 },
  { conversationId: 7 },
];

const SPECIFIC_BAD_PAYLOADS: Record<string, readonly unknown[]> = {
  [EVENTS.catchUp]: [
    { conversationId: CONVERSATION },
    { conversationId: CONVERSATION, after: -1 },
    { conversationId: CONVERSATION, after: 1.5 },
    { conversationId: CONVERSATION, after: '3' },
    { conversationId: CONVERSATION, after: 2_147_483_647 },
  ],
  [EVENTS.send]: [
    { ...sendPayload(), operationId: 'not-a-uuid' },
    { ...sendPayload(), body: 'x'.repeat(4_001) },
    { ...sendPayload(), body: 42 },
    {
      ...sendPayload(),
      attachmentIds: [
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
        randomUUID(),
      ],
    },
    { ...sendPayload(), attachmentIds: [CONVERSATION, CONVERSATION] },
    { ...sendPayload(), attachmentIds: ['nope'] },
    { ...sendPayload(), senderAccountId: ALICE },
    { conversationId: CONVERSATION, body: 'hello', attachmentIds: [] },
  ],
  [EVENTS.read]: [
    { conversationId: CONVERSATION, sequence: -1 },
    { conversationId: CONVERSATION, sequence: 'latest' },
    { conversationId: CONVERSATION },
  ],
  [EVENTS.typing]: [
    { conversationId: CONVERSATION, typing: 'yes' },
    { conversationId: CONVERSATION, typing: true, text: 'draft' },
    { conversationId: CONVERSATION },
  ],
};

describe('event validation', () => {
  it.each(Object.values(EVENTS))(
    '%s refuses malformed, extra-key, oversized and bad-id payloads before any service call',
    async (event) => {
      const socket = await connect(SENTINEL.aliceToken);
      const sessionCalls = sessions.seen.length;
      for (const payload of [
        ...GENERIC_BAD_PAYLOADS,
        ...(SPECIFIC_BAD_PAYLOADS[event] ?? []),
      ]) {
        expect(await request(socket, event, payload)).toEqual({
          ok: false,
          failure: 'invalid',
        });
      }
      // Two payloads, or none, are not the event's shape either.
      expect(await request(socket, event, { conversationId: CONVERSATION }, {})).toEqual({
        ok: false,
        failure: 'invalid',
      });
      expect(await request(socket, event)).toEqual({ ok: false, failure: 'invalid' });

      // Refused before the budget, the session and Messaging: nothing was asked.
      expect(fake.journal).toEqual([]);
      expect(sessions.seen.length).toBe(sessionCalls);

      // And the connection — and the process — keep serving.
      expect((await subscribe(socket)).conversationId).toBe(CONVERSATION);
    },
  );

  it('does no work for a frame that carries no ack', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    socket.emit(EVENTS.subscribe, { conversationId: CONVERSATION });
    socket.emit(EVENTS.send, sendPayload());
    await barrier(socket);
    expect(fake.journal).toEqual([]);
  });

  it('refuses prototype-pollution-shaped payloads and mutates nothing', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    const polluting = [
      JSON.parse(
        `{"conversationId":"${CONVERSATION}","__proto__":{"polluted":"yes"}}`,
      ) as unknown,
      { conversationId: CONVERSATION, constructor: { prototype: { polluted: 'yes' } } },
      JSON.parse(
        `{"conversationId":"${CONVERSATION}","prototype":{"polluted":"yes"}}`,
      ) as unknown,
    ];
    for (const payload of polluting) {
      for (const event of [EVENTS.subscribe, EVENTS.typing, EVENTS.send]) {
        expect(await request(socket, event, payload)).toEqual({
          ok: false,
          failure: 'invalid',
        });
      }
    }
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
    expect(fake.journal).toEqual([]);
  });

  it('closes a connection whose frame exceeds the payload cap and keeps serving others', async () => {
    const bystander = await connect(SENTINEL.bobToken);
    const socket = await connect(SENTINEL.aliceToken);
    const gone = disconnected(socket);
    socket.emit(
      EVENTS.send,
      sendPayload('x'.repeat(REALTIME_LIMITS.maxPayloadBytes + 1)),
      () => undefined,
    );
    expect(await gone).toBe('transport close');
    expect(fake.journal).not.toContain(`send:${ALICE}`);

    expect((await subscribe(bystander)).conversationId).toBe(CONVERSATION);
    const fresh = await connect(SENTINEL.aliceToken);
    expect((await subscribe(fresh)).conversationId).toBe(CONVERSATION);
  });

  it('ignores unknown event names, including `error`', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    let answered = false;
    socket.emit('conversation:delete', { conversationId: CONVERSATION }, () => {
      answered = true;
    });
    socket.emit('error', { conversationId: CONVERSATION });
    socket.emit('admin:moderate', { everything: true }, () => {
      answered = true;
    });
    await barrier(socket);
    expect(answered).toBe(false);
    expect(fake.journal).toEqual([]);
    expect((await subscribe(socket)).conversationId).toBe(CONVERSATION);
  });
});

/* ===========================================================================
 * Budgets
 * ========================================================================= */

describe('per-connection budgets', () => {
  it('limits subscribe churn, and refills with the clock', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    const { max, windowMs } = REALTIME_LIMITS.budgets.subscribe;
    for (let index = 0; index < max / 2; index += 1) {
      await subscribe(socket);
      expect(
        await request(socket, EVENTS.unsubscribe, { conversationId: CONVERSATION }),
      ).toEqual({
        ok: true,
        value: null,
      });
    }
    const opens = fake.journal.filter((entry) => entry === `open:${ALICE}`).length;
    expect(
      await request(socket, EVENTS.subscribe, { conversationId: CONVERSATION }),
    ).toEqual({
      ok: false,
      failure: 'rate-limited',
    });
    // Refused before Messaging was asked.
    expect(fake.journal.filter((entry) => entry === `open:${ALICE}`).length).toBe(opens);

    clock += windowMs;
    expect((await subscribe(socket)).conversationId).toBe(CONVERSATION);
  });

  it('limits sends', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    for (let index = 0; index < REALTIME_LIMITS.budgets.send.max; index += 1) {
      expect((await request(socket, EVENTS.send, sendPayload())).ok).toBe(true);
    }
    expect(await request(socket, EVENTS.send, sendPayload())).toEqual({
      ok: false,
      failure: 'rate-limited',
    });
    expect(fake.committed).toHaveLength(REALTIME_LIMITS.budgets.send.max);
  });

  it('limits typing signals', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    await subscribe(socket);
    for (let index = 0; index < REALTIME_LIMITS.budgets.typing.max; index += 1) {
      expect(
        (
          await request(socket, EVENTS.typing, {
            conversationId: CONVERSATION,
            typing: index % 2 === 0,
          })
        ).ok,
      ).toBe(true);
    }
    expect(
      await request(socket, EVENTS.typing, {
        conversationId: CONVERSATION,
        typing: true,
      }),
    ).toEqual({
      ok: false,
      failure: 'rate-limited',
    });
  });

  it('caps the conversations one connection follows', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    for (let index = 0; index < REALTIME_LIMITS.subscriptionsPerConnection; index += 1) {
      await subscribe(socket, randomUUID());
    }
    expect(
      await request(socket, EVENTS.subscribe, { conversationId: randomUUID() }),
    ).toEqual({
      ok: false,
      failure: 'too-many',
    });
  });

  it('are per connection: another socket of the same person has its own', async () => {
    const first = await connect(SENTINEL.aliceToken);
    for (let index = 0; index < REALTIME_LIMITS.budgets.send.max; index += 1) {
      await request(first, EVENTS.send, sendPayload());
    }
    const second = await connect(SENTINEL.aliceTab2Token);
    expect((await request(second, EVENTS.send, sendPayload())).ok).toBe(true);
  });
});

/* ===========================================================================
 * Session, re-resolved on every event
 * ========================================================================= */

describe('per-event session re-resolution', () => {
  it.each([
    ['revoked', () => sessions.deny(SENTINEL.aliceToken, 'no-session')],
    ['suspended', () => sessions.deny(SENTINEL.aliceToken, 'account-suspended')],
    ['now another account', () => sessions.activate(SENTINEL.aliceToken, CAROL)],
  ])(
    'a session %s after connect is signed out on the next event',
    async (_label, change) => {
      const socket = await connect(SENTINEL.aliceToken);
      change();
      const gone = disconnected(socket);
      expect(
        await request(socket, EVENTS.subscribe, { conversationId: CONVERSATION }),
      ).toEqual({
        ok: false,
        failure: 'signed-out',
      });
      expect(await gone).toBe('io server disconnect');
      expect(fake.journal).toEqual([]);
    },
  );

  it('answers `unavailable` while Identity cannot answer, and calls nothing', async () => {
    const socket = await connect(SENTINEL.aliceToken);
    sessions.setOutage(true);
    expect(await request(socket, EVENTS.send, sendPayload())).toEqual({
      ok: false,
      failure: 'unavailable',
    });
    expect(fake.journal).toEqual([]);
    sessions.setOutage(false);
    expect((await request(socket, EVENTS.send, sendPayload())).ok).toBe(true);
  });
});

/* ===========================================================================
 * Subscription and message fan-out
 * ========================================================================= */

describe('subscription and delivery', () => {
  it('maps a Messaging refusal and does not join a refused conversation', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    const bobFrames = record(bob);
    fake.denyOpen.add(BOB);
    expect(
      await request(bob, EVENTS.subscribe, { conversationId: CONVERSATION }),
    ).toEqual({
      ok: false,
      failure: 'not-found',
    });
    await subscribe(alice);

    const mark = logs.lines.length;
    expect((await request(alice, EVENTS.send, sendPayload())).ok).toBe(true);
    const done = await logs.waitFor(fanOutLine('fan-out:message'), mark);
    await barrier(bob);
    expect(done['recipients']).toBe(0);
    expect(bobFrames).toEqual([]);
    expect(fake.journal).not.toContain(`deliver:${BOB}`);
  });

  it('drops an existing subscription that Messaging now refuses', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    const bobFrames = record(bob);
    await subscribe(alice);
    await subscribe(bob);
    fake.denyOpen.add(BOB);
    expect(
      (await request(bob, EVENTS.subscribe, { conversationId: CONVERSATION })).ok,
    ).toBe(false);

    const mark = logs.lines.length;
    await request(alice, EVENTS.send, sendPayload());
    expect((await logs.waitFor(fanOutLine('fan-out:message'), mark))['recipients']).toBe(
      0,
    );
    await barrier(bob);
    expect(
      bobFrames.filter((frame) => frame.event === SERVER_EVENTS.messageCreated),
    ).toEqual([]);
  });

  it('commits through Messaging before any emit, acks the committed message, then delivers', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(alice);
    await subscribe(bob);

    let committedWhenReceived = -1;
    const received = next<RealtimeMessageCreated>(
      bob,
      SERVER_EVENTS.messageCreated,
      () => {
        committedWhenReceived = fake.committed.length;
        fake.journal.push(`received:${BOB}`);
        return true;
      },
    );
    const aliceFrames = record(alice);
    const ack = await request<RealtimeSent>(
      alice,
      EVENTS.send,
      sendPayload(SENTINEL.body),
    );
    const frame = await received;

    expect(ack.ok).toBe(true);
    const committed = fake.committed[0]!;
    if (!ack.ok) throw new Error('unreachable');
    expect(ack.value).toEqual({
      message: { ...committed, sentAt: committed.sentAt.toISOString() },
      replayed: false,
    });
    expect(frame).toEqual({
      conversationId: CONVERSATION,
      message: { ...committed, own: false, sentAt: committed.sentAt.toISOString() },
    });
    expect(committedWhenReceived).toBe(1);
    const order = fake.journal;
    expect(order.indexOf(`committed:1`)).toBeGreaterThan(order.indexOf(`send:${ALICE}`));
    expect(order.indexOf(`deliver:${BOB}`)).toBeGreaterThan(order.indexOf('committed:1'));
    expect(order.indexOf(`received:${BOB}`)).toBeGreaterThan(
      order.indexOf(`deliver:${BOB}`),
    );

    // The sending connection is answered by its ack, not by a second frame.
    await barrier(alice);
    expect(
      aliceFrames.filter((each) => each.event === SERVER_EVENTS.messageCreated),
    ).toEqual([]);
  });

  it('reaches the sender’s other tabs, deciding once per account per fan-out', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const aliceTab2 = await connect(SENTINEL.aliceTab2Token);
    const bob = await connect(SENTINEL.bobToken);
    const bobTab2 = await connect(SENTINEL.bobTab2Token);
    for (const socket of [alice, aliceTab2, bob, bobTab2]) await subscribe(socket);

    const toAliceTab2 = next<RealtimeMessageCreated>(
      aliceTab2,
      SERVER_EVENTS.messageCreated,
    );
    const toBob = next<RealtimeMessageCreated>(bob, SERVER_EVENTS.messageCreated);
    const toBobTab2 = next<RealtimeMessageCreated>(bobTab2, SERVER_EVENTS.messageCreated);
    await request(alice, EVENTS.send, sendPayload());
    expect((await toAliceTab2).message.own).toBe(true);
    expect((await toBob).message.own).toBe(false);
    expect((await toBobTab2).message.own).toBe(false);

    expect(fake.journal.filter((entry) => entry === `deliver:${BOB}`)).toHaveLength(1);
    expect(fake.journal.filter((entry) => entry === `deliver:${ALICE}`)).toHaveLength(1);
  });

  it('delivers NOTHING to a stale room member whose delivery Messaging now refuses', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(alice);
    await subscribe(bob);
    const bobFrames = record(bob);
    fake.denyDelivery.add(BOB);

    const mark = logs.lines.length;
    expect((await request(alice, EVENTS.send, sendPayload())).ok).toBe(true);
    const done = await logs.waitFor(fanOutLine('fan-out:message'), mark);
    await barrier(bob);
    expect(done).toMatchObject({ recipients: 1, delivered: 0 });
    expect(fake.journal).toContain(`deliver:${BOB}`);
    expect(bobFrames).toEqual([]);
  });

  it('delivers nothing to a member whose session ended, and disconnects it', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(alice);
    await subscribe(bob);
    const bobFrames = record(bob);
    const gone = disconnected(bob);
    sessions.deny(SENTINEL.bobToken, 'account-closed');

    expect((await request(alice, EVENTS.send, sendPayload())).ok).toBe(true);
    expect(await gone).toBe('io server disconnect');
    expect(
      bobFrames.filter((frame) => frame.event === SERVER_EVENTS.messageCreated),
    ).toEqual([]);
    expect(fake.journal).not.toContain(`deliver:${BOB}`);
  });

  it('keeps the commit and the ack when delivery fails after it', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    const bobTab2 = await connect(SENTINEL.bobTab2Token);
    const carol = await connect(SENTINEL.carolToken);
    for (const socket of [alice, bob, bobTab2, carol]) await subscribe(socket);
    const bobFrames = record(bob);
    fake.brokenDelivery.add(BOB);
    fake.throwDelivery.add(CAROL);

    const mark = logs.lines.length;
    const ack = await request<RealtimeSent>(alice, EVENTS.send, sendPayload());
    expect(ack.ok).toBe(true);
    expect(fake.committed).toHaveLength(1);
    const done = await logs.waitFor(fanOutLine('fan-out:message'), mark);
    expect(done).toMatchObject({ recipients: 3, delivered: 0 });
    await barrier(bob);
    // (Carol's arrival may still be announcing presence; only messages matter here.)
    expect(
      bobFrames.filter((frame) => frame.event === SERVER_EVENTS.messageCreated),
    ).toEqual([]);

    // The process is unharmed: the next send is delivered.
    fake.brokenDelivery.clear();
    const delivered = next<RealtimeMessageCreated>(bob, SERVER_EVENTS.messageCreated);
    await request(alice, EVENTS.send, sendPayload());
    expect((await delivered).message.sequence).toBe(2);
  });

  it('does not deliver across conversations', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(alice, OTHER_CONVERSATION);
    await subscribe(bob, CONVERSATION);
    const bobFrames = record(bob);

    const mark = logs.lines.length;
    await request(alice, EVENTS.send, sendPayload('hello', OTHER_CONVERSATION));
    expect((await logs.waitFor(fanOutLine('fan-out:message'), mark))['recipients']).toBe(
      0,
    );
    await barrier(bob);
    expect(bobFrames).toEqual([]);
  });

  it('does not re-deliver a replayed send', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(alice);
    await subscribe(bob);
    const bobFrames = record(bob);
    const payload = sendPayload();

    const first = next<RealtimeMessageCreated>(bob, SERVER_EVENTS.messageCreated);
    await request(alice, EVENTS.send, payload);
    await first;
    const replay = await request<RealtimeSent>(alice, EVENTS.send, payload);
    expect(replay.ok && replay.value.replayed).toBe(true);
    await barrier(bob);
    expect(
      bobFrames.filter((frame) => frame.event === SERVER_EVENTS.messageCreated),
    ).toHaveLength(1);
    expect(fake.committed).toHaveLength(1);
  });

  it('answers catch-up and read marks from Messaging', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    await request(alice, EVENTS.send, sendPayload('first'));
    await request(alice, EVENTS.send, sendPayload('second'));
    const page = await request(alice, EVENTS.catchUp, {
      conversationId: CONVERSATION,
      after: 1,
    });
    expect(page).toMatchObject({ ok: true, value: { more: false, lastSequence: 2 } });
    expect(
      page.ok &&
        (page.value as { messages: { body: string; sentAt: string }[] }).messages,
    ).toEqual([
      expect.objectContaining({ body: 'second', sentAt: '2026-10-17T10:00:00.000Z' }),
    ]);
    expect(
      await request(alice, EVENTS.read, { conversationId: CONVERSATION, sequence: 2 }),
    ).toEqual({
      ok: true,
      value: { readSequence: 2 },
    });
  });

  it('maps every refusal to the transport vocabulary and an outage to `unavailable`', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    const cases: [Error, string][] = [
      [new MessagingRefusal('blocked'), 'blocked'],
      [new MessagingRefusal('ended'), 'ended'],
      [new MessagingRefusal('operation-conflict'), 'operation-conflict'],
      [new MessagingRefusal('too-large'), 'invalid'],
      [new MessagingRefusal('denied'), 'not-found'],
      [new Error('SELECT * FROM secret failed'), 'unavailable'],
    ];
    for (const [error, failure] of cases) {
      fake.messaging.markRead = () => Promise.reject(error);
      expect(
        await request(alice, EVENTS.read, { conversationId: CONVERSATION, sequence: 1 }),
      ).toEqual({
        ok: false,
        failure,
      });
    }
  });
});

/* ===========================================================================
 * Presence
 * ========================================================================= */

describe('presence', () => {
  it('announces online once per account and offline when the last tab leaves', async () => {
    const bob = await connect(SENTINEL.bobToken);
    const bobFrames = record(bob);
    expect((await subscribe(bob)).counterpartOnline).toBe(false);

    const online = next<RealtimePresenceChanged>(bob, SERVER_EVENTS.presenceChanged);
    const alice = await connect(SENTINEL.aliceToken);
    expect((await subscribe(alice)).counterpartOnline).toBe(true);
    expect(await online).toEqual({ conversationId: CONVERSATION, online: true });

    const aliceTab2 = await connect(SENTINEL.aliceTab2Token);
    await subscribe(aliceTab2);

    let mark = logs.lines.length;
    alice.disconnect();
    await logs.waitFor((line) => line['operation'] === 'disconnect', mark);
    await barrier(bob);
    // Still online: the second tab holds the conversation.
    expect(bobFrames.map((frame) => frame.payload)).toEqual([
      { conversationId: CONVERSATION, online: true },
    ]);

    mark = logs.lines.length;
    const offline = next<RealtimePresenceChanged>(bob, SERVER_EVENTS.presenceChanged);
    aliceTab2.disconnect();
    expect(await offline).toEqual({ conversationId: CONVERSATION, online: false });
    expect(bobFrames.map((frame) => frame.payload)).toEqual([
      { conversationId: CONVERSATION, online: true },
      { conversationId: CONVERSATION, online: false },
    ]);
    // Exactly three presence fan-outs: bob's arrival, alice's arrival, alice's departure.
    expect(logs.lines.filter(fanOutLine('fan-out:presence'))).toHaveLength(3);
    expect(logs.lines.slice(mark).filter(fanOutLine('fan-out:presence'))).toHaveLength(1);
  });

  it('withdraws presence on unsubscribe', async () => {
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(bob);
    const alice = await connect(SENTINEL.aliceToken);
    const online = next<RealtimePresenceChanged>(bob, SERVER_EVENTS.presenceChanged);
    await subscribe(alice);
    await online;
    const offline = next<RealtimePresenceChanged>(bob, SERVER_EVENTS.presenceChanged);
    await request(alice, EVENTS.unsubscribe, { conversationId: CONVERSATION });
    expect(await offline).toEqual({ conversationId: CONVERSATION, online: false });
  });

  it('tells nothing to an observer Messaging does not allow to observe', async () => {
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(bob);
    const bobFrames = record(bob);
    fake.denyObserve.add(BOB);

    const mark = logs.lines.length;
    const alice = await connect(SENTINEL.aliceToken);
    expect((await subscribe(alice)).counterpartOnline).toBe(true);
    const done = await logs.waitFor(fanOutLine('fan-out:presence'), mark);
    await barrier(bob);
    expect(done).toMatchObject({ recipients: 1, delivered: 0 });
    expect(bobFrames).toEqual([]);
    // Nor does bob's own subscription reveal it.
    expect((await subscribe(bob)).counterpartOnline).toBe(false);
  });

  it('starts empty after the server closes and starts again', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    await subscribe(alice);
    await server.close();
    clients.splice(0).forEach((socket) => socket.disconnect());
    await boot();
    const bob = await connect(SENTINEL.bobToken);
    expect((await subscribe(bob)).counterpartOnline).toBe(false);
  });
});

/* ===========================================================================
 * Typing
 * ========================================================================= */

describe('typing', () => {
  async function pair() {
    const alice = await connect(SENTINEL.aliceToken);
    const bob = await connect(SENTINEL.bobToken);
    await subscribe(bob);
    const arrived = next<RealtimePresenceChanged>(bob, SERVER_EVENTS.presenceChanged);
    await subscribe(alice);
    await arrived;
    return { alice, bob };
  }

  const typing = (value: boolean) => ({ conversationId: CONVERSATION, typing: value });

  it('refuses typing Messaging does not allow now, and tells no one', async () => {
    const { alice, bob } = await pair();
    const bobFrames = record(bob);
    fake.denyType.add(ALICE);
    expect(await request(alice, EVENTS.typing, typing(true))).toEqual({
      ok: false,
      failure: 'not-found',
    });
    expect(fake.journal).toContain(`can-type:${ALICE}`);
    await barrier(bob);
    expect(bobFrames).toEqual([]);
    expect(logs.lines.filter(fanOutLine('fan-out:typing'))).toHaveLength(0);
  });

  it('refuses typing in a conversation the connection does not follow', async () => {
    const carol = await connect(SENTINEL.carolToken);
    expect(await request(carol, EVENTS.typing, typing(true))).toEqual({
      ok: false,
      failure: 'not-found',
    });
  });

  it('carries only the conversation and a boolean, and lapses on the clock', async () => {
    const { alice, bob } = await pair();
    const started = next<RealtimeTypingChanged>(bob, SERVER_EVENTS.typingChanged);
    expect(await request(alice, EVENTS.typing, typing(true))).toEqual({
      ok: true,
      value: null,
    });
    const frame = await started;
    expect(frame).toEqual({ conversationId: CONVERSATION, typing: true });
    expect(Object.keys(frame).sort()).toEqual(['conversationId', 'typing']);

    const lapsed = next<RealtimeTypingChanged>(bob, SERVER_EVENTS.typingChanged);
    clock += REALTIME_LIMITS.typingTtlMs + 1;
    expect(await lapsed).toEqual({ conversationId: CONVERSATION, typing: false });
  });

  it('clears on an explicit stop, on send, and on disconnect', async () => {
    const { alice, bob } = await pair();
    const changes = (value: boolean) =>
      next<RealtimeTypingChanged>(
        bob,
        SERVER_EVENTS.typingChanged,
        (payload) => payload.typing === value,
      );

    let started = changes(true);
    await request(alice, EVENTS.typing, typing(true));
    await started;
    let stopped = changes(false);
    await request(alice, EVENTS.typing, typing(false));
    await stopped;

    started = changes(true);
    await request(alice, EVENTS.typing, typing(true));
    await started;
    stopped = changes(false);
    await request(alice, EVENTS.send, sendPayload());
    await stopped;

    started = changes(true);
    await request(alice, EVENTS.typing, typing(true));
    await started;
    stopped = changes(false);
    alice.disconnect();
    await stopped;
  });

  it('tells nothing to an observer Messaging does not allow to observe', async () => {
    const { alice, bob } = await pair();
    const bobFrames = record(bob);
    fake.denyObserve.add(BOB);
    const mark = logs.lines.length;
    expect(await request(alice, EVENTS.typing, typing(true))).toEqual({
      ok: true,
      value: null,
    });
    const done = await logs.waitFor(fanOutLine('fan-out:typing'), mark);
    await barrier(bob);
    expect(done).toMatchObject({ recipients: 1, delivered: 0 });
    expect(bobFrames).toEqual([]);
  });
});

/* ===========================================================================
 * Logs
 * ========================================================================= */

describe('logging', () => {
  it('writes operations, outcomes, counts and a correlation id — never credentials or content', async () => {
    const alice = await connect(SENTINEL.aliceToken, {
      headers: { 'x-sentinel': SENTINEL.header },
    });
    const bob = await connect(SENTINEL.bobToken, {
      headers: { 'x-sentinel': SENTINEL.header },
    });
    await subscribe(alice);
    await subscribe(bob);
    const delivered = next(bob, SERVER_EVENTS.messageCreated);
    await request(alice, EVENTS.send, sendPayload(SENTINEL.body));
    await delivered;
    await request(alice, EVENTS.typing, { conversationId: CONVERSATION, typing: true });
    await request(alice, EVENTS.send, {
      ...sendPayload(SENTINEL.body),
      extra: SENTINEL.body,
    });
    expect(
      await outcomeOf(
        client({ cookie: `sid=${SENTINEL.carolToken}`, origin: 'https://evil.example' }),
      ),
    ).toBe('refused');
    sessions.deny(SENTINEL.bobToken, 'no-session');
    await request(bob, EVENTS.read, { conversationId: CONVERSATION, sequence: 1 });

    const text = logs.raw.join('\n');
    for (const value of Object.values(SENTINEL)) expect(text).not.toContain(value);
    expect(text).not.toContain('evil.example');
    expect(text).not.toContain(ALICE);

    const allowed = new Set([
      'level',
      'time',
      'env',
      'msg',
      'component',
      'correlationId',
      'operation',
      'outcome',
      'durationMs',
      'recipients',
      'delivered',
      'subscriptions',
    ]);
    for (const line of logs.lines) {
      for (const key of Object.keys(line)) expect(allowed).toContain(key);
    }
    expect(
      logs.lines.some(
        (line) => line['operation'] === 'handshake' && line['outcome'] === 'origin',
      ),
    ).toBe(true);
    expect(logs.lines.some((line) => typeof line['correlationId'] === 'string')).toBe(
      true,
    );
  });
});

/* ===========================================================================
 * HTTP surface and shutdown
 * ========================================================================= */

describe('http surface and shutdown', () => {
  it('serves health and readiness probes, 404 elsewhere, and no CORS header', async () => {
    const health = await fetch(url('/healthz'));
    expect(health.status).toBe(200);
    expect(await health.text()).toBe('ok');
    const ready = await fetch(url('/readyz'), {
      headers: { origin: 'https://evil.example' },
    });
    expect(ready.status).toBe(200);
    for (const path of ['/', '/socket.io', '/healthz/x', '/admin']) {
      expect((await fetch(url(path))).status).toBe(404);
    }
    expect((await fetch(url('/healthz'), { method: 'POST' })).status).toBe(404);
    const preflight = await fetch(url(REALTIME_PATH), {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    for (const response of [health, ready, preflight]) {
      for (const name of response.headers.keys())
        expect(name).not.toMatch(/^access-control-/);
    }
  });

  it('reports not-ready while closing and waits for an in-flight send within the grace', async () => {
    const alice = await connect(SENTINEL.aliceToken);
    fake.state.holdSend = deferred();
    const answered = request<RealtimeSent>(alice, EVENTS.send, sendPayload());
    await new Promise<void>((resolve) => {
      const check = () =>
        fake.journal.includes(`send:${ALICE}`) ? resolve() : setImmediate(check);
      check();
    });

    let closed = false;
    const closing = server.close().then(() => {
      closed = true;
    });
    expect((await fetch(url('/readyz'))).status).toBe(503);
    expect((await fetch(url('/healthz'))).status).toBe(200);
    // No one new is admitted while draining.
    expect(await outcomeOf(client({ cookie: `sid=${SENTINEL.bobToken}` }))).toBe(
      'refused',
    );
    expect(closed).toBe(false);

    fake.state.holdSend.resolve();
    const ack = await answered;
    expect(ack.ok).toBe(true);
    expect(fake.committed).toHaveLength(1);
    await closing;
    expect(closed).toBe(true);
    await expect(fetch(url('/healthz'))).rejects.toThrow();
  });

  it('closes after the grace even if a send never finishes', async () => {
    await server.close();
    await boot({ shutdownGraceMs: 50 });
    const alice = await connect(SENTINEL.aliceToken);
    fake.state.holdSend = deferred();
    void request(alice, EVENTS.send, sendPayload());
    await new Promise<void>((resolve) => {
      const check = () =>
        fake.journal.includes(`send:${ALICE}`) ? resolve() : setImmediate(check);
      check();
    });
    const gone = disconnected(alice);
    await server.close();
    await gone;
    expect(alice.connected).toBe(false);
    fake.state.holdSend.resolve();
  });
});
