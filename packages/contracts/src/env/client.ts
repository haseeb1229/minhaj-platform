import { z } from 'zod';

import { parseEnvironment } from './shared.ts';

/**
 * Client environment schema — Phase 0B scope only.
 *
 * Everything here is PUBLIC. It is inlined into the browser bundle at build
 * time, so a value placed here is disclosed to every visitor
 * (SECURITY_BASELINE.md §18.1).
 *
 * Two invariants, both asserted by test:
 *   1. Every key is prefixed `NEXT_PUBLIC_`.
 *   2. No key names anything secret-shaped.
 */
export const clientEnvSchema = z.object({
  /**
   * The site's canonical origin. Public by definition — it appears in every
   * canonical link and sitemap entry (ROUTE_MAP.md §2).
   */
  NEXT_PUBLIC_SITE_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:3000'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

/**
 * Substrings that must never appear in a client variable name. A public bundle
 * is not a place for any of these.
 */
export const secretNameFragments = Object.freeze([
  'SECRET',
  'PASSWORD',
  'TOKEN',
  'PRIVATE',
  'CREDENTIAL',
  'API_KEY',
  'APIKEY',
  'CONNECTION_STRING',
  'DATABASE_URL',
]);

/** The declared client keys, exported so tests can assert the invariants. */
export const clientEnvKeys = Object.freeze(Object.keys(clientEnvSchema.shape));

/**
 * Validates the client environment.
 *
 * `process.env` is not read here. Next.js inlines `NEXT_PUBLIC_` values by
 * static substitution, so the caller passes the explicit record it wants
 * validated; a dynamic lookup would not survive bundling.
 */
export function parseClientEnv(source: Record<string, string | undefined>): ClientEnv {
  return parseEnvironment(clientEnvSchema, source, 'client');
}
