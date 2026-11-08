import { RecitationEditor } from '../../recitation-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/quran/recitations/{id}` — one Recitation: its lifecycle,
 * metadata, segments, each segment's audio upload and private preview.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.recitation');
export const dynamic = 'force-dynamic';

export default RecitationEditor;
