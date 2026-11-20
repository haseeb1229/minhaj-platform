import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { CentresPage } from '@/components/global/directory';
import {
  centresCanonicalRedirect,
  readCentresView,
} from '@/components/global/global-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/global/centres` — every public Centre, grouped by Country, with
 * `?kind=physical|virtual` and `?page` (24 a page; R2). One address per view
 * (Phase 16's `?offset=` is one redirect); an unknown kind is refused where it
 * was asked. Narrowing by place is the finder's.
 */
export const dynamic = 'force-dynamic';

interface CentresParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CentresParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'global' });
  return shellMetadata({
    locale,
    route: requireRoute('global.centres'),
    title: t('sections.centres'),
    description: t('centresIntro'),
  });
}

export default async function CentresRoute({ params, searchParams }: CentresParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = centresCanonicalRedirect(globalPaths.centres(locale), query);
  if (canonical !== null) redirect(canonical);
  return <CentresPage locale={locale} view={readCentresView(query)} />;
}
