// FIXTURE — MUST FAIL. A neutral wrapper is not a boundary. Re-exporting the
// private client through an innocent-looking shared module is exactly the
// laundering ARCHITECTURE.md §6.3 rule 13 names.
export { getDatabaseClient } from '../../../../packages/database/src/client';
