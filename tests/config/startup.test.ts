import { execFile } from 'node:child_process';
import { createConnection, createServer } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

import { repoRoot } from '../architecture/architecture-harness.ts';
import { ensureProductionBuild, webRoot } from './next-production-build.ts';

/**
 * E1 — production startup must fail fast, BEFORE the listener exists.
 *
 * SECURITY_BASELINE.md §18.1 requires the process to fail fast on invalid
 * configuration. The previous implementation validated inside Next's
 * `instrumentation` hook, which runs AFTER the port is bound: a bad environment
 * produced a LISTENING server answering every request with 500. That passes a
 * port health check and hides the fault behind an error page, so it is not a
 * failed start in any useful sense.
 *
 * These tests drive the REAL production start command and assert the process
 * exits non-zero with nothing listening.
 */

const run = promisify(execFile);
const startScript = path.join(webRoot, 'scripts', 'start.mjs');
const validateScript = path.join(webRoot, 'scripts', 'validate-env.mjs');

/**
 * Reserves a free TCP port and releases it.
 *
 * Review #3 (N4) found these tests pinned to 3191–3195. A fixed port is a flake
 * waiting for a developer who happens to be running something, and a
 * cross-test collision waiting for parallel execution. Binding port 0 asks the
 * OS for a port it knows is free, which is both deterministic and
 * collision-resistant in a way a hand-picked range cannot be.
 *
 * There is an unavoidable window between release and reuse. It is harmless
 * here: every assertion is that NOTHING binds the port, so a third party
 * taking it would make the test fail loudly rather than pass falsely.
 */
async function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();

      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('could not obtain an ephemeral port'));
        return;
      }

      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

/** Is anything accepting connections on this port? */
async function isListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const settle = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(1500);
    socket.once('connect', () => settle(true));
    socket.once('timeout', () => settle(false));
    socket.once('error', () => settle(false));
  });
}

/** Runs the production start command and captures its outcome. */
async function startWith(
  environment: Record<string, string>,
): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [startScript], {
      cwd: webRoot,
      env: { ...process.env, ...environment },
      timeout: 30_000,
    });
    return { code: 0, output: `${stdout}\n${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: failure.code ?? 1,
      output: `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`,
    };
  }
}

/**
 * The wrapper's SOURCE with comments removed.
 *
 * Several assertions below are of the form "this construct does not appear".
 * The wrapper documents at length why it no longer re-execs and why the
 * `react-server` condition is scoped to validation, so a raw text search finds
 * those words in the explanation and passes for the wrong reason — a test that
 * succeeds because of a comment is worse than no test. Stripping comments makes
 * the assertions about the program.
 */
async function readWrapperCode(): Promise<string> {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(startScript, 'utf8');

  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('E1 — invalid configuration terminates before listening', () => {
  it('exits non-zero for an invalid LOG_LEVEL', async () => {
    const result = await startWith({
      LOG_LEVEL: 'chatty',
      PORT: String(await reservePort()),
    });

    expect(result.code).not.toBe(0);
  });

  it('names the offending variable', async () => {
    const result = await startWith({
      LOG_LEVEL: 'chatty',
      PORT: String(await reservePort()),
    });

    expect(result.output).toContain('LOG_LEVEL');
    expect(result.output).toContain('the server will not start');
  });

  it('never prints the supplied invalid value', async () => {
    // A validation failure must not become a credential leak (§19.2).
    //
    // Driven through LOG_LEVEL because `DEFAULT_LOCALE` no longer exists:
    // Phase 3A fixed the final no-preference locale at `en` (ROUTE_MAP.md
    // §1.1) and retired the variable that could contradict it. The property
    // asserted is the same one — the offending VARIABLE is named, its VALUE
    // never is — and it is asserted against a variable the schema still has,
    // which is the only way this can remain a real test rather than one that
    // passes because nothing rejects anything.
    const secret = 'SUPPLIED-VALUE-MUST-NOT-APPEAR';
    const result = await startWith({
      LOG_LEVEL: secret,
      PORT: String(await reservePort()),
    });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('LOG_LEVEL');
    expect(result.output).not.toContain(secret);
  });

  it('leaves NO listening socket behind', async () => {
    // The decisive assertion. A process that is up and serving 500s would pass
    // a naive "did it error?" check while still accepting production traffic.
    const port = await reservePort();

    expect(await isListening(port), 'port must be free before the test').toBe(false);

    const result = await startWith({ LOG_LEVEL: 'chatty', PORT: String(port) });

    expect(result.code).not.toBe(0);
    expect(await isListening(port), 'no listener may exist after a failed start').toBe(
      false,
    );
  });

  it('reports an invalid PORT without starting anything', async () => {
    const result = await startWith({ PORT: 'not-a-number' });

    expect(result.code).not.toBe(0);
    expect(result.output).toContain('PORT');
  });

  it('does not retry or loop', async () => {
    // A restart loop would eventually bind a port and mask the failure.
    const result = await startWith({
      LOG_LEVEL: 'chatty',
      PORT: String(await reservePort()),
    });
    const failures = result.output.match(/the server will not start/g) ?? [];

    expect(failures.length).toBe(1);
  });
});

describe('E1 — the wrapper and the app validate the same schema', () => {
  it('shares one schema definition between both entry points', async () => {
    // The public entry point re-exports the implementation, so there is exactly
    // ONE schema and the wrapper and the application cannot drift apart.
    const viaImplementation =
      await import('../../packages/contracts/src/env/server-schema.ts');
    const viaServer = await import('../../packages/contracts/src/env/server.ts');

    expect(viaServer.parseServerEnv).toBe(viaImplementation.parseServerEnv);
    expect(viaServer.serverEnvSchema).toBe(viaImplementation.serverEnvSchema);
  });

  it('imports the PUBLIC marked entry point, not an unguarded module', async () => {
    // The heart of the B1 remedy. Review #3's bypass existed because the
    // wrapper needed a module plain Node could load, and the answer taken was
    // an unmarked, publicly exported one. The answer now is that validation
    // runs under the `react-server` condition and imports the same guarded
    // module the application does.
    //
    // Validation moved into its own process in Round 4 (B4), so the two halves
    // are asserted where they now live: the wrapper APPLIES the condition, and
    // the validator IMPORTS the marked entry point. Both must hold — a
    // condition applied to nothing, or a marked import run without the
    // condition, would each be the bypass reopening.
    const { readFile } = await import('node:fs/promises');
    const wrapper = await readFile(startScript, 'utf8');
    const validator = await readFile(validateScript, 'utf8');

    expect(wrapper).toContain('--conditions=react-server');
    expect(validator).toContain("'@minhaj/contracts/env/server'");
  });

  it('applies the react-server condition ONLY to validation', async () => {
    // Review #4 (B4 §6.2) required the condition to stay scoped to the
    // validator. Applying it to the Next child would change Next's own module
    // resolution for the entire application, which is a different program from
    // the one that was tested.
    //
    // Asserted against CODE, not prose: comments in this wrapper discuss the
    // condition at length, and a text search over the whole file would be
    // satisfied by the discussion rather than by the behaviour.
    const wrapper = await readWrapperCode();

    // The Next child is spawned from `nextBin`; that argument list must carry
    // no condition flag.
    const nextSpawn = wrapper.slice(wrapper.indexOf('const next = await run('));

    expect(nextSpawn).not.toContain('REACT_SERVER_CONDITION');
    expect(nextSpawn).not.toContain('--conditions');
  });

  it('never re-executes itself, so the top-level process owns the lifecycle', async () => {
    // The exact B4 defect: a synchronous re-exec left the top-level process
    // blocked with no event loop, so its signal handlers did not exist and a
    // SIGTERM to the wrapper's PID orphaned a still-listening Next server.
    const wrapper = await readWrapperCode();

    expect(wrapper).not.toContain('spawnSync');
    expect(wrapper).not.toContain('MINHAJ_START_REEXEC');
  });

  it('installs termination handlers before spawning anything', async () => {
    // A handler installed after the first spawn leaves a window in which a
    // signal reaches a process that cannot forward it — which is how a child
    // gets stranded. Order is the guarantee, so order is what is asserted.
    const wrapper = await readWrapperCode();

    const handlerAt = wrapper.indexOf('process.on(signal');
    const firstSpawnAt = wrapper.indexOf('await run(');

    expect(handlerAt).toBeGreaterThan(-1);
    expect(firstSpawnAt).toBeGreaterThan(-1);
    expect(handlerAt).toBeLessThan(firstSpawnAt);
  });

  it('leaves no unmarked route to server environment parsing', async () => {
    // Every module that can parse the server environment must carry the marker.
    // An unmarked one is reachable by relative path or tsconfig alias whatever
    // the `exports` map says, because a source path consults no exports map.
    const { readFile } = await import('node:fs/promises');

    for (const file of [
      'packages/contracts/src/env/server.ts',
      'packages/contracts/src/env/server-schema.ts',
    ]) {
      const source = await readFile(path.join(repoRoot, file), 'utf8');

      expect(source, `${file} must carry the server-only marker`).toMatch(
        /import\s+['"]server-only['"]/,
      );
    }
  });
});

describe('E1 — the removed public schema subpath (Review #3 B1)', () => {
  it('no longer appears in the contracts export map', async () => {
    // The exact bypass: `@minhaj/contracts/env/schema` was public and
    // marker-free, and a Client Component importing it built cleanly into a
    // browser bundle. The remedy is that the subpath does not exist.
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(
        path.join(repoRoot, 'packages', 'contracts', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, unknown> };

    expect(Object.keys(manifest.exports)).not.toContain('./env/schema');
  });

  it('exposes no export resolving to the server env implementation', async () => {
    // Stronger than checking one key: NO public export, under any condition,
    // may resolve to `server-schema.ts`. Deleting `./env/schema` fixes the
    // exact bypass; this fixes the SHAPE of it, so the implementation cannot be
    // re-exposed under a different name.
    const { readFile } = await import('node:fs/promises');
    const manifest = JSON.parse(
      await readFile(
        path.join(repoRoot, 'packages', 'contracts', 'package.json'),
        'utf8',
      ),
    ) as { exports: Record<string, unknown> };

    expect(JSON.stringify(manifest.exports)).not.toContain('server-schema');
  });
});

// ===========================================================================
// B4 — the TOP-LEVEL process owns the server's lifecycle
// ===========================================================================

/**
 * Review #4's blocker, reproduced exactly.
 *
 * The wrapper used to re-exec itself synchronously, so signal handlers existed
 * only in a grandchild. A supervisor sends SIGTERM to the PID it launched — the
 * TOP-LEVEL one — and that process died while the conditioned child kept Next
 * alive and listening. The container then had to be SIGKILLed on the grace
 * timeout, cutting in-flight requests, on every single deploy.
 *
 * These tests therefore signal the TOP-LEVEL PID and nothing else, and assert
 * on the LISTENER — the thing a load balancer actually observes. Asserting that
 * the wrapper exited would have passed against the broken version, because the
 * broken version's wrapper exited fine; it was what it left behind that was the
 * defect.
 *
 * PLATFORM — and this matters, because it decides whether these tests prove
 * anything at all.
 *
 * Signals are a POSIX mechanism. On Windows `process.kill(pid, 'SIGTERM')` is
 * not a signal: it terminates the target abruptly, and Windows tears the whole
 * process tree down with it. That MASKS the defect. Run against the broken
 * re-exec wrapper, the orphan assertion below PASSES on Windows and FAILS on
 * Linux — verified both ways during remediation. A test that cannot fail is not
 * evidence, so on Windows these are smoke tests only.
 *
 * The authority for B4 is therefore the Linux run: `docker build --target test`
 * then `npx vitest run tests/config/startup.test.ts`, which is what CI executes
 * and what the self-hosted Docker deployment target actually is
 * (ARCHITECTURE.md §10.1). There, against the broken wrapper, the listener
 * survives SIGTERM for the full 30-second window and the assertion fails with
 * exactly the message it carries.
 */
const posix = process.platform !== 'win32';

/** Waits until `predicate` holds, or gives up. */
async function waitFor(
  predicate: () => Promise<boolean>,
  { timeout = 90_000, interval = 250 } = {},
): Promise<boolean> {
  const deadline = Date.now() + timeout;

  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  return false;
}

/**
 * The production build these tests need is produced by the SHARED helper.
 *
 * It used to be built here. A second suite — the Phase 3A locale routing proof
 * — now needs a built application too, and Vitest runs test files in parallel
 * processes, so two independent "build if absent" helpers would race to write
 * the same `.next` directory. `ensureProductionBuild` holds a cross-process
 * lock and builds exactly once; the guarantee for this file is unchanged.
 */

/**
 * The secrets a PRODUCTION process must supply for itself.
 *
 * `parseServerEnv` rejects the repository's development defaults when
 * `NODE_ENV=production` (SECURITY_BASELINE.md §18.1), and the start wrapper
 * validates BEFORE `next start` runs — so a production launch without these
 * exits non-zero and never listens, which is the guard working. A launch that
 * is testing SHUTDOWN therefore has to get past it.
 *
 * Synthetic sentinels, recognisably not credentials, and never a real value.
 */
const PRODUCTION_SECRETS = {
  AUTH_SECRETS: '1:synthetic-startup-sentinel-value-0001',
  RATE_LIMIT_DIGEST_KEY: 'synthetic-startup-rate-limit-0001',
  EMAIL_DIGEST_KEY: 'synthetic-startup-email-digest-0001',
} as const;

/** Launches the ordinary, UNCONDITIONED start wrapper, as a container does. */
async function launchWrapper(
  port: number,
  environment: Record<string, string>,
  args: readonly string[] = [],
) {
  const { spawn } = await import('node:child_process');

  return spawn(process.execPath, [startScript, ...args], {
    cwd: webRoot,
    stdio: 'ignore',
    env: { ...process.env, PORT: String(port), ...environment },
  });
}

describe('B4 — SIGTERM to the top-level wrapper stops the listener', () => {
  it('terminates the Next listener and leaves no orphan', async () => {
    await ensureProductionBuild();

    const port = await reservePort();
    const wrapper = await launchWrapper(port, {
      NODE_ENV: 'production',
      npm_lifecycle_event: 'start',
      ...PRODUCTION_SECRETS,
    });

    const topLevelPid = wrapper.pid;
    expect(topLevelPid, 'the wrapper must have a PID to signal').toBeDefined();

    const exited = new Promise<void>((resolve) => wrapper.once('exit', () => resolve()));

    try {
      const up = await waitFor(() => isListening(port));
      expect(up, 'the server must be listening before the signal is sent').toBe(true);

      // THE reproduction: signal the TOP-LEVEL PID only. Nothing here knows
      // or touches any child PID — a supervisor does not know them either.
      process.kill(topLevelPid as number, 'SIGTERM');

      const down = await waitFor(async () => !(await isListening(port)), {
        timeout: 30_000,
      });

      expect(
        down,
        'the listener must disappear after SIGTERM to the top-level PID; a ' +
          'surviving listener is the orphaned-grandchild defect. This ' +
          'assertion is only load-bearing on POSIX — see the block comment ' +
          'above: Windows kills the whole tree and hides the fault.',
      ).toBe(true);

      const wrapperExited = await Promise.race([
        exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 15_000)),
      ]);

      expect(wrapperExited, 'the wrapper itself must exit').toBe(true);

      // Nothing may still hold the port afterwards: an orphan that lost its
      // parent would still be serving.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(
        await isListening(port),
        'no orphaned Next process may still be serving',
      ).toBe(false);
    } finally {
      if (wrapper.exitCode === null) wrapper.kill('SIGKILL');
    }
  }, 420_000);

  it.skipIf(!posix)(
    'exits with the conventional signal status rather than reporting success',
    async () => {
      await ensureProductionBuild();

      const port = await reservePort();
      const wrapper = await launchWrapper(port, {
        NODE_ENV: 'production',
        npm_lifecycle_event: 'start',
        ...PRODUCTION_SECRETS,
      });

      const outcome = new Promise<{ code: number | null; signal: string | null }>(
        (resolve) => wrapper.once('exit', (code, signal) => resolve({ code, signal })),
      );

      try {
        expect(await waitFor(() => isListening(port))).toBe(true);
        process.kill(wrapper.pid as number, 'SIGTERM');

        const { code, signal } = await outcome;

        // Either the signal is re-raised (signal === 'SIGTERM') or the
        // conventional 128+15 status is returned. A ZERO exit would tell a
        // supervisor the process stopped of its own accord.
        expect(signal === 'SIGTERM' || code === 143).toBe(true);
      } finally {
        if (wrapper.exitCode === null) wrapper.kill('SIGKILL');
      }
    },
    180_000,
  );
});

describe('B4 — development shares the same lifecycle', () => {
  it('runs real `next dev` and stops when the top-level process is terminated', async () => {
    const port = await reservePort();
    const wrapper = await launchWrapper(
      port,
      { NODE_ENV: 'development', npm_lifecycle_event: 'dev' },
      ['--dev'],
    );

    try {
      expect(
        await waitFor(() => isListening(port)),
        'the development server must come up',
      ).toBe(true);

      process.kill(wrapper.pid as number, 'SIGTERM');

      expect(
        await waitFor(async () => !(await isListening(port)), { timeout: 30_000 }),
        'the development listener must stop with the top-level process',
      ).toBe(true);
    } finally {
      if (wrapper.exitCode === null) wrapper.kill('SIGKILL');
    }
  }, 420_000);
});

describe('B4 — an invalid environment starts no process to strand', () => {
  it('leaves neither a listener nor a surviving child', async () => {
    const port = await reservePort();
    const wrapper = await launchWrapper(port, {
      LOG_LEVEL: 'chatty',
      NODE_ENV: 'production',
      npm_lifecycle_event: 'start',
    });

    const { code } = await new Promise<{ code: number | null }>((resolve) =>
      wrapper.once('exit', (exitCode) => resolve({ code: exitCode })),
    );

    expect(code, 'invalid configuration must exit non-zero').not.toBe(0);
    expect(await isListening(port), 'nothing may be listening').toBe(false);
  }, 60_000);

  it('refuses to start in production on a development secret default', async () => {
    // The guard, end to end. `AUTH_SECRETS`, `RATE_LIMIT_DIGEST_KEY` and
    // `EMAIL_DIGEST_KEY` all carry a development default so a fresh checkout
    // runs — and a default secret in a deployed environment is not a secret
    // (SECURITY_BASELINE.md §18.1).
    //
    // Asserted here rather than only at the schema, because the property that
    // matters is that the PROCESS does not come up: a deployment that started
    // and served traffic while signing sessions with a published value would
    // be the failure, not the parse.
    const port = await reservePort();
    const wrapper = await launchWrapper(port, {
      NODE_ENV: 'production',
      npm_lifecycle_event: 'start',
    });

    const { code } = await new Promise<{ code: number | null }>((resolve) =>
      wrapper.once('exit', (exitCode) => resolve({ code: exitCode })),
    );

    expect(code, 'a defaulted production secret must exit non-zero').not.toBe(0);
    expect(await isListening(port), 'nothing may be listening').toBe(false);
  }, 60_000);
});
