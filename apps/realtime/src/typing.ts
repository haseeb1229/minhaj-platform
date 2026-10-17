import 'server-only';

/**
 * Who is typing where — ephemeral, self-expiring transport state
 * (SECURITY_BASELINE.md §12.4: typing state is never persisted).
 *
 * WHAT IS HELD. conversation → account → connection → the instant that
 * connection's signal lapses. An account is typing in a conversation while any
 * of its connections holds an unexpired signal; the caller is told only of
 * TRANSITIONS of that account-level state, so a second tab starting to type
 * says nothing new and the last signal lapsing says "stopped".
 *
 * NO TEXT, EVER. The registry stores identifiers and instants. A draft or a
 * body is never handed to it, so none can leak from it.
 *
 * EXPIRY. A signal lasts `ttlMs` unless renewed. Expiry is decided against the
 * injected clock — not wall time — so a test advances time instead of
 * sleeping; a sweep runs every `sweepMs` while anything is held, and stops
 * when nothing is. Its timer is `unref`'d so a lingering signal never keeps
 * the process alive.
 */

export interface TypingRegistry {
  /** Starts or renews a signal; `true` when the account has just started typing here. */
  start(conversationId: string, accountId: string, connectionId: string): boolean;
  /** Ends a signal; `true` when the account has just stopped typing here. */
  stop(conversationId: string, accountId: string, connectionId: string): boolean;
  clear(): void;
}

export interface TypingRegistryOptions {
  readonly now: () => number;
  readonly ttlMs: number;
  readonly sweepMs: number;
  /** Called when a lapsed signal leaves an account no longer typing. */
  readonly onLapse: (conversationId: string, accountId: string) => void;
}

export function createTypingRegistry(options: TypingRegistryOptions): TypingRegistry {
  const conversations = new Map<string, Map<string, Map<string, number>>>();
  let sweeper: NodeJS.Timeout | null = null;

  function stopSweeping(): void {
    if (sweeper !== null) clearInterval(sweeper);
    sweeper = null;
  }

  function sweep(): void {
    const current = options.now();
    const lapsed: [string, string][] = [];
    for (const [conversationId, accounts] of conversations) {
      for (const [accountId, connections] of accounts) {
        for (const [connectionId, expiresAt] of connections) {
          if (expiresAt <= current) connections.delete(connectionId);
        }
        if (connections.size === 0) {
          accounts.delete(accountId);
          lapsed.push([conversationId, accountId]);
        }
      }
      if (accounts.size === 0) conversations.delete(conversationId);
    }
    if (conversations.size === 0) stopSweeping();
    for (const [conversationId, accountId] of lapsed) {
      options.onLapse(conversationId, accountId);
    }
  }

  return {
    start(conversationId, accountId, connectionId) {
      let accounts = conversations.get(conversationId);
      if (accounts === undefined) {
        accounts = new Map();
        conversations.set(conversationId, accounts);
      }
      let connections = accounts.get(accountId);
      if (connections === undefined) {
        connections = new Map();
        accounts.set(accountId, connections);
      }
      const wasTyping = connections.size > 0;
      connections.set(connectionId, options.now() + options.ttlMs);
      if (sweeper === null) {
        sweeper = setInterval(sweep, options.sweepMs);
        sweeper.unref();
      }
      return !wasTyping;
    },

    stop(conversationId, accountId, connectionId) {
      const accounts = conversations.get(conversationId);
      const connections = accounts?.get(accountId);
      if (accounts === undefined || connections === undefined) return false;
      if (!connections.delete(connectionId)) return false;
      if (connections.size > 0) return false;
      accounts.delete(accountId);
      if (accounts.size === 0) conversations.delete(conversationId);
      if (conversations.size === 0) stopSweeping();
      return true;
    },

    clear() {
      conversations.clear();
      stopSweeping();
    },
  };
}
