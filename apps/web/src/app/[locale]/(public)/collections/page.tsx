import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CollectionsPage } from '@/components/editorial/collections';
import {
  collectionsCanonicalRedirect,
  readCollectionsView,
} from '@/components/editorial/collections-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/collections` — every published Collection (ROUTE_MAP.md §3.9):
 * `?topic, holds, language, sort, page`, twenty to a page (News & Events Part
 * 2). Each view has ONE address — a form's empty controls, another order of
 * the parameters, a malformed or repeated value and Phase 15's `?offset=` are
 * each ONE redirect to it — and every view is canonical to `/collections` and
 * never a sitemap entry (§2.3). There is no `/collections/latest`, `popular`
 * or `featured`. `force-dynamic`: Collections are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface CollectionsParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CollectionsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'collections' });
  return shellMetadata({
    locale,
    route: requireRoute('collections'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function CollectionsRoute({
  params,
  searchParams,
}: CollectionsParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = collectionsCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <CollectionsPage locale={locale} view={readCollectionsView(query)} />;
}
