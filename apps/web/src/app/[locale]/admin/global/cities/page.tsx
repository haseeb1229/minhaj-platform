import { CityDirectory } from '../place-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/global/cities` — the City directory, filtered and paged. */
export const generateMetadata = adminPageMetadata('admin.global', 'surface.cities');
export const dynamic = 'force-dynamic';

export default CityDirectory;
