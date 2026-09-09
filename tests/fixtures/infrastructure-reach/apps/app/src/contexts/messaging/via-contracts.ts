// REVIEW #3 EXACT REPRODUCTION — MUST FAIL.
//   messaging -> @minhaj/contracts -> @minhaj/database
// The first hop is approved. The composition is not.
import { connection } from '@minhaj/contracts';

export const used = connection;
