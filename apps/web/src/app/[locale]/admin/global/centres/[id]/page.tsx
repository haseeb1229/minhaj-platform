import { CentreEditor } from '../../centre-surfaces';

/**
 * `/{locale}/admin/global/centres/{id}` — one Centre: its place, words, contacts and served Cities.
 * `new` creates; any other segment must be a record's identifier.
 */
export const dynamic = 'force-dynamic';

export default CentreEditor;
