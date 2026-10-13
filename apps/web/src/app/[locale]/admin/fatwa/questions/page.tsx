import { QuestionsScreen } from '../question-surfaces';

/**
 * `/{locale}/admin/fatwa/questions` — intake under `question.receive`: every
 * question not yet answered, declined or closed, by stage, category and
 * answerer. Never a question's text.
 */
export const dynamic = 'force-dynamic';

export default QuestionsScreen;
