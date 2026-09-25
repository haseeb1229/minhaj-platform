import { newsDetailRoute } from '../../news-routes';

/**
 * `/{locale}/news/statements/{slug}` — one published statement, with the authority it is issued by.
 */
export const dynamic = 'force-dynamic';

const route = newsDetailRoute('statement');

export const generateMetadata = route.generateMetadata;

export default route.Page;
