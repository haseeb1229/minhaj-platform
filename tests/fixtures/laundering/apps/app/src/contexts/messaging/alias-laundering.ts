// FIXTURE — MUST FAIL. Laundering reached through the `@/` path alias, proving
// alias resolution feeds the same graph as relative resolution.
import { ayahTable } from '@/shared/wrapper';
export const t = ayahTable;
