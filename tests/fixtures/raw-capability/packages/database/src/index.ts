// FIXTURE — MUST FAIL. The package's public entry handing out the raw client.
// This is the exact defect corrected in production `packages/database`:
// construction stayed inside the package and the constructed client went out
// through the front door (ARCHITECTURE.md §4.1).
export { getDatabaseClient } from './client';
export type { DatabaseClient } from './client';
export { createMessageStore } from './adapters/messaging';
