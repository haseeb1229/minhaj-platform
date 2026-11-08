import { AyahScreen } from '../../../canonical-surfaces';
import { adminPageMetadata } from '../../../../metadata';

/**
 * `/{locale}/admin/quran/ayat/{surah}/{ayah}` — one Ayah: its canonical text and
 * facts, its immutable history, its Topics, and the protected correction flow.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.quran.ayah');
export const dynamic = 'force-dynamic';

export default AyahScreen;
