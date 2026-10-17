import 'server-only';

import type { SessionOutcome } from '@minhaj/contracts/identity';
import type { Logger } from '@minhaj/server-core/logger';
import type { RealtimeMessaging } from '@minhaj/server-core/messaging';

/**
 * The transport's public shapes (Phase 25).
 *
 * WHAT IS INJECTED IS ALL IT HOLDS. The realtime process is a transport
 * adapter: it is handed a session resolver and the Messaging facade by its
 * Layer-4 composition root (`apps/web/src/composition/realtime.ts`) and holds
 * nothing else — no database, no persistence adapter, no Identity mechanics,
 * no rule (ARCHITECTURE.md §3.1 rule 1, §3.1.2).
 */

/**
 * Identity's ONE session decision, as the transport may ask it.
 *
 * The composition root passes the server-core `SessionService`, so a cookie
 * this process accepts is exactly a cookie the web process accepts, and an
 * account that is disabled, suspended or closed is refused here on the very
 * next event, as it is there on the very next request.
 */
export interface RealtimeSessionPort {
  resolve(headers: Headers): Promise<SessionOutcome>;
}

export interface RealtimeServerOptions {
  readonly session: RealtimeSessionPort;
  readonly messaging: RealtimeMessaging;
  /** The ONE origin a browser connection may come from — exact `scheme://host[:port]`. */
  readonly allowedOrigin: string;
  readonly host: string;
  /** `0` binds an ephemeral port (tests); `RealtimeServer.port` reports it. */
  readonly port: number;
  readonly logger: Logger;
  /** How long `close()` waits for in-flight work, in milliseconds. Default 5,000. */
  readonly shutdownGraceMs?: number;
  /** The clock budgets and typing expiry read. Injectable so a test needs no sleep. */
  readonly now?: () => number;
}

export interface RealtimeServer {
  /** The bound port — the ephemeral one when `0` was asked for. */
  readonly port: number;
  /**
   * Stop accepting, let in-flight work finish within the grace, drop every
   * connection and all presence and typing, and release the port. Idempotent.
   */
  close(): Promise<void>;
}
