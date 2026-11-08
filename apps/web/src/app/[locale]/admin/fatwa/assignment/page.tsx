import { AssignmentScreen } from '../question-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/fatwa/assignment` — the questions that have an answerer, and
 * who it is; reassignment happens on the question's own page.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'surface.assignment');
export const dynamic = 'force-dynamic';

export default AssignmentScreen;
