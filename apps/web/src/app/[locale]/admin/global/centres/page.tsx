import { CentreDirectory } from '../place-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/global/centres` — the Centre directory, filtered and paged. */
export const generateMetadata = adminPageMetadata('admin.global', 'surface.centres');
export const dynamic = 'force-dynamic';

export default CentreDirectory;
