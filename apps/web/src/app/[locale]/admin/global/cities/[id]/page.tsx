import { CityEditor } from '../../place-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/global/cities/{id}` — one City of one Country, and its optional Region.
 * `new` creates; any other segment must be a record's identifier.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.global.city');
export const dynamic = 'force-dynamic';

export default CityEditor;
