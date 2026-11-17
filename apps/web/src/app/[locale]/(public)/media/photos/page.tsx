import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { PhotosPage } from '@/components/media/photos';
import { photosCanonicalRedirect, readPhotosView } from '@/components/media/photos-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/photos` — every published photograph (ROUTE_MAP.md §3.9):
 * `?year, month, gallery, language, sort, page` (News & Events Part 2). Each
 * view has ONE address — a form's empty controls, another order of the
 * parameters, a malformed or repeated value and Phase 12's `?offset=` are each
 * one redirect. Every view is canonical to `/media/photos` and never a sitemap
 * entry (§2.3). No photograph has a page of its own: each opens in the
 * enlarged view here. `force-dynamic` because a cached copy would keep
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
  const query = await searchParams;
  const canonical = photosCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <PhotosPage locale={locale} view={readPhotosView(query)} />;
}
