import { TafsirEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/quran/tafsir/{id}` — one Tafsir work: its lifecycle,
 * metadata and texts per Surah. Never canonical text.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.tafsir');
export const dynamic = 'force-dynamic';

export default TafsirEditor;
