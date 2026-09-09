// FIXTURE — MUST FAIL. `any` lets the caller use the raw client immediately.
import { getDatabaseClient } from '../../client';

export function connection(): any {
  return getDatabaseClient();
}
