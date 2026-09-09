// FIXTURE — MUST PASS. A nested OWN-CONTEXT relative import. A context's
// internal structure is its own business; ARCHITECTURE.md §6.3 rule 4 governs
// CROSS-context imports, and a rule that rejected this would make nesting a
// context's own modules a lint error.
import type { ConversationId } from '../identifiers';

export const conversations: readonly ConversationId[] = [];
