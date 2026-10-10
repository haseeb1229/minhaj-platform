import { CountryEditor } from '../../place-surfaces';

/**
 * `/{locale}/admin/global/countries/{id}` — one Country: its ISO code, slug, state and names.
 * `new` creates; any other segment must be a record's identifier.
 */
export const dynamic = 'force-dynamic';

export default CountryEditor;
