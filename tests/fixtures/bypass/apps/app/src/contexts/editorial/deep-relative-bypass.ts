// FIXTURE — MUST FAIL. Review bypass: ../../ traversal into a sibling context.
// The target is Quran, which Editorial may never reach. (It was Library until
// Phase 15 admitted the one-way editorial -> library edge; a traversal into a
// context the allowlist PERMITS proves nothing about traversal.)
import { placeholder } from '../../contexts/quran/index';
export const q = placeholder;
