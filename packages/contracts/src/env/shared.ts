import { z } from 'zod';

/**
 * Environment primitives shared by the server and client schemas.
 *
 * SECURITY_BASELINE.md §18.1: secrets are supplied as environment variables and
 * validated at startup with Zod so the process fails fast. `NEXT_PUBLIC_`
 * variables are understood to be public and never carry sensitive values.
 */

/** The deployment environments of ARCHITECTURE.md §10.2. */
export const nodeEnvSchema = z.enum(['development', 'test', 'production']);
export type NodeEnv = z.infer<typeof nodeEnvSchema>;

/** Pino log levels (TECH_STACK.md §12). */
export const logLevelSchema = z.enum([
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
]);
export type LogLevel = z.infer<typeof logLevelSchema>;

/**
 * The three supported locales (ROUTE_MAP.md §1.2). Listed here because locale is
 * a platform constant, not a feature of the localisation library that arrives in
 * a later phase.
 */
export const localeSchema = z.enum(['en', 'ur', 'ar']);
export type Locale = z.infer<typeof localeSchema>;

/**
 * Formats a Zod failure into a message that names every invalid variable
 * without ever printing its value — a secret must not reach a log or a crash
 * trace (SECURITY_BASELINE.md §19.2).
 */
export function formatEnvironmentError(
  error: z.ZodError,
  scope: 'server' | 'client',
): string {
  const lines = error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    return `  - ${name}: ${issue.message}`;
  });

  return [
    `Invalid ${scope} environment configuration.`,
    ...lines,
    '',
    'See .env.example for the variables this phase expects.',
    'Values are never printed, only variable names.',
  ].join('\n');
}

/**
 * Treats an empty string as an absent variable.
 *
 * `.env.example` is valueless (SECURITY_BASELINE.md §18.1), so copying it to
 * `.env.local` yields `PORT=` rather than no `PORT` at all. Without this, a
 * developer following the documented setup would hit a validation failure on a
 * variable they were never required to set, and the natural fix — pasting real
 * values into the tracked example — is exactly what the rule exists to prevent.
 *
 * An empty string is not a meaningful value for any variable in this phase, so
 * treating it as "unset" lets the schema defaults apply as documented.
 */
function omitEmptyValues(
  source: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const cleaned: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(source)) {
    if (value !== '') cleaned[key] = value;
  }

  return cleaned;
}

/**
 * Parses a schema against a raw environment record and throws a redacted error
 * on failure. Fail fast, and never leak a value.
 */
export function parseEnvironment<T extends z.ZodType>(
  schema: T,
  source: Record<string, string | undefined>,
  scope: 'server' | 'client',
): z.infer<T> {
  const result = schema.safeParse(omitEmptyValues(source));

  if (!result.success) {
    throw new Error(formatEnvironmentError(result.error, scope));
  }

  return result.data;
}
