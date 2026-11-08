import { TafsirDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/tafsir` — every Tafsir work, in any state, and a new one. */
export const generateMetadata = adminPageMetadata('quranAdmin', 'surface.tafsir');
export const dynamic = 'force-dynamic';

export default TafsirDirectory;
