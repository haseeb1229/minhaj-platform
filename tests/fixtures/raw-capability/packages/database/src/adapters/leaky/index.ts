// FIXTURE — MUST FAIL. An adapter entry re-exporting the raw client. Being
// declared an adapter is not what makes a boundary (ARCHITECTURE.md §4.1).
export { getDatabaseClient } from '../../client';
