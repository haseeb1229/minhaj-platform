import { RegionDirectory } from '../place-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/global/regions` — the Region directory, filtered and paged. */
export const generateMetadata = adminPageMetadata('admin.global', 'surface.regions');
export const dynamic = 'force-dynamic';

export default RegionDirectory;
