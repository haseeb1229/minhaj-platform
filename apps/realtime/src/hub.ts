import 'server-only';

import {
  REALTIME_LIMITS,
  REALTIME_SERVER_EVENTS,
  toRealtimeMessage,
  type RealtimeMessageCreated,
  type RealtimePresenceChanged,
  type RealtimeTypingChanged,
} from '@minhaj/contracts/messaging';
import type { RealtimeMessaging } from '@minhaj/server-core/messaging';
import type { Server } from 'socket.io';

import { roomOf, type Connection } from './connection.ts';
import { fanOut, type Audience, type FanOutResult } from './fan-out.ts';
import { elapsedSince, type TransportLog } from './logging.ts';
import { createPresenceRegistry } from './presence.ts';
import { createTypingRegistry } from './typing.ts';

/**
 * The transport's live state and everything that tells sockets about it.
 *
 * OWNS ONLY EPHEMERA. Which connections exist, which conversations each
 * follows, who is present and who is typing — all in memory, all discarded on
 * close, none of it persisted and none of it authority. Every outbound frame
 * is decided by Messaging for its recipient at the moment of sending
 * (`fan-out.ts`).
 *
 * TRACKED WORK. Everything the transport starts on a connection's behalf —
 * each event and each fan-out — is registered with `track`, so `close()` can
 * give in-flight sends their bounded grace to commit and answer.
 */

/** How often lapsed typing signals are swept; expiry itself is decided by the clock. */
const TYPING_SWEEP_MS = 1_000;

export interface HubOptions {
  readonly io: Server;
  readonly messaging: RealtimeMessaging;
  readonly now: () => number;
  readonly log: TransportLog;
}

export interface Hub {
  readonly messaging: RealtimeMessaging;
  register(connection: Connection): void;
  /** Disconnects a connection whose session no longer holds. */
  signOut(connection: Connection): void;
  /** Starts following; presence is announced when the account has just come online. */
  follow(connection: Connection, conversationId: string): void;
  /** Stops following; presence and typing are withdrawn as they lapse. */
  unfollow(connection: Connection, conversationId: string): void;
  /** Is the other person here, AND may this connection's person be told so now? */
  counterpartOnline(connection: Connection, conversationId: string): Promise<boolean>;
  startTyping(connection: Connection, conversationId: string): void;
  stopTyping(connection: Connection, conversationId: string): void;
  /** Delivers a committed message to every other member allowed to receive it. */
  deliver(
    connection: Connection,
    conversationId: string,
    sequence: number,
  ): Promise<void>;
  /** A connection has gone: withdraw everything it held. */
  drop(connection: Connection): void;
  track(work: Promise<unknown>): void;
  /** Resolves when tracked work has settled, or after `graceMs`, whichever is first. */
  settle(graceMs: number): Promise<void>;
  /** Stop announcing anything, and forget all presence and typing. */
  quiesce(): void;
}

export function createHub(options: HubOptions): Hub {
  const { io, messaging } = options;
  const connections = new Map<string, Connection>();
  const inFlight = new Set<Promise<unknown>>();
  let quiet = false;

  const presence = createPresenceRegistry();
  const typing = createTypingRegistry({
    now: options.now,
    ttlMs: REALTIME_LIMITS.typingTtlMs,
    sweepMs: TYPING_SWEEP_MS,
    onLapse: (conversationId, accountId) => {
      announceTyping(options.log, conversationId, accountId, false);
    },
  });

  const host = {
    members(conversationId: string): readonly Connection[] {
      const socketIds = io.sockets.adapter.rooms.get(roomOf(conversationId));
      if (socketIds === undefined) return [];
      const members: Connection[] = [];
      for (const socketId of socketIds) {
        const member = connections.get(socketId);
        if (member !== undefined) members.push(member);
      }
      return members;
    },
    signOut(connection: Connection): void {
      connection.log('info', { operation: 'session', outcome: 'signed-out' });
      connection.socket.disconnect(true);
    },
  };

  function track(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    inFlight.add(settled);
    void settled.then(() => inFlight.delete(settled));
  }

  function logFanOut(
    log: TransportLog,
    operation: string,
    startedAt: number,
    result: FanOutResult,
  ): void {
    log('debug', {
      operation,
      outcome: 'done',
      recipients: result.recipients,
      delivered: result.delivered,
      durationMs: elapsedSince(startedAt),
    });
  }

  /** Tells the OTHER people in a conversation that `accountId` came or went. */
  function announcePresence(
    log: TransportLog,
    conversationId: string,
    accountId: string,
    online: boolean,
  ): void {
    if (quiet) return;
    const startedAt = performance.now();
    const audience: Audience = { conversationId, exceptAccount: accountId };
    const payload: RealtimePresenceChanged = { conversationId, online };
    track(
      fanOut(
        host,
        audience,
        async (recipient) =>
          (await messaging.mayObserve(recipient, conversationId)) ? payload : null,
        (target, value) => {
          target.socket.emit(REALTIME_SERVER_EVENTS.presenceChanged, value);
        },
      ).then((result) => logFanOut(log, 'fan-out:presence', startedAt, result)),
    );
  }

  /** Tells the OTHER people in a conversation that `accountId` started or stopped typing. */
  function announceTyping(
    log: TransportLog,
    conversationId: string,
    accountId: string,
    isTyping: boolean,
  ): void {
    if (quiet) return;
    const startedAt = performance.now();
    const audience: Audience = { conversationId, exceptAccount: accountId };
    // Exactly two fields: a typing signal never carries text.
    const payload: RealtimeTypingChanged = { conversationId, typing: isTyping };
    track(
      fanOut(
        host,
        audience,
        async (recipient) =>
          (await messaging.mayObserve(recipient, conversationId)) ? payload : null,
        (target, value) => {
          target.socket.emit(REALTIME_SERVER_EVENTS.typingChanged, value);
        },
      ).then((result) => logFanOut(log, 'fan-out:typing', startedAt, result)),
    );
  }

  function stopTyping(connection: Connection, conversationId: string): void {
    if (typing.stop(conversationId, connection.actor.accountId, connection.id)) {
      announceTyping(connection.log, conversationId, connection.actor.accountId, false);
    }
  }

  function unfollow(connection: Connection, conversationId: string): void {
    if (!connection.subscriptions.delete(conversationId)) return;
    if (connection.socket.connected) void connection.socket.leave(roomOf(conversationId));
    stopTyping(connection, conversationId);
    if (presence.leave(conversationId, connection.actor.accountId, connection.id)) {
      announcePresence(connection.log, conversationId, connection.actor.accountId, false);
    }
  }

  return {
    messaging,

    register(connection) {
      connections.set(connection.socket.id, connection);
    },

    signOut: host.signOut,

    follow(connection, conversationId) {
      if (connection.subscriptions.has(conversationId)) return;
      connection.subscriptions.add(conversationId);
      void connection.socket.join(roomOf(conversationId));
      if (presence.join(conversationId, connection.actor.accountId, connection.id)) {
        announcePresence(
          connection.log,
          conversationId,
          connection.actor.accountId,
          true,
        );
      }
    },

    unfollow,

    async counterpartOnline(connection, conversationId) {
      if (!presence.othersOnline(conversationId, connection.actor.accountId))
        return false;
      // An outage answers "not online": presence is a courtesy, never worth a refusal.
      return messaging
        .mayObserve({ accountId: connection.actor.accountId }, conversationId)
        .catch(() => false);
    },

    startTyping(connection, conversationId) {
      if (typing.start(conversationId, connection.actor.accountId, connection.id)) {
        announceTyping(connection.log, conversationId, connection.actor.accountId, true);
      }
    },

    stopTyping,

    async deliver(connection, conversationId, sequence) {
      const startedAt = performance.now();
      const result = await fanOut(
        host,
        // The sender's OTHER tabs are members like anyone else; only the
        // sending connection is left out, because its ack already answered it.
        { conversationId, exceptConnection: connection },
        (recipient) => messaging.deliveryFor(recipient, conversationId, sequence),
        (target, view) => {
          const frame: RealtimeMessageCreated = {
            conversationId,
            message: toRealtimeMessage(view),
          };
          target.socket.emit(REALTIME_SERVER_EVENTS.messageCreated, frame);
        },
      );
      logFanOut(connection.log, 'fan-out:message', startedAt, result);
    },

    drop(connection) {
      for (const conversationId of [...connection.subscriptions]) {
        unfollow(connection, conversationId);
      }
      connections.delete(connection.socket.id);
    },

    track,

    async settle(graceMs) {
      if (inFlight.size === 0) return;
      let timer: NodeJS.Timeout | undefined;
      const grace = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
        timer.unref();
      });
      // Work tracked while waiting (an ack's fan-out) is waited for too.
      const drained = (async () => {
        while (inFlight.size > 0) await Promise.all([...inFlight]);
      })();
      await Promise.race([drained, grace]);
      clearTimeout(timer);
    },

    quiesce() {
      quiet = true;
      typing.clear();
      presence.clear();
    },
  };
}
