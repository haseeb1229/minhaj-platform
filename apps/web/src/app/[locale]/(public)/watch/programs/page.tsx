import { seriesListingRoute } from '../series-routes';

/**
 * `/{locale}/watch/programs` — published programmes (ROUTE_MAP.md §3.7). A
 * programme is a Series whose kind says so; there is no separate Program
 * aggregate. Signed out and `force-dynamic`.
 */
export const dynamic = 'force-dynamic';

const route = seriesListingRoute('program');

export const generateMetadata = route.generateMetadata;

export default route.Page;
