import { CourseDirectory } from '../course-surfaces';
import { adminPageMetadata } from '../../metadata';

/** `/{locale}/admin/learning/courses` — the Course directory. */
export const generateMetadata = adminPageMetadata('adminLearning', 'surface.courses');
export const dynamic = 'force-dynamic';

export default CourseDirectory;
