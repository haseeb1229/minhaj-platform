// FIXTURE — MUST FAIL. Receiving the raw client through a wrapper package. The
// prohibition is absolute and a wrapper chain does not satisfy it.
import { getDatabaseClient } from '@fixture/raw-capability-wrapper';
export const database = getDatabaseClient;
