import { TafsirEditor } from '../../layer-surfaces';

/**
 * `/{locale}/admin/quran/tafsir/{id}` — one Tafsir work: its lifecycle,
 * metadata and texts per Surah. Never canonical text.
 */
export const dynamic = 'force-dynamic';

export default TafsirEditor;
