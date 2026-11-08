import { TajweedEditor } from '../../tajweed-surfaces';
import { adminPageMetadata } from '../../../metadata';

/** `/{locale}/admin/quran/tajweed/{id}` — one Tajweed rule: its lifecycle and texts. */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.tajweed');
export const dynamic = 'force-dynamic';

export default TajweedEditor;
