import { seriesListingRoute } from '../series-routes';

/**
 * `/{locale}/watch/series` — published series (ROUTE_MAP.md §3.7). Signed out;
 * `force-dynamic` because a cached copy would keep offering a withdrawn one.
 */
export const dynamic = 'force-dynamic';

const route = seriesListingRoute('series');

export const generateMetadata = route.generateMetadata;

export default route.Page;
