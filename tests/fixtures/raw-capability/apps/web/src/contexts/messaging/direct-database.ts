// FIXTURE — MUST FAIL. A context never imports the database package, whatever
// physically lives inside it (ARCHITECTURE.md §4.1; DOMAIN_MODEL.md §2 rule 7).
// The context owns the PORT; the adapter is wired at composition.
export { createMessageStore } from '@minhaj/database';
