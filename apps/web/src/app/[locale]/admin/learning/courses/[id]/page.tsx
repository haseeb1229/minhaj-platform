import { CourseEditor } from '../../course-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/learning/courses/{id}` — `new` creates a draft; otherwise one
 * Course's facts, lifecycle and syllabus.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.learning.course');
export const dynamic = 'force-dynamic';

export default CourseEditor;
