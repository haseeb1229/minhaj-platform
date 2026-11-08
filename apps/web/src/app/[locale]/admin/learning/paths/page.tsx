import { PathDirectory } from '../path-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/learning/paths` — the LearningPath directory. */
export const generateMetadata = adminPageMetadata('adminLearning', 'surface.paths');
export const dynamic = 'force-dynamic';

export default PathDirectory;
