/**
 * The non-secret environment fields needed while Next builds the public tree.
 *
 * This module is available to Node build configuration, not to browsers. The
 * application-facing entry is `./prerender.ts`, which adds the `server-only`
 * marker. Keeping the field definitions here lets `next.config.ts` validate
 * and bind the indexing posture into the build without importing the full
 * secret-bearing server schema or duplicating a validation rule.
 */
import { z } from 'zod';

import { parseEnvironment } from './shared.ts';

export const applicationOriginSchema = z
  .url({ protocol: /^https?$/ })
  .default('http://localhost:3000');

export const publicIndexingEnabledSchema = z
  .union([z.literal('true'), z.literal('false')])
  .default('false')
  .transform((value) => value === 'true');

export const prerenderEnvSchema = z.object({
  AUTH_BASE_URL: applicationOriginSchema,
  PUBLIC_INDEXING_ENABLED: publicIndexingEnabledSchema,
});

export type PrerenderEnv = z.infer<typeof prerenderEnvSchema>;

export const prerenderEnvKeys = Object.freeze(Object.keys(prerenderEnvSchema.shape));

export function parsePrerenderEnv(
  source: Record<string, string | undefined> = process.env,
): PrerenderEnv {
  return parseEnvironment(prerenderEnvSchema, source, 'server');
}
