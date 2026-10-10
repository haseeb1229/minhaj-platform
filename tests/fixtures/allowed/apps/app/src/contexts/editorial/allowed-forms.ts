// FIXTURE — MUST PASS. Every permitted form of the allowlisted
// editorial -> global-network edge (Phase 16), through the public interface only.
import { centreSelectable } from '@/contexts/global-network';
export { centreSelectable } from '@/contexts/global-network';
export const lazy = () => import('@/contexts/global-network');
export const check = centreSelectable;
