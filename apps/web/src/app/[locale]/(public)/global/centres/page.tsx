import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CentresPage } from '@/components/global/directory';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/** `/{locale}/global/centres` — every public Centre, in bounded pages. */
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
  return <CentresPage locale={locale} query={await searchParams} />;
}
