import { TranslationEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/quran/translations/{id}` — one Translation work: its lifecycle,
 * metadata and texts per Surah. Never canonical text.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.translation');
export const dynamic = 'force-dynamic';

export default TranslationEditor;
