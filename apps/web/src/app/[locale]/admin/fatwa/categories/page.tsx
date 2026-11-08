import { CategoriesScreen } from '../category-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/categories` — every category, for any Fatwa key; the
 * creation of a category under `fatwa.publish`.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.categories');
export const dynamic = 'force-dynamic';

export default CategoriesScreen;
