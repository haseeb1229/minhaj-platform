import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { GlobalLandingPage } from '@/components/global/directory';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/global` — the World Network landing (ROUTE_MAP.md §3.9): the
 * directory's genuine entry points, its public Countries, and an honest
 * statement when nothing is published yet. Reads published directory data, so
 * it is rendered per request.
 */
export const dynamic = 'force-dynamic';

interface LandingParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: LandingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'global' });
  return shellMetadata({
    locale,
    route: requireRoute('global'),
    title: t('title'),
    description: t('intro'),
  });
}

export default async function GlobalRoute({ params }: LandingParams) {
  const locale = await requireLocale(params);
  return <GlobalLandingPage locale={locale} />;
}
