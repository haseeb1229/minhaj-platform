import { CountryDirectory } from '../place-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/global/countries` — the Country directory, filtered and paged. */
export const generateMetadata = adminPageMetadata('admin.global', 'surface.countries');
export const dynamic = 'force-dynamic';

export default CountryDirectory;
