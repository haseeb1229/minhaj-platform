import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TrialPage } from '@/components/learning/landing';
import { readLearnOffset } from '@/components/learning/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/trial` — Trial Classes (ROUTE_MAP.md §3.5).
 *
 * An explanation, and the published Courses taught live, each linking to its
 * own page where the private island offers the request. A request is recorded
 * and NOTHING IS BOOKED: confirming a class is Phase 23's and is not offered,
 * and the page says so. `?offset=` pages the Courses and is canonical to this
 * address. `force-dynamic` because Courses are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface TrialParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: TrialParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learn' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.trial'),
    title: t('sections.trial'),
    description: t('sectionBody.trial'),
  });
}

export default async function TrialRoute({ params, searchParams }: TrialParams) {
  const locale = await requireLocale(params);
  return <TrialPage locale={locale} offset={readLearnOffset(await searchParams)} />;
}
