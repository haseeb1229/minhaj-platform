// Marks this module server-only for the Next.js bundler, so reaching it from a
// client graph through the subpath export fails the build exactly as the root
// export does (ARCHITECTURE.md §6.3 rule 9).
import 'server-only';

import { pino, type Logger, type LoggerOptions } from 'pino';

import {
  buildRedactionPaths,
  isSafeContextField,
  redactionPlaceholder,
  sanitiseForLog,
} from './redaction.ts';

/**
 * Structured server logging (Pino 10.3.1, TECH_STACK.md §12).
 *
 * Server-only. Reached through `@minhaj/server-core`, which carries the
 * `server-only` marker, so a client bundle reaching it fails the Next build.
 *
 * Deliberately small. This is a logging foundation, not an observability
 * platform: a configured logger, boundary sanitisation, and a child-logger
 * helper for correlation identifiers.
 *
 * Application logging is distinct from domain audit (SECURITY_BASELINE.md §13).
 * Audit records are durable domain data owned by their contexts and do not
 * travel through this logger.
 */

/**
 * Sanitises every argument of a log call.
 *
 * Pino hands each call's arguments to the `logMethod` hook, so redaction
 * happens once, centrally, for every call site that exists or will ever exist.
 * This is the mechanism §19.2 requires; `redact.paths` below is a second layer.
 *
 * Exported so tests can assert the transformation directly.
 */
export function sanitiseLogArguments(args: readonly unknown[]): unknown[] {
  return args.map((argument) =>
    typeof argument === 'object' && argument !== null
      ? sanitiseForLog(argument)
      : argument,
  );
}

/** Options shared by every logger this package creates. */
export function loggerOptions(level: string, nodeEnv: string): LoggerOptions {
  return {
    level,

    // Layer 1 — recursive sanitisation of every logged object, at any depth.
    hooks: {
      logMethod(this: Logger, args, method) {
        method.apply(this, sanitiseLogArguments(args) as Parameters<typeof method>);
      },
    },

    // Layer 2 — Pino's own path redaction for the common request shapes.
    redact: {
      paths: buildRedactionPaths(),
      censor: redactionPlaceholder,
      remove: false,
    },

    // Stable, machine-readable level names rather than numbers.
    formatters: {
      level: (label) => ({ level: label }),
    },

    base: {
      env: nodeEnv,
    },

    timestamp: pino.stdTimeFunctions.isoTime,
  };
}

/**
 * Creates the application logger.
 *
 * The level and environment are passed in rather than read from `process.env`
 * here, so the caller validates configuration through `@minhaj/contracts`
 * first and this module has one job.
 */
export function createLogger(options: { level: string; nodeEnv: string }): Logger {
  return pino(loggerOptions(options.level, options.nodeEnv));
}

/**
 * A child logger carrying correlation context (SECURITY_BASELINE.md §19.2).
 *
 * Bindings are attached to EVERY subsequent line from this logger, so a
 * sensitive value smuggled in here leaks repeatedly rather than once. The
 * defence is an allowlist: only fields known to be safe correlation metadata
 * pass through, and anything else is redacted rather than silently accepted.
 *
 * The type already restricts values to primitives, so a whole request or user
 * object cannot be attached casually. The allowlist closes the remaining gap —
 * a secret string under a bland key name.
 */
export function withContext(
  logger: Logger,
  bindings: Record<string, string | number | boolean>,
): Logger {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(bindings)) {
    safe[key] = isSafeContextField(key) ? value : redactionPlaceholder;
  }

  return logger.child(safe);
}

export type { Logger };
