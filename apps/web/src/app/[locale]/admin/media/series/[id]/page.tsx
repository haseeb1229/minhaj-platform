import { SeriesEditor } from '../../surfaces';
import { adminPageMetadata } from '../../../metadata';

/** `/{locale}/admin/media/series/{id}` — one series or programme and its episodes. */
export const generateMetadata = adminPageMetadata('admin', 'titles.media.series');
export const dynamic = 'force-dynamic';

export default SeriesEditor;
