// REVIEW #3 EXACT REPRODUCTION — MUST FAIL.
//   apps/realtime -> @minhaj/contracts -> @minhaj/database
// ARCHITECTURE.md §3.1 rule 1 is absolute: the realtime process NEVER reaches
// the database. A wrapper chain does not satisfy "never".
import { connection } from '@minhaj/contracts';

export const used = connection;
