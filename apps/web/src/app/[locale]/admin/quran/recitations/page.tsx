import { RecitationDirectory } from '../recitation-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/quran/recitations` — every Recitation, in any state, and a new one. */
export const generateMetadata = adminPageMetadata('quranAdmin', 'surface.recitations');
export const dynamic = 'force-dynamic';

export default RecitationDirectory;
