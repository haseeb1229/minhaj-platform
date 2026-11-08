import { TransliterationDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/transliterations` — every Transliteration work, in any state, and a new one. */
export const generateMetadata = adminPageMetadata(
  'quranAdmin',
  'surface.transliterations',
);
export const dynamic = 'force-dynamic';

export default TransliterationDirectory;
