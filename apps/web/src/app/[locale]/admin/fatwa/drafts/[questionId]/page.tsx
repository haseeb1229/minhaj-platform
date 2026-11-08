import { DraftScreen } from '../../draft-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/fatwa/drafts/{questionId}` — one assigned question: its
 * private text (an audited read), the ruling's revisions and return notes, the
 * draft form and sending a revision for review.
 */
export const generateMetadata = adminPageMetadata('fatwaAdmin', 'drafts.heading');
export const dynamic = 'force-dynamic';

export default DraftScreen;
