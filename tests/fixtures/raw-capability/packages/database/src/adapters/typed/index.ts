// FIXTURE — MUST FAIL. Explicitly annotated, and what it says is the raw
// client type one alias away from PrismaClient.
import type { DatabaseClient } from '../../client';
import { getDatabaseClient } from '../../client';

export function connection(): DatabaseClient {
  return getDatabaseClient();
}
