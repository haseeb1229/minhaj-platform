import { AudioSeriesDirectory } from '../../audio-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/media/audio/series` — the audio series directory. Beneath
 * `audio`, so it is never mistaken for the Video `series` screen.
 */
export const generateMetadata = adminPageMetadata('media', 'surface.audioSeries');
export const dynamic = 'force-dynamic';

export default AudioSeriesDirectory;
