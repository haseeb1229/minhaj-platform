import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ListenLandingPage } from '@/components/media/listen';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/listen` — the Listen landing (ROUTE_MAP.md §3.7), a sibling of
 * `/watch`. Signed out, and `force-dynamic` because the recordings on it are
 * published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface ListenParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: ListenParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'listen' });
  return shellMetadata({
    locale,
    route: requireRoute('listen'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function ListenPage({ params }: ListenParams) {
  const locale = await requireLocale(params);
  return <ListenLandingPage locale={locale} />;
}
