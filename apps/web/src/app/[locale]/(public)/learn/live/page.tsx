import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { readLiveOffset } from '@/components/live-learning/presentation';
import { LiveSchedulePage } from '@/components/live-learning/schedule';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/live` — Live Learning: the public schedule of upcoming
 * classes (ROUTE_MAP.md §3.5; DELIVERY_PLAN.md Phase 23).
 *
 * Whether anything is shown is a RUNTIME fact of the live-learning activation,
 * so the route is `excluded` from the build-bound sitemap and `noindex`
 * (ROUTE_MAP.md §9.5), and `force-dynamic` because classes are scheduled,
 * moved and cancelled. `?offset=` pages the schedule and is canonical to this
 * address. Nothing here reads a session.
 */
export const dynamic = 'force-dynamic';

interface LiveParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: LiveParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learnLive' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.live'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function LiveRoute({ params, searchParams }: LiveParams) {
  const locale = await requireLocale(params);
  return <LiveSchedulePage locale={locale} offset={readLiveOffset(await searchParams)} />;
}
