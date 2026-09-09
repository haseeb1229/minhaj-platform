// FIXTURE — MUST FAIL. The client is nested in a field whose public type has
// been erased; nesting does not make possession into invocation.
import { getDatabaseClient } from '../../client';

export function connection(): { client: unknown } {
  return { client: getDatabaseClient() };
}
