import { RegionEditor } from '../../place-surfaces';

/**
 * `/{locale}/admin/global/regions/{id}` — one Region of one Country.
 * `new` creates; any other segment must be a record's identifier.
 */
export const dynamic = 'force-dynamic';

export default RegionEditor;
