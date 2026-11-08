import { PlaylistDirectory } from '../surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/media/playlists` — the Playlist directory and its create form. */
export const generateMetadata = adminPageMetadata('media', 'surface.playlists');
export const dynamic = 'force-dynamic';

export default PlaylistDirectory;
