import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * ONE production build, shared by every suite that needs a running server.
 *
 * `npm run verify` runs the tests BEFORE `npm run build`, so in a clean
 * checkout — and in the Docker test stage, which is exactly that — `.next` does
 * not exist yet and `next start` refuses to serve. A test that needs a build
 * must therefore produce one.
 *
 * WHY THERE IS A LOCK. Two suites now need a built application: the startup
 * lifecycle proof and the locale routing proof. Vitest runs test FILES IN
 * PARALLEL PROCESSES, so an in-module promise guards only its own worker; two
 * `next build` runs writing the same `.next` directory at the same time would
 * corrupt it, and the failure would look like a routing defect rather than a
 * harness defect.
 *
 * The lock is a DIRECTORY, because `mkdir` either creates it or fails — there
 * is no window between checking and creating, which is the whole problem with
 * a file-existence check. It lives in the OS temp directory rather than the
 * repository so that no run can leave an untracked artifact behind in a working
 * tree under review.
 */

const run = promisify(execFile);

export const webRoot = path.join(repoRoot, 'apps', 'web');
export const nextBin = path.join(repoRoot, 'node_modules', 'next', 'dist', 'bin', 'next');

const buildIdFile = path.join(webRoot, '.next', 'BUILD_ID');
const lockDirectory = path.join(tmpdir(), 'minhaj-next-production-build.lock');

/**
 * Has Next written a BUILD_ID?
 *
 * NOT, on its own, "the build has finished" — see `build()`. Measured against
 * Next 16.3.3, `BUILD_ID` appears about 1.4 seconds BEFORE `next build` exits,
 * and before the prerendered locale pages are written. A waiting process that
 * treats it as completion starts serving a half-written `.next` and gets
 * connection resets and missing markup, which look exactly like application
 * defects and are not.
 */
function hasBuildId(): boolean {
  return existsSync(buildIdFile);
}

/** Is another process building right now? */
function buildInProgress(): boolean {
  return existsSync(lockDirectory);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let inThisWorker: Promise<void> | null = null;

/** Builds the application if it is not already built. Safe to call anywhere. */
export function ensureProductionBuild(): Promise<void> {
  inThisWorker ??= build();
  return inThisWorker;
}

async function build(): Promise<void> {
  const deadline = Date.now() + 900_000;

  while (Date.now() < deadline) {
    /**
     * THE completion signal is the released lock, not the BUILD_ID.
     *
     * The lock is removed only after `next build` has EXITED, so "no lock and
     * a BUILD_ID" is the one state in which the output is genuinely complete.
     * Checking the BUILD_ID alone is the subtly wrong version of this, and it
     * fails in the worst way: intermittently, only on a clean checkout, and
     * with symptoms that point at the application rather than the harness.
     */
    if (!buildInProgress() && hasBuildId()) return;

    try {
      mkdirSync(lockDirectory);
    } catch {
      // Someone else holds it. Wait and re-examine.
      await sleep(500);
      continue;
    }

    try {
      // Acquiring the lock proves no build is running, so a BUILD_ID here is a
      // finished one.
      if (hasBuildId()) return;

      await run(process.execPath, [nextBin, 'build'], {
        cwd: webRoot,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: 600_000,
        maxBuffer: 32 * 1024 * 1024,
      });

      return;
    } finally {
      rmSync(lockDirectory, { recursive: true, force: true });
    }
  }

  throw new Error(
    `Timed out waiting for the production build lock at ${lockDirectory}. ` +
      'If no build is running, remove that directory: a previous run was ' +
      'killed while holding it.',
  );
}
