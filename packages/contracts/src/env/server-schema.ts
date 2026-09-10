/**
 * Server environment SCHEMA and PARSER — implementation, not public API.
 *
 * TWO INDEPENDENT DEFENCES, and it needs both.
 *
 * 1. THE MARKER. `import 'server-only'` resolves to a module that throws under
 *    any resolver not applying the `react-server` condition — which is every
 *    client bundler. The marker travels with the FILE, so it holds however the
 *    module is reached: package subpath, relative source path, or tsconfig
 *    alias. No `exports` map can offer that, because a source path never
 *    consults one.
 *
 * 2. NO PUBLIC SPECIFIER. The `exports` map of `@minhaj/contracts` does not
 *    name this file, so nothing outside the package can import it by package
 *    specifier at all. The one supported route is
 *    `@minhaj/contracts/env/server`.
 *
 * Review #3 defeated the previous arrangement because this module was BOTH
 * publicly exported (as `@minhaj/contracts/env/schema`) AND marker-free. A
 * Client Component imported it and the production build succeeded, shipping
 * `process.env` parsing to the browser.
 *
 * WHY THE MARKER IS SAFE HERE NOW
 * -------------------------------
 * The marker was originally omitted so that `apps/web/scripts/start.mjs` could
 * validate configuration in PLAIN NODE, before Next exists in the process.
 * That constraint is real, but omitting the marker was the wrong way to meet
 * it: it traded a build-enforced boundary for a convention.
 *
 * The wrapper now runs itself under `--conditions=react-server`, the same
 * condition Next applies to the Server Component graph. `server-only` then
 * resolves to its empty module and the wrapper imports the ordinary, marked,
 * PUBLIC entry point. One schema, one marker, no unguarded module.
 *
 * `scripts/architecture/client-graph.mjs` additionally prohibits this path from
 * any client graph by resolved SOURCE PATH, so the architecture gate reports it
 * even where a bundler would not.
 */

import 'server-only';

import { z } from 'zod';

import { logLevelSchema, nodeEnvSchema, parseEnvironment } from './shared.ts';

/**
 * Server environment schema — Phase 0B scope only.
 *
 * Deliberately minimal. Database, authentication, OAuth, email, storage and
 * payment configuration belong to the phases that introduce them
 * (DELIVERY_PLAN.md); inventing their variables now would produce configuration
 * for systems that do not exist and credentials nobody has issued.
 *
 * Every variable here is non-secret. When the first genuine secret arrives it is
 * added to this schema, never to the client schema, and never with a default.
 */
export const serverEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema.default('development'),

  /** Port the web process listens on. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Pino level (TECH_STACK.md §12). */
  LOG_LEVEL: logLevelSchema.default('info'),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Validates the server environment, throwing a redacted error on failure.
 *
 * Accepts the source record so tests can validate without mutating the real
 * process environment.
 */
export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  return parseEnvironment(serverEnvSchema, source, 'server');
}

/**
 * Names that must never appear on the server schema, because a `NEXT_PUBLIC_`
 * variable is shipped to the browser and therefore is not a place for a secret
 * (SECURITY_BASELINE.md §18.1).
 *
 * Asserted by test rather than left as a comment.
 */
export const serverEnvKeys = Object.freeze(Object.keys(serverEnvSchema.shape));
