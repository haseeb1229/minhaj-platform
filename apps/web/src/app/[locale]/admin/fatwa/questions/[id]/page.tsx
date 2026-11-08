import { QuestionScreen } from '../../question-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/fatwa/questions/{id}` — one private question, read as an
 * audited data access, with triage, assignment and declining.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'question.heading');
export const dynamic = 'force-dynamic';

export default QuestionScreen;
