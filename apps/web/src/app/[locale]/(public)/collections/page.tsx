import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CollectionsPage } from '@/components/editorial/collections';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/collections` — every published Collection, newest publication
 * first, twenty to a page with `?offset=` (ROUTE_MAP.md §3.8). Every offset is
 * canonical to `/collections` and none is a sitemap entry (§2.3). There is no
 * `/collections/latest`, `popular` or `featured`. `force-dynamic`: Collections
 * are published and withdrawn.
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
  return <CollectionsPage locale={locale} query={await searchParams} />;
}
