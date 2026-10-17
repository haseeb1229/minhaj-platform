import 'server-only';

import type { MessagingActor } from '@minhaj/contracts/messaging';

import type { Connection } from './connection.ts';

/**
 * Telling other sockets something — each one decided for its own person, now.
 *
 * ROOM MEMBERSHIP IS A MAILING LIST, NOT A PERMISSION. A socket is in a room
 * because it once subscribed; that proves nothing about now. So before
 * anything reaches a member:
 *
 *   1. its OWN cookie is re-resolved — a member whose session ended, or now
 *      names another account, is disconnected and told nothing;
 *   2. Messaging decides for that member's account, fresh (`deliveryFor` for a
 *      message, `mayObserve` for presence and typing) — `null` means nothing
 *      is sent, whatever the room says;
 *   3. it must still be connected and still following the conversation once
 *      those answers arrive.
 *
 * ONE DECISION PER ACCOUNT PER FAN-OUT. Several tabs of one person share the
 * answer for that one fan-out — the same person, the same instant — and no
 * decision outlives it: the next fan-out asks again.
 *
 * FAILURE IS CONTAINED. A decision that throws, or an emit that fails, skips
 * that recipient only; it never reaches the caller, so it can never undo or
 * misreport what was already committed. A recipient who misses something
 * recovers it by durable catch-up.
 */

export interface Audience {
  readonly conversationId: string;
  /** The connection that caused this fan-out; it is answered by its ack instead. */
  readonly exceptConnection?: Connection;
  /** Presence and typing describe this account, so none of its own tabs is told. */
  readonly exceptAccount?: string;
}

export interface FanOutResult {
  readonly recipients: number;
  readonly delivered: number;
}

export interface FanOutHost {
  members(conversationId: string): readonly Connection[];
  signOut(connection: Connection): void;
}

export async function fanOut<T>(
  host: FanOutHost,
  audience: Audience,
  decide: (recipient: MessagingActor) => Promise<T | null>,
  deliver: (connection: Connection, value: T) => void,
): Promise<FanOutResult> {
  const targets = host
    .members(audience.conversationId)
    .filter(
      (member) =>
        member !== audience.exceptConnection &&
        member.actor.accountId !== audience.exceptAccount,
    );
  const decisions = new Map<string, Promise<T | null>>();

  function decisionFor(actor: MessagingActor): Promise<T | null> {
    let decision = decisions.get(actor.accountId);
    if (decision === undefined) {
      // Copied: `decide` is handed a fresh actor, never the connection's own object.
      decision = decide({ accountId: actor.accountId }).catch(() => null);
      decisions.set(actor.accountId, decision);
    }
    return decision;
  }

  async function reach(target: Connection): Promise<boolean> {
    let signedIn: boolean;
    try {
      signedIn = await target.stillSignedIn();
    } catch {
      // Identity could not answer: fail closed for this recipient, but do not
      // disconnect a person over an outage that is not theirs.
      return false;
    }
    if (!signedIn) {
      host.signOut(target);
      return false;
    }
    const value = await decisionFor(target.actor);
    if (value === null) return false;
    if (!target.socket.connected || !target.subscriptions.has(audience.conversationId)) {
      return false;
    }
    try {
      deliver(target, value);
      return true;
    } catch {
      return false;
    }
  }

  const outcomes = await Promise.all(targets.map(reach));
  return {
    recipients: targets.length,
    delivered: outcomes.filter(Boolean).length,
  };
}
