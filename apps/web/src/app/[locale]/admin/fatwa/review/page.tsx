import { ReviewQueueScreen } from '../review-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/review` — under `fatwa.publish`: the rulings awaiting
 * scholar review.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.review');
export const dynamic = 'force-dynamic';

export default ReviewQueueScreen;
