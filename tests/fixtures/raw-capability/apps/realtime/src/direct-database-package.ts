// FIXTURE — MUST FAIL. The database package named directly. The realtime
// transport is handed narrow services by its composition root; it never
// imports the package that holds raw capability (ARCHITECTURE.md §3.1 rule 1).
import { createMessageStore } from '@minhaj/database';
export const store = createMessageStore;
