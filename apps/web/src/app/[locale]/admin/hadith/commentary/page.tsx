import { CommentaryDirectory } from '../layer-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/commentary` — commentary works, and a new one.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.commentary');
export const dynamic = 'force-dynamic';

export default CommentaryDirectory;
