import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { GalleriesPage } from '@/components/media/photos';
import {
  galleriesCanonicalRedirect,
  readGalleriesView,
} from '@/components/media/photos-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/galleries` — the published galleries that hold at least one
 * public photograph, each with its genuine cover, count and span of dates
 * (ROUTE_MAP.md §3.9): `?sort=oldest|title` and `?page` (News & Events Part
 * 2), most recently added first by default. Phase 12's `?offset=` and any
 * other spelling of a view are one redirect; every view is canonical to
 * `/media/galleries`.
 */
export const dynamic = 'force-dynamic';

interface GalleriesParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: GalleriesParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'photos' });
  return shellMetadata({
    locale,
    route: requireRoute('media.galleries'),
    title: t('sections.galleries'),
    description: t('sectionBody.galleries'),
  });
}

export default async function GalleriesRoute({ params, searchParams }: GalleriesParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = galleriesCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <GalleriesPage locale={locale} view={readGalleriesView(query)} />;
}
