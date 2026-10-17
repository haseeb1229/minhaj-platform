import { closeSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  httpGet,
  recordedRealtimePid,
  recordRealtimeProcess,
  spawnRealtime,
  stopOwnRealtime,
  waitForStatus,
} from '../../scripts/shared/realtime-harness.mjs';
import { browserEnvironment } from './support.ts';

/**
 * Stopping and restarting the browser run's REAL realtime process (Phase 25).
 *
 * WHY A SPEC NEEDS THIS. Two Phase-25 claims are about the process being
 * absent: Messaging keeps working without it (send and history are the web's
 * own Server Actions over the same service), and nothing is lost — a page that
 * reconnects after a restart catches up from the durable sequence. Neither can
 * be shown without actually stopping the process the page was connected to.
 *
 * THE SAME PROCESS, AGAIN. A restart runs the same composition entry with the
 * environment `scripts/browser-server.mjs` recorded — the same database, the
 * same secrets, the same internal address and port — so NGINX, which still
 * routes `/socket.io/` there, reaches the new process with no change. The new
 * PID replaces the old one in the run's process file, which is what the
 * server's cleanup and the global teardown stop.
 *
 * ONE SPEC AT A TIME. These act on the run's one shared process. A spec that
 * stops it must restart it before it finishes, and specs that do so must not
 * run concurrently with each other.
 */

interface RealtimeRecord {
  readonly host: string;
  readonly port: number;
  readonly marker: string;
  readonly environment: Record<string, string>;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');

/** A restarted process outlives the worker that started it; its output goes here. */
const RESTART_LOG = path.join(repoRoot, 'test-results', 'browser-realtime-restart.log');

function record(): RealtimeRecord {
  const realtime = (browserEnvironment() as unknown as { realtime?: RealtimeRecord })
    .realtime;
  if (realtime === undefined) {
    throw new Error('The browser environment records no realtime process.');
  }
  return realtime;
}

const probe = (realtime: RealtimeRecord, path: string) =>
  `http://${realtime.host}:${String(realtime.port)}${path}`;

/** Is the run's realtime process up and accepting sockets? */
export async function isRealtimeRunning(): Promise<boolean> {
  try {
    return (await httpGet(probe(record(), '/readyz'))).status === 200;
  } catch {
    return false;
  }
}

/**
 * Stops the run's realtime process (SIGTERM, then SIGKILL past its grace) and
 * waits until nothing answers on its port.
 */
export async function stopRealtime(): Promise<void> {
  const realtime = record();
  const pid = recordedRealtimePid();
  if (pid !== null) await stopOwnRealtime(pid, realtime.marker);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (!(await isRealtimeRunning())) return;
    await new Promise((resolve) => {
      setTimeout(resolve, 100);
    });
  }
  throw new Error('The realtime process still answers after it was stopped.');
}

/**
 * Starts the run's realtime process again — same entry, same environment, same
 * port — and waits for `/readyz`.
 */
export async function startRealtime(): Promise<void> {
  const realtime = record();
  if (await isRealtimeRunning()) {
    throw new Error('The realtime process is already running.');
  }

  mkdirSync(path.dirname(RESTART_LOG), { recursive: true });
  const log = openSync(RESTART_LOG, 'a');
  try {
    const child = spawnRealtime({
      marker: realtime.marker,
      environment: { ...process.env, ...realtime.environment },
      stdio: ['ignore', log, log],
      detached: true,
    });
    recordRealtimeProcess(child.pid);
    // The worker may finish before the process does; the run's teardown owns it.
    child.unref();
  } finally {
    closeSync(log);
  }

  await waitForStatus(probe(realtime, '/readyz'), 200, 120_000);
}
