import { seriesDetailRoute } from '../../series-routes';

/**
 * `/{locale}/watch/programs/{slug}` — one published programme and its episodes,
 * at its ONE canonical address. A former slug, or this programme's address under
 * `/watch/series`, answers a single 301 here from the request proxy.
 */
export const dynamic = 'force-dynamic';

const route = seriesDetailRoute('program');

export const generateMetadata = route.generateMetadata;

export default route.Page;
