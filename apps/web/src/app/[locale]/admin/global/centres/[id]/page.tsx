import { CentreEditor } from '../../centre-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/global/centres/{id}` — one Centre: its place, words, contacts and served Cities.
 * `new` creates; any other segment must be a record's identifier.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.global.centre');
export const dynamic = 'force-dynamic';

export default CentreEditor;
