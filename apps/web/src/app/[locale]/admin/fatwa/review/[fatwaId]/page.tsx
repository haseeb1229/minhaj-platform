import { ReviewScreen } from '../../review-surfaces';

/**
 * `/{locale}/admin/fatwa/review/{fatwaId}` — one revision under review, in full,
 * beside what it would replace; returning it, and publishing it behind
 * confirmation and a `fatwa-publication` step-up.
 */
export const dynamic = 'force-dynamic';

export default ReviewScreen;
