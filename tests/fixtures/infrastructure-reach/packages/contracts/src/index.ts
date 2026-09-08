// THE DEFECT UNDER TEST. `@minhaj/contracts` is Layer 0 and reachable from
// every bounded context by design. Re-exporting the database here hands the
// database to all sixteen of them, without a single context naming it.
export { connection } from '@minhaj/database';
