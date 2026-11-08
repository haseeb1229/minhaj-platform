import { SeriesDirectory } from '../surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/media/series` — series and programmes, and the create form. */
export const generateMetadata = adminPageMetadata('media', 'surface.series');
export const dynamic = 'force-dynamic';

export default SeriesDirectory;
