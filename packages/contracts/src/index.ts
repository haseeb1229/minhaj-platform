/**
 * `@minhaj/contracts` — shared types and Zod schemas.
 *
 * Layer 0 (ARCHITECTURE.md §6.1). Importable by every bounded context and by
 * both processes. It owns no business rules and reaches no infrastructure.
 *
 * THIS ROOT IS BROWSER-SAFE. Everything exported here may legitimately end up
 * in a client bundle. There is currently no client environment variable: the
 * former site-origin setting duplicated the canonical server origin and had no
 * browser consumer, so it was retired rather than preserved as dead config.
 *
 * Server environment parsing is deliberately NOT re-exported here. It reads
 * `process.env` and will, in later phases, describe secrets; reaching it should
 * require naming it. Import it explicitly:
 *
 *     import { parseServerEnv } from '@minhaj/contracts/env/server';
 *
 * That subpath carries a `browser` export condition AND the `server-only`
 * marker, so a client bundle reaching it fails rather than silently pulling
 * server configuration into the browser (SECURITY_BASELINE.md §18.1).
 *
 * It is the ONLY public route to server environment parsing. The schema and
 * parser themselves live in `./env/server-schema.ts`, which carries the same
 * marker and which the `exports` map does not name — so no specifier resolves
 * to it, and reaching it by source path fails on the marker anyway. Review #3
 * reached a MARKER-FREE parser through a public `./env/schema` subpath; that
 * subpath is gone and the module behind it is now marked.
 *
 * Phase 0B holds only environment contracts. Domain schemas arrive with the
 * contexts that own them.
 */

export {
  localeSchema,
  logLevelSchema,
  nodeEnvSchema,
  formatEnvironmentError,
  parseEnvironment,
} from './env/shared.ts';
export type { Locale, LogLevel, NodeEnv } from './env/shared.ts';
