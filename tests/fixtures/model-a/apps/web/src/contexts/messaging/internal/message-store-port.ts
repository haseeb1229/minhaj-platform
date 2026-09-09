// The Messaging context's OWN persistence port (DOMAIN_MODEL.md §2 rule 7).
// The contract is owned here; the adapter that fulfils it lives in the
// database package and remains owned by this context (ARCHITECTURE.md §4.1).
export interface MessageStore {
  save(body: string): Promise<string>;
}
