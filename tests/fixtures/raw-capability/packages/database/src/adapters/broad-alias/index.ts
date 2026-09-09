// FIXTURE — MUST FAIL. A local alias must not hide the broad type.
import { getDatabaseClient } from '../../client';

type HiddenCapability = unknown;

export function connection(): HiddenCapability {
  return getDatabaseClient();
}
