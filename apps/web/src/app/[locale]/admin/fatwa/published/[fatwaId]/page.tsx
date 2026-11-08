import { PublishedScreen } from '../../review-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/fatwa/published/{fatwaId}` — one ruling's full public
 * history, its withdrawn state, and withdrawal behind confirmation and a
 * `fatwa-publication` step-up.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.fatwa.published');
export const dynamic = 'force-dynamic';

export default PublishedScreen;
