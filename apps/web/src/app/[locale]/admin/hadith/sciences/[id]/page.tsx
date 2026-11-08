import { ScienceEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/sciences/{id}` — one sciences entry: its lifecycle and
 * plain-text title and body per language.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.science');
export const dynamic = 'force-dynamic';

export default ScienceEditor;
