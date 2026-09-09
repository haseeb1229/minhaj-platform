// FIXTURE — MUST FAIL. Renaming the exported client factory changes no capability.
export { getDatabaseClient as obtain } from '../../client';
