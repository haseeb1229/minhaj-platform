import { TransliterationEditor } from '../../layer-surfaces';

/**
 * `/{locale}/admin/quran/transliterations/{id}` — one Transliteration work: its lifecycle,
 * metadata and texts per Surah. Never canonical text.
 */
export const dynamic = 'force-dynamic';

export default TransliterationEditor;
