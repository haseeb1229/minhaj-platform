import 'server-only';

import { withContext, type Logger } from '@minhaj/server-core/logger';

/**
 * What the transport writes to its log — and, by construction, what it cannot.
 *
 * One shape for every line: the operation, its outcome category, and counts
 * and durations. The connection's correlation id is bound once, as child
 * context, through the platform's allowlisting `withContext`. There is no field
 * for a cookie, a header, a token, a body, a name, an address, a filename or a
 * payload, so a call site cannot pass one by accident (SECURITY_BASELINE.md
 * §19.2); the platform logger's own sanitiser still runs beneath this as a
 * second layer.
 */

export interface TransportLogEntry {
  readonly operation: string;
  readonly outcome: string;
  readonly durationMs?: number;
  readonly recipients?: number;
  readonly delivered?: number;
  readonly subscriptions?: number;
}

export type TransportLog = (
  level: 'debug' | 'info' | 'warn',
  entry: TransportLogEntry,
) => void;

/** A log bound to one connection's correlation id (or to the process, without one). */
export function transportLog(base: Logger, correlationId?: string): TransportLog {
  const logger = withContext(
    base,
    correlationId === undefined
      ? { component: 'realtime' }
      : { component: 'realtime', correlationId },
  );
  return (level, entry) => {
    logger[level]({ ...entry }, 'realtime');
  };
}

/** Whole milliseconds since `startedAt` on the monotonic clock. */
export function elapsedSince(startedAt: number): number {
  return Math.round(performance.now() - startedAt);
}
