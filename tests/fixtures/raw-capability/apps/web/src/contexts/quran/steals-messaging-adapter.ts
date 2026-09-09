// FIXTURE — MUST FAIL. A non-owner cannot directly obtain another context's
// adapter merely because the import lands on its public entry.
export { createMessageStore } from '../../../../../packages/database/src/adapters/messaging';
