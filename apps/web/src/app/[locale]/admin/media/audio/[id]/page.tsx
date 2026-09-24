import { AudioEditor } from '../../audio-surfaces';

/**
 * `/{locale}/admin/media/audio/{id}` — one audio track: its file, the
 * administrator's preview, the upload that attaches or replaces the file, and
 * its editor.
 */
export const dynamic = 'force-dynamic';

export default AudioEditor;
