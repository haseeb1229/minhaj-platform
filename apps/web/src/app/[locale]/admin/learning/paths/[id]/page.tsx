import { PathEditor } from '../../path-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/learning/paths/{id}` — `new` creates a draft; otherwise one
 * path's words, lifecycle and ordered Courses.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.learning.path');
export const dynamic = 'force-dynamic';

export default PathEditor;
