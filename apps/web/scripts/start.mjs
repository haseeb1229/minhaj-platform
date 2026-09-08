#!/usr/bin/env node
/**
 * Start wrapper — fail-fast configuration validation, then the standard Next
 * server, with this process owning the lifecycle throughout.
 *
 * WHY THIS WRAPPER EXISTS
 * -----------------------
 * SECURITY_BASELINE.md §18.1 requires the process to "fail fast" on invalid
 * configuration. Next's `instrumentation` hook is NOT sufficient: it runs after
 * the server has bound its port, so a bad environment produced a listening
 * server answering every request with 500. A process that is up and serving
 * errors is not a process that failed fast — it passes a port health check,
 * accepts traffic, and hides the fault behind an error page.
 *
 * So: validate FIRST, and only then hand off to the standard Next command.
 *
 * WHY THE PROCESS MODEL CHANGED (Review #4, B4)
 * ---------------------------------------------
 * The previous shape was:
 *
 *     top-level wrapper  --spawnSync-->  conditioned wrapper  --spawn-->  next
 *
 * The re-exec was SYNCHRONOUS, so the top-level process sat blocked inside
 * `spawnSync` with no event loop and no signal handlers. Those handlers existed
 * only in the conditioned grandchild. When a supervisor sent SIGTERM to the
 * original PID — the only PID it knows — the top-level process died, the
 * conditioned child was orphaned, and Next kept its listener open and kept
 * answering requests. A container that will not stop on SIGTERM is killed on
 * the grace-period timeout, every deploy, and in-flight requests are cut rather
 * than drained.
 *
 * The re-exec existed only to obtain one export condition for VALIDATION. That
 * is a short-lived, self-terminating task, so it is now a child of this process
 * rather than this process being a child of it:
 *
 *     start.mjs (owns the lifecycle for its whole life)
 *        │
 *        ├── 1. validator child   node --conditions=react-server  (exits)
 *        └── 2. next child        node <next-bin> start|dev       (long-lived)
 *
 * This process never blocks, never re-execs, and always holds a handle to
 * whichever child is current — so a signal arriving at ANY moment is forwarded
 * to something real. The `react-server` condition stays scoped to the validator
 * and never touches the Next child, which keeps Next's own resolution semantics
 * exactly as Next expects them.
 *
 * Next's server architecture is untouched. This wraps the standard command; it
 * does not replace it, and there is no custom HTTP server anywhere here.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The `react-server` export condition, applied to the VALIDATOR ONLY.
 *
 * `@minhaj/contracts/env/server` carries `import 'server-only'`, which resolves
 * to a throwing module under any resolver that does not apply this condition.
 * That is the marker doing its job: it is what makes a client bundle fail.
 * Validation is not a client — it is the server's configuration check — so it
 * applies the same condition Next applies to the Server Component graph and
 * imports the ordinary public entry point.
 *
 * The alternative, and what Review #3 found here, was an UNMARKED schema module
 * plain Node could import. That module was also publicly exported, and a Client
 * Component importing it built cleanly into a browser bundle. Even unexported
 * it would have remained reachable by relative path or tsconfig alias, because
 * a source path consults no `exports` map. Running validation under the
 * condition removes the need for an unmarked module at all: there is one
 * schema, it is marked, and every route to it is guarded.
 *
 * Scoped deliberately to that child. Applying it to the Next process would
 * change Next's own module resolution for the whole application.
 */
const REACT_SERVER_CONDITION = '--conditions=react-server';

/** Termination signals this wrapper forwards to the active child. */
const FORWARDED_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP', 'SIGBREAK'];

/**
 * The child currently owning the foreground, or `null`.
 *
 * Read by the signal handlers installed BEFORE anything is spawned, so a signal
 * that arrives during validation is handled just as one arriving during serving
 * is. A window in which a signal reaches nothing is exactly the window that
 * strands a process.
 */
let activeChild = null;

/** Set once a signal has been forwarded, so a repeated signal escalates. */
let terminating = false;

/**
 * Forwards a termination signal to the active child.
 *
 * The child is asked to stop with the SAME signal the supervisor sent, so Next
 * runs its own shutdown — draining in-flight requests — rather than being
 * killed. A SECOND signal means the operator is no longer waiting, so the child
 * is killed outright.
 *
 * `SIGBREAK` is Windows-only and is forwarded as `SIGTERM`, because Node on
 * Windows cannot deliver `SIGBREAK` to a child. Windows has no real signal
 * delivery at all — `child.kill()` terminates the process there — which is
 * acceptable for local development; the graceful path is the Linux/Docker one,
 * which is the deployment target (ARCHITECTURE.md §10.1).
 */
function forward(signal) {
  if (activeChild === null || activeChild.exitCode !== null) {
    // Nothing to stop — honour the signal for this process.
    process.exit(signal === 'SIGINT' ? 130 : 143);
  }

  if (terminating) {
    activeChild.kill('SIGKILL');
    return;
  }

  terminating = true;
  activeChild.kill(signal === 'SIGBREAK' ? 'SIGTERM' : signal);
}

// Installed FIRST, before any child exists, so there is no unhandled window.
for (const signal of FORWARDED_SIGNALS) {
  process.on(signal, () => forward(signal));
}

/**
 * Runs one child to completion, tracking it as the active child throughout.
 *
 * Resolves with `{ code, signal, stdout }`. Deliberately asynchronous: a
 * synchronous spawn would block this process's event loop and its signal
 * handlers with it, which is the defect this file exists to correct.
 *
 * `stdout` is collected only when the child's stdout is a pipe — the validator.
 * The Next child inherits stdio, so its output reaches the terminal unbuffered
 * and its logs are never held by this process.
 */
function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    activeChild = child;

    let stdout = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });

    child.once('error', (error) => {
      activeChild = null;
      reject(error);
    });

    // `close` rather than `exit`: it fires once the piped streams have been
    // fully consumed, so the validated PORT cannot be lost to a race between
    // the child exiting and its last write arriving.
    child.once('close', (code, signal) => {
      activeChild = null;
      resolve({ code, signal, stdout });
    });
  });
}

// ---------------------------------------------------------------------------
// 1. Validate the environment, under the `react-server` condition.
// ---------------------------------------------------------------------------
//
// A separate short-lived child rather than a re-exec of this script. It prints
// its own diagnostics on stderr (inherited) and reports success by exit code,
// and it terminates before Next is spawned — so the two never coexist and the
// condition cannot leak into the server.

const validator = path.join(appRoot, 'scripts', 'validate-env.mjs');

let validation;

try {
  validation = await run(process.execPath, [REACT_SERVER_CONDITION, validator], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: process.env,
  });
} catch (error) {
  process.stderr.write(
    `\nFATAL: the server will not start.\n\n` +
      `Could not run configuration validation: ` +
      `${error instanceof Error ? error.message : String(error)}\n\n` +
      `No listener was started.\n\n`,
  );
  process.exit(1);
}

// A signal during validation stops here: nothing has bound a port.
if (validation.signal !== null && validation.signal !== undefined) {
  process.exit(143);
}

if (validation.code !== 0) {
  // The validator has already printed the safe, value-free diagnostic.
  process.exit(validation.code ?? 1);
}

// ---------------------------------------------------------------------------
// 2. Configuration is valid — start the standard Next server.
// ---------------------------------------------------------------------------

/**
 * The validated PORT, read back from the validator's stdout.
 *
 * The validator is the only thing that has parsed the environment, and parsing
 * it a second time here — with a second copy of the defaulting rules — is how
 * the wrapper and the application drift apart. It prints the single value this
 * process needs, and that value is re-checked below before use.
 */
const reported = (validation.stdout ?? '').trim();
const port = Number.parseInt(reported, 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write(
    `\nFATAL: the server will not start.\n\n` +
      `Configuration validation did not report a usable PORT.\n\n` +
      `No listener was started.\n\n`,
  );
  process.exit(1);
}

const nextBin = path.join(
  appRoot,
  '..',
  '..',
  'node_modules',
  'next',
  'dist',
  'bin',
  'next',
);

/**
 * `dev` runs the development server, `start` the production one. Both route
 * through this wrapper so a broken environment fails identically in either —
 * the blocking requirement is production fail-fast, but a developer meeting the
 * same error locally is what keeps the production path trustworthy.
 *
 * The mode is taken from the npm lifecycle event (set by npm itself) or from an
 * explicit `--dev` flag, so no cross-platform env-var syntax is needed in the
 * package scripts.
 */
const mode =
  process.argv.includes('--dev') || process.env['npm_lifecycle_event'] === 'dev'
    ? 'dev'
    : 'start';

// `--dev` is ours, not Next's; do not forward it.
const passthrough = process.argv.slice(2).filter((argument) => argument !== '--dev');

// A signal that arrived during validation must not be followed by a start.
if (terminating) process.exit(143);

const next = await run(
  process.execPath,
  // NO `--conditions` here. The Next child gets ordinary Node resolution, which
  // is what Next's own module graph expects.
  [nextBin, mode, '--port', String(port), ...passthrough],
  { cwd: appRoot, stdio: 'inherit', env: process.env },
);

// ---------------------------------------------------------------------------
// 3. Propagate the child's outcome.
// ---------------------------------------------------------------------------
//
// Killed by a signal: re-raise it on THIS process, so the supervisor observes
// the conventional 128+n status and "terminated by SIGTERM" rather than a
// wrapper that swallowed the signal and reported success.
if (next.signal !== null && next.signal !== undefined) {
  process.kill(process.pid, next.signal);

  // Reached only where the platform cannot re-raise (Windows). The conventional
  // status for a signalled process keeps the exit code meaningful there too.
  process.exit(next.signal === 'SIGINT' ? 130 : 143);
}

process.exit(next.code ?? 0);
