import { randomBytes } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

import { io, type Socket } from 'socket.io-client';
import { expect } from 'vitest';

import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_PATH,
  REALTIME_SERVER_EVENTS,
  type RealtimeAck,
  type RealtimeFailure,
} from '../../packages/contracts/src/messaging/realtime.ts';
import { n } from '../learning/fixture-sql.ts';
import {
  freePort,
  realtimeMarker,
  spawnRealtime,
  stopOwnRealtime,
  waitForStatus,
} from '../../scripts/shared/realtime-harness.mjs';
import {
  freshEmail,
  linkParameters,
  PROOF_PASSWORD,
  PROOF_SECRETS,
} from '../identity/harness.ts';
import {
  anonymousContext,
  BASE_URL,
  cookieHeader,
  createIdentityHarness,
  type IdentityHarness,
} from '../identity/service.ts';
import {
  activateLive,
  activateMessaging,
  enrol,
  grantRole,
  liveCourse,
  messagingWorld,
  op,
  scope,
  sentinel,
  type MessagingWorld,
  type RoleFixture,
} from '../messaging/fixture-sql.ts';

/**
 * The shared harness for the Phase-25 REAL-PROCESS proofs.
 *
 * WHAT IS REAL. A disposable database with the real migrations; the Phase-24
 * Messaging service wired exactly as the web composition root wires it, every
 * read made by the provisioned least-privilege RUNTIME principal
 * (`tests/messaging/fixture-sql.ts`); people who signed up, verified and signed
 * in through Identity's own service, so every cookie is a real Better Auth
 * session; the REAL realtime process, spawned from its composition entry with
 * plain Node exactly as `npm run realtime:start` runs it, configured as a
 * deployment is (`NODE_ENV=production`, the runtime principal's URL and no
 * other database credential); and REAL `socket.io-client` connections over
 * WebSocket carrying a real `Origin` and `Cookie`.
 *
 * WHAT IS NOT. Nothing is mocked between the socket and SQL Server. The only
 * fixture writes are the rows other owners or the operator write (activation,
 * roles, Courses, scopes, Enrolments) — on the owner session, never through
 * the process under test.
 *
 * POSITIVE BARRIERS, NEVER SLEEPS. "Nothing arrived" is only meaningful once
 * something proves the moment for it to arrive has passed. Every such proof
 * here waits for a positive signal: a refused ack (a refused event fans out
 * nothing), the transport's own `fan-out:* done` record with its recipient and
 * delivery counts (debug level — counts and a correlation id, never content),
 * or a control frame on another conversation the same socket is following.
 */

/** The origin the process is configured with — the one Identity's harness signs for. */
export const ORIGIN = BASE_URL;

/** Synthetic sentinels for the secrets the production schema insists on. */
const PROCESS_SECRETS = {
  AUTH_SECRETS: PROOF_SECRETS.authSecrets
    .map((secret) => `${String(secret.version)}:${secret.value}`)
    .join(','),
  RATE_LIMIT_DIGEST_KEY: PROOF_SECRETS.digestKey,
  RATE_LIMIT_DIGEST_KEY_VERSION: String(PROOF_SECRETS.digestKeyVersion),
  EMAIL_DIGEST_KEY: 'synthetic-realtime-proof-email-digest-0001',
  NEWSLETTER_TOKEN_KEY: 'synthetic-realtime-proof-newsletter-0001',
};

/**
 * Credentials the realtime process must never hold. The parent suite carries
 * them (it created the database), so they are REMOVED from the child's
 * environment rather than merely not added: the process runs with the runtime
 * principal's URL and nothing more powerful.
 */
const WITHHELD = [
  'DATABASE_MIGRATION_URL',
  'DATABASE_APP_LOGIN',
  'DATABASE_APP_PASSWORD',
  'DATABASE_OPERATOR_LOGIN',
  'DATABASE_OPERATOR_PASSWORD',
  'MSSQL_SA_PASSWORD',
];

/* ===========================================================================
 * The realtime process
 * ========================================================================= */

/** One structured log record of the process (Pino JSON). */
export type LogRecord = Readonly<Record<string, unknown>>;

export interface RealtimeProcess {
  readonly host: string;
  readonly port: number;
  /** `http://host:port`, for probes and direct sockets. */
  readonly url: string;
  /** Every record the process has written so far, in order. */
  readonly records: LogRecord[];
  /** Everything the process wrote, verbatim — for "nothing secret was logged". */
  output(): string;
  /** The first record at or after `from` satisfying `predicate`. */
  waitForRecord(
    predicate: (record: LogRecord) => boolean,
    options?: { readonly from?: number; readonly timeoutMs?: number },
  ): Promise<LogRecord>;
  /** Stops it — SIGTERM (graceful) or SIGKILL (a crash) — and proves it gone. */
  stop(signal?: 'SIGTERM' | 'SIGKILL'): Promise<void>;
  readonly exited: Promise<number | null>;
}

export interface ProcessOptions {
  /** The runtime principal's URL to the disposable database. */
  readonly databaseUrl: string;
  readonly host?: string;
  /** A fixed port (for a restart); a free one is chosen otherwise. */
  readonly port?: number;
  /** The one origin the handshake admits; `ORIGIN` by default. */
  readonly origin?: string;
}

/** Starts the REAL realtime process and waits until it accepts sockets. */
export async function startRealtimeProcess(
  options: ProcessOptions,
): Promise<RealtimeProcess> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? (await freePort(host));
  const marker = realtimeMarker('realtime-proof', randomBytes(6).toString('hex'));

  const environment: Record<string, string | undefined> = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !WITHHELD.includes(key)),
  );
  Object.assign(environment, PROCESS_SECRETS, {
    NODE_ENV: 'production',
    LOG_LEVEL: 'debug',
    DATABASE_URL: options.databaseUrl,
    AUTH_BASE_URL: options.origin ?? ORIGIN,
    REALTIME_HOST: host,
    REALTIME_PORT: String(port),
  });

  const child: ChildProcess = spawnRealtime({
    marker,
    environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let raw = '';
  let pending = '';
  const records: LogRecord[] = [];
  const waiters = new Set<() => void>();
  const notify = () => {
    for (const waiter of waiters) waiter();
  };

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    raw += chunk;
    pending += chunk;
    let newline = pending.indexOf('\n');
    while (newline !== -1) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (line.startsWith('{')) {
        try {
          records.push(JSON.parse(line) as LogRecord);
        } catch {
          // Not a record; kept verbatim in `raw`.
        }
      }
      newline = pending.indexOf('\n');
    }
    notify();
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    raw += chunk;
  });

  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => {
      notify();
      resolve(code);
    });
  });

  const url = `http://${host}:${String(port)}`;
  const ready = waitForStatus(`${url}/readyz`, 200, 120_000);
  const early = exited.then((code) => {
    throw new Error(
      `The realtime process exited (${String(code)}) before it was ready:\n${raw}`,
    );
  });
  // The race's loser must not surface later as an unhandled rejection.
  early.catch(() => undefined);
  try {
    await Promise.race([ready, early]);
  } catch (error) {
    // A process that never became ready must not outlive the proof.
    if (child.exitCode === null && child.pid !== undefined)
      await stopOwnRealtime(child.pid, marker, { signal: 'SIGKILL' });
    throw error;
  }

  return {
    host,
    port,
    url,
    records,
    output: () => raw,
    async waitForRecord(predicate, { from = 0, timeoutMs = 30_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = records.slice(from).find(predicate);
        if (found !== undefined) return found;
        const remaining = deadline - Date.now();
        if (remaining <= 0 || child.exitCode !== null)
          throw new Error('The expected realtime log record never appeared.');
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, remaining);
          function done() {
            clearTimeout(timer);
            waiters.delete(done);
            resolve();
          }
          waiters.add(done);
        });
      }
    },
    async stop(signal = 'SIGTERM') {
      if (child.exitCode !== null || child.pid === undefined) return;
      await stopOwnRealtime(child.pid, marker, { signal });
      await exited;
    },
    exited,
  };
}

/** A predicate for one transport fan-out completing. */
export const fanOutDone =
  (operation: 'fan-out:message' | 'fan-out:presence' | 'fan-out:typing') =>
  (record: LogRecord) =>
    record['operation'] === operation && record['outcome'] === 'done';

/* ===========================================================================
 * Sockets
 * ========================================================================= */

export interface Frame {
  readonly event: string;
  readonly payload: unknown;
}

export interface Client {
  readonly socket: Socket;
  /** Every server event this socket received, in order. */
  readonly frames: Frame[];
  ack<T>(event: string, payload: unknown): Promise<RealtimeAck<T>>;
  /** The next frame (at or after index `from`) of `event` matching `predicate`. */
  next(
    event: string,
    predicate?: (payload: never) => boolean,
    options?: { readonly from?: number; readonly timeoutMs?: number },
  ): Promise<unknown>;
  /** Frames of `event` naming `conversationId`, at or after `from`. */
  framesFor(conversationId: string, from?: number): Frame[];
  readonly disconnected: Promise<string>;
  close(): void;
}

export interface ConnectOptions {
  /** The Cookie header; omitted means none at all. */
  readonly cookie?: string;
  /** The Origin header; `null` means none at all. `ORIGIN` by default. */
  readonly origin?: string | null;
  readonly query?: Record<string, string>;
  readonly auth?: Record<string, unknown>;
}

export type ConnectOutcome =
  | { readonly connected: true; readonly client: Client }
  | { readonly connected: false; readonly reason: string };

const SERVER_EVENTS = Object.values(REALTIME_SERVER_EVENTS) as string[];

/** Opens a REAL socket.io-client WebSocket connection to `url`. */
export function connect(
  url: string,
  options: ConnectOptions = {},
): Promise<ConnectOutcome> {
  const headers: Record<string, string> = {};
  const origin = options.origin === undefined ? ORIGIN : options.origin;
  if (origin !== null) headers['Origin'] = origin;
  if (options.cookie !== undefined) headers['Cookie'] = options.cookie;

  const socket = io(url, {
    path: REALTIME_PATH,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    timeout: 20_000,
    extraHeaders: headers,
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.auth === undefined ? {} : { auth: options.auth }),
  });

  const frames: Frame[] = [];
  const waiters = new Set<() => void>();
  for (const event of SERVER_EVENTS) {
    socket.on(event, (payload: unknown) => {
      frames.push({ event, payload });
      for (const waiter of waiters) waiter();
    });
  }
  const disconnected = new Promise<string>((resolve) => {
    socket.once('disconnect', (reason) => {
      for (const waiter of waiters) waiter();
      resolve(String(reason));
    });
  });

  const client: Client = {
    socket,
    frames,
    async ack<T>(event: string, payload: unknown) {
      return (await socket.timeout(20_000).emitWithAck(event, payload)) as RealtimeAck<T>;
    },
    async next(event, predicate = () => true, { from = 0, timeoutMs = 20_000 } = {}) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = frames
          .slice(from)
          .find(
            (frame) =>
              frame.event === event &&
              (predicate as (payload: unknown) => boolean)(frame.payload),
          );
        if (found !== undefined) return found.payload;
        const remaining = deadline - Date.now();
        if (remaining <= 0 || !socket.connected)
          throw new Error(`No ${event} frame arrived.`);
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, remaining);
          function done() {
            clearTimeout(timer);
            waiters.delete(done);
            resolve();
          }
          waiters.add(done);
        });
      }
    },
    framesFor(conversationId, from = 0) {
      return frames
        .slice(from)
        .filter(
          (frame) =>
            (frame.payload as { conversationId?: unknown } | null)?.conversationId ===
            conversationId,
        );
    },
    disconnected,
    close() {
      socket.close();
    },
  };

  return new Promise((resolve) => {
    socket.once('connect', () => resolve({ connected: true, client }));
    socket.once('connect_error', (error) => {
      socket.close();
      resolve({ connected: false, reason: error.message });
    });
  });
}

/** Connects and insists on success. */
export async function connected(url: string, options: ConnectOptions): Promise<Client> {
  const outcome = await connect(url, options);
  if (!outcome.connected)
    throw new Error(`The connection was refused: ${outcome.reason}`);
  return outcome.client;
}

/** The ack's failure, or `accepted`. */
export function failureOf(ack: RealtimeAck<unknown>): RealtimeFailure | 'accepted' {
  return ack.ok ? 'accepted' : ack.failure;
}

/** What the transport must answer for a Messaging refusal reason (its presentation map). */
export function transportFailureFor(reason: string): RealtimeFailure | 'accepted' {
  const map: Record<string, RealtimeFailure> = {
    unclaimed: 'not-found',
    denied: 'not-found',
    conflict: 'unavailable',
    'too-large': 'invalid',
    unsupported: 'invalid',
    'not-cleared': 'unavailable',
  };
  if (reason === 'accepted') return 'accepted';
  return map[reason] ?? (reason as RealtimeFailure);
}

export const subscribe = (client: Client, conversationId: string) =>
  client.ack<{
    conversationId: string;
    lastSequence: number;
    readSequence: number;
    canSend: boolean;
    counterpartOnline: boolean;
  }>(REALTIME_CLIENT_EVENTS.subscribe, { conversationId });

export const sendOver = (
  client: Client,
  conversationId: string,
  body: string,
  operationId: string = op(),
) =>
  client.ack<{
    message: { id: string; sequence: number; body: string | null };
    replayed: boolean;
  }>(REALTIME_CLIENT_EVENTS.send, {
    conversationId,
    operationId,
    body,
    attachmentIds: [],
  });

export const catchUpOver = (client: Client, conversationId: string, after: number) =>
  client.ack<{
    messages: { id: string; sequence: number; body: string | null }[];
    more: boolean;
    lastSequence: number;
  }>(REALTIME_CLIENT_EVENTS.catchUp, { conversationId, after });

export const readOver = (client: Client, conversationId: string, sequence: number) =>
  client.ack<{ readSequence: number }>(REALTIME_CLIENT_EVENTS.read, {
    conversationId,
    sequence,
  });

export const typingOver = (client: Client, conversationId: string, typing: boolean) =>
  client.ack<unknown>(REALTIME_CLIENT_EVENTS.typing, { conversationId, typing });

/* ===========================================================================
 * The world: database, Messaging, Identity, people
 * ========================================================================= */

export interface Person {
  readonly accountId: string;
  readonly email: string;
  /** The real session cookie Identity issued at sign-in. */
  readonly cookie: string;
}

export interface Pair {
  readonly teacher: Person & { readonly role: RoleFixture };
  readonly learner: Person;
  readonly courseId: string;
  readonly scopeId: string;
  readonly conversationId: string;
}

export interface RealtimeWorld {
  readonly messaging: MessagingWorld;
  readonly identity: IdentityHarness;
  /** The runtime principal's URL to this world's database. */
  readonly databaseUrl: string;
  /** A person who signed up, verified and signed in through Identity. */
  person(label: string): Promise<Person>;
  /** Everyone `person` created, for the log-hygiene proofs. */
  readonly people: readonly Person[];
  /** Activates live learning and the teacher-student and support kinds. */
  activate(): Promise<void>;
  /** A fresh CURRENT teaching relationship with its conversation opened. */
  pair(label: string): Promise<Pair>;
  /** A teacher-student pair around an EXISTING learner. */
  pairFor(learner: Person, label: string): Promise<Pair>;
  close(): Promise<void>;
}

export async function realtimeWorld(): Promise<RealtimeWorld> {
  const messaging = await messagingWorld();
  try {
    const identity = await createIdentityHarness();
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined || !databaseUrl.includes(messaging.db.name))
      throw new Error('The runtime URL does not name the disposable database.');
    const admin = messaging.db.admin;
    const people: Person[] = [];

    async function person(label: string): Promise<Person> {
      const email = freshEmail(`realtime-${label}`);
      const signedUp = await identity.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Realtime Proof',
      });
      expect(signedUp.ok).toBe(true);
      await identity.dispatch();
      const link = identity.provider.lastLinkTo(email);
      expect(link).not.toBeNull();
      const parameters = linkParameters(link ?? '');
      const confirmed = await identity.identity.confirmVerification(anonymousContext(), {
        email: parameters.email,
        token: parameters.token,
      });
      expect(confirmed.ok).toBe(true);
      const signedIn = await identity.identity.signIn(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
      });
      if (!signedIn.ok) throw new Error('The proof person could not sign in.');
      const created = {
        accountId: signedIn.account.id,
        email,
        cookie: cookieHeader(signedIn.setCookies),
      };
      people.push(created);
      return created;
    }

    async function pairFor(learner: Person, label: string): Promise<Pair> {
      const teacherPerson = await person(`${label}-teacher`);
      const role = await grantRole(admin, teacherPerson.accountId, ['teaching.perform']);
      const courseId = await liveCourse(admin);
      const scopeId = await scope(admin, courseId, role);
      await enrol(admin, learner.accountId, courseId);
      const { conversationId } = await messaging.service.startTeaching(
        { accountId: learner.accountId },
        { counterpartAccountId: teacherPerson.accountId, courseId },
      );
      return {
        teacher: { ...teacherPerson, role },
        learner,
        courseId,
        scopeId,
        conversationId,
      };
    }

    return {
      messaging,
      identity,
      databaseUrl,
      person,
      people,
      async activate() {
        await activateLive(admin, 'fixture');
        await activateMessaging(admin, 'teacher-student');
        await activateMessaging(admin, 'support');
      },
      async pair(label) {
        return pairFor(await person(`${label}-learner`), label);
      },
      pairFor,
      close: () => messaging.close(),
    };
  } catch (error) {
    await messaging.close();
    throw error;
  }
}

/** A body no real message could be mistaken for. */
export const body = (label: string) => sentinel('REALTIME_BODY', label);

/** Rows in one table matching a condition, read on the owner session. */
export async function rows(
  world: RealtimeWorld,
  table: string,
  where: string,
): Promise<number> {
  const [row] = await world.messaging.db.admin.query<{ total: number }>(
    `SELECT COUNT(*) AS [total] FROM [dbo].[${table}] WHERE ${where};`,
  );
  return row?.total ?? 0;
}

/** Messages in one conversation. */
export const messagesIn = (world: RealtimeWorld, conversationId: string) =>
  rows(world, 'Message', `[conversationId] = ${n(conversationId)}`);
