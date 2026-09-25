import { newsListingRoute } from '../news-routes';

/**
 * `/{locale}/news/statements` — Statements, an intentional navigational view the
 * information architecture curates (ROUTE_MAP.md §2.3), newest first.
 */
export const dynamic = 'force-dynamic';

const route = newsListingRoute('statement');

export const generateMetadata = route.generateMetadata;

export default route.Page;
