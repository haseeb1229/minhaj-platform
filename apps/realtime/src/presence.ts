import 'server-only';

/**
 * Who is connected to which conversation — ephemeral transport state.
 *
 * WHAT IT IS. conversation → account → the connections of that account
 * currently subscribed to it. An account is "online" in a conversation while
 * it has at least one such connection, so a second tab keeps it online when
 * the first closes, and the last one leaving takes it offline.
 *
 * WHAT IT IS NOT. Not a directory: there is no "who is online anywhere", no
 * last-seen, no history. Not durable: it lives in this process's memory,
 * starts empty, and is discarded on close — a restart forgets everyone, and
 * the next subscription rebuilds it. Not authority: being present grants
 * nothing; whether anyone may be TOLD is Messaging's `mayObserve`, asked fresh
 * by the caller before every notification.
 *
 * Bounded by what admits entries: one per subscribed connection, and a
 * connection's subscriptions are capped (REALTIME_LIMITS).
 */

export interface PresenceRegistry {
  /** Records a subscription; `true` when the account has just come online here. */
  join(conversationId: string, accountId: string, connectionId: string): boolean;
  /** Removes one; `true` when the account has just gone offline here. */
  leave(conversationId: string, accountId: string, connectionId: string): boolean;
  /** Does some account OTHER than `accountId` have a live connection here? */
  othersOnline(conversationId: string, accountId: string): boolean;
  clear(): void;
}

export function createPresenceRegistry(): PresenceRegistry {
  const conversations = new Map<string, Map<string, Set<string>>>();

  return {
    join(conversationId, accountId, connectionId) {
      let accounts = conversations.get(conversationId);
      if (accounts === undefined) {
        accounts = new Map();
        conversations.set(conversationId, accounts);
      }
      let connections = accounts.get(accountId);
      if (connections === undefined) {
        connections = new Set();
        accounts.set(accountId, connections);
      }
      const wasOnline = connections.size > 0;
      connections.add(connectionId);
      return !wasOnline;
    },

    leave(conversationId, accountId, connectionId) {
      const accounts = conversations.get(conversationId);
      const connections = accounts?.get(accountId);
      if (accounts === undefined || connections === undefined) return false;
      if (!connections.delete(connectionId)) return false;
      if (connections.size > 0) return false;
      accounts.delete(accountId);
      if (accounts.size === 0) conversations.delete(conversationId);
      return true;
    },

    othersOnline(conversationId, accountId) {
      const accounts = conversations.get(conversationId);
      if (accounts === undefined) return false;
      for (const [other, connections] of accounts) {
        if (other !== accountId && connections.size > 0) return true;
      }
      return false;
    },

    clear() {
      conversations.clear();
    },
  };
}
