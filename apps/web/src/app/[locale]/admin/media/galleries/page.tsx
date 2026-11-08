import { GalleryDirectory } from '../photo-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/media/galleries` — the Gallery directory and its create form. */
export const generateMetadata = adminPageMetadata('media', 'surface.galleries');
export const dynamic = 'force-dynamic';

export default GalleryDirectory;
