import { RecordsScreen } from '../record-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/records` — source-qualified records, narrowed by state
 * and collection, and the protected creation of a record.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.records');
export const dynamic = 'force-dynamic';

export default RecordsScreen;
