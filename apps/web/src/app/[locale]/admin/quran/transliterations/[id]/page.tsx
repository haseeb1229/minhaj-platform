import { TransliterationEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/quran/transliterations/{id}` — one Transliteration work: its lifecycle,
 * metadata and texts per Surah. Never canonical text.
 */
export const generateMetadata = adminPageMetadata(
  'admin',
  'titles.quran.transliteration',
);
export const dynamic = 'force-dynamic';

export default TransliterationEditor;
