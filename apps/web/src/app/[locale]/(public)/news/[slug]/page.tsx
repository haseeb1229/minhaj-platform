import { newsDetailRoute } from '../news-routes';

/**
 * `/{locale}/news/{slug}` — one published NewsArticle. No NewsArticle slug can
 * be `archive` or a family's segment, so this route never competes with the
 * static routes beside it.
 */
export const dynamic = 'force-dynamic';

const route = newsDetailRoute('news-article');

export const generateMetadata = route.generateMetadata;

export default route.Page;
