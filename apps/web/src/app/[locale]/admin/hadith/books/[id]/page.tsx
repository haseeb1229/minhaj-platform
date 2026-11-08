import { BookScreen } from '../../structure-surfaces';
import { adminPageMetadata } from '../../../metadata';

/**
 * `/{locale}/admin/hadith/books/{id}` — one book: its sourced reference and title
 * (read-only) and its display names.
 */
export const generateMetadata = adminPageMetadata('admin', 'titles.hadith.book');
export const dynamic = 'force-dynamic';

export default BookScreen;
