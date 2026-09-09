// FIXTURE — MUST FAIL. The realtime process importing a persistence adapter
// directly, by RELATIVE PATH so no prohibited package NAME appears anywhere in
// the specifier (ARCHITECTURE.md §3.1.2).
export { createMessageStore } from '../../../packages/database/src/adapters/messaging';
