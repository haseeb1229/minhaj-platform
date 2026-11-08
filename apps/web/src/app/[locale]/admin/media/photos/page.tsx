import { PhotoDirectory } from '../photo-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/media/photos` — the photograph directory, its gap filters and
 * the uploader that turns each chosen file into a draft Photo.
 */
export const generateMetadata = adminPageMetadata('media', 'surface.photos');
export const dynamic = 'force-dynamic';

export default PhotoDirectory;
