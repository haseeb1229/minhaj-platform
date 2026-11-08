import { QuestionsScreen } from '../question-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/questions` — intake under `question.receive`: every
 * question not yet answered, declined or closed, by stage, category and
 * answerer. Never a question's text.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.questions');
export const dynamic = 'force-dynamic';

export default QuestionsScreen;
