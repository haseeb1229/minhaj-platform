import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { TrialPage } from '@/components/learning/trial';
import { learnPath } from '@/components/learning/presentation';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/trial` — Trial Classes (ROUTE_MAP.md §3.5).
 *
 * How a trial class is asked for and what happens next, and the newest
 * published Courses taught live, each linking to its own page where the
 * private island offers the request. A request is recorded and NOTHING IS
 * BOOKED, and the page says so. `force-dynamic` because Courses are published
 * and withdrawn.
 *
 * ONE ADDRESS (Learn Part 2). The page holds one view; the rest of the
 * Courses taught live are the catalogue's own `?format=live` view. The former
 * `?offset=` pager (until Learn Part 2) is ONE redirect to this address.
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
  if ('offset' in (await searchParams)) redirect(learnPath(locale, 'trial'));
  return <TrialPage locale={locale} />;
}
