import { CommentaryEditor } from '../../layer-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/commentary/{id}` — one commentary work: its lifecycle,
 * metadata and entries keyed by record.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.commentary');
export const dynamic = 'force-dynamic';

export default CommentaryEditor;
