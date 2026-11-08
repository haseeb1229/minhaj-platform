import { LessonEditor } from '../../../../course-surfaces';
import { adminPageMetadata } from '../../../../../metadata';

/** `/{locale}/admin/learning/courses/{id}/lessons/{lessonId}` — one lesson's words. */
export const generateMetadata = adminPageMetadata('admin', 'titles.learning.lesson');
export const dynamic = 'force-dynamic';

export default LessonEditor;
