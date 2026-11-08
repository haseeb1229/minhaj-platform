import { CountryEditor } from '../../place-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/global/countries/{id}` — one Country: its ISO code, slug, state and names.
 * `new` creates; any other segment must be a record's identifier.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.global.country');
export const dynamic = 'force-dynamic';

export default CountryEditor;
