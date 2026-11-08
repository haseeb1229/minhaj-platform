import { GalleryEditor } from '../../photo-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/media/galleries/{id}` — one Gallery: its ordered Photos and
 * the named changes that add, move and remove them, and its editor.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.media.gallery');
export const dynamic = 'force-dynamic';

export default GalleryEditor;
