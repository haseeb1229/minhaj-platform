import { parseServerEnv, type ServerEnv } from '@minhaj/contracts/env/server';

/**
 * Server configuration, validated once at module load.
 *
 * SECURITY_BASELINE.md §18.1: configuration is "validated at startup with Zod
 * so the process fails fast". Defining schemas is not enough — nothing invokes
 * them unless the application actually does, which was the defect this module
 * closes.
 *
 * This module is imported by `instrumentation.ts`, which Next.js runs before
 * any request is served, and by the server components that consume the values.
 * An invalid environment therefore fails the process rather than surfacing as a
 * confusing runtime error on some later request.
 *
 * The thrown error names the offending variable and never prints its value
 * (§19.2).
 */

let cached: ServerEnv | null = null;

/**
 * Returns the validated server environment.
 *
 * Cached after the first successful parse: the environment does not change
 * during a process lifetime, and re-parsing per call would be wasted work.
 */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}

/**
 * Validates configuration eagerly, for the startup path.
 *
 * Separate from `serverEnv()` so the intent at the call site is explicit:
 * this one exists to fail fast, not to read a value.
 */
export function assertServerEnv(): void {
  serverEnv();
}
