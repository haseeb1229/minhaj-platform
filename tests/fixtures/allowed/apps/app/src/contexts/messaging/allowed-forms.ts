// FIXTURE — MUST PASS. Every permitted form of the allowlisted
// messaging -> learning edge, through the public interface only.
import { isCurrentlyEnrolled } from '@/contexts/learning';
export { isCurrentlyEnrolled } from '@/contexts/learning';
export const lazy = () => import('@/contexts/learning');
export const check = isCurrentlyEnrolled;
