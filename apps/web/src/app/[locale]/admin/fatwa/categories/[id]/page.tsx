import { CategoryScreen } from '../../category-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/fatwa/categories/{id}` — one category; its topic, position,
 * status and names are changed under `fatwa.publish`.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.fatwa.category');
export const dynamic = 'force-dynamic';

export default CategoryScreen;
