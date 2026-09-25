import { newsDetailRoute } from '../../news-routes';

/**
 * `/{locale}/news/media-coverage/{slug}` — one published summary of another outlet's coverage, with a described link to the original where it is known.
 */
export const dynamic = 'force-dynamic';

const route = newsDetailRoute('media-coverage');

export const generateMetadata = route.generateMetadata;

export default route.Page;
