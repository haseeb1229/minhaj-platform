import { WordByWordDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/word-by-word` — every word-by-word work, in any state, and a new one (Quran Part 7). */
export const generateMetadata = adminPageMetadata('quranAdmin', 'surface.word-by-word');
export const dynamic = 'force-dynamic';

export default WordByWordDirectory;
