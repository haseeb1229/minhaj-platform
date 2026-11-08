import { PublishedListScreen } from '../review-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/published` — under `fatwa.publish`: every ruling ever
 * published, current and withdrawn.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.published');
export const dynamic = 'force-dynamic';

export default PublishedListScreen;
