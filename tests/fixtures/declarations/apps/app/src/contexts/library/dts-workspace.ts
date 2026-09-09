// MUST FAIL — a bounded context reaching prohibited infrastructure through its
// DECLARATIONS. Data access is confined to packages/database and reached
// through an interface (ARCHITECTURE.md §4.1).
import type { Connection } from '@minhaj/database';

export type Used = Connection;
