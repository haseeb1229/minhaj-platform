import type { ProfileKind } from '@minhaj/contracts/people';

import { FacetDirectory } from '../facet-directory';

/**
 * `/{locale}/admin/people/speakers` — the speaker directory
 * (ROUTE_MAP.md §7).
 *
 * A THIN ROUTE OVER ONE SHARED IMPLEMENTATION. The four facet directories are
 * the same screen filtered by a different profile kind, so the screen is written
 * once in `../facet-directory.tsx` and each route supplies its kind. Four copies
 * would be four files to keep in step, and the day one gained a column the other
 * three would be the screens nobody noticed.
 *
 * `noindex, nofollow` and `force-dynamic` are declared HERE rather than in the
 * shared component, because Next reads route segment configuration from the
 * module it renders — an export on an imported component is not configuration,
 * it is a value nothing reads.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const KIND: ProfileKind = 'speaker';

export default function SpeakersPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <FacetDirectory kind={KIND} params={params} searchParams={searchParams} />;
}
