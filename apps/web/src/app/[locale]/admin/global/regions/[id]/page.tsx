import { RegionEditor } from '../../place-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/global/regions/{id}` — one Region of one Country.
 * `new` creates; any other segment must be a record's identifier.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.global.region');
export const dynamic = 'force-dynamic';

export default RegionEditor;
