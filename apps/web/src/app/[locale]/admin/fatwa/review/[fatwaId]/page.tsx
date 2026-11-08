import { ReviewScreen } from '../../review-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/fatwa/review/{fatwaId}` — one revision under review, in full,
 * beside what it would replace; returning it, and publishing it behind
 * confirmation and a `fatwa-publication` step-up.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.fatwa.review');
export const dynamic = 'force-dynamic';

export default ReviewScreen;
