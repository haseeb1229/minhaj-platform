// A neutral-looking shared package whose only purpose is to pass the raw
// client along. "Neutral or shared packages exposing unrestricted database
// capability" is prohibited outright (ARCHITECTURE.md §3.1.2).
export { getDatabaseClient } from '@minhaj/database';
