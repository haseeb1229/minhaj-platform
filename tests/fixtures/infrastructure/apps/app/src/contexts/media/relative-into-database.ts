// FIXTURE — MUST FAIL.
// Reaching packages/database by relative path rather than by package name must
// not evade the prohibition (ARCHITECTURE.md §4.1).
import { client } from '../../../../../packages/database/src/index';

export const db = client;
