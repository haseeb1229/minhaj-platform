import { newsListingRoute } from './news-routes';

/**
 * `/{locale}/news` — News and Events: the NewsArticles' listing and the
 * section's front door (ROUTE_MAP.md §3.9). `?topic, year, month, language,
 * sort, page`; the former `?sort=latest`, `?lang=` and `?offset=` are one
 * redirect each to the same view's one address. Every view is canonical to
 * `/news` and never a sitemap entry (§2.3).
 */
export const dynamic = 'force-dynamic';

const route = newsListingRoute('news-article');

export const generateMetadata = route.generateMetadata;

export default route.Page;
