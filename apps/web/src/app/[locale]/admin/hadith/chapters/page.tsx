import { ChaptersScreen } from '../structure-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/chapters` — chapters, narrowed by book, and the protected
 * creation of a chapter.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.chapters');
export const dynamic = 'force-dynamic';

export default ChaptersScreen;
