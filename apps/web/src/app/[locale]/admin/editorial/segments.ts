import type { EditorialKind } from '@minhaj/contracts/editorial';

/**
 * Where each aggregate the editorial workflow governs is administered, beneath
 * `/admin/editorial` (ROUTE_MAP.md §7). The segment is also the aggregate's
 * section label in the `editorial` message catalogue, so a list, an editor, a
 * redirect after saving and the navigation can never disagree about it.
 */
export const EDITORIAL_SEGMENTS = Object.freeze({
  article: 'articles',
  page: 'pages',
  'news-article': 'news',
  'press-release': 'press-releases',
  statement: 'statements',
  'media-coverage': 'media-coverage',
  event: 'events',
  collection: 'collections',
} as const satisfies Record<EditorialKind, string>);
