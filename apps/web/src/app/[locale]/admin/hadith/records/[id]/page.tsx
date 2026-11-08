import { RecordScreen } from '../../record-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/records/{id}` — one record: its sourced facts, history,
 * verification, conflict evidence and citation, its topics and translations, and
 * the protected canonical changes.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.record');
export const dynamic = 'force-dynamic';

export default RecordScreen;
