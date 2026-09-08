#!/usr/bin/env node
/**
 * Server environment validation, run as its own short-lived process.
 *
 * WHY A SEPARATE FILE
 * -------------------
 * `@minhaj/contracts/env/server` carries `import 'server-only'`, so it resolves
 * to a throwing module unless the `react-server` export condition is applied.
 * Node fixes its export conditions at startup, which means the condition can
 * only be obtained by launching a process with it.
 *
 * Previously `start.mjs` obtained it by re-executing ITSELF with the flag, via
 * `spawnSync`. That made the original process block with no event loop, so it
 * held no signal handlers, and a SIGTERM to the wrapper's PID left an orphaned
 * Next server still listening (Review #4, B4).
 *
 * Validation is a short, self-terminating task, so it belongs in a CHILD rather
 * than in a process the wrapper becomes a child of. Splitting it into this file
 * lets `start.mjs` stay alive and in charge for its whole life, while the
 * `react-server` condition stays scoped to this process and never reaches Next.
 *
 * CONTRACT WITH THE WRAPPER
 * -------------------------
 *   exit 0  — valid; the validated PORT is written to stdout, and nothing else
 *   exit 1  — invalid; a safe diagnostic naming the variables is on stderr
 *
 * The value on stdout exists so the wrapper does not re-parse the environment
 * with a second copy of the defaulting rules. There is ONE schema and one
 * parser, and this is the only process that runs it.
 */

import { parseServerEnv } from '@minhaj/contracts/env/server';

let env;

try {
  env = parseServerEnv(process.env);
} catch (error) {
  // The message names the offending variables and never prints their values
  // (SECURITY_BASELINE.md §19.2).
  process.stderr.write(
    `\nFATAL: the server will not start.\n\n` +
      `${error instanceof Error ? error.message : String(error)}\n\n` +
      `No listener was started. Correct the environment and start again.\n\n`,
  );
  process.exit(1);
}

// stdout carries the validated PORT and nothing else — the wrapper parses it.
process.stdout.write(String(env.PORT));
process.exit(0);
