import { AudioSeriesEditor } from '../../../audio-surfaces';
import { adminPageMetadata } from '../../../../metadata';

/** `/{locale}/admin/media/audio/series/{id}` — one audio series and its tracks. */
export const generateMetadata = adminPageMetadata('admin', 'titles.media.audioSeries');
export const dynamic = 'force-dynamic';

export default AudioSeriesEditor;
