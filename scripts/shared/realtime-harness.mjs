/**
 * The realtime process and the NGINX front door, as test harnesses run them
 * (Phase 25).
 *
 * Shared by the browser suite's server (`scripts/browser-server.mjs`), its
 * teardown and spec controls (`tests/browser/`), and the real-process proofs
 * (`tests/realtime/`), so there is ONE way a proof starts the realtime
 * process, ONE way it stands NGINX in front of it, and ONE way either is
 * stopped and proved gone.
 *
 * THE REAL THINGS. The realtime process is started from its composition entry
 * exactly as `npm run realtime:start` starts it; NGINX is the pinned image
 * rendering the repository's own template. Nothing here is a stand-in.
 *
 * REACHING HOST PROCESSES FROM THE CONTAINER. Through Docker's `host-gateway`
 * — never host networking. Docker Desktop forwards it to the host's loopback,
 * so host processes bind `127.0.0.1`; on Linux it is the default bridge's
 * gateway, so host processes bind THAT address (reachable from containers and
 * the host, not from the network) rather than every interface.
 *
 * ONE IPv4 ADDRESS, NAMED. Docker Desktop also resolves `host.docker.internal`
 * to an IPv6 address the container cannot route. NGINX treats every address a
 * name resolves to as a separate upstream peer, so it alternated onto the dead
 * one and answered 502 once both peers had been marked failed. The gateway's
 * IPv4 address is therefore resolved ONCE, by the pinned image itself, and
 * handed to the proxy under a name of its own.
 *
 * STOPPING IS PROVED, NOT ASSUMED (SECURITY_BASELINE.md §18.2 discipline). A
 * process is signalled only after its command line is positively shown to
 * carry this run's marker — a recorded PID may since belong to anything — and
 * a container only when its name is in the generated namespace. Absence is
 * then confirmed by a probe whose failure is a failure, never a pass.
 */

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The proxy image, pinned by digest — the same one Compose and CI run. */
export const NGINX_IMAGE =
  'nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5';

/** The repository's NGINX templates, rendered by the image at start. */
export const NGINX_TEMPLATES = path.join(repoRoot, 'docker', 'nginx', 'templates');

/** The realtime PROCESS entry — the composition root, not the transport. */
export const REALTIME_ENTRY = path.join(
  repoRoot,
  'apps',
  'web',
  'src',
  'composition',
  'realtime-main.ts',
);

/** Generated proxy container names; nothing outside this namespace is removed. */
const CONTAINER_NAME = /^minhaj-(?:browser|realtime-proof)-proxy-[0-9a-f]{12}$/u;

/** Generated process markers; a process is signalled only when it carries one. */
const PROCESS_MARKER = /^minhaj-(?:browser|realtime-proof)-realtime-[0-9a-f]{12}$/u;

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/**
 * The address host processes bind so the proxy container can reach them.
 *
 * Fails closed on Linux: without the bridge gateway there is no safe address
 * to bind, and binding every interface instead would be the wrong fix.
 */
export function upstreamBindAddress() {
  if (process.platform !== 'linux') return '127.0.0.1';

  const result = spawnSync(
    'docker',
    ['network', 'inspect', 'bridge', '--format', '{{(index .IPAM.Config 0).Gateway}}'],
    { encoding: 'utf8' },
  );
  const address = (result.stdout ?? '').trim();
  if (result.status !== 0 || !/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(address)) {
    throw new Error('Could not determine the Docker bridge gateway address.');
  }
  return address;
}

/** A port free on `host` at this moment. */
export function freePort(host) {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      server.close(() => {
        if (address === null || typeof address === 'string') {
          reject(new Error('No port was assigned.'));
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

/** One plain HTTP GET; resolves `{ status, body }`, rejects on a transport error. */
export function httpGet(url, headers = {}, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = request(
      {
        host: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers,
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        response.on('error', reject);
      },
    );
    outgoing.on('timeout', () => outgoing.destroy(new Error('timed out')));
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Polls until `url` answers `status`, or fails after `timeoutMs`. */
export async function waitForStatus(url, status, timeoutMs, headers = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no answer';
  while (Date.now() < deadline) {
    try {
      const response = await httpGet(url, headers);
      if (response.status === status) return;
      last = `HTTP ${String(response.status)}`;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await pause(150);
  }
  throw new Error(`${url} did not answer ${String(status)} in time (last: ${last}).`);
}

/* ===========================================================================
 * The realtime process
 * ========================================================================= */

/** A fresh marker for one realtime process. */
export function realtimeMarker(kind, suffix) {
  const marker = `minhaj-${kind}-realtime-${suffix}`;
  if (!PROCESS_MARKER.test(marker)) throw new Error('Invalid realtime process marker.');
  return marker;
}

/**
 * Starts the REAL realtime process from its composition entry.
 *
 * `--title` carries the marker into the process's command line, which is what
 * a later stop positively checks before signalling anything.
 */
export function spawnRealtime({
  marker,
  environment,
  stdio = 'inherit',
  detached = false,
}) {
  if (!PROCESS_MARKER.test(marker)) throw new Error('Invalid realtime process marker.');
  return spawn(
    process.execPath,
    ['--conditions=react-server', `--title=${marker}`, REALTIME_ENTRY],
    {
      cwd: repoRoot,
      env: environment,
      stdio,
      detached,
      windowsHide: true,
    },
  );
}

/**
 * The command line of `pid`, or `null` when no such process exists.
 *
 * Throws when the platform's process table cannot be read: an inspection
 * that failed is not evidence that the process is gone.
 */
function commandLineOf(pid) {
  // The operating system's own answer first: no such process is conclusive.
  // EPERM means it exists (as someone else's), so its command line decides.
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === 'ESRCH') return null;
    if (error?.code !== 'EPERM') throw error;
  }

  if (process.platform === 'linux') {
    try {
      return readFileSync(`/proc/${String(pid)}/cmdline`, 'utf8').replaceAll('\0', ' ');
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ESRCH') return null;
      throw error;
    }
  }

  if (process.platform === 'win32') {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${String(pid)}"; ` +
          `if ($null -eq $p) { 'PROCESS_ABSENT' } else { 'PROCESS_PRESENT ' + $p.CommandLine }`,
      ],
      { encoding: 'utf8', windowsHide: true },
    );
    const output = (result.stdout ?? '').trim();
    if (result.status !== 0) throw new Error('The process table could not be read.');
    if (output === 'PROCESS_ABSENT') return null;
    if (output.startsWith('PROCESS_PRESENT'))
      return output.slice('PROCESS_PRESENT'.length);
    throw new Error('The process table gave no conclusive answer.');
  }

  const result = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], {
    encoding: 'utf8',
  });
  if (result.status === 1 && (result.stdout ?? '').trim() === '') return null;
  if (result.status !== 0) throw new Error('The process table could not be read.');
  return result.stdout;
}

/** Is `pid` alive AND positively this run's realtime process? */
export function isOwnRealtime(pid, marker) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (!PROCESS_MARKER.test(marker)) throw new Error('Invalid realtime process marker.');
  const commandLine = commandLineOf(pid);
  return commandLine !== null && commandLine.includes(marker);
}

/**
 * Stops this run's realtime process at `pid`, and proves it gone.
 *
 * `SIGTERM` first, so the transport runs its own bounded shutdown; then
 * `SIGKILL` if it outlives `graceMs`. A PID that is not (or no longer) the
 * marked process is left alone. Throws if the process is still present at the
 * end — a stop that did not stop must not read as done.
 */
export async function stopOwnRealtime(
  pid,
  marker,
  { signal = 'SIGTERM', graceMs = 10_000 } = {},
) {
  if (!isOwnRealtime(pid, marker)) return;

  try {
    process.kill(pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }

  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!isOwnRealtime(pid, marker)) return;
    await pause(100);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
  const killDeadline = Date.now() + 5_000;
  while (Date.now() < killDeadline) {
    if (!isOwnRealtime(pid, marker)) return;
    await pause(100);
  }
  throw new Error('The realtime process could not be stopped.');
}

/**
 * Where the browser run records its CURRENT realtime PID. A spec may stop and
 * restart the process (`tests/browser/realtime-control.ts`), so the PID is
 * not a fact of the run the way the database name is: it lives in its own
 * file, replaced atomically, and every stop reads it from here.
 */
export const BROWSER_REALTIME_PROCESS_FILE = path.join(
  repoRoot,
  'test-results',
  'browser-realtime.json',
);

/** Records the browser run's current realtime PID, atomically. */
export function recordRealtimeProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('No realtime PID to record.');
  const staging = `${BROWSER_REALTIME_PROCESS_FILE}.${String(process.pid)}.tmp`;
  writeFileSync(staging, `${JSON.stringify({ pid })}\n`, 'utf8');
  renameSync(staging, BROWSER_REALTIME_PROCESS_FILE);
}

/** The recorded PID, or `null` when none is recorded. */
export function recordedRealtimePid() {
  let source;
  try {
    source = readFileSync(BROWSER_REALTIME_PROCESS_FILE, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  const pid = JSON.parse(source).pid;
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error('The recorded realtime PID is invalid.');
  return pid;
}

/* ===========================================================================
 * The NGINX front door
 * ========================================================================= */

/** The name the proxy container reaches host processes by. */
const HOST_ALIAS = 'minhaj-host-gateway';

let gatewayAddress = null;

/** The host gateway's IPv4 address, as a container on the default bridge sees it. */
function hostGatewayIPv4() {
  if (gatewayAddress !== null) return gatewayAddress;
  const result = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '--add-host',
      'host.docker.internal:host-gateway',
      NGINX_IMAGE,
      'getent',
      'ahostsv4',
      'host.docker.internal',
    ],
    { encoding: 'utf8', windowsHide: true },
  );
  const address = /^(\d{1,3}(?:\.\d{1,3}){3})\s/mu.exec(result.stdout ?? '')?.[1];
  if (result.status !== 0 || address === undefined) {
    throw new Error('Could not resolve the Docker host gateway IPv4 address.');
  }
  gatewayAddress = address;
  return address;
}

/** A fresh, generated proxy container name. */
export function frontDoorName(kind, suffix) {
  const name = `minhaj-${kind}-proxy-${suffix}`;
  if (!CONTAINER_NAME.test(name)) throw new Error('Invalid proxy container name.');
  return name;
}

/**
 * Runs the pinned NGINX image, rendering the repository template, published on
 * the host's LOOPBACK only, and waits until NGINX itself answers.
 *
 * `extraConfiguration` is an optional host file mounted into `conf.d/` — the
 * browser suite's one harness-only setting (see its own file). Readiness is
 * probed with an unknown Host, which the default server refuses with 421
 * without consulting any upstream, so it proves NGINX is serving the rendered
 * configuration whatever the upstreams are doing.
 */
export async function startFrontDoor({
  name,
  publicPort,
  publicHost = '127.0.0.1',
  webPort,
  realtimePort,
  extraConfiguration,
  timeoutMs = 60_000,
}) {
  if (!CONTAINER_NAME.test(name)) throw new Error('Invalid proxy container name.');

  const args = [
    'run',
    '--detach',
    '--name',
    name,
    '--publish',
    `127.0.0.1:${String(publicPort)}:8080`,
    '--add-host',
    `${HOST_ALIAS}:${hostGatewayIPv4()}`,
    '--env',
    'NGINX_ENVSUBST_FILTER=^MINHAJ_',
    '--env',
    `MINHAJ_PUBLIC_HOST=${publicHost}`,
    '--env',
    `MINHAJ_WEB_UPSTREAM=${HOST_ALIAS}:${String(webPort)}`,
    '--env',
    `MINHAJ_REALTIME_UPSTREAM=${HOST_ALIAS}:${String(realtimePort)}`,
    '--volume',
    `${NGINX_TEMPLATES}:/etc/nginx/templates:ro`,
  ];
  if (extraConfiguration !== undefined) {
    args.push(
      '--volume',
      `${extraConfiguration}:/etc/nginx/conf.d/${path.basename(extraConfiguration)}:ro`,
    );
  }
  args.push(NGINX_IMAGE);

  const result = spawnSync('docker', args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`The proxy container did not start: ${(result.stderr ?? '').trim()}`);
  }

  try {
    await waitForStatus(`http://127.0.0.1:${String(publicPort)}/`, 421, timeoutMs, {
      host: 'unknown-host.invalid',
    });
  } catch (error) {
    const logs = spawnSync('docker', ['logs', '--tail', '40', name], {
      encoding: 'utf8',
    });
    await removeFrontDoor(name);
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${logs.stderr ?? ''}`,
      { cause: error },
    );
  }
}

/** Proves the named container absent; throws when the inspection is inconclusive. */
export function frontDoorAbsent(name) {
  if (!CONTAINER_NAME.test(name)) throw new Error('Invalid proxy container name.');
  const result = spawnSync(
    'docker',
    ['ps', '--all', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.status !== 0) throw new Error('The container list could not be read.');
  return (result.stdout ?? '').trim() === '';
}

/** Removes the named proxy container and proves it gone. */
export async function removeFrontDoor(name) {
  if (!CONTAINER_NAME.test(name)) throw new Error('Invalid proxy container name.');
  const result = spawnSync('docker', ['rm', '--force', name], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0 && !/No such container/iu.test(result.stderr ?? '')) {
    throw new Error('The proxy container could not be removed.');
  }
  if (!frontDoorAbsent(name)) throw new Error('The proxy container is still present.');
}
