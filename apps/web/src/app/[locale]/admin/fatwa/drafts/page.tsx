import { DraftsScreen } from '../draft-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/drafts` — under `fatwa.answer`: the questions assigned
 * to the signed-in answerer now.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.drafts');
export const dynamic = 'force-dynamic';

export default DraftsScreen;
