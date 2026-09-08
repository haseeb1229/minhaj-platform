// FIXTURE — MUST FAIL. Real module-level cycle inside one context.
// ARCHITECTURE.md §6.3 rule 3 prohibits dependency cycles anywhere.
import { beta } from './beta';
export const alpha = () => beta();
