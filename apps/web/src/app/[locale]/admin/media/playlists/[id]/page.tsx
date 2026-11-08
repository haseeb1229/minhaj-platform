import { PlaylistEditor } from '../../surfaces';
import { adminPageMetadata } from '../../../metadata';

/** `/{locale}/admin/media/playlists/{id}` — one Playlist, its ordered Videos and its editor. */
export const generateMetadata = adminPageMetadata('admin', 'titles.media.playlist');
export const dynamic = 'force-dynamic';

export default PlaylistEditor;
