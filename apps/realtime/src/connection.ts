import 'server-only';

import type { MessagingActor } from '@minhaj/contracts/messaging';
import type { Socket } from 'socket.io';

import type { ConnectionBudget } from './budgets.ts';
import type { TransportLog } from './logging.ts';

/**
 * One authenticated socket, as the transport tracks it.
 *
 * `actor` is the account the HANDSHAKE resolved; it is never taken from the
 * client and never changes. Every event asks `stillSignedIn` again before any
 * work, and a different answer — signed out, disabled, suspended, closed, or a
 * cookie that now names someone else — ends the connection.
 *
 * `id` is a random correlation id minted at the handshake: it keys this
 * connection's presence and typing entries and is the only identifier the
 * transport logs. It is not the Socket.IO id and it carries no meaning.
 */
export interface Connection {
  readonly id: string;
  readonly socket: Socket;
  readonly actor: MessagingActor;
  readonly budget: ConnectionBudget;
  /** Conversations this connection follows; bounded by REALTIME_LIMITS. */
  readonly subscriptions: Set<string>;
  readonly log: TransportLog;
  /** Is the SAME account still signed in with this connection's cookie? Throws on an outage. */
  stillSignedIn(): Promise<boolean>;
}

/** The transport's internal room for a conversation. Membership never authorises. */
export function roomOf(conversationId: string): string {
  return `conversation:${conversationId}`;
}
