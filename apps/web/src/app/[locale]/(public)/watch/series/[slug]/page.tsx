import { seriesDetailRoute } from '../../series-routes';

/**
 * `/{locale}/watch/series/{slug}` — one published series and its episodes, at
 * its ONE canonical address. A former slug, or this series' address under
 * `/watch/programs`, answers a single 301 here from the request proxy.
 */
export const dynamic = 'force-dynamic';

const route = seriesDetailRoute('series');

export const generateMetadata = route.generateMetadata;

export default route.Page;
