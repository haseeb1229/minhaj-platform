import { AyatScreen } from '../canonical-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/ayat` — one Surah's canonical ayat, paged and read-only. */
export const generateMetadata = adminPageMetadata('quranAdmin', 'surface.ayat');
export const dynamic = 'force-dynamic';

export default AyatScreen;
