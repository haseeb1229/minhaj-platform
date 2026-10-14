import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PathListingPage } from '@/components/learning/paths';
import { readLearnOffset } from '@/components/learning/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/paths` — every published LearningPath, `?offset=` paged
 * (ROUTE_MAP.md §3.5). Every offset is canonical to `/learn/paths` and none is
 * a sitemap entry (§2.3). `force-dynamic`: paths are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface PathsParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PathsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learn' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.paths'),
    title: t('sections.paths'),
    description: t('sectionBody.paths'),
  });
}

export default async function PathsPage({ params, searchParams }: PathsParams) {
  const locale = await requireLocale(params);
  return <PathListingPage locale={locale} offset={readLearnOffset(await searchParams)} />;
}
