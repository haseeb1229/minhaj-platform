import { newsDetailRoute } from '../../news-routes';

/**
 * `/{locale}/news/press-releases/{slug}` — one published press release.
 */
export const dynamic = 'force-dynamic';

const route = newsDetailRoute('press-release');

export const generateMetadata = route.generateMetadata;

export default route.Page;
