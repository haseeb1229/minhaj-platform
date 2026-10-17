import 'server-only';

import { realtimeAddressFrom, startRealtimeServer } from '@minhaj/realtime';
import { createLogger } from '@minhaj/server-core/logger';

import { composeRealtime } from './realtime.ts';

/**
 * The realtime PROCESS entry (Phase 25): compose, start the transport, and own
 * the process lifecycle.
 *
 * Run as `node --conditions=react-server apps/web/src/composition/realtime-main.ts`
 * (`npm run realtime:start`). The `react-server` condition is what admits the
 * `server-only` markers every server module carries; nothing here weakens them.
 *
 * FAIL FAST. Configuration is validated before a port is bound, so a bad
 * environment is a process that exits, not one that listens and refuses
 * everyone (SECURITY_BASELINE.md §18.1).
 *
 * SHUTDOWN. SIGTERM and SIGINT close the transport: no new connection is
 * accepted, ephemeral presence and typing are discarded, in-flight sends are
 * given the transport's bounded grace to commit, and the process then exits.
 * Nothing durable lives here, so nothing is lost by stopping.
 */

const composition = composeRealtime();
const logger = createLogger({
  level: composition.environment.LOG_LEVEL,
  nodeEnv: composition.environment.NODE_ENV,
});

const server = await startRealtimeServer({
  session: composition.session,
  messaging: composition.messaging,
  allowedOrigin: new URL(composition.environment.AUTH_BASE_URL).origin,
  ...realtimeAddressFrom(process.env),
  logger,
});

logger.info(
  { operation: 'realtime-start', port: server.port },
  'Realtime transport listening.',
);

let stopping = false;
async function stop(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ operation: 'realtime-stop', signal }, 'Realtime transport stopping.');
  try {
    await server.close();
    process.exit(0);
  } catch {
    logger.error(
      { operation: 'realtime-stop' },
      'Realtime transport did not close cleanly.',
    );
    process.exit(1);
  }
}

process.on('SIGTERM', () => void stop('SIGTERM'));
process.on('SIGINT', () => void stop('SIGINT'));
