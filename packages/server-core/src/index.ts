/**
 * `@minhaj/server-core` — a server-only physical hosting and export surface for
 * selected context-owned services (ARCHITECTURE.md §3.1).
 *
 * It exists so one implementation can be reached by two processes: `apps/web`
 * today, and `apps/realtime` when Messaging introduces it.
 *
 * What this package IS NOT — and Phase 0B must not quietly make it:
 *   ✘ not a bounded context — it has no domain language and no invariants
 *   ✘ not a second domain layer
 *   ✘ not a god-package
 *   ✘ not a route around boundaries
 *   ✘ never client-side
 *
 * Services are admitted here ONLY by justification: when a second process
 * genuinely needs one. "Shared-looking" is not a reason. Placing an
 * implementation here changes where it is exported from, never who owns it —
 * the owning bounded context remains its sole semantic owner.
 *
 * Phase 0B is STRUCTURE ONLY. The directories anticipated by ARCHITECTURE.md
 * §3.1 — `messaging/`, `authorization/`, `relationships/`, `session/` — are
 * deliberately NOT created. Each is owned by a context that does not exist yet,
 * and inventing services to populate a folder is exactly how a host package
 * becomes the god-package it is defined not to be.
 *
 * The only thing hosted today is the logging foundation, which is genuinely
 * server-only and genuinely needed by both processes.
 */

// The React/Next server-only marker. Next.js 16 recognises this specifier in
// its bundler and FAILS THE BUILD when a Client Component graph reaches this
// module (ARCHITECTURE.md §3.1, §6.3 rule 9). This is the authoritative gate:
// it holds for a direct import, a dynamic import, a re-export wrapper and a
// subpath alike, because it follows the real module graph rather than a
// filename convention.
import 'server-only';

export { createLogger, loggerOptions, withContext } from './logging/logger.ts';
export type { Logger } from './logging/logger.ts';
export {
  buildRedactionPaths,
  redactedFieldNames,
  redactionPlaceholder,
  sanitiseForLog,
} from './logging/redaction.ts';
