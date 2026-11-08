import { AudioDirectory } from '../audio-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/media/audio` — the audio track directory and its create form. */
export const generateMetadata = adminPageMetadata('media', 'surface.audio');
export const dynamic = 'force-dynamic';

export default AudioDirectory;
