import { CollectionsScreen } from '../structure-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/collections` — every collection, its activation (read-only)
 * and editions, and the protected creation of a new collection.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.collections');
export const dynamic = 'force-dynamic';

export default CollectionsScreen;
