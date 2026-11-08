import { CollectionScreen } from '../../structure-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/collections/{id}` — one collection: its registered editions
 * and activation (operator-only, read-only here) and its display names.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.collection');
export const dynamic = 'force-dynamic';

export default CollectionScreen;
