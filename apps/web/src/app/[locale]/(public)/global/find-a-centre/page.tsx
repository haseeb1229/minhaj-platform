import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FinderPage } from '@/components/global/directory';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/global/find-a-centre` — Find a Centre (ROUTE_MAP.md §3.9).
 * `?country=&region=&city=&offset=` are queries on this one page: every
 * combination is canonical to the bare finder and none is a sitemap entry
 * (§2.3, §9.4).
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
  return <FinderPage locale={locale} query={await searchParams} />;
}
