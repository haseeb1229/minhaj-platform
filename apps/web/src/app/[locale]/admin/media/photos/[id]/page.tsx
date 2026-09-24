import { PhotoEditor } from '../../photo-surfaces';

/**
 * `/{locale}/admin/media/photos/{id}` — one Photo: its image through the
 * administrator's preview, the upload that replaces it, its words, credit, date
 * and lifecycle, and the Galleries it appears in.
 */
export const dynamic = 'force-dynamic';

export default PhotoEditor;
