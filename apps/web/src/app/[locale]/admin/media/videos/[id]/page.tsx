import { VideoEditor } from '../../surfaces';

/**
 * `/{locale}/admin/media/videos/{id}` — one Video, its privacy-gated preview and
 * its editor. One of the two routes whose CSP may frame a provider.
 */
export const dynamic = 'force-dynamic';

export default VideoEditor;
