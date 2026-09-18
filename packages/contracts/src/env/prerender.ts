/**
 * Build-time configuration for the statically rendered public tree.
 *
 * This module is intentionally separate from `./server-schema.ts`. A public
 * prerender may reach this file, but must never reach the module that declares
 * authentication, email or other secret-bearing runtime configuration. The
 * full server schema imports these two field definitions, so this remains one
 * schema definition per variable rather than a second source of truth.
 */
import 'server-only';

export {
  applicationOriginSchema,
  parsePrerenderEnv,
  prerenderEnvKeys,
  prerenderEnvSchema,
  publicIndexingEnabledSchema,
} from './prerender-build.ts';
export type { PrerenderEnv } from './prerender-build.ts';
