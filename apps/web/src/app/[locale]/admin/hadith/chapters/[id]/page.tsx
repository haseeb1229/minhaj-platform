import { ChapterScreen } from '../../structure-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/chapters/{id}` — one chapter: its sourced reference and
 * title (read-only) and its display names.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.chapter');
export const dynamic = 'force-dynamic';

export default ChapterScreen;
