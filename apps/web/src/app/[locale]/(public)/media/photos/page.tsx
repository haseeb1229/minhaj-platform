import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PhotosPage } from '@/components/media/photos';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/photos` — every published photograph, most recently added
 * first (ROUTE_MAP.md §3.9). No photograph has a page of its own: each opens
 * in the enlarged view here. `force-dynamic` because a cached copy would keep
 * offering a withdrawn photograph.
 */
export const dynamic = 'force-dynamic';

interface PhotosParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PhotosParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'photos' });
  return shellMetadata({
    locale,
    route: requireRoute('media.photos'),
    title: t('sections.photos'),
    description: t('sectionBody.photos'),
  });
}

export default async function PhotosRoute({ params, searchParams }: PhotosParams) {
  const locale = await requireLocale(params);
  return <PhotosPage locale={locale} query={await searchParams} />;
}
