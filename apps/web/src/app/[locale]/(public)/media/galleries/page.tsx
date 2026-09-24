import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { GalleriesPage } from '@/components/media/photos';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/galleries` — published galleries that hold at least one
 * public photograph, most recently created first, each with its genuine cover
 * (ROUTE_MAP.md §3.9).
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
  return <GalleriesPage locale={locale} query={await searchParams} />;
}
