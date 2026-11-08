import { TranslationDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/translations` — every Translation work, in any state, and a new one. */
export const generateMetadata = adminPageMetadata('quranAdmin', 'surface.translations');
export const dynamic = 'force-dynamic';

export default TranslationDirectory;
