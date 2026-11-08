import { VideoDirectory } from '../surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/media/videos` — the Video directory and its create form. */
export const generateMetadata = adminPageMetadata('media', 'surface.videos');
export const dynamic = 'force-dynamic';

export default VideoDirectory;
