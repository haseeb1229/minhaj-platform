import 'server-only';

/**
 * `@minhaj/realtime` — the Phase-25 realtime transport.
 *
 * A TRANSPORT ADAPTER THAT OWNS NO BUSINESS RULE (DELIVERY_PLAN.md Phase 25,
 * SECURITY_BASELINE.md §12). It decides socket lifecycle, frame validity,
 * per-connection budgets, which Messaging operation an event names, and
 * ephemeral presence and typing state — nothing else. Who may follow, read,
 * send, mark, type, receive or observe is answered by the Messaging and
 * Identity services hosted in `@minhaj/server-core`, injected by the realtime
 * process's composition root (`apps/web/src/composition/realtime.ts`).
 *
 * It never reaches the database, by any chain (ARCHITECTURE.md §3.1 rule 1,
 * §3.1.2): `scripts/check-architecture.mjs` enforces that transitively.
 *
 * NODE-RUNNABLE. Loaded by plain Node under `--conditions=react-server`, so
 * this workspace uses only erasable TypeScript: no enums, namespaces or
 * parameter properties.
 */

export { realtimeAddressFrom } from './config.ts';
export { startRealtimeServer } from './server.ts';
export type {
  RealtimeServer,
  RealtimeServerOptions,
  RealtimeSessionPort,
} from './types.ts';
