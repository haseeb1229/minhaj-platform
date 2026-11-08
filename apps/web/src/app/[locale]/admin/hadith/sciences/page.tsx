import { SciencesDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/sciences` — Hadith sciences study material, and a new one.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.sciences');
export const dynamic = 'force-dynamic';

export default SciencesDirectory;
