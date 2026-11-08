import { BooksScreen } from '../structure-surfaces';
import { adminPageMetadata } from '../../metadata';

/**
 * `/{locale}/admin/hadith/books` — books, narrowed by collection, and the protected
 * creation of a book for a registered edition.
 */
export const generateMetadata = adminPageMetadata('hadithAdmin', 'surface.books');
export const dynamic = 'force-dynamic';

export default BooksScreen;
