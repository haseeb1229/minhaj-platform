import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { FinderPage } from '@/components/global/directory';
import { finderCanonicalRedirect, readFinderView } from '@/components/global/global-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/global/find-a-centre` — Find a Centre (ROUTE_MAP.md §3.9).
 * `?country`, then `?region` OR `?city`, and `?page` (R2) are queries on this
 * one page: every combination is canonical to the bare finder and none is a
 * sitemap entry (§2.3, §9.4). The form's empty controls, another order and
 * Phase 16's `?offset=` are one redirect each; a place that cannot mean
 * anything is refused where it was asked, never widened.
 */
export const dynamic = 'force-dynamic';

interface FinderParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: FinderParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'global' });
  return shellMetadata({
    locale,
    route: requireRoute('find-a-centre'),
    title: t('sections.finder'),
    description: t('finder.intro'),
  });
}

export default async function FinderRoute({ params, searchParams }: FinderParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = finderCanonicalRedirect(globalPaths.finder(locale), query);
  if (canonical !== null) redirect(canonical);
  return <FinderPage locale={locale} view={readFinderView(query)} />;
}
