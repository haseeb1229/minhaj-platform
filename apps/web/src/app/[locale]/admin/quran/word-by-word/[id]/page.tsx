import { WordByWordEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/quran/word-by-word/{id}` — one word-by-word work: its
 * lifecycle, metadata and contributors, and each Surah's glosses word by word
 * (Quran Part 7). Never canonical text.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.wordByWord');
export const dynamic = 'force-dynamic';

export default WordByWordEditor;
